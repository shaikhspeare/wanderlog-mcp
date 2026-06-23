import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  findExpenseMatches,
  formatCandidateList,
  formatExpense,
} from "./expenses-shared.js";
import { submitOp } from "./shared.js";

export const removeExpenseInputSchema = {
  trip_key: z.string().min(1).describe("The trip to remove the expense from."),
  description: z
    .string()
    .min(1)
    .describe("Case-insensitive substring matching the expense description to remove."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Optional exact date filter to disambiguate duplicates, YYYY-MM-DD."),
  amount: z
    .number()
    .positive()
    .optional()
    .describe("Optional exact amount filter to disambiguate duplicates."),
  currency: z
    .string()
    .min(3)
    .max(3)
    .optional()
    .describe("Optional ISO 4217 currency filter to disambiguate duplicates. Case-insensitive."),
};

export const removeExpenseDescription = `
Removes a budget expense from a Wanderlog trip by matching a substring of its description.

The match is case-insensitive. If exactly one expense matches, it is deleted. If none match, an
error is returned. If several match, a numbered list is returned and nothing is deleted — re-call
with a more specific description or add a date / amount / currency filter to pick one.
`.trim();

type Args = {
  trip_key: string;
  description: string;
  date?: string;
  amount?: number;
  currency?: string;
};

export async function removeExpense(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
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
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "budget", "expenses", index],
        ld: expense,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    return {
      content: [
        {
          type: "text",
          text: `Removed expense ${formatExpense(expense)} from "${trip.title}".`,
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
