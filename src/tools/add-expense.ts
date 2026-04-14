import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { isPlaceBlock } from "../types.js";
import { generateBlockId, requireUserId, submitOp } from "./shared.js";

export const addExpenseInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to add the expense to."),
  amount: z
    .number()
    .positive()
    .describe("Cost amount (e.g. 50, 12.50)."),
  currency: z
    .string()
    .min(3)
    .max(3)
    .default("USD")
    .describe("ISO 4217 currency code (e.g. 'USD', 'JPY', 'EUR'). Defaults to USD."),
  category: z
    .enum(["food", "transport", "accommodation", "activities", "shopping", "other"])
    .default("other")
    .describe("Expense category."),
  description: z
    .string()
    .min(1)
    .describe("What the expense is for (e.g. 'Lunch at Ichiran Ramen', 'Subway day pass')."),
  place: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to link this expense to a place in the trip (e.g. 'Sensō-ji', 'the hotel'). Required — every expense must be linked to a place.",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Date of the expense, YYYY-MM-DD. Defaults to today if omitted."),
};

export const addExpenseDescription = `
Adds a budget expense to a Wanderlog trip linked to a specific place. Expenses appear in the
trip's budget tracker on the linked place.

Use this after adding places to give the trip a cost dimension — estimated meal costs, entrance
fees, transport passes, etc. The place must already exist in the trip.

Returns confirmation with the expense amount and description.
`.trim();

type Args = {
  trip_key: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  place: string;
  date?: string;
};

export async function addExpense(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    // Every expense must be linked to a place — Wanderlog's UI crashes on
    // unlinked expenses (blockId: null triggers an undefined .text access).
    const result = resolvePlaceRef(trip, args.place);
    if (result.kind === "ambiguous") {
      const lines = result.candidates.map((c, i) => {
        const name = isPlaceBlock(c.block) ? c.block.place.name : `block #${c.block.id}`;
        const loc = c.section.date ? `day ${c.section.date}` : c.section.heading || "unscheduled";
        return `  ${i + 1}. ${name} (${loc})`;
      });
      const text = `Multiple places match "${args.place}":\n${lines.join("\n")}\n\nRetry with a more specific reference.`;
      return { content: [{ type: "text", text }] };
    }
    if (result.kind === "none") {
      throw new WanderlogError(
        `No place matching "${args.place}" found in "${trip.title}"`,
        "place_ref_not_found",
        {
          hint: "Add the place to the trip first with wanderlog_add_place, then add the expense.",
          followUps: [
            `Call wanderlog_get_trip with trip_key "${args.trip_key}" to see existing places.`,
          ],
        },
      );
    }
    const blockId = result.match.block.id;
    const associatedDate = result.match.section.date;

    const expenseDate = args.date ?? new Date().toISOString().slice(0, 10);

    // Build the expense object matching Wanderlog's schema
    const expense: Record<string, unknown> = {
      id: generateBlockId(),
      amount: {
        amount: args.amount,
        currencyCode: args.currency.toUpperCase(),
      },
      category: args.category,
      description: args.description,
      date: expenseDate,
      paidByUserId: userId,
      paidByUser: { type: "registered", id: userId },
      splitWith: { type: "individuals", users: [] },
      blockId: blockId,
      associatedDate: associatedDate ?? expenseDate,
    };

    // Find the current expenses array length to insert at the end
    const budget = (trip.itinerary as Record<string, unknown>).budget as
      | Record<string, unknown>
      | undefined;
    const expenses = (budget?.expenses as unknown[] | undefined) ?? [];
    const insertIndex = expenses.length;

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "budget", "expenses", insertIndex],
        li: expense,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const currencyLabel = args.currency.toUpperCase();
    const text = `Added expense: ${currencyLabel} ${args.amount} for "${args.description}" (linked to ${args.place}) in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
