import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { annotatePlace } from "../../src/tools/annotate-place.ts";
import { removePlace } from "../../src/tools/remove-place.ts";
import type { TripPlan } from "../../src/types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("concurrent mutation identity", () => {
  it("re-resolves an annotation by block ID after a preceding removal shifts its index", async () => {
    const target = {
      id: 202,
      type: "place" as const,
      place: { name: "Target Museum", place_id: "target" },
      text: { ops: [{ insert: "\n" }] },
    };
    const decoy = {
      id: 303,
      type: "place" as const,
      place: { name: "Decoy Cafe", place_id: "decoy" },
      text: { ops: [{ insert: "untouched\n" }] },
    };
    const trip = {
      title: "Identity trip",
      itinerary: {
        sections: [
          {
            id: 10,
            type: "transit",
            mode: "placeList",
            heading: "Transit",
            date: null,
            blocks: [
              { id: 101, type: "train", text: { ops: [{ insert: "\n" }] } },
              target,
              decoy,
            ],
          },
        ],
      },
    } as unknown as TripPlan;
    const entry = { snapshot: trip, version: 1, geos: [] };
    const removalStarted = deferred();
    const releaseRemoval = deferred();
    const submitted: Json0Op[][] = [];
    let submitCount = 0;
    const client = {
      isSubscribed: true,
      version: 1,
      async submit(ops: Json0Op[]) {
        submitted.push(ops);
        submitCount++;
        if (submitCount === 1) {
          removalStarted.resolve();
          await releaseRemoval.promise;
        }
        this.version++;
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

    const removal = removePlace(ctx, { trip_key: "trip", place_ref: "the train" });
    await removalStarted.promise;
    const annotation = annotatePlace(ctx, {
      trip_key: "trip",
      place: "Target Museum",
      note: "Follow the target",
    });
    expect(submitted).toHaveLength(1);
    releaseRemoval.resolve();

    const [removeResult, annotateResult] = await Promise.all([removal, annotation]);
    expect(removeResult.isError).toBeUndefined();
    expect(annotateResult.isError).toBeUndefined();
    expect(submitted[1]![0]!.p).toEqual([
      "itinerary",
      "sections",
      0,
      "blocks",
      0,
      "text",
    ]);

    const blocks = entry.snapshot.itinerary.sections[0]!.blocks;
    expect(blocks.map((block) => block.id)).toEqual([target.id, decoy.id]);
    expect(blocks[0]!.text?.ops[0]!.insert).toContain("Follow the target");
    expect(blocks[1]!.text?.ops[0]!.insert).toBe("untouched\n");
  });

  it("re-finds a newly inserted place before a follow-up rich-text batch", async () => {
    const trip = {
      title: "Multi-batch trip",
      itinerary: {
        sections: [
          {
            id: 10,
            type: "normal",
            mode: "placeList",
            heading: "Places to visit",
            date: null,
            blocks: [],
          },
        ],
      },
    } as unknown as TripPlan;
    const entry = {
      snapshot: trip,
      version: 1,
      geos: [{ id: 1, name: "Test", latitude: 1, longitude: 2 }],
    };
    const submitted: Json0Op[][] = [];
    let appliedBatches = 0;
    const client = {
      isSubscribed: true,
      version: 1,
      async submit(ops: Json0Op[]) {
        submitted.push(ops);
        this.version++;
      },
    };
    const ctx = {
      userId: 55,
      rest: {
        searchPlacesAutocomplete: async () => [
          { place_id: "inserted", description: "Inserted Place" },
        ],
        getPlaceDetails: async () => ({
          name: "Inserted Place",
          place_id: "inserted",
        }),
        getPlacePhotos: async () => [],
      },
      pool: { get: () => client },
      tripCache: {
        getEntry: async () => entry,
        applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
          entry.snapshot = applyOp(entry.snapshot, ops);
          entry.version = version;
          appliedBatches++;
          if (appliedBatches === 1) {
            entry.snapshot.itinerary.sections[0]!.blocks.unshift({
              id: 404,
              type: "note",
              text: { ops: [{ insert: "shift\n" }] },
            });
          }
        },
        invalidate: () => {},
      },
    } as unknown as AppContext;

    const result = await addPlace(ctx, {
      trip_key: "trip",
      place: "Inserted Place",
      note: "Attached to inserted ID",
    });

    expect(result.isError).toBeUndefined();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]![0]!.p).toEqual([
      "itinerary",
      "sections",
      0,
      "blocks",
      1,
      "text",
    ]);
    const blocks = entry.snapshot.itinerary.sections[0]!.blocks;
    expect(blocks[0]!.id).toBe(404);
    expect(blocks[0]!.text?.ops[0]!.insert).toBe("shift\n");
    expect(blocks[1]!.type).toBe("place");
    expect(blocks[1]!.text?.ops[0]!.insert).toContain("Attached to inserted ID");
  });
});
