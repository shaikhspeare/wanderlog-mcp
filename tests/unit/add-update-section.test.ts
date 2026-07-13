import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import {
  buildSectionObject,
  findSectionByRef,
} from "../../src/tools/shared.ts";
import { updateSection } from "../../src/tools/update-section.ts";
import type { Section, TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

function makeFakeContext(trip: TripPlan): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
} {
  const submittedOps: Json0Op[][] = [];
  const ctx = {
    pool: {
      get: () => ({
        isSubscribed: true,
        version: 1,
        async submit(ops: Json0Op[]) {
          submittedOps.push(ops);
        },
      }),
    },
    tripCache: {
      getEntry: async () => ({ snapshot: structuredClone(trip) }),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, submittedOps };
}

// ---------------------------------------------------------------------------
// buildSectionObject
// ---------------------------------------------------------------------------

describe("buildSectionObject", () => {
  it("produces the correct shape with a heading", () => {
    const s = buildSectionObject("Food & Drink");
    expect(s.type).toBe("normal");
    expect(s.mode).toBe("placeList");
    expect(s.heading).toBe("Food & Drink");
    expect(s.date).toBeNull();
    expect(s.blocks).toEqual([]);
    expect(s.text).toEqual({ ops: [{ insert: "\n" }] });
    expect(s.placeMarkerColor).toBe("#3498db");
    expect(s.placeMarkerIcon).toBe("map-marker");
    expect(typeof s.id).toBe("number");
    expect(s.id).toBeGreaterThanOrEqual(0);
    expect(s.id).toBeLessThan(1_000_000_000);
  });

  it("accepts an empty heading", () => {
    const s = buildSectionObject("");
    expect(s.heading).toBe("");
  });

  it("generates unique IDs across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => buildSectionObject("X").id));
    expect(ids.size).toBeGreaterThan(45);
  });
});

// ---------------------------------------------------------------------------
// findSectionByRef
// ---------------------------------------------------------------------------

describe("findSectionByRef", () => {
  it("finds 'places to visit' alias", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "places to visit");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Places to visit");
  });

  it("finds 'places' alias (short form)", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "places");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Places to visit");
  });

  it("finds a section by its exact heading", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "Notes");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("Notes");
    expect(result!.index).toBe(0);
  });

  it("matches heading case-insensitively", () => {
    const trip = fresh(checklistTrip);
    const result = findSectionByRef(trip, "notes");
    expect(result).not.toBeNull();
    expect(result!.index).toBe(0);
  });

  it("returns null for an unknown reference", () => {
    const trip = fresh(checklistTrip);
    expect(findSectionByRef(trip, "Nonexistent Section")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section list insert (li)
// ---------------------------------------------------------------------------

describe("applyOp – section li", () => {
  it("inserts a new section at the end", () => {
    const doc = fresh(checklistTrip);
    const section = buildSectionObject("Day Trips");
    const insertIndex = doc.itinerary.sections.length;
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", insertIndex], li: section },
    ];
    const next = applyOp(doc, ops);
    expect(next.itinerary.sections).toHaveLength(insertIndex + 1);
    const inserted = next.itinerary.sections[insertIndex]! as Section;
    expect(inserted.heading).toBe("Day Trips");
    expect(inserted.type).toBe("normal");
    expect(inserted.mode).toBe("placeList");
    expect(inserted.blocks).toEqual([]);
  });

  it("inserts a section at a mid-trip position", () => {
    const doc = fresh(checklistTrip);
    const section = buildSectionObject("Must-See");
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 1], li: section },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[1]! as Section).heading).toBe("Must-See");
    // Existing section at index 1 is shifted to index 2
    expect((next.itinerary.sections[2]! as Section).heading).toBe("Places to visit");
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section heading update (od + oi)
// ---------------------------------------------------------------------------

describe("applyOp – section heading od+oi", () => {
  it("updates a section heading in place", () => {
    const doc = fresh(checklistTrip);
    // Section at index 0 has heading "Notes"
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "Trip Notes",
      },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[0]! as Section).heading).toBe("Trip Notes");
    // Other fields on the section should be unchanged
    expect(next.itinerary.sections[0]!.id).toBe(doc.itinerary.sections[0]!.id);
  });

  it("clears a heading to empty string", () => {
    const doc = fresh(checklistTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "",
      },
    ];
    const next = applyOp(doc, ops);
    expect((next.itinerary.sections[0]! as Section).heading).toBe("");
  });

  it("does not affect sibling sections", () => {
    const doc = fresh(checklistTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "heading"],
        od: "Notes",
        oi: "Renamed",
      },
    ];
    const next = applyOp(doc, ops);
    // Section at index 1 ("Places to visit") must be untouched
    expect((next.itinerary.sections[1]! as Section).heading).toBe(
      doc.itinerary.sections[1]!.heading,
    );
  });
});

// ---------------------------------------------------------------------------
// applyOp round-trip: section list delete (ld)
// ---------------------------------------------------------------------------

describe("applyOp – section ld", () => {
  it("removes a section and shifts remaining sections", () => {
    const doc = fresh(checklistTrip);
    const sectionCount = doc.itinerary.sections.length;
    // Delete the section at index 0 ("Notes")
    const target = doc.itinerary.sections[0]!;
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 0], ld: target },
    ];
    const next = applyOp(doc, ops);
    expect(next.itinerary.sections).toHaveLength(sectionCount - 1);
    // Former index 1 ("Places to visit") is now at index 0
    expect((next.itinerary.sections[0]! as Section).heading).toBe("Places to visit");
  });

  it("throws when ld value does not match the existing section", () => {
    const doc = fresh(checklistTrip);
    const staleSection = { ...doc.itinerary.sections[0]!, heading: "Wrong heading" };
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 0], ld: staleSection },
    ];
    expect(() => applyOp(doc, ops)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateSection guards — must refuse day/places-to-visit/system sections,
// mirroring deleteSection so it can't collide with rename_day or corrupt
// the day structure.
// ---------------------------------------------------------------------------

describe("updateSection guards", () => {
  it("refuses to rename a day (dayPlan) section and points at rename_day", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Arrival day",
      heading: "Renamed day",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("rename_day");
    expect(submittedOps).toHaveLength(0);
  });

  it("refuses to rename the 'Places to visit' default list", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Places to visit",
      heading: "My places",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("default place list");
    expect(submittedOps).toHaveLength(0);
  });

  it("allows renaming a genuine custom section", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const res = await updateSection(ctx, {
      trip_key: "T",
      section: "Notes",
      heading: "Trip Notes",
    });
    expect(res.isError).toBeUndefined();
    expect(submittedOps).toHaveLength(1);
    expect(submittedOps[0]![0]!).toMatchObject({
      od: "Notes",
      oi: "Trip Notes",
    });
  });
});
