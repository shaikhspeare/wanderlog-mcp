import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { findChecklistItemTargets, setChecklistItem } from "../../src/tools/set-checklist-item.ts";
import { isChecklistBlock, type TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";

function tripWithSecondChecklist(): TripPlan {
  const trip = structuredClone(checklistTrip);
  trip.itinerary.sections[0]!.blocks.push({
    id: 80001,
    type: "checklist",
    title: "Before departure",
    items: [
      { id: 80002, checked: false, text: { ops: [{ insert: "Pack passport\n" }] } },
      { id: 80003, checked: false, text: { ops: [{ insert: "Pack comfortable socks\n" }] } },
    ],
    attachments: [],
  } as never);
  return trip;
}

function makeContext(trip: TripPlan) {
  const submittedOps: Json0Op[][] = [];
  let invalidations = 0;
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
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
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {
        invalidations++;
      },
    },
  } as unknown as AppContext;
  return { ctx, entry, submittedOps, invalidations: () => invalidations };
}

function itemChecked(trip: TripPlan, sectionIndex: number, blockIndex: number, itemIndex: number) {
  const block = trip.itinerary.sections[sectionIndex]!.blocks[blockIndex]!;
  if (!isChecklistBlock(block)) throw new Error("not a checklist");
  return block.items[itemIndex]!.checked;
}

describe("findChecklistItemTargets", () => {
  it("matches item text case-insensitively and reports current state", () => {
    const targets = findChecklistItemTargets(checklistTrip, { item: "BOOK TICKETS" });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ checked: true, checklistTitle: "Packing list" });
  });

  it("returns every match across checklists", () => {
    const targets = findChecklistItemTargets(tripWithSecondChecklist(), { item: "pack " });
    expect(targets.map((t) => t.itemText)).toEqual([
      "Pack passport",
      "Pack comfortable socks",
      "Pack comfortable shoes",
    ]);
  });

  it("narrows by checklist title, day and section", () => {
    const trip = tripWithSecondChecklist();
    expect(findChecklistItemTargets(trip, { item: "pack", checklist: "before" })).toHaveLength(2);
    expect(findChecklistItemTargets(trip, { item: "pack", day: "2026-06-01" })).toHaveLength(1);
    expect(findChecklistItemTargets(trip, { item: "pack", section: "notes" })).toHaveLength(2);
  });
});

describe("setChecklistItem", () => {
  it("ticks an item with an od+oi on the checked field and updates the cache", async () => {
    const { ctx, entry, submittedOps } = makeContext(checklistTrip);
    const res = await setChecklistItem(ctx, {
      trip_key: "k",
      item: "offline map",
      checked: true,
    });
    expect(res.isError).toBeUndefined();
    expect(submittedOps).toEqual([
      [
        {
          p: ["itinerary", "sections", 2, "blocks", 2, "items", 2, "checked"],
          od: false,
          oi: true,
        },
      ],
    ]);
    expect(itemChecked(entry.snapshot, 2, 2, 2)).toBe(true);
    expect(res.content[0]!.text).toContain("ticked");
  });

  it("unticks an item", async () => {
    const { ctx, entry, submittedOps } = makeContext(checklistTrip);
    await setChecklistItem(ctx, { trip_key: "k", item: "book tickets", checked: false });
    expect(submittedOps[0]![0]).toMatchObject({ od: true, oi: false });
    expect(itemChecked(entry.snapshot, 2, 2, 0)).toBe(false);
  });

  it("defaults to ticking when checked is omitted", async () => {
    const { ctx, entry } = makeContext(checklistTrip);
    await setChecklistItem(ctx, { trip_key: "k", item: "comfortable shoes" });
    expect(itemChecked(entry.snapshot, 2, 2, 1)).toBe(true);
  });

  it("does not submit when the item is already in the requested state", async () => {
    const { ctx, submittedOps } = makeContext(checklistTrip);
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "book tickets", checked: true });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("already ticked");
    expect(submittedOps).toEqual([]);
  });

  it("returns numbered previews and does not mutate when ambiguous", async () => {
    const { ctx, submittedOps } = makeContext(tripWithSecondChecklist());
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "pack" });
    expect(res.isError).toBe(true);
    const text = res.content[0]!.text;
    expect(text).toContain("matches 3 checklist items");
    expect(text).toContain('1. [ ] "Pack passport"');
    expect(text).toContain('"Before departure" checklist');
    expect(submittedOps).toEqual([]);
  });

  it("resolves an ambiguity with the checklist filter", async () => {
    const { ctx, entry } = makeContext(tripWithSecondChecklist());
    const res = await setChecklistItem(ctx, {
      trip_key: "k",
      item: "pack",
      checklist: "before departure",
      day: undefined,
      section: "Notes",
    });
    expect(res.content[0]!.text).toContain("matches 2 checklist items");
    const ok = await setChecklistItem(ctx, {
      trip_key: "k",
      item: "passport",
      checklist: "before departure",
    });
    expect(ok.isError).toBeUndefined();
    expect(itemChecked(entry.snapshot, 0, 0, 0)).toBe(true);
  });

  it("errors with no mutation when nothing matches", async () => {
    const { ctx, submittedOps } = makeContext(checklistTrip);
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "nonexistent" });
    expect(res.isError).toBe(true);
    expect(submittedOps).toEqual([]);
  });

  it("errors with no mutation for a day outside the trip", async () => {
    const { ctx, submittedOps } = makeContext(checklistTrip);
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "pack", day: "2030-01-01" });
    expect(res.isError).toBe(true);
    expect(submittedOps).toEqual([]);
  });

  it("errors on an unknown section filter", async () => {
    const { ctx, submittedOps } = makeContext(checklistTrip);
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "pack", section: "Nope" });
    expect(res.isError).toBe(true);
    expect(submittedOps).toEqual([]);
  });

  it("sets checked with a bare oi when the item has no checked field", async () => {
    const trip = structuredClone(checklistTrip);
    const block = trip.itinerary.sections[2]!.blocks[2]!;
    if (!isChecklistBlock(block)) throw new Error("fixture changed");
    delete (block.items[1] as { checked?: boolean }).checked;
    const { ctx, entry, submittedOps } = makeContext(trip);
    await setChecklistItem(ctx, { trip_key: "k", item: "comfortable shoes", checked: false });
    expect(submittedOps[0]![0]).toEqual({
      p: ["itinerary", "sections", 2, "blocks", 2, "items", 1, "checked"],
      oi: false,
    });
    expect(itemChecked(entry.snapshot, 2, 2, 1)).toBe(false);
  });

  it("invalidates the cache when the submit fails", async () => {
    const { ctx, invalidations } = makeContext(checklistTrip);
    (ctx.pool as unknown as { get: () => unknown }).get = () => ({
      isSubscribed: true,
      version: 1,
      async submit() {
        throw new Error("boom");
      },
    });
    const res = await setChecklistItem(ctx, { trip_key: "k", item: "offline map" });
    expect(res.isError).toBe(true);
    expect(invalidations()).toBe(1);
  });
});
