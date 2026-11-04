import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import { resolveDay } from "../resolvers/day.js";
import { suggestProximityOrder } from "./planning-helpers.js";

export const optimizeDayInputSchema = {
  trip_key: z.string().min(1).describe("The Wanderlog trip key."),
  day: z.string().min(1).describe('Trip day, such as "day 2", "May 4", or "2026-05-04".'),
};

export const optimizeDayDescription = [
  "Suggest a proximity-based visiting order for one itinerary day without changing the trip.",
  "Timed visits, recognizable bookings, and places without coordinates remain in their original positions.",
  "The proposal is a nearest-neighbor geographic heuristic, not a verified public transit or walking route.",
  "Opening hours, bookings, and actual transfer times must be checked separately.",
].join(" ");

type Args = { trip_key: string; day: string };

export async function optimizeDay(ctx: AppContext, args: Args) {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const section = resolveDay(trip, args.day);
    const result = suggestProximityOrder(section);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message =
      error instanceof WanderlogError
        ? error.toUserMessage()
        : "Unexpected error: " + (error as Error).message;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
