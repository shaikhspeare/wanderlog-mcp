import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../../src/context.js";
import type { Json0Op } from "../../src/ot/apply.js";
import { applyOp } from "../../src/ot/apply.js";
import type { TripPlan } from "../../src/types.js";
import { saveTripBackup } from "../../src/tools/backup-trip.js";
import { restoreBackup } from "../../src/tools/restore-backup.js";

const baseTrip = (): TripPlan => ({
  id: 123,
  key: "demo-trip",
  title: "Demonstration",
  userId: 123,
  privacy: "private",
  startDate: "2026-11-21",
  endDate: "2026-11-22",
  days: 2,
  placeCount: 1,
  schemaVersion: 2,
  createdAt: "",
  updatedAt: "",
  itinerary: {
    sections: [
      {
        id: 100,
        type: "normal",
        mode: "dayPlan",
        heading: "Arrival",
        date: "2026-11-21",
        blocks: [
          {
            id: 1,
            type: "place",
            place: { name: "Museum", place_id: "museum-1" },
          },
        ],
      },
      {
        id: 200,
        type: "flights",
        mode: "placeList",
        heading: "Flights",
        date: null,
        blocks: [{ id: 7, type: "flight" }],
      },
    ],
  },
});

let storageDirectory: string;
let keyBefore: string | undefined;
let directoryBefore: string | undefined;
beforeEach(async () => {
  keyBefore = process.env.WANDERLOG_MCP_STATE_KEY;
  directoryBefore = process.env.WANDERLOG_MCP_STATE_DIR;
  storageDirectory = await mkdtemp(join(tmpdir(), "wanderlog-restore-"));
  process.env.WANDERLOG_MCP_STATE_KEY = "a".repeat(64);
  process.env.WANDERLOG_MCP_STATE_DIR = storageDirectory;
});
afterEach(async () => {
  if (keyBefore === undefined) delete process.env.WANDERLOG_MCP_STATE_KEY;
  else process.env.WANDERLOG_MCP_STATE_KEY = keyBefore;
  if (directoryBefore === undefined) delete process.env.WANDERLOG_MCP_STATE_DIR;
  else process.env.WANDERLOG_MCP_STATE_DIR = directoryBefore;
  await rm(storageDirectory, { recursive: true, force: true });
});

function simulatedContext(persistSubmit: boolean) {
  const initial = baseTrip();
  const changed = baseTrip();
  const updated = changed.itinerary.sections[0]!.blocks[0];
  if (updated.type !== "place") throw new Error("Incorrect fixture");
  updated.place.name = "Updated Museum";

  let remote = structuredClone(changed);
  let cached = structuredClone(changed);
  let invalidated = false;
  let versions = 1;

  const client = {
    isSubscribed: true,
    version: versions,
    submit: async (ops: Json0Op[]) => {
      versions++;
      client.version = versions;
      if (persistSubmit) remote = applyOp(remote, ops);
    },
  };
  const entry = {
    get snapshot() {
      return cached;
    },
    get version() {
      return versions;
    },
    client,
  };
  const ctx = {
    userId: 123,
    tripCache: {
      get: async () => (invalidated ? structuredClone(remote) : cached),
      getEntry: async () => entry,
      applyLocalOp: (_: string, ops: Json0Op[]) => {
        cached = applyOp(cached, ops);
      },
      invalidate: () => {
        invalidated = true;
      },
    },
    pool: { get: () => client },
  } as unknown as AppContext;
  return { ctx, initial, getRemote: () => remote };
}

describe("restore remote verification", () => {
  it("confirms a completed restore from a fresh remote snapshot", async () => {
    const { ctx, initial, getRemote } = simulatedContext(true);
    const backup = await saveTripBackup(ctx, initial);
    const preview = await restoreBackup(ctx, {
      trip_key: "demo-trip",
      backup_id: backup.backup_id,
      action: "preview",
    });
    expect(preview.isError).toBeUndefined();
    const info = JSON.parse(preview.content[0]!.text);
    expect(info.can_apply).toBe(true);
    const applied = await restoreBackup(ctx, {
      trip_key: "demo-trip",
      backup_id: backup.backup_id,
      action: "apply",
      restore_token: info.restore_token,
      confirm_destructive: true,
    });
    expect(applied.isError).toBeUndefined();
    const receipt = JSON.parse(applied.content[0]!.text);
    expect(receipt.verified_by_fresh_remote_read).toBe(true);
    expect(getRemote().itinerary.sections).toEqual(initial.itinerary.sections);
  });

  it("does not claim success if only the local cache reflects the write", async () => {
    const { ctx, initial, getRemote } = simulatedContext(false);
    const backup = await saveTripBackup(ctx, initial);
    const preview = await restoreBackup(ctx, {
      trip_key: "demo-trip",
      backup_id: backup.backup_id,
      action: "preview",
    });
    const info = JSON.parse(preview.content[0]!.text);
    const applied = await restoreBackup(ctx, {
      trip_key: "demo-trip",
      backup_id: backup.backup_id,
      action: "apply",
      restore_token: info.restore_token,
      confirm_destructive: true,
    });
    expect(applied.isError).toBe(true);
    expect(applied.content[0]!.text).toMatch(/fresh remote read/);
    expect(getRemote().itinerary.sections).not.toEqual(initial.itinerary.sections);
  });

  it("flags date mismatches in the preview before approval", async () => {
    const { ctx, initial } = simulatedContext(true);
    initial.startDate = "2026-11-20";
    const backup = await saveTripBackup(ctx, initial);
    const preview = await restoreBackup(ctx, {
      trip_key: "demo-trip",
      backup_id: backup.backup_id,
      action: "preview",
    });
    const result = JSON.parse(preview.content[0]!.text);
    expect(result.matches_trip_dates).toBe(false);
    expect(result.can_apply).toBe(false);
  });
});
