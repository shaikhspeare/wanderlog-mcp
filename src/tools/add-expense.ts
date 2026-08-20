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
    .default("other")
    .describe("Expense category."),
  description: z
    .string()
    .min(1)
    .describe("What the expense is for (e.g. 'Lunch at Ichiran Ramen', 'Subway day pass')."),
  place: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional natural-language reference to link this expense to something in the trip — a place ('Sensō-ji', 'the hotel'), or a transit/rental reservation ('the ferry', 'the bus', 'the train', 'the rental car'). Omit to log an unlinked expense (counts toward the budget total but isn't attached).",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Date of the expense, YYYY-MM-DD. Defaults to today if omitted."),
};

export const addExpenseDescription = `
Adds a budget expense to a Wanderlog trip. Optionally links the expense to a place so it shows up
on that place in the budget tracker; omit "place" to log a standalone (unlinked) expense.

Use this to give the trip a cost dimension — estimated meal costs, entrance fees, transport
passes, etc. If you link a place, it must already exist in the trip.

Returns confirmation with the expense amount and description.
`.trim();

type Args = {
  trip_key: string;
  amount: number;
  currency: string;
  category: string;
  description: string;
  place?: string;
  date?: string;
};

export async function addExpense(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const expenseDate = args.date ?? new Date().toISOString().slice(0, 10);
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      let blockId: number | null = null;
      let associatedDate: string | null = null;
      if (args.place) {
        const resolved = resolvePlaceRef(trip, args.place);
        if (resolved.kind === "ambiguous") {
          const lines = resolved.candidates.map((c, i) => {
            const name = isPlaceBlock(c.block) ? c.block.place.name : `block #${c.block.id}`;
            const loc = c.section.date
              ? `day ${c.section.date}`
              : c.section.heading || "unscheduled";
            return `  ${i + 1}. ${name} (${loc})`;
          });
          return {
            response: {
              content: [
                {
                  type: "text" as const,
                  text: `Multiple places match "${args.place}":\n${lines.join("\n")}\n\nRetry with a more specific reference.`,
                },
              ],
            },
          };
        }
        if (resolved.kind === "none") {
          throw new WanderlogError(
            `No place matching "${args.place}" found in "${trip.title}"`,
            "place_ref_not_found",
            {
              hint: "Add the place to the trip first with wanderlog_add_place, or omit 'place' to log an unlinked expense.",
              followUps: [
                `Call wanderlog_get_trip with trip_key "${args.trip_key}" to see existing places.`,
              ],
            },
          );
        }
        blockId = resolved.match.block.id;
        associatedDate = resolved.match.section.date;
      }
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
        blockId,
        associatedDate: associatedDate ?? expenseDate,
      };
      const budget = (trip.itinerary as Record<string, unknown>).budget as
        | Record<string, unknown>
        | undefined;
      const expenses = (budget?.expenses as unknown[] | undefined) ?? [];
      const ops: Json0Op[] = [
        {
          p: ["itinerary", "budget", "expenses", expenses.length],
          li: expense,
        },
      ];
      await submit(ops);
      return { tripTitle: trip.title };
    });
    if ("response" in result && result.response) return result.response;

    const currencyLabel = args.currency.toUpperCase();
    const linkLabel = args.place ? ` (linked to ${args.place})` : "";
    const text = `Added expense: ${currencyLabel} ${args.amount} for "${args.description}"${linkLabel} in "${result.tripTitle}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
