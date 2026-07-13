import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import { addExpense } from "../../src/tools/add-expense.ts";
import { budgetTrip } from "../fixtures/budget-trip.ts";

function makeFakeContext(trip: TripPlan): { ctx: AppContext; submittedOps: Json0Op[][] } {
  const submittedOps: Json0Op[][] = [];
  const ctx = {
    userId: 555,
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
      getEntry: async () => ({ snapshot: structuredClone(trip), version: 1, geos: [] }),
      get: async () => structuredClone(trip),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, submittedOps };
}

const liOf = (ops: Json0Op[][]) =>
  ops[0]![0] as { p: (string | number)[]; li: Record<string, any> };

describe("addExpense — unlinked (no place)", () => {
  it("adds an expense with blockId null and no place in the message", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 20,
      currency: "usd",
      category: "food",
      description: "Snack",
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain('Added expense: USD 20 for "Snack"');
    expect(res.content[0]!.text).not.toContain("linked to");

    const op = liOf(submittedOps);
    // inserted at the end of the existing 4 expenses
    expect(op.p).toEqual(["itinerary", "budget", "expenses", 4]);
    expect(op.li.blockId).toBeNull();
    expect(op.li.amount).toEqual({ amount: 20, currencyCode: "USD" });
    expect(op.li.category).toBe("food");
  });
});

describe("addExpense — linked (place given)", () => {
  it("links to the resolved place and reports it", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 9,
      currency: "usd",
      category: "sightseeing",
      description: "Temple entry",
      place: "Sensō-ji",
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("linked to Sensō-ji");
    const op = liOf(submittedOps);
    expect(op.li.blockId).toBe(50001); // the Sensō-ji place block id in the fixture
  });

  it("errors when the place reference matches nothing", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 9,
      currency: "usd",
      category: "other",
      description: "Mystery",
      place: "no_such_place_xyz",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("No place matching");
    expect(submittedOps).toHaveLength(0);
  });
});
