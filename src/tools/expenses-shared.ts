import { WanderlogValidationError } from "../errors.js";
import type { Expense, ExpenseSplit, TripPlan } from "../types.js";

/** A located expense: the live array index plus the expense object itself. */
export type ExpenseMatch = {
  index: number;
  expense: Expense;
};

/** Filters used to narrow expense matches. All are optional except via the caller. */
export type ExpenseFilters = {
  description?: string;
  date?: string;
  amount?: number;
  currency?: string;
};

/**
 * Reads `trip.itinerary.budget.expenses`, pairing each expense with its array
 * index so callers can build JSON0 list paths. Returns an empty array when the
 * trip has no budget yet.
 */
export function getExpenses(trip: TripPlan): ExpenseMatch[] {
  const expenses = trip.itinerary.budget?.expenses ?? [];
  return expenses.map((expense, index) => ({ index, expense }));
}

/**
 * Finds expenses matching a case-insensitive description substring, optionally
 * narrowed by exact date, amount, and (case-insensitive) currency filters used
 * to disambiguate duplicates. An empty/omitted description matches every
 * expense, so `list_expenses` can call with filters alone.
 */
export function findExpenseMatches(trip: TripPlan, filters: ExpenseFilters): ExpenseMatch[] {
  const description = filters.description?.toLowerCase();
  const currency = filters.currency?.toUpperCase();

  return getExpenses(trip).filter(({ expense }) => {
    if (description) {
      const desc = (expense.description ?? "").toLowerCase();
      if (!desc.includes(description)) return false;
    }
    if (filters.date && expense.date !== filters.date) return false;
    if (filters.amount !== undefined && expense.amount?.amount !== filters.amount) {
      return false;
    }
    if (currency && (expense.amount?.currencyCode ?? "").toUpperCase() !== currency) {
      return false;
    }
    return true;
  });
}

/**
 * Renders matched expenses as a numbered list for an ambiguity prompt, capped
 * at `limit` with a "(N more…)" suffix so a huge budget doesn't flood the LLM.
 */
export function formatCandidateList(matches: ExpenseMatch[], limit = 10, trip?: TripPlan): string {
  const lines = matches
    .slice(0, limit)
    .map((m, i) => `  ${i + 1}. ${formatExpense(m.expense, trip)}`)
    .join("\n");
  const suffix = matches.length > limit ? `\n  (${matches.length - limit} more…)` : "";
  return `${lines}${suffix}`;
}

/**
 * One-line human label, e.g. `USD 12.50 — Lunch at Ichiran Ramen (food, 2026-05-04)`.
 * On a shared trip, also says who paid and who it's split between.
 */
export function formatExpense(expense: Expense, trip?: TripPlan): string {
  const currency = expense.amount?.currencyCode ?? "?";
  const amount = expense.amount?.amount ?? "?";
  const description = expense.description?.trim() || "(no description)";
  const meta = [expense.category, expense.date].filter(Boolean).join(", ");
  const suffix = meta ? ` (${meta})` : "";
  const who = trip && isSharedTrip(trip) ? ` — ${formatPayerSplit(expense, trip)}` : "";
  return `${currency} ${amount} — ${description}${suffix}${who}`;
}

// ---------------------------------------------------------------------------
// Payer / split
// ---------------------------------------------------------------------------

/** Display names of the trip's contributors and editors, keyed by user id. */
export function tripMembers(trip: TripPlan): Map<number, string> {
  const members = new Map<number, string>();
  for (const c of [...(trip.contributors ?? []), ...(trip.editors ?? [])]) {
    if (!members.has(c.id)) members.set(c.id, c.name?.trim() || c.username);
  }
  return members;
}

/** Payer and split only mean something when more than one person is on the trip. */
export function isSharedTrip(trip: TripPlan): boolean {
  return tripMembers(trip).size > 1;
}

function memberName(trip: TripPlan, id: number | undefined): string {
  return (id !== undefined && tripMembers(trip).get(id)) || "a former trip member";
}

/**
 * Resolves a trip member by username, full name, or first name
 * (case-insensitive). Throws a validation error naming the members when
 * nothing, or more than one member, matches.
 */
export function resolveMember(trip: TripPlan, ref: string): number {
  const needle = ref.trim().toLowerCase();
  const hits = new Set<number>();
  for (const m of [...(trip.contributors ?? []), ...(trip.editors ?? [])]) {
    const name = (m.name ?? "").trim().toLowerCase();
    if (m.username.toLowerCase() === needle || name === needle || name.split(/\s+/)[0] === needle) {
      hits.add(m.id);
    }
  }
  if (hits.size === 1) return [...hits][0]!;
  const names = [...tripMembers(trip).values()].join(", ") || "none listed";
  throw new WanderlogValidationError(
    hits.size === 0
      ? `No trip member matches "${ref}". Members: ${names}.`
      : `"${ref}" matches more than one trip member. Members: ${names}.`,
  );
}

/** Wanderlog's `splitWith` for an even split between the given members; `[]` means not split. */
export function buildSplitWith(trip: TripPlan, refs: string[]): ExpenseSplit {
  const ids = new Set(refs.map((r) => resolveMember(trip, r)));
  return { type: "individuals", users: [...ids].map((id) => ({ type: "registered", id })) };
}

/** e.g. `paid by Alice Smith, split between Alice Smith + Bob Jones`. */
export function formatPayerSplit(expense: Expense, trip: TripPlan): string {
  const payer = `paid by ${memberName(trip, expense.paidByUserId)}`;
  const split = expense.splitWith;
  const users = split?.users ?? [];
  if (split?.type === "individuals" && users.length > 0) {
    return `${payer}, split between ${users.map((u) => memberName(trip, u.id)).join(" + ")}`;
  }
  if (split?.type && split.type !== "individuals") return `${payer}, split: ${split.type}`;
  return `${payer}, not split`;
}

/** Settle-up payments between members, e.g. `Alice Smith → Bob Jones CAD 120 on 2026-10-05`. */
export function formatPayments(trip: TripPlan): string[] {
  return (trip.itinerary.budget?.payments ?? []).map((p) => {
    const amount = `${p.amount?.currencyCode ?? "?"} ${p.amount?.amount ?? "?"}`;
    const when = p.paidAt ? ` on ${p.paidAt.slice(0, 10)}` : "";
    return `${memberName(trip, p.fromUser?.id)} → ${memberName(trip, p.toUser?.id)} ${amount}${when}`;
  });
}
