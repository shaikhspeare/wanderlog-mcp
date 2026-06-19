import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../../src/context.ts";
import { createTrip } from "../../src/tools/create-trip.ts";
import { addExpense } from "../../src/tools/add-expense.ts";
import { listExpenses } from "../../src/tools/list-expenses.ts";
import { editExpense } from "../../src/tools/edit-expense.ts";
import { removeExpense } from "../../src/tools/remove-expense.ts";
import type { Expense, TripPlan } from "../../src/types.ts";

/**
 * Live round-trip for the budget-expense tools against the real Wanderlog API.
 * Creates a throwaway trip, adds an UNLINKED expense (no place required), then
 * lists / edits / removes it — re-reading the server via REST between steps for
 * authoritative assertions. Deletes the trip in afterAll.
 *
 * A stray trip from a mid-run crash shows up as "WANDERDOG_TEST_<timestamp>".
 */
describe("Expense tools (live round-trip)", () => {
  let ctx: AppContext;
  let tripKey: string | undefined;

  const expenseByDesc = (trip: TripPlan, desc: string): Expense | undefined =>
    (trip.itinerary.budget?.expenses ?? []).find((e) => e.description === desc);

  beforeAll(async () => {
    if (!process.env.WANDERLOG_COOKIE) {
      throw new Error("WANDERLOG_COOKIE must be set");
    }
    ctx = createContext();
    const user = await ctx.rest.getUser();
    ctx.userId = user.id;
  }, 20_000);

  afterAll(async () => {
    ctx?.pool.closeAll();
    if (tripKey) {
      try {
        await ctx.rest.deleteTrip(tripKey);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("creates a throwaway trip", async () => {
    const result = await createTrip(ctx, {
      destination: "Tokyo",
      start_date: "2099-02-01",
      end_date: "2099-02-03",
      title: `WANDERDOG_TEST_${Date.now()}`,
      privacy: "private",
    });
    expect(result.isError).not.toBe(true);
    const keyMatch = /Key: (\w+)/.exec(result.content[0]!.text);
    expect(keyMatch).not.toBeNull();
    tripKey = keyMatch![1]!;
  }, 15_000);

  it("add_expense adds an UNLINKED expense (no place required)", async () => {
    expect(tripKey).toBeDefined();
    const res = await addExpense(ctx, {
      trip_key: tripKey!,
      amount: 42.5,
      currency: "usd",
      category: "food",
      description: "Ramen lunch",
    });
    if (res.isError) throw new Error(`add_expense failed: ${res.content[0]!.text}`);
    expect(res.content[0]!.text).not.toContain("linked to");

    const trip = await ctx.rest.getTrip(tripKey!);
    const e = expenseByDesc(trip, "Ramen lunch");
    expect(e).toBeDefined();
    expect(e!.blockId).toBeNull();
    expect(e!.amount).toEqual({ amount: 42.5, currencyCode: "USD" });
    expect(e!.category).toBe("food");
  }, 30_000);

  it("list_expenses shows the expense", async () => {
    expect(tripKey).toBeDefined();
    const res = await listExpenses(ctx, { trip_key: tripKey! });
    expect(res.isError).not.toBe(true);
    expect(res.content[0]!.text).toContain("Ramen lunch");
    expect(res.content[0]!.text).toContain("USD 42.5");
  }, 15_000);

  it("edit_expense changes amount, currency, category, description (server-confirmed)", async () => {
    expect(tripKey).toBeDefined();
    const res = await editExpense(ctx, {
      trip_key: tripKey!,
      description: "Ramen lunch",
      new_amount: 50,
      new_currency: "jpy",
      new_category: "drinks",
      new_description: "Ramen + beer",
      new_date: "2099-02-02",
    });
    if (res.isError) throw new Error(`edit_expense failed: ${res.content[0]!.text}`);

    const trip = await ctx.rest.getTrip(tripKey!);
    const e = expenseByDesc(trip, "Ramen + beer");
    expect(e).toBeDefined();
    expect(e!.amount).toEqual({ amount: 50, currencyCode: "JPY" }); // currency uppercased
    expect(e!.category).toBe("drinks");
    // new_date updates BOTH fields — the budget UI displays associatedDate.
    expect(e!.date).toBe("2099-02-02");
    expect(e!.associatedDate).toBe("2099-02-02");
    // Unknown fields we never touched must survive the edit.
    expect(e!.paidByUser).toBeDefined();
    expect(e!.splitWith).toBeDefined();
    expect("blockId" in e!).toBe(true);
  }, 30_000);

  it("edit_expense returns not-found for a non-matching description", async () => {
    expect(tripKey).toBeDefined();
    const res = await editExpense(ctx, {
      trip_key: tripKey!,
      description: "no_such_expense_xyz",
      new_amount: 1,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text.toLowerCase()).toContain("not found");
  }, 15_000);

  it("remove_expense deletes the expense", async () => {
    expect(tripKey).toBeDefined();
    const res = await removeExpense(ctx, { trip_key: tripKey!, description: "Ramen + beer" });
    if (res.isError) throw new Error(`remove_expense failed: ${res.content[0]!.text}`);

    const trip = await ctx.rest.getTrip(tripKey!);
    expect(expenseByDesc(trip, "Ramen + beer")).toBeUndefined();
  }, 30_000);
});
