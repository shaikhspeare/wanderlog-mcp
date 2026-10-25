import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import type { TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";
import { submitOp } from "./shared.js";
import { loadState, listStateIds, newStateId, saveState, stateHash } from "./advanced-state.js";
import {
  assertUnprotected,
  bookingProtected,
  parseProtection,
  planChanges,
  type PlanAction,
  type ProtectionState,
} from "./advanced-plan.js";
import { saveTripBackup } from "./backup-trip.js";

const moveAction = z.object({
  type: z.literal("move"),
  place: z.string().min(1),
  to_day: z.string().min(1),
  from_day: z.string().optional(),
  position: z.number().int().positive().optional(),
});
const reorderAction = z.object({
  type: z.literal("reorder"),
  place: z.string().min(1),
  day: z.string().min(1),
  position: z.number().int().positive(),
});
const timeAction = z.object({
  type: z.literal("set_time"),
  place: z.string().min(1),
  day: z.string().min(1),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});
const actionsSchema = z
  .array(z.discriminatedUnion("type", [moveAction, reorderAction, timeAction]))
  .min(1)
  .max(30);

export const previewChangesInputSchema = {
  trip_key: z.string().min(1),
  actions: actionsSchema,
  label: z.string().max(120).optional(),
};
export const previewChangesDescription = [
  "Validate and preview one to thirty place moves, reorders, or time edits.",
  "Returns an expiring preview_id, without changing Wanderlog.",
  "Every action must be unambiguous. Protected reservations and manually protected places",
  "cannot be changed. Applying a preview requires wanderlog_bulk_update with explicit approval.",
  "Encrypted previews are stored locally and require WANDERLOG_MCP_STATE_KEY.",
].join(" ");

export const bulkUpdateInputSchema = {
  trip_key: z.string().min(1),
  preview_id: z.string().uuid(),
  confirm_apply: z.boolean().default(false),
};
export const bulkUpdateDescription = [
  "Apply a previously validated preview only with confirm_apply=true.",
  "Revalidates the whole plan against the latest itinerary and protection rules,",
  "requires an unchanged source hash, and creates an encrypted backup before submitting.",
  "Never retry an ambiguous write failure before inspecting Wanderlog.",
].join(" ");

export const movePlaceToDayInputSchema = {
  trip_key: z.string().min(1),
  place: z.string().min(1),
  from_day: z.string().optional(),
  to_day: z.string().min(1),
  position: z.number().int().positive().optional(),
};
export const movePlaceToDayDescription = [
  "Prepare a lossless cross-day or custom-list place move and return a preview_id.",
  "Pass the preview_id to wanderlog_bulk_update with confirm_apply=true after review.",
  "Preserves the complete original block, including annotations, identifiers and times.",
  "No itinerary changes are made by this tool.",
].join(" ");

export const protectReservationsInputSchema = {
  trip_key: z.string().min(1),
  action: z.enum(["list", "protect", "unprotect"]).default("list"),
  places: z.array(z.string().min(1)).min(1).max(30).optional(),
};
export const protectReservationsDescription = [
  "List, add, or remove persistent protections for individual places, stored by block ID.",
  "Confirmed hotel bookings embedded in place blocks are always protected automatically.",
  "Protections are enforced by the new preview/bulk-update/restore workflow;",
  "they do not change how pre-existing mutation tools behave.",
  "Requires encrypted local state (WANDERLOG_MCP_STATE_KEY).",
].join(" ");

type PreviewRecord = {
  trip_key: string;
  preview_id: string;
  created_at: string;
  expires_at: string;
  source_hash: string;
  protected_hash: string;
  actions: PlanAction[];
  summary: Array<Record<string, string | number>>;
  label: string;
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
function failure(error: unknown) {
  const message =
    error instanceof WanderlogError
      ? error.toUserMessage()
      : "Unexpected error: " + (error as Error).message;
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export async function getProtections(ctx: AppContext, trip: string): Promise<ProtectionState> {
  const ids = await listStateIds(ctx, trip, "protections");
  if (!ids.includes("locks")) return { ids: [], updated_at: "" };
  return parseProtection(await loadState(ctx, trip, "protections", "locks"));
}

export async function createChangesPreview(
  ctx: AppContext,
  tripKey: string,
  actions: PlanAction[],
  label?: string,
) {
  const validated = actionsSchema.parse(actions);
  const trip = await ctx.tripCache.get(tripKey);
  const locks = await getProtections(ctx, tripKey);
  const proposed = planChanges(trip, validated, locks.ids);
  const now = Date.now();
  const record: PreviewRecord = {
    trip_key: tripKey,
    preview_id: newStateId(),
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 30 * 60 * 1000).toISOString(),
    source_hash: stateHash(trip.itinerary.sections),
    protected_hash: stateHash(locks.ids),
    actions: validated,
    summary: proposed.summary,
    label: label ?? "Itinerary change preview",
  };
  await saveState(ctx, tripKey, "previews", record.preview_id, record);
  return {
    preview_id: record.preview_id,
    expires_at: record.expires_at,
    changes: record.summary,
    change_count: record.summary.length,
    requires_approval: true,
    itinerary_modified: false,
  };
}

export async function applyChangesPreview(
  ctx: AppContext,
  tripKey: string,
  previewId: string,
  approved: boolean,
) {
  if (!approved)
    throw new WanderlogValidationError("Explicit confirmation required: confirm_apply=true.");
  const preview = await loadState<PreviewRecord>(ctx, tripKey, "previews", previewId);
  if (preview.trip_key !== tripKey || Date.parse(preview.expires_at) <= Date.now()) {
    throw new WanderlogValidationError("Preview has expired or belongs to another trip.");
  }
  const output = await submitOp(ctx, tripKey, async (entry, submit) => {
    const current = entry.snapshot;
    const locks = await getProtections(ctx, tripKey);
    if (
      stateHash(current.itinerary.sections) !== preview.source_hash ||
      stateHash(locks.ids) !== preview.protected_hash
    ) {
      throw new WanderlogValidationError(
        "The trip or protected place list changed; generate a fresh preview.",
      );
    }
    const planned = planChanges(current, preview.actions, locks.ids);
    if (stateHash(planned.summary) !== stateHash(preview.summary)) {
      throw new WanderlogValidationError("Preview no longer matches the requested actions.");
    }
    const backup = await saveTripBackup(ctx, current, "Before preview " + previewId);
    if (planned.operations.length > 0) await submit(planned.operations);
    if (stateHash(entry.snapshot.itinerary.sections) !== stateHash(planned.expectedSections)) {
      ctx.tripCache.invalidate(tripKey);
      throw new WanderlogValidationError(
        "Write may have completed, but verification failed. Inspect the trip before retrying.",
      );
    }
    return {
      applied: true,
      preview_id: previewId,
      changes: planned.summary,
      no_op: planned.operations.length === 0,
      backup_id: backup.backup_id,
      verified_against_local_cache: true,
    };
  });
  return output;
}

export async function previewChanges(
  ctx: AppContext,
  args: { trip_key: string; actions: PlanAction[]; label?: string },
) {
  try {
    return result(await createChangesPreview(ctx, args.trip_key, args.actions, args.label));
  } catch (error) {
    return failure(error);
  }
}

export async function movePlaceToDay(
  ctx: AppContext,
  args: { trip_key: string; place: string; to_day: string; from_day?: string; position?: number },
) {
  try {
    return result(
      await createChangesPreview(
        ctx,
        args.trip_key,
        [
          {
            type: "move",
            place: args.place,
            from_day: args.from_day,
            to_day: args.to_day,
            position: args.position,
          },
        ],
        "Move " + args.place + " to " + args.to_day,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function bulkUpdate(
  ctx: AppContext,
  args: { trip_key: string; preview_id: string; confirm_apply: boolean },
) {
  try {
    return result(
      await applyChangesPreview(ctx, args.trip_key, args.preview_id, args.confirm_apply),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function protectReservations(
  ctx: AppContext,
  args: { trip_key: string; action?: "list" | "protect" | "unprotect"; places?: string[] },
) {
  try {
    const trip: TripPlan = await ctx.tripCache.get(args.trip_key);
    const protectedState = await getProtections(ctx, args.trip_key);
    const action = args.action ?? "list";
    if (action !== "list") {
      if (!args.places?.length || args.places.length > 30) {
        throw new WanderlogValidationError("Supply 1 to 30 place references.");
      }
      const proposedIds: number[] = [];
      for (const ref of args.places) {
        const match = resolvePlaceRef(trip, ref);
        if (match.kind !== "unique" || !isPlaceBlock(match.match.block)) {
          throw new WanderlogValidationError("Place not found or reference ambiguous: " + ref);
        }
        const block = match.match.block;
        if (action === "unprotect" && bookingProtected(block)) {
          throw new WanderlogValidationError("Confirmed bookings cannot be unprotected.");
        }
        proposedIds.push(block.id);
      }
      const ids = new Set(protectedState.ids);
      for (const id of proposedIds) {
        if (action === "protect") ids.add(id);
        else ids.delete(id);
      }
      protectedState.ids = [...ids].sort((a, b) => a - b);
      protectedState.updated_at = new Date().toISOString();
      await saveState(ctx, args.trip_key, "protections", "locks", protectedState);
    }
    const manual = protectedState.ids.map((id) => {
      for (const section of trip.itinerary.sections) {
        const block = section.blocks.find((item) => item.id === id);
        if (block && isPlaceBlock(block)) return { id, name: block.place.name };
      }
      return { id, name: "(no longer in trip)" };
    });
    const automatic = trip.itinerary.sections.flatMap((section) =>
      section.blocks
        .filter(isPlaceBlock)
        .filter(bookingProtected)
        .map((block) => ({ id: block.id, name: block.place.name })),
    );
    return result({
      action,
      manual,
      automatically_protected: automatic,
      scope: "Advanced preview, bulk-update and restore tools only.",
    });
  } catch (error) {
    return failure(error);
  }
}
