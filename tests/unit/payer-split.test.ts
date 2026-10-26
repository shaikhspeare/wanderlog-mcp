import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import { addExpense } from "../../src/tools/add-expense.ts";
import { editExpense } from "../../src/tools/edit-expense.ts";
import { listExpenses } from "../../src/tools/list-expenses.ts";
import { resolveMember } from "../../src/tools/expenses-shared.ts";
import { budgetTrip } from "../fixtures/budget-trip.ts";

const ALICE = 3656632;
const BOB = 4100001;

function sharedTrip(): TripPlan {
  const trip = structuredClone(budgetTrip);
  trip.contributors = [
    { id: ALICE, username: "alice1", name: "Alice Smith" },
    { id: BOB, username: "bobj", name: "Bob Jones" },
  ];
  const e = trip.itinerary.budget!.expenses![0]!;
  e.splitWith = {
    type: "individuals",
    users: [
      { type: "registered", id: ALICE },
      { type: "registered", id: BOB },
    ],
  };
  trip.itinerary.budget!.payments = [
    {
      amount: { amount: 120, currencyCode: "USD" },
      fromUser: { type: "registered", id: BOB },
      toUser: { type: "registered", id: ALICE },
      paidAt: "2026-06-05T23:16:53Z",
    },
  ];
  return trip;
}

function makeCtx(trip: TripPlan): { ctx: AppContext; entry: { snapshot: TripPlan } } {
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  const ctx = {
    userId: ALICE,
    pool: {
      get: () => ({ isSubscribed: true, version: 1, async submit(_ops: Json0Op[]) {} }),
    },
    tripCache: {
      getEntry: async () => entry,
      get: async () => entry.snapshot,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, entry };
}

// ---------------------------------------------------------------------------
// resolveMember
// ---------------------------------------------------------------------------

describe("resolveMember", () => {
  it("matches first name, full name and username, case-insensitively", () => {
    const trip = sharedTrip();
    expect(resolveMember(trip, "bob")).toBe(BOB);
    expect(resolveMember(trip, "alice smith")).toBe(ALICE);
    expect(resolveMember(trip, "BOBJ")).toBe(BOB);
  });

  it("names the members, without their ids, when nothing matches", () => {
    expect(() => resolveMember(sharedTrip(), "Carol")).toThrow(
      /Members: Alice Smith, Bob Jones\.$/,
    );
  });

  it("rejects a first name shared by two members", () => {
    const trip = sharedTrip();
    trip.contributors!.push({ id: 4100002, username: "bobby", name: "Bob Brown" });
    expect(() => resolveMember(trip, "Bob")).toThrow(/more than one trip member/);
  });
});

// ---------------------------------------------------------------------------
// listExpenses
// ---------------------------------------------------------------------------

describe("listExpenses payer and split", () => {
  it("shows who paid, the split and settle-up payments on a shared trip", async () => {
    const { ctx } = makeCtx(sharedTrip());
    const res = await listExpenses(ctx, { trip_key: "budgettripkey" });
    const text = res.content[0]!.text;
    expect(text).toContain(
      "Lunch at Ichiran Ramen (food, 2026-06-01) — paid by Alice Smith, split between Alice Smith + Bob Jones",
    );
    expect(text).toContain("paid by Alice Smith, not split");
    expect(text).toContain(
      "Settle-up payments:\n  - Bob Jones → Alice Smith USD 120 on 2026-06-05",
    );
  });

  it("leaves settle-up payments out of a filtered list", async () => {
    const { ctx } = makeCtx(sharedTrip());
    const res = await listExpenses(ctx, { trip_key: "budgettripkey", description: "Lunch" });
    const text = res.content[0]!.text;
    expect(text).toContain("paid by Alice Smith, split between Alice Smith + Bob Jones");
    expect(text).not.toContain("Settle-up");
  });

  it("leaves payer and split out on a solo trip", async () => {
    const { ctx } = makeCtx(budgetTrip);
    const text = (await listExpenses(ctx, { trip_key: "budgettripkey" })).content[0]!.text;
    expect(text).not.toContain("paid by");
  });
});

// ---------------------------------------------------------------------------
// addExpense
// ---------------------------------------------------------------------------

describe("addExpense payer and split", () => {
  it("defaults to the logged-in user as payer, unsplit", async () => {
    const { ctx, entry } = makeCtx(sharedTrip());
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 1000,
      currency: "JPY",
      category: "food",
      description: "Ramen",
    });
    const added = entry.snapshot.itinerary.budget!.expenses!.at(-1)!;
    expect(added.paidByUserId).toBe(ALICE);
    expect(added.splitWith).toEqual({ type: "individuals", users: [] });
    expect(res.content[0]!.text).toContain("(paid by Alice Smith, not split)");
  });

  it("records paid_by and split_with", async () => {
    const { ctx, entry } = makeCtx(sharedTrip());
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 500,
      currency: "JPY",
      category: "food",
      description: "Snacks",
      paid_by: "Bob",
      split_with: ["Bob", "alice smith"],
    });
    const added = entry.snapshot.itinerary.budget!.expenses!.at(-1)!;
    expect(added.paidByUserId).toBe(BOB);
    expect(added.paidByUser).toEqual({ type: "registered", id: BOB });
    expect(added.splitWith).toEqual({
      type: "individuals",
      users: [
        { type: "registered", id: BOB },
        { type: "registered", id: ALICE },
      ],
    });
    expect(res.content[0]!.text).toContain(
      "(paid by Bob Jones, split between Bob Jones + Alice Smith)",
    );
  });

  it("rejects an unknown payer without adding anything", async () => {
    const { ctx, entry } = makeCtx(sharedTrip());
    const before = entry.snapshot.itinerary.budget!.expenses!.length;
    const res = await addExpense(ctx, {
      trip_key: "budgettripkey",
      amount: 1,
      currency: "JPY",
      category: "food",
      description: "x",
      paid_by: "Carol",
    });
    expect(res.isError).toBe(true);
    expect(entry.snapshot.itinerary.budget!.expenses!.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// editExpense
// ---------------------------------------------------------------------------

describe("editExpense payer and split", () => {
  it("changes payer and split", async () => {
    const { ctx, entry } = makeCtx(sharedTrip());
    const res = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "Lunch at Ichiran",
      new_paid_by: "Bob",
      new_split_with: ["Alice"],
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain("paid by → Bob Jones, split between → Alice Smith");
    const e = entry.snapshot.itinerary.budget!.expenses![0]!;
    expect(e.paidByUserId).toBe(BOB);
    expect(e.paidByUser).toEqual({ type: "registered", id: BOB });
    expect(e.splitWith).toEqual({
      type: "individuals",
      users: [{ type: "registered", id: ALICE }],
    });
  });

  it("stops splitting when new_split_with is empty", async () => {
    const { ctx, entry } = makeCtx(sharedTrip());
    const res = await editExpense(ctx, {
      trip_key: "budgettripkey",
      description: "Lunch at Ichiran",
      new_split_with: [],
    });
    expect(res.content[0]!.text).toContain("split → none");
    expect(entry.snapshot.itinerary.budget!.expenses![0]!.splitWith).toEqual({
      type: "individuals",
      users: [],
    });
  });
});
