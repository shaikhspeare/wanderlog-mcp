import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import { isPlaceBlock } from "../types.js";
import { submitOp } from "./shared.js";
import { loadState, newStateId, saveState, stateHash } from "./advanced-state.js";
import { assertUnprotected } from "./advanced-plan.js";
import { getProtections } from "./advanced-edits.js";
import { readTripBackup, saveTripBackup } from "./backup-trip.js";

type RestorePreview = {
  trip_key: string;
  backup_id: string;
  restore_token: string;
  current_hash: string;
  backup_hash: string;
  protected_hash: string;
  expires_at: string;
  affected_protected: string[];
};

export const restoreBackupInputSchema = {
  trip_key: z.string().min(1),
  backup_id: z.string().uuid(),
  action: z.enum(["preview", "apply"]).default("preview"),
  restore_token: z.string().uuid().optional(),
  confirm_destructive: z.boolean().default(false),
};
export const restoreBackupDescription = [
  "Preview or explicitly restore a previously encrypted local itinerary backup.",
  "Preview returns the changed section count, any protected-place conflicts, and a short-lived token.",
  "Apply requires restore_token and confirm_destructive=true, checks for intervening changes",
  "and protection conflicts, creates another backup, and restores ONLY itinerary sections.",
  "Date range, expenses, journal, and other trip metadata are not restored.",
  "Treat restore as destructive and review the current trip before confirming.",
].join(" ");

type Args = {
  trip_key: string;
  backup_id: string;
  action?: "preview" | "apply";
  restore_token?: string;
  confirm_destructive?: boolean;
};

export async function restoreBackup(ctx: AppContext, args: Args) {
  try {
    const backup = await readTripBackup(ctx, args.trip_key, args.backup_id);
    const backupSections = backup.snapshot.itinerary.sections;
    const backupSectionsHash = stateHash(backupSections);
    if ((args.action ?? "preview") === "preview") {
      const current = await ctx.tripCache.get(args.trip_key);
      const protections = await getProtections(ctx, args.trip_key);
      const matchesTripIdentity =
        current.id === backup.snapshot.id && current.key === backup.snapshot.key;
      const matchesTripDates =
        current.startDate === backup.start_date && current.endDate === backup.end_date;
      const changedProtected: string[] = [];
      const protectedSectionTypes = new Set(["hotels", "flights", "transit", "rentalCars"]);
      const reservedBlockTypes = new Set(["flight", "ferry", "bus", "train", "rentalCar"]);
      for (const section of current.itinerary.sections) {
        for (const block of section.blocks) {
          let protectedBlock =
            protectedSectionTypes.has(section.type) || reservedBlockTypes.has(block.type);
          if (isPlaceBlock(block)) {
            try {
              assertUnprotected(block, protections.ids);
            } catch {
              protectedBlock = true;
            }
          }
          if (!protectedBlock) continue;
          const restored = backupSections
            .flatMap((candidate) => candidate.blocks)
            .find((candidate) => candidate.id === block.id);
          const futureSection = backupSections.find((candidate) =>
            candidate.blocks.some((candidateBlock) => candidateBlock.id === block.id),
          );
          if (
            !restored ||
            !futureSection ||
            futureSection.id !== section.id ||
            stateHash(restored) !== stateHash(block)
          ) {
            const name = isPlaceBlock(block) ? block.place.name : block.type + " #" + block.id;
            changedProtected.push(name);
          }
        }
      }
      const restoreToken = newStateId();
      const record: RestorePreview = {
        trip_key: args.trip_key,
        backup_id: args.backup_id,
        restore_token: restoreToken,
        current_hash: stateHash(current.itinerary.sections),
        backup_hash: backup.sha256,
        protected_hash: stateHash(protections.ids),
        expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        affected_protected: changedProtected,
        // Date and identity changes must block preview approval as well as application.
      };
      await saveState(ctx, args.trip_key, "restore-previews", restoreToken, record);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                restore_token: restoreToken,
                expires_at: record.expires_at,
                from_backup: args.backup_id,
                current_sections: current.itinerary.sections.length,
                backup_sections: backupSections.length,
                protected_places_affected: changedProtected,
                matches_trip_identity: matchesTripIdentity,
                matches_trip_dates: matchesTripDates,
                can_apply: changedProtected.length === 0 && matchesTripIdentity && matchesTripDates,
                requires_explicit_confirmation: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (!args.confirm_destructive || !args.restore_token) {
      throw new WanderlogValidationError(
        "Restore requires a preview token and confirm_destructive=true.",
      );
    }

    const previous = await loadState<RestorePreview>(
      ctx,
      args.trip_key,
      "restore-previews",
      args.restore_token,
    );
    if (
      previous.backup_id !== args.backup_id ||
      previous.trip_key !== args.trip_key ||
      previous.restore_token !== args.restore_token ||
      Date.parse(previous.expires_at) <= Date.now() ||
      previous.affected_protected.length > 0
    ) {
      throw new WanderlogValidationError(
        "Restore preview invalid, expired, or has protected conflicts.",
      );
    }

    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const current = entry.snapshot;
      const protections = await getProtections(ctx, args.trip_key);
      if (
        stateHash(protections.ids) !== previous.protected_hash ||
        stateHash(current.itinerary.sections) !== previous.current_hash ||
        backup.sha256 !== previous.backup_hash
      ) {
        throw new WanderlogValidationError(
          "The itinerary or reservation protections changed; create a new restore preview.",
        );
      }
      if (current.id !== backup.snapshot.id || current.key !== backup.snapshot.key) {
        throw new WanderlogValidationError("Backup trip identity differs from the current trip.");
      }
      if (current.startDate !== backup.start_date || current.endDate !== backup.end_date) {
        throw new WanderlogValidationError(
          "Backup trip dates differ from the current trip; restore is blocked.",
        );
      }
      const emergencyBackup = await saveTripBackup(
        ctx,
        current,
        "Automatic backup before restore " + args.backup_id,
      );
      const original = structuredClone(current.itinerary.sections);
      const replacement = structuredClone(backupSections);
      if (stateHash(original) !== stateHash(replacement)) {
        await submit([{ p: ["itinerary", "sections"], od: original, oi: replacement }]);
      }
      if (stateHash(entry.snapshot.itinerary.sections) !== backupSectionsHash) {
        ctx.tripCache.invalidate(args.trip_key);
        throw new WanderlogValidationError(
          "Restore may have been submitted but verification failed. Inspect the trip before retrying.",
        );
      }
      return {
        restored: true,
        backup_id: args.backup_id,
        safety_backup_id: emergencyBackup.backup_id,
        verified_against_local_cache: true,
      };
    });
    // A successful ShareDB acknowledgement and local cache update do not prove
    // the write persisted. Subscribe again to read a fresh remote snapshot.
    ctx.tripCache.invalidate(args.trip_key);
    let confirmed: boolean;
    try {
      const freshTrip = await ctx.tripCache.get(args.trip_key);
      confirmed = stateHash(freshTrip.itinerary.sections) === backupSectionsHash;
    } catch {
      throw new WanderlogValidationError(
        "Restore may have completed, but the remote post-write read failed. " +
          "Inspect the current Wanderlog itinerary before retrying.",
      );
    }
    if (!confirmed) {
      throw new WanderlogValidationError(
        "Restore may have completed, but a fresh remote read does not match the backup. " +
          "Inspect the current itinerary before retrying.",
      );
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ...result, verified_by_fresh_remote_read: true }, null, 2),
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof WanderlogError
        ? error.toUserMessage()
        : "Unexpected error: " + (error as Error).message;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
