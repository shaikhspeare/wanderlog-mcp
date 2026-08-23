import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import {
  addChecklist,
  addChecklistInputSchema,
} from "../../src/tools/add-checklist.ts";
import type { TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";

function makeFakeContext(trip: TripPlan): {
  ctx: AppContext;
  submittedOps: Json0Op[][];
} {
  const submittedOps: Json0Op[][] = [];
  const ctx = {
    userId: 3656632,
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

describe("addChecklistInputSchema", () => {
  const schema = z.object(addChecklistInputSchema);
  const requiredInput = {
    trip_key: "trip-key",
    items: ["Passport"],
  };

  it("accepts the required fields", () => {
    expect(schema.safeParse(requiredInput).success).toBe(true);
  });

  it("rejects a missing trip key", () => {
    expect(schema.safeParse({ items: ["Passport"] }).success).toBe(false);
  });

  it("rejects an empty trip key", () => {
    expect(schema.safeParse({ ...requiredInput, trip_key: "" }).success).toBe(false);
  });

  it("rejects a non-string trip key", () => {
    expect(schema.safeParse({ ...requiredInput, trip_key: 123 }).success).toBe(false);
  });

  it("rejects missing checklist items", () => {
    expect(schema.safeParse({ trip_key: "trip-key" }).success).toBe(false);
  });

  it("rejects an empty checklist", () => {
    expect(schema.safeParse({ ...requiredInput, items: [] }).success).toBe(false);
  });

  it("rejects an empty checklist item", () => {
    expect(schema.safeParse({ ...requiredInput, items: [""] }).success).toBe(false);
  });

  it("rejects a non-string checklist item", () => {
    expect(schema.safeParse({ ...requiredInput, items: [123] }).success).toBe(false);
  });

  it("rejects checklist items that are not an array", () => {
    expect(schema.safeParse({ ...requiredInput, items: "Passport" }).success).toBe(
      false,
    );
  });

  it("accepts a title", () => {
    expect(schema.safeParse({ ...requiredInput, title: "Before departure" }).success).toBe(
      true,
    );
  });

  it("accepts an empty title", () => {
    expect(schema.safeParse({ ...requiredInput, title: "" }).success).toBe(true);
  });

  it("rejects a non-string title", () => {
    expect(schema.safeParse({ ...requiredInput, title: 123 }).success).toBe(false);
  });

  it("accepts a day target", () => {
    expect(schema.safeParse({ ...requiredInput, day: "day 1" }).success).toBe(true);
  });

  it("rejects a non-string day target", () => {
    expect(schema.safeParse({ ...requiredInput, day: 1 }).success).toBe(false);
  });

  it("accepts a named section target", () => {
    expect(
      schema.safeParse({ ...requiredInput, section: "Trip Preparations" }).success,
    ).toBe(true);
  });

  it("rejects an empty section target", () => {
    expect(schema.safeParse({ ...requiredInput, section: "" }).success).toBe(false);
  });

  it("rejects a non-string section target", () => {
    expect(schema.safeParse({ ...requiredInput, section: 123 }).success).toBe(false);
  });

  it("accepts both day and section targets", () => {
    expect(
      schema.safeParse({
        ...requiredInput,
        day: "day 1",
        section: "Trip Preparations",
      }).success,
    ).toBe(true);
  });
});

describe("addChecklist section targeting", () => {
  const checklist = {
    trip_key: "T",
    title: "Before departure",
    items: ["Passport", "Travel insurance"],
  };

  async function runChecklist(
    overrides: Partial<Parameters<typeof addChecklist>[1]> = {},
    trip: TripPlan = checklistTrip,
  ) {
    const { ctx, submittedOps } = makeFakeContext(trip);
    const result = await addChecklist(ctx, { ...checklist, ...overrides });
    return { result, submittedOps };
  }

  it("succeeds when no target is provided", async () => {
    const { result } = await runChecklist();

    expect(result.isError).toBeUndefined();
  });

  it("reports Places to visit when no target is provided", async () => {
    const { result } = await runChecklist();

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("places to visit");
  });

  it("inserts into Places to visit when no target is provided", async () => {
    const { result, submittedOps } = await runChecklist();

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.p).toEqual([
      "itinerary",
      "sections",
      1,
      "blocks",
      1,
    ]);
  });

  it("succeeds for a case-insensitive named section", async () => {
    const { result } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
  });

  it("reports the canonical named section", async () => {
    const { result } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('section "Notes"');
  });

  it("submits one operation for a named section", async () => {
    const { result, submittedOps } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps).toHaveLength(1);
  });

  it("inserts into the named section", async () => {
    const { result, submittedOps } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.p).toEqual([
      "itinerary",
      "sections",
      0,
      "blocks",
      0,
    ]);
  });

  it("inserts a checklist block into the named section", async () => {
    const { result, submittedOps } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.li).toMatchObject({ type: "checklist" });
  });

  it("preserves the checklist title in the named section", async () => {
    const { result, submittedOps } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.li).toMatchObject({ title: "Before departure" });
  });

  it("creates one block item per checklist input", async () => {
    const { result, submittedOps } = await runChecklist({ section: "notes" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.li).toMatchObject({
      items: [expect.any(Object), expect.any(Object)],
    });
  });

  it("lets section override day in the response", async () => {
    const { result } = await runChecklist({
      day: "day 1",
      section: "Notes",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('section "Notes"');
  });

  it("lets section override day in the submitted path", async () => {
    const { result, submittedOps } = await runChecklist({
      day: "day 1",
      section: "Notes",
    });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.p).toEqual([
      "itinerary",
      "sections",
      0,
      "blocks",
      0,
    ]);
  });

  it("returns an error for an unknown section", async () => {
    const { result } = await runChecklist({ section: "Does not exist" });

    expect(result.isError).toBe(true);
  });

  it("identifies an unknown section in the error", async () => {
    const { result } = await runChecklist({ section: "Does not exist" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Section "Does not exist" not found');
  });

  it("does not submit for an unknown section", async () => {
    const { result, submittedOps } = await runChecklist({
      section: "Does not exist",
    });

    expect(result.isError).toBe(true);
    expect(submittedOps).toHaveLength(0);
  });

  it("returns an error when section targets a dayPlan", async () => {
    const trip = structuredClone(checklistTrip);
    trip.itinerary.sections[2]!.date = null;
    const { result } = await runChecklist({ section: "Arrival day" }, trip);

    expect(result.isError).toBe(true);
  });

  it("identifies a dayPlan as a dated section", async () => {
    const trip = structuredClone(checklistTrip);
    trip.itinerary.sections[2]!.date = null;
    const { result } = await runChecklist({ section: "Arrival day" }, trip);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("is a dated section");
  });

  it("directs dayPlan callers to the day parameter", async () => {
    const trip = structuredClone(checklistTrip);
    trip.itinerary.sections[2]!.date = null;
    const { result } = await runChecklist({ section: "Arrival day" }, trip);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"day" parameter');
  });

  it("does not submit when section targets a dayPlan", async () => {
    const trip = structuredClone(checklistTrip);
    trip.itinerary.sections[2]!.date = null;
    const { result, submittedOps } = await runChecklist(
      { section: "Arrival day" },
      trip,
    );

    expect(result.isError).toBe(true);
    expect(submittedOps).toHaveLength(0);
  });

  it("succeeds for a day target", async () => {
    const { result } = await runChecklist({ day: "day 1" });

    expect(result.isError).toBeUndefined();
  });

  it("reports the resolved day target", async () => {
    const { result } = await runChecklist({ day: "day 1" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("day 2026-06-01");
  });

  it("inserts into the resolved day target", async () => {
    const { result, submittedOps } = await runChecklist({ day: "day 1" });

    expect(result.isError).toBeUndefined();
    expect(submittedOps[0]![0]!.p).toEqual([
      "itinerary",
      "sections",
      2,
      "blocks",
      3,
    ]);
  });
});
