import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { TripPlan } from "../types.js";
import { listStateIds, loadState, newStateId, saveState, stateHash } from "./advanced-state.js";

export type BackupRecord = {
  backup_id: string;
  trip_key: string;
  created_at: string;
  label: string;
  trip_title: string;
  start_date: string;
  end_date: string;
  snapshot: TripPlan;
  sha256: string;
};

export async function saveTripBackup(
  ctx: AppContext,
  trip: TripPlan,
  label = "Manual snapshot",
): Promise<Omit<BackupRecord, "snapshot">> {
  const record: BackupRecord = {
    backup_id: newStateId(),
    trip_key: trip.key,
    created_at: new Date().toISOString(),
    label: label.slice(0, 120),
    trip_title: trip.title,
    start_date: trip.startDate,
    end_date: trip.endDate,
    snapshot: structuredClone(trip),
    sha256: stateHash(trip),
  };
  await saveState(ctx, trip.key, "backups", record.backup_id, record);
  // Verify the encrypted archive is readable and its full-trip checksum matches
  // before claiming the backup was created successfully.
  await readTripBackup(ctx, trip.key, record.backup_id);
  const { snapshot: _snapshot, ...info } = record;
  return info;
}

export async function readTripBackup(
  ctx: AppContext,
  trip: string,
  backupId: string,
): Promise<BackupRecord> {
  const backup = await loadState<BackupRecord>(ctx, trip, "backups", backupId);
  if (
    backup.trip_key !== trip ||
    backup.backup_id !== backupId ||
    backup.snapshot?.key !== trip ||
    !Array.isArray(backup.snapshot.itinerary?.sections) ||
    stateHash(backup.snapshot) !== backup.sha256
  ) {
    throw new WanderlogValidationError("Backup integrity check failed.");
  }
  return backup;
}

export const backupTripInputSchema = {
  trip_key: z.string().min(1),
  action: z.enum(["create", "list"]).default("create"),
  label: z.string().max(120).optional(),
};

export const backupTripDescription = [
  "Create or list encrypted full-trip snapshots, preserving itinerary sections,",
  "budgets, journal entries, trip metadata, notes, and reservation details.",
  "Requires WANDERLOG_MCP_STATE_KEY and persistent filesystem storage.",
  "Restore currently restores itinerary sections only; other data is archived but not restored.",
  "The encryption key and persistent local files must be retained for recovery.",
  "No Wanderlog itinerary modifications are performed.",
].join(" ");

type Args = { trip_key: string; action?: "create" | "list"; label?: string };

export async function backupTrip(ctx: AppContext, args: Args) {
  try {
    let result: unknown;
    if ((args.action ?? "create") === "list") {
      const ids = await listStateIds(ctx, args.trip_key, "backups");
      const backups: Array<Omit<BackupRecord, "snapshot">> = [];
      for (const id of ids) {
        const backup = await readTripBackup(ctx, args.trip_key, id);
        const { snapshot: _snapshot, ...info } = backup;
        backups.push(info);
      }
      result = {
        trip_key: args.trip_key,
        backups,
        restore_scope: "itinerary.sections",
        storage_notice: "Retain WANDERLOG_MCP_STATE_KEY and use a persistent local volume.",
      };
    } else {
      const trip = await ctx.tripCache.get(args.trip_key);
      result = {
        created: true,
        backup: await saveTripBackup(ctx, trip, args.label),
        archived_scope: "full TripPlan snapshot",
        restore_scope: "itinerary.sections",
        storage_notice:
          "A persistent local volume and the same encryption key are required for later restores.",
      };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message =
      error instanceof WanderlogError
        ? error.toUserMessage()
        : "Unexpected error: " + (error as Error).message;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
