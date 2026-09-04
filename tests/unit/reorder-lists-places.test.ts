import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { reorderPlaces } from "../../src/tools/reorder-places.ts";
import { reorderSections } from "../../src/tools/reorder-sections.ts";
import { isPlaceBlock, type TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";

function makeTrip(): TripPlan {
  const trip = structuredClone(checklistTrip);
  trip.itinerary.sections[0]!.heading = "Food";
  trip.itinerary.sections[0]!.blocks.push(
    {
      id: 50002,
      type: "place",
      place: { name: "Bakery Beta", place_id: "beta" },
      startTime: "08:00",
    },
    {
      id: 50003,
      type: "note",
      text: { ops: [{ insert: "Walk between stops\n" }] },
    },
    {
      id: 50004,
      type: "place",
      place: { name: "Cafe Gamma", place_id: "gamma" },
      text: { ops: [{ insert: "Window seat\n" }] },
    },
  );
  trip.itinerary.sections.splice(1, 0, {
    id: 150,
    type: "normal",
    mode: "placeList",
    heading: "Sights",
    date: null,
    blocks: [],
  });
  return trip;
}

function makeFakeContext(trip = makeTrip()): {
  ctx: AppContext;
  snapshot: () => TripPlan;
  submittedOps: Json0Op[][];
} {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  const client = {
    isSubscribed: true,
    version: 1,
    async submit(ops: Json0Op[]) {
      submittedOps.push(ops);
      this.version += 1;
    },
  };
  const ctx = {
    pool: { get: () => client },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, snapshot: () => entry.snapshot, submittedOps };
}

function customHeadings(trip: TripPlan): string[] {
  return trip.itinerary.sections
    .filter((section) => section.heading === "Food" || section.heading === "Sights")
    .map((section) => section.heading);
}

describe("reorderPlaces", () => {
  it("supports first and last boundary positions while preserving the complete block", async () => {
    const first = makeFakeContext();
    const gamma = structuredClone(first.snapshot().itinerary.sections[0]!.blocks[2]!);
    const firstResult = await reorderPlaces(first.ctx, {
      trip_key: "T",
      section: "Food",
      place_ref: "Cafe Gamma",
      position: 1,
    });
    expect(firstResult.isError).toBeUndefined();
    const firstPlaces = first.snapshot().itinerary.sections[0]!.blocks.filter(isPlaceBlock);
    expect(firstPlaces.map((block) => block.place.name)).toEqual([
      "Cafe Gamma",
      "Bakery Beta",
    ]);
    expect(firstPlaces[0]).toEqual(gamma);

    const last = makeFakeContext();
    const beta = structuredClone(last.snapshot().itinerary.sections[0]!.blocks[0]!);
    const lastResult = await reorderPlaces(last.ctx, {
      trip_key: "T",
      section: "Food",
      place_ref: "Bakery Beta",
      position: 2,
    });
    expect(lastResult.isError).toBeUndefined();
    const lastPlaces = last.snapshot().itinerary.sections[0]!.blocks.filter(isPlaceBlock);
    expect(lastPlaces.map((block) => block.place.name)).toEqual([
      "Cafe Gamma",
      "Bakery Beta",
    ]);
    expect(lastPlaces[1]).toEqual(beta);
  });

  it("rejects invalid positions, sections, days, and ambiguous names", async () => {
    const cases = [
      { section: "Food", place_ref: "Bakery Beta", position: 3 },
      { section: "Does not exist", place_ref: "Bakery Beta", position: 1 },
      { day: "day 9", place_ref: "Park Güell", position: 1 },
    ];
    for (const args of cases) {
      const fake = makeFakeContext();
      const result = await reorderPlaces(fake.ctx, { trip_key: "T", ...args });
      expect(result.isError).toBe(true);
      expect(fake.submittedOps).toHaveLength(0);
    }

    const duplicateTrip = makeTrip();
    duplicateTrip.itinerary.sections[0]!.blocks.push({
      id: 50005,
      type: "place",
      place: { name: "Bakery Beta", place_id: "beta-2" },
    });
    const duplicate = makeFakeContext(duplicateTrip);
    const result = await reorderPlaces(duplicate.ctx, {
      trip_key: "T",
      section: "Food",
      place_ref: "Bakery Beta",
      position: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("ambiguous");
    expect(duplicate.submittedOps).toHaveLength(0);
  });
});

describe("reorderSections", () => {
  it("moves custom lists to first and last positions without rewriting content", async () => {
    const first = makeFakeContext();
    const sights = structuredClone(
      first.snapshot().itinerary.sections.find((section) => section.heading === "Sights")!,
    );
    const firstResult = await reorderSections(first.ctx, {
      trip_key: "T",
      section: "Sights",
      position: 1,
    });
    expect(firstResult.isError).toBeUndefined();
    expect(customHeadings(first.snapshot())).toEqual(["Sights", "Food"]);
    expect(first.snapshot().itinerary.sections.find((section) => section.id === 150)).toEqual(sights);

    const last = makeFakeContext();
    const lastResult = await reorderSections(last.ctx, {
      trip_key: "T",
      section: "Food",
      position: 2,
    });
    expect(lastResult.isError).toBeUndefined();
    expect(customHeadings(last.snapshot())).toEqual(["Sights", "Food"]);
  });

  it("rejects non-custom, duplicate, and out-of-range targets", async () => {
    const base = makeFakeContext();
    for (const args of [
      { section: "Arrival day", position: 1 },
      { section: "Food", position: 3 },
    ]) {
      const result = await reorderSections(base.ctx, { trip_key: "T", ...args });
      expect(result.isError).toBe(true);
    }
    expect(base.submittedOps).toHaveLength(0);

    const duplicateTrip = makeTrip();
    duplicateTrip.itinerary.sections.unshift({
      id: 151,
      type: "normal",
      mode: "placeList",
      heading: "Sights",
      date: null,
      blocks: [],
    });
    const duplicate = makeFakeContext(duplicateTrip);
    const result = await reorderSections(duplicate.ctx, {
      trip_key: "T",
      section: "Sights",
      position: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("ambiguous");
    expect(duplicate.submittedOps).toHaveLength(0);
  });
});
