import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../../src/context.js";
import type { TripPlan } from "../../src/types.js";
import { loadState, saveState, stateHash } from "../../src/tools/advanced-state.js";
import { readTripBackup, saveTripBackup } from "../../src/tools/backup-trip.js";
import { restoreBackup } from "../../src/tools/restore-backup.js";

const demoKey = "a".repeat(64);
let directory: string;
let previousKey: string | undefined;
let previousDirectory: string | undefined;
const sampleTrip = (): TripPlan => ({
  id: 1,
  key: "exampletrip",
  title: "Example trip",
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
    budget: {
      expenses: [{ id: 99, amount: { amount: 1999, currencyCode: "JPY" }, description: "Train" }],
    },
    journal: { summary: "Confidential journal" },
    sections: [
      {
        id: 100,
        mode: "dayPlan",
        type: "normal",
        date: "2026-11-21",
        heading: "Arrival",
        text: { ops: [{ insert: "Private itinerary note.\n" }] },
        blocks: [
          {
            id: 1,
            type: "place",
            place: {
              name: "Museum",
              place_id: "example-1",
            },
          },
        ],
      },
      {
        id: 101,
        mode: "placeList",
        type: "flights",
        date: null,
        heading: "Flights",
        blocks: [
          {
            id: 10,
            type: "flight",
            flightInfo: {
              airline: { name: "Test Airline", iata: "TA" },
              number: "12",
            },
          },
        ],
      },
    ],
  },
});

function context(trip = sampleTrip(), userId = 123): AppContext {
  return {
    userId,
    tripCache: { get: async () => trip },
  } as unknown as AppContext;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "wanderlog-advanced-"));
  previousKey = process.env.WANDERLOG_MCP_STATE_KEY;
  previousDirectory = process.env.WANDERLOG_MCP_STATE_DIR;
  process.env.WANDERLOG_MCP_STATE_KEY = demoKey;
  process.env.WANDERLOG_MCP_STATE_DIR = directory;
});
afterEach(async () => {
  if (previousKey === undefined) delete process.env.WANDERLOG_MCP_STATE_KEY;
  else process.env.WANDERLOG_MCP_STATE_KEY = previousKey;
  if (previousDirectory === undefined) delete process.env.WANDERLOG_MCP_STATE_DIR;
  else process.env.WANDERLOG_MCP_STATE_DIR = previousDirectory;
  await rm(directory, { recursive: true, force: true });
});

describe("encrypted local advanced state", () => {
  it("encrypts sensitive contents and scopes them by account and trip", async () => {
    const ctx = context();
    await saveState(ctx, "exampletrip", "previews", "draft", {
      note: "Sensitive note that must not be plaintext",
    });
    const payload = await readFile(
      join(directory, "123", "exampletrip", "previews", "draft.json"),
      "utf8",
    );
    expect(payload).not.toContain("Sensitive note");
    expect(await loadState(ctx, "exampletrip", "previews", "draft")).toEqual({
      note: "Sensitive note that must not be plaintext",
    });
    await expect(
      loadState(context(sampleTrip(), 456), "exampletrip", "previews", "draft"),
    ).rejects.toThrow();
    await expect(loadState(ctx, "anothertrip", "previews", "draft")).rejects.toThrow();
  });

  it("rejects a changed encryption key", async () => {
    const ctx = context();
    await saveState(ctx, "exampletrip", "previews", "draft", { a: 1 });
    process.env.WANDERLOG_MCP_STATE_KEY = "b".repeat(64);
    await expect(loadState(ctx, "exampletrip", "previews", "draft")).rejects.toThrow(
      /decrypt|verify/,
    );
  });

  it("requires a stable encryption key", async () => {
    delete process.env.WANDERLOG_MCP_STATE_KEY;
    await expect(
      saveState(context(), "exampletrip", "previews", "draft", { a: 1 }),
    ).rejects.toThrow(/WANDERLOG_MCP_STATE_KEY/);
  });

  it("backs up and verifies full-trip metadata including budgets and journal", async () => {
    const ctx = context();
    const original = sampleTrip();
    const metadata = await saveTripBackup(ctx, original, "Before changes");
    const restored = await readTripBackup(ctx, original.key, metadata.backup_id);
    expect(restored.sha256).toBe(stateHash(original));
    expect(restored.snapshot).toEqual(original);
    expect(restored.snapshot.itinerary.budget?.expenses).toHaveLength(1);
    expect(restored.snapshot.itinerary.journal?.summary).toBe("Confidential journal");
    expect(restored.label).toBe("Before changes");
  });

  it("rejects tampering with encrypted backup contents", async () => {
    const ctx = context();
    const backup = await saveTripBackup(ctx, sampleTrip());
    const path = join(directory, "123", "exampletrip", "backups", backup.backup_id + ".json");
    const encrypted = JSON.parse(await readFile(path, "utf8"));
    encrypted.ciphertext = "AAAA" + encrypted.ciphertext.slice(4);
    await writeFile(path, JSON.stringify(encrypted), "utf8");
    await expect(readTripBackup(ctx, "exampletrip", backup.backup_id)).rejects.toThrow(
      /decrypt|verify/,
    );
  });

  it("does not allow a restore preview to overwrite an existing flight reservation", async () => {
    const original = sampleTrip();
    const ctx = context();
    const backup = await saveTripBackup(ctx, original, "Before flight changes");
    const current = sampleTrip();
    const flight = current.itinerary.sections[1]!.blocks[0];
    if (flight.type !== "flight") throw new Error("Bad fixture");
    flight.flightInfo = { airline: { name: "Different Airline", iata: "DA" }, number: "99" };
    const active = context(current);
    const response = await restoreBackup(active, {
      trip_key: original.key,
      backup_id: backup.backup_id,
      action: "preview",
    });
    expect(response.isError).toBeUndefined();
    const data = JSON.parse(response.content[0]!.text);
    expect(data.can_apply).toBe(false);
    expect(data.protected_places_affected).toEqual(["flight #10"]);
  });
});
