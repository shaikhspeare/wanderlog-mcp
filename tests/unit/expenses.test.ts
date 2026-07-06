import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import {
  findExpenseMatches,
  formatExpense,
  getExpenses,
} from "../../src/tools/expenses-shared.ts";
import { listExpenses } from "../../src/tools/list-expenses.ts";
import { removeExpense } from "../../src/tools/remove-expense.ts";
import { editExpense } from "../../src/tools/edit-expense.ts";
import { budgetTrip } from "../fixtures/budget-trip.ts";

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
// getExpenses / formatExpense
// ---------------------------------------------------------------------------

describe("getExpenses", () => {
  it("returns indexed expenses from the budget", () => {
    const result = getExpenses(fresh(budgetTrip));
    expect(result).toHaveLength(4);
    expect(result[0]!.index).toBe(0);
    expect(result[0]!.expense.description).toBe("Lunch at Ichiran Ramen");
  });

  it("returns an empty array when the trip has no budget", () => {
    const trip = fresh(budgetTrip);
    delete (trip.itinerary as { budget?: unknown }).budget;
    expect(getExpenses(trip)).toHaveLength(0);
  });
});

describe("formatExpense", () => {
  it("renders amount, currency, description, category and date", () => {
    const expense = fresh(budgetTrip).itinerary.budget!.expenses![0]!;
    expect(formatExpense(expense)).toBe("USD 12.5 — Lunch at Ichiran Ramen (food, 2026-06-01)");
  });
});

// ---------------------------------------------------------------------------
// findExpenseMatches
// ---------------------------------------------------------------------------

describe("findExpenseMatches", () => {
  it("matches a description substring case-insensitively", () => {
    const matches = findExpenseMatches(fresh(budgetTrip), { description: "SUBWAY" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.expense.description).toBe("Subway day pass");
  });

  it("returns no matches for an unknown description", () => {
    expect(findExpenseMatches(fresh(budgetTrip), { description: "nope_nothing" })).toHaveLength(0);
  });

  it("returns multiple matches for a shared substring", () => {
    const matches = findExpenseMatches(fresh(budgetTrip), { description: "ichiran" });
    expect(matches).toHaveLength(2);
  });

  it("narrows duplicates with a date filter", () => {
    const matches = findExpenseMatches(fresh(budgetTrip), {
      description: "ichiran",
      date: "2026-06-02",
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.expense.description).toBe("Dinner at Ichiran Ramen");
  });

  it("narrows duplicates with an amount filter", () => {
    const matches = findExpenseMatches(fresh(budgetTrip), { description: "ichiran", amount: 12.5 });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.expense.date).toBe("2026-06-01");
  });

  it("narrows duplicates with a case-insensitive currency filter", () => {
    const matches = findExpenseMatches(fresh(budgetTrip), { description: "ichiran", currency: "jpy" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.expense.amount.currencyCode).toBe("JPY");
  });

  it("matches everything when no description is given", () => {
    expect(findExpenseMatches(fresh(budgetTrip), {})).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// listExpenses
// ---------------------------------------------------------------------------

describe("listExpenses", () => {
  it("lists all expenses with a count header", async () => {
    const { ctx } = makeFakeContext(budgetTrip);
    const result = await listExpenses(ctx, { trip_key: "budgettripkey" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain("4 expenses");
    expect(text).toContain("Lunch at Ichiran Ramen");
    expect(text).toContain("Museum entry");
  });

  it("applies filters to the listing", async () => {
    const { ctx } = makeFakeContext(budgetTrip);
    const result = await listExpenses(ctx, { trip_key: "budgettripkey", currency: "EUR" });
    const text = result.content[0]!.text;
    expect(text).toContain("1 expense");
    expect(text).toContain("Museum entry");
    expect(text).not.toContain("Subway");
  });

  it("returns a friendly message when there are no expenses", async () => {
    const trip = fresh(budgetTrip);
    trip.itinerary.budget!.expenses = [];
    const { ctx } = makeFakeContext(trip);
    const result = await listExpenses(ctx, { trip_key: "budgettripkey" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("No expenses logged");
  });
});

// ---------------------------------------------------------------------------
// removeExpense
// ---------------------------------------------------------------------------

describe("removeExpense", () => {
  it("returns not-found when nothing matches", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await removeExpense(ctx, {
      trip_key: "budgettripkey",
      description: "nope_nothing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
    expect(submittedOps).toHaveLength(0);
  });

  it("returns a candidate list and does not mutate when ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await removeExpense(ctx, {
      trip_key: "budgettripkey",
      description: "ichiran",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("matches 2 expenses");
    expect(result.content[0]!.text).toContain("Lunch at Ichiran Ramen");
    expect(result.content[0]!.text).toContain("Dinner at Ichiran Ramen");
    expect(submittedOps).toHaveLength(0);
  });

  it("deletes the matched expense with a JSON0 ld op carrying the full object", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await removeExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Removed expense");
    expect(submittedOps).toHaveLength(1);
    const op = submittedOps[0]![0] as { p: (string | number)[]; ld: { id: number } };
    expect(op.p).toEqual(["itinerary", "budget", "expenses", 1]);
    expect(op.ld.id).toBe(90002);
  });

  it("disambiguates via a filter, then deletes the right one", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await removeExpense(ctx, {
      trip_key: "budgettripkey",
      description: "ichiran",
      currency: "JPY",
    });
    expect(result.isError).toBeUndefined();
    const op = submittedOps[0]![0] as { p: (string | number)[]; ld: { id: number } };
    expect(op.p).toEqual(["itinerary", "budget", "expenses", 2]);
    expect(op.ld.id).toBe(90003);
  });
});

// ---------------------------------------------------------------------------
// editExpense
// ---------------------------------------------------------------------------

describe("editExpense", () => {
  it("rejects when no new_* value is supplied", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, { trip_key: "budgettripkey", description: "subway" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Nothing to edit");
    expect(submittedOps).toHaveLength(0);
  });

  it("returns not-found when nothing matches", async () => {
    const { ctx } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "nope_nothing",
      new_amount: 5,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
  });

  it("returns a candidate list and does not mutate when ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "ichiran",
      new_amount: 20,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("matches 2 expenses");
    expect(submittedOps).toHaveLength(0);
  });

  it("edits the description with an od+oi op for only that field", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_description: "Metro 72h pass",
    });
    expect(result.isError).toBeUndefined();
    expect(submittedOps).toHaveLength(1);
    expect(submittedOps[0]).toHaveLength(1);
    expect(submittedOps[0]![0]).toEqual({
      p: ["itinerary", "budget", "expenses", 1, "description"],
      od: "Subway day pass",
      oi: "Metro 72h pass",
    });
  });

  it("edits amount and currency via the nested amount path", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_amount: 9.5,
      new_currency: "eur",
    });
    expect(result.isError).toBeUndefined();
    const ops = submittedOps[0]!;
    expect(ops).toContainEqual({
      p: ["itinerary", "budget", "expenses", 1, "amount", "amount"],
      od: 8,
      oi: 9.5,
    });
    // currency normalized to uppercase
    expect(ops).toContainEqual({
      p: ["itinerary", "budget", "expenses", 1, "amount", "currencyCode"],
      od: "USD",
      oi: "EUR",
    });
  });

  it("edits the category", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_category: "carRental",
    });
    expect(submittedOps[0]![0]).toEqual({
      p: ["itinerary", "budget", "expenses", 1, "category"],
      od: "publicTransit",
      oi: "carRental",
    });
  });

  it("edits the date, updating both date and associatedDate", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const res = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_date: "2026-06-09",
    });
    expect(res.isError).toBeUndefined();
    const ops = submittedOps[0]!;
    expect(ops).toContainEqual({
      p: ["itinerary", "budget", "expenses", 1, "date"],
      od: "2026-06-01",
      oi: "2026-06-09",
    });
    expect(ops).toContainEqual({
      p: ["itinerary", "budget", "expenses", 1, "associatedDate"],
      od: "2026-06-01",
      oi: "2026-06-09",
    });
  });

  it("syncs associatedDate even when the date field already matches (UI shows associatedDate)", async () => {
    const trip = fresh(budgetTrip);
    // Real-world mismatch: date is correct but associatedDate is a day ahead.
    trip.itinerary.budget!.expenses![1]!.associatedDate = "2026-06-02";
    const { ctx, submittedOps } = makeFakeContext(trip);
    const res = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_date: "2026-06-01", // already the `date` value
    });
    expect(res.isError).toBeUndefined();
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1); // only associatedDate needs changing
    expect(ops[0]).toEqual({
      p: ["itinerary", "budget", "expenses", 1, "associatedDate"],
      od: "2026-06-02",
      oi: "2026-06-01",
    });
  });

  it("only emits ops for fields that actually change", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_amount: 8, // unchanged
      new_currency: "USD", // unchanged
      new_description: "Subway 1-day pass", // changed
    });
    const ops = submittedOps[0]!;
    expect(ops).toHaveLength(1);
    expect((ops[0] as { p: (string | number)[] }).p).toEqual([
      "itinerary",
      "budget",
      "expenses",
      1,
      "description",
    ]);
  });

  it("returns a no-change message when nothing differs", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    const result = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_amount: 8,
      new_currency: "usd",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("No changes");
    expect(submittedOps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: the produced ops must apply cleanly via the real applyOp, the
// same path submitOp → tripCache.applyLocalOp uses. Catches bad JSON0 paths
// the fake submit would otherwise mask, and proves unknown fields survive.
// ---------------------------------------------------------------------------

describe("expense ops apply via applyOp", () => {
  it("remove deletes only the matched expense", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    await removeExpense(ctx, { trip_key: "budgettripkey", description: "subway" });
    const next = applyOp(fresh(budgetTrip), submittedOps[0]!);
    const descriptions = next.itinerary.budget!.expenses!.map((e) => e.description);
    expect(descriptions).toEqual([
      "Lunch at Ichiran Ramen",
      "Dinner at Ichiran Ramen",
      "Museum entry",
    ]);
  });

  it("edit changes the targeted fields and preserves unknown ones", async () => {
    const { ctx, submittedOps } = makeFakeContext(budgetTrip);
    await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "subway",
      new_amount: 9.5,
      new_currency: "eur",
      new_description: "Metro pass",
      new_category: "carRental",
    });
    const next = applyOp(fresh(budgetTrip), submittedOps[0]!);
    const edited = next.itinerary.budget!.expenses![1]!;
    expect(edited.description).toBe("Metro pass");
    expect(edited.category).toBe("carRental");
    expect(edited.amount).toEqual({ amount: 9.5, currencyCode: "EUR" });
    // Fields we never touched are still intact.
    expect(edited.id).toBe(90002);
    expect(edited.blockId).toBe(50001);
    expect(edited.paidByUserId).toBe(3656632);
    expect(edited.associatedDate).toBe("2026-06-01");
  });
});
