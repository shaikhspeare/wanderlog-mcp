import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import { editNote, findEditTargets } from "../../src/tools/edit-note.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";
import { mixedBlocksTrip } from "../fixtures/mixed-blocks-trip.ts";

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

function makeFakeContext(trip: TripPlan): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
  invalidateCount: { value: number };
} {
  const submittedOps: Json0Op[][] = [];
  const invalidateCount = { value: 0 };

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
      get: async () => structuredClone(trip),
      applyLocalOp: () => {},
      invalidate: () => {
        invalidateCount.value++;
      },
    },
  } as unknown as AppContext;

  return { ctx, submittedOps, invalidateCount };
}

// ---------------------------------------------------------------------------
// findEditTargets — note blocks
// ---------------------------------------------------------------------------

describe("findEditTargets — note blocks", () => {
  it("finds a note block by substring", () => {
    const trip = fresh(mixedBlocksTrip);
    const results = findEditTargets(trip, "nakamise");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("rich-text");
    expect(results[0]!.preview).toContain("Note:");
    expect(results[0]!.preview).toContain("Nakamise");
  });

  it("is case-insensitive", () => {
    const trip = fresh(checklistTrip);
    const results = findEditTargets(trip, "SUNSCREEN");
    expect(results).toHaveLength(1);
  });

  it("returns empty array for no match", () => {
    const trip = fresh(checklistTrip);
    expect(findEditTargets(trip, "xyz_impossible")).toHaveLength(0);
  });

  it("returns correct fieldPath for note block", () => {
    const trip = fresh(checklistTrip);
    const results = findEditTargets(trip, "sunscreen");
    expect(results).toHaveLength(1);
    const target = results[0]!;
    expect(target.fieldPath).toContain("text");
    expect(target.fieldPath).toContain("blocks");
  });

  it("records correct offset for note match", () => {
    const trip = fresh(mixedBlocksTrip);
    const results = findEditTargets(trip, "Check out the");
    expect(results).toHaveLength(1);
    const target = results[0]!;
    expect(target.offset).toBe(0);
    expect(target.matchedLen).toBe("Check out the".length);
  });

  it("detects cross-boundary match (span two ops)", () => {
    const trip = fresh(mixedBlocksTrip);
    // "Check out the Nakamise" spans op[0] ("Check out the ") and op[1] ("Nakamise...")
    const results = findEditTargets(trip, "Check out the Nakamise");
    expect(results).toHaveLength(1);
    const target = results[0]!;
    if (target.kind !== "rich-text") throw new Error("expected rich-text");
    expect(target.crossesBoundary).toBe(true);
  });

  it("does not flag as cross-boundary when match is within one op", () => {
    const trip = fresh(mixedBlocksTrip);
    const results = findEditTargets(trip, "Nakamise shopping street");
    expect(results).toHaveLength(1);
    const target = results[0]!;
    if (target.kind !== "rich-text") throw new Error("expected rich-text");
    expect(target.crossesBoundary).toBe(false);
  });

  it("filters by day", () => {
    const trip = fresh(checklistTrip);
    const onDay1 = findEditTargets(trip, "sunscreen", "day 1");
    expect(onDay1).toHaveLength(1);
    const onDay2 = findEditTargets(trip, "sunscreen", "day 2");
    expect(onDay2).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findEditTargets — place annotations
// ---------------------------------------------------------------------------

describe("findEditTargets — place annotations", () => {
  it("finds place annotation text", () => {
    const trip: TripPlan = {
      ...fresh(checklistTrip),
      itinerary: {
        sections: [
          {
            id: 1,
            type: "normal",
            mode: "dayPlan",
            heading: "",
            date: "2026-06-01",
            blocks: [
              {
                id: 50,
                type: "place",
                place: {
                  name: "Sensō-ji",
                  place_id: "ChIJyyy",
                  geometry: { location: { lat: 35.71, lng: 139.79 } },
                },
                text: { ops: [{ insert: "Arrive before 9am to avoid crowds.\n" }] },
              },
            ],
          },
        ],
      },
    };
    const results = findEditTargets(trip, "avoid crowds");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("rich-text");
    expect(results[0]!.preview).toContain("Sensō-ji");
    expect(results[0]!.label).toContain("Sensō-ji");
  });

  it("skips place blocks with no text annotation", () => {
    const trip = fresh(checklistTrip);
    // Park Güell has no text annotation
    const results = findEditTargets(trip, "Park");
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findEditTargets — checklist blocks
// ---------------------------------------------------------------------------

describe("findEditTargets — checklist blocks", () => {
  it("finds checklist title", () => {
    const trip = fresh(checklistTrip);
    const results = findEditTargets(trip, "Packing list");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("plain");
    expect(results[0]!.label).toBe("checklist title");
    expect(results[0]!.preview).toContain("Packing list");
  });

  it("finds checklist item text", () => {
    const trip = fresh(checklistTrip);
    const results = findEditTargets(trip, "Book tickets online");
    expect(results).toHaveLength(1);
    expect(results[0]!.kind).toBe("rich-text");
    expect(results[0]!.label).toBe("checklist item");
  });

  it("finds checklist item case-insensitively", () => {
    const trip = fresh(checklistTrip);
    expect(findEditTargets(trip, "PACK COMFORTABLE")).toHaveLength(1);
  });

  it("plain target stores correct oldValue and offset", () => {
    const trip = fresh(checklistTrip);
    const results = findEditTargets(trip, "Packing");
    expect(results).toHaveLength(1);
    const target = results[0]!;
    if (target.kind !== "plain") throw new Error("expected plain");
    expect(target.oldValue).toBe("Packing list");
    expect(target.offset).toBe(0);
    expect(target.matchedLen).toBe("Packing".length);
  });
});

// ---------------------------------------------------------------------------
// editNote handler
// ---------------------------------------------------------------------------

describe("editNote", () => {
  it("returns not-found when no match", async () => {
    const { ctx } = makeFakeContext(checklistTrip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "xyz_no_match",
      new_text: "replacement",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
  });

  it("returns ambiguous list when multiple matches", async () => {
    const trip: TripPlan = {
      ...fresh(checklistTrip),
      itinerary: {
        sections: [
          {
            id: 1,
            type: "normal",
            mode: "placeList",
            heading: "Notes",
            date: null,
            blocks: [
              { id: 10, type: "note", text: { ops: [{ insert: "Book the restaurant early\n" }] } },
              { id: 11, type: "note", text: { ops: [{ insert: "Book tickets online\n" }] } },
            ],
          },
        ],
      },
    };
    const { ctx, submittedOps } = makeFakeContext(trip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "book",
      new_text: "reserve",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("matches 2 notes");
    expect(submittedOps).toHaveLength(0);
  });

  it("edits a note block with rich-text op", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "sunscreen",
      new_text: "Neutrogena SPF 50",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Updated note");
    expect(result.content[0]!.text).toContain("sunscreen");
    expect(result.content[0]!.text).toContain("Neutrogena SPF 50");
    expect(submittedOps).toHaveLength(1);
    const op = submittedOps[0]![0] as { t: string; o: unknown[] };
    expect(op.t).toBe("rich-text");
    const deltaOps = op.o as Array<Record<string, unknown>>;
    expect(deltaOps.some((d) => "delete" in d)).toBe(true);
    expect(deltaOps.some((d) => d.insert === "Neutrogena SPF 50")).toBe(true);
  });

  it("edits a checklist title with plain oi/od op", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "Packing list",
      new_text: "Pre-trip checklist",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("checklist title");
    expect(submittedOps).toHaveLength(1);
    const op = submittedOps[0]![0] as { od: unknown; oi: unknown };
    expect(op.od).toBe("Packing list");
    expect(op.oi).toBe("Pre-trip checklist");
  });

  it("edits a checklist item with rich-text op", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "Book tickets online",
      new_text: "Buy tickets at the gate",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("checklist item");
    expect(submittedOps).toHaveLength(1);
    const op = submittedOps[0]![0] as { t: string };
    expect(op.t).toBe("rich-text");
  });

  it("rejects cross-boundary match with clear error", async () => {
    const { ctx, submittedOps } = makeFakeContext(mixedBlocksTrip);
    // "Check out the Nakamise" spans two ops
    const result = await editNote(ctx, {
      trip_key: "hxziqupjjlmrfrxw",
      old_text: "Check out the Nakamise",
      new_text: "Visit the",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("formatting boundary");
    expect(submittedOps).toHaveLength(0);
  });

  it("respects day filter", async () => {
    const { ctx, submittedOps } = makeFakeContext(checklistTrip);
    const result = await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "sunscreen",
      new_text: "sunblock",
      day: "day 2",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
    expect(submittedOps).toHaveLength(0);
  });

  it("retains text before match (offset > 0)", async () => {
    const trip: TripPlan = {
      ...fresh(checklistTrip),
      itinerary: {
        sections: [
          {
            id: 1,
            type: "normal",
            mode: "dayPlan",
            heading: "",
            date: "2026-06-01",
            blocks: [{ id: 10, type: "note", text: { ops: [{ insert: "Please book early.\n" }] } }],
          },
        ],
      },
    };
    const { ctx, submittedOps } = makeFakeContext(trip);
    await editNote(ctx, {
      trip_key: "checklisttripkey",
      old_text: "book",
      new_text: "reserve",
    });
    expect(submittedOps).toHaveLength(1);
    const deltaOps = (submittedOps[0]![0] as { o: Array<Record<string, unknown>> }).o;
    // Should have a retain for "Please " prefix
    expect(deltaOps[0]).toMatchObject({ retain: "Please ".length });
    expect(deltaOps.some((d) => d.insert === "reserve")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Place-ref normalization (Feature 3) — tested via resolvePlaceRef
// ---------------------------------------------------------------------------

describe("place-ref punctuation normalization", () => {
  it("matches hyphenated canonical name against unhyphenated ref", async () => {
    const { resolvePlaceRef } = await import("../../src/resolvers/place-ref.ts");
    const trip: TripPlan = {
      ...fresh(checklistTrip),
      itinerary: {
        sections: [
          {
            id: 1,
            type: "normal",
            mode: "dayPlan",
            heading: "",
            date: "2026-06-01",
            blocks: [
              {
                id: 1,
                type: "place",
                place: {
                  name: "Roppongi Hills - Tokyo City View",
                  place_id: "ChIJabc",
                  geometry: { location: { lat: 35.66, lng: 139.73 } },
                },
              },
            ],
          },
        ],
      },
    };
    const result = resolvePlaceRef(trip, "Roppongi Hills Tokyo City View");
    expect(result.kind).toBe("unique");
  });

  it("still matches exact hyphenated name", async () => {
    const { resolvePlaceRef } = await import("../../src/resolvers/place-ref.ts");
    const trip: TripPlan = {
      ...fresh(checklistTrip),
      itinerary: {
        sections: [
          {
            id: 1,
            type: "normal",
            mode: "dayPlan",
            heading: "",
            date: "2026-06-01",
            blocks: [
              {
                id: 1,
                type: "place",
                place: {
                  name: "Roppongi Hills - Tokyo City View",
                  place_id: "ChIJabc",
                  geometry: { location: { lat: 35.66, lng: 139.73 } },
                },
              },
            ],
          },
        ],
      },
    };
    const result = resolvePlaceRef(trip, "Roppongi Hills - Tokyo City View");
    expect(result.kind).toBe("unique");
  });
});
