import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import { getDaySections, resolveDay } from "../resolvers/day.js";
import { checkDayConflicts } from "./planning-helpers.js";

export const checkConflictsInputSchema = {
  trip_key: z.string().min(1).describe("The Wanderlog trip key."),
  day: z.string().optional().describe("Optional day filter; omit to analyze all itinerary days."),
};

export const checkConflictsDescription = [
  "Read-only checks for overlapping scheduled visits, invalid time ranges, overly busy days,",
  "and possible transfer timing issues. All reported distances are straight-line estimates.",
  "Walking time is only a heuristic; it does not account for public transit, roads,",
  "opening hours, or unrecorded reservations. This tool never changes trip data.",
].join(" ");

type Args = { trip_key: string; day?: string };

export async function checkConflicts(ctx: AppContext, args: Args) {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const sections = args.day ? [resolveDay(trip, args.day)] : getDaySections(trip);
    const result = { days: sections.map(checkDayConflicts) };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message =
      error instanceof WanderlogError
        ? error.toUserMessage()
        : "Unexpected error: " + (error as Error).message;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}
