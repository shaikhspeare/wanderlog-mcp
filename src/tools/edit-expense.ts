import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { Expense } from "../types.js";
import { findExpenseMatches, formatCandidateList, formatExpense } from "./expenses-shared.js";
import { submitOp } from "./shared.js";

export const editExpenseInputSchema = {
  trip_key: z.string().min(1).describe("The trip whose expense to edit."),
  description: z
    .string()
    .min(1)
    .describe("Case-insensitive substring matching the description of the expense to edit."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Optional exact date filter to disambiguate which expense to edit."),
  amount: z
    .number()
    .positive()
    .optional()
    .describe("Optional exact amount filter to disambiguate which expense to edit."),
  currency: z
    .string()
    .min(3)
    .max(3)
    .optional()
    .describe("Optional ISO 4217 currency filter to disambiguate which expense to edit."),
  new_description: z
    .string()
    .min(1)
    .optional()
    .describe("New description text. Omit to leave unchanged."),
  new_amount: z
    .number()
    .positive()
    .optional()
    .describe("New cost amount (e.g. 50, 12.50). Omit to leave unchanged."),
  new_currency: z
    .string()
    .min(3)
    .max(3)
    .optional()
    .describe(
      "New ISO 4217 currency code (e.g. 'EUR'). Normalized to uppercase. Omit to leave unchanged.",
    ),
  new_category: z
    .enum([
      "food",
      "drinks",
      "groceries",
      "publicTransit",
      "carRental",
      "gas",
      "flights",
      "lodging",
      "sightseeing",
      "activities",
      "shopping",
      "other",
    ])
    .optional()
    .describe("New expense category. Omit to leave unchanged."),
  new_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe(
      "New date for the expense, YYYY-MM-DD. Updates both the expense date and the budget day it's grouped under (Wanderlog's budget list displays this date). Omit to leave unchanged.",
    ),
};

export const editExpenseDescription = `
Edits an existing budget expense on a Wanderlog trip. Find the expense by a case-insensitive
substring of its description, then change any of: description, amount, currency, category, date.

If none match, an error is returned. If several match, a numbered list is returned and nothing is
changed — narrow with a more specific description or a date / amount / currency filter. Only the
fields you supply via new_* are modified; all other fields on the expense are preserved.
`.trim();

type Args = {
  trip_key: string;
  description: string;
  date?: string;
  amount?: number;
  currency?: string;
  new_description?: string;
  new_amount?: number;
  new_currency?: string;
  new_category?: string;
  new_date?: string;
};

/** od+oi replacement for an existing key; oi-only insert when the key is absent. */
function replaceField(path: (string | number)[], oldValue: unknown, newValue: unknown): Json0Op {
  return oldValue === undefined
    ? { p: path, oi: newValue }
    : { p: path, od: oldValue, oi: newValue };
}

function buildEditOps(
  expense: Expense,
  index: number,
  args: Args,
): { ops: Json0Op[]; changes: string[] } {
  const base = ["itinerary", "budget", "expenses", index];
  const ops: Json0Op[] = [];
  const changes: string[] = [];

  if (args.new_description !== undefined && args.new_description !== expense.description) {
    ops.push(replaceField([...base, "description"], expense.description, args.new_description));
    changes.push(`description → "${args.new_description}"`);
  }

  if (args.new_category !== undefined && args.new_category !== expense.category) {
    ops.push(replaceField([...base, "category"], expense.category, args.new_category));
    changes.push(`category → ${args.new_category}`);
  }

  if (args.new_amount !== undefined && args.new_amount !== expense.amount?.amount) {
    ops.push(replaceField([...base, "amount", "amount"], expense.amount?.amount, args.new_amount));
    changes.push(`amount → ${args.new_amount}`);
  }

  if (args.new_currency !== undefined) {
    const normalized = args.new_currency.toUpperCase();
    if (normalized !== expense.amount?.currencyCode) {
      ops.push(
        replaceField([...base, "amount", "currencyCode"], expense.amount?.currencyCode, normalized),
      );
      changes.push(`currency → ${normalized}`);
    }
  }

  if (args.new_date !== undefined) {
    // Wanderlog's budget list displays `associatedDate` (the trip day the
    // expense is grouped under), not `date`, so keep both in sync.
    const dateChanged = args.new_date !== expense.date;
    const assocChanged = args.new_date !== expense.associatedDate;
    if (dateChanged) {
      ops.push(replaceField([...base, "date"], expense.date, args.new_date));
    }
    if (assocChanged) {
      ops.push(replaceField([...base, "associatedDate"], expense.associatedDate, args.new_date));
    }
    if (dateChanged || assocChanged) {
      changes.push(`date → ${args.new_date}`);
    }
  }

  return { ops, changes };
}

export async function editExpense(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const hasNewValue =
      args.new_description !== undefined ||
      args.new_amount !== undefined ||
      args.new_currency !== undefined ||
      args.new_category !== undefined ||
      args.new_date !== undefined;
    if (!hasNewValue) {
      throw new WanderlogValidationError(
        "Nothing to edit — supply at least one of new_description, new_amount, new_currency, new_category, or new_date.",
      );
    }

    const trip = await ctx.tripCache.get(args.trip_key);
    const matches = findExpenseMatches(trip, {
      description: args.description,
      date: args.date,
      amount: args.amount,
      currency: args.currency,
    });

    if (matches.length === 0) {
      throw new WanderlogNotFoundError("Expense", args.description);
    }

    if (matches.length > 1) {
      return {
        content: [
          {
            type: "text",
            text: `"${args.description}" matches ${matches.length} expenses:\n${formatCandidateList(matches)}\n\nRe-call with a more specific description, or add a date / amount / currency filter to pick one.`,
          },
        ],
        isError: true,
      };
    }

    const { index, expense } = matches[0]!;
    const { ops, changes } = buildEditOps(expense, index, args);

    if (ops.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No changes — ${formatExpense(expense)} already has those values.`,
          },
        ],
      };
    }

    await submitOp(ctx, args.trip_key, ops);

    return {
      content: [
        {
          type: "text",
          text: `Updated expense ${formatExpense(expense)} in "${trip.title}": ${changes.join(", ")}.`,
        },
      ],
    };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
