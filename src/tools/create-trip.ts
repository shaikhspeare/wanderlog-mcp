import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";

export const createTripInputSchema = {
  destination: z
    .string()
    .min(1)
    .describe(
      "City or region name to plan the trip around (e.g. 'Lisbon', 'Tokyo', 'Banff'). Resolved via Wanderlog's geo autocomplete — the top-ranked result is used.",
    ),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("First day of the trip, YYYY-MM-DD."),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Last day of the trip, YYYY-MM-DD."),
  title: z
    .string()
    .optional()
    .describe("Optional custom title. If omitted, Wanderlog auto-generates one like 'Trip to Lisbon'."),
  privacy: z
    .enum(["private", "friends", "public"])
    .default("private")
    .describe("Trip visibility. 'private' is the safe default."),
};

export const createTripDescription = `
Creates a new Wanderlog trip for the given destination and date range. The trip is created
empty (no places yet) with one pre-generated day section per day in the range.

After creating a trip, populate each day using ALL of these tools together — places alone
make a flat list, but notes and checklists are what make an itinerary actually useful:

1. wanderlog_add_place — add attractions, restaurants, and activities
2. wanderlog_add_note — add between places for transit directions, practical tips, time
   warnings, or local recommendations (e.g. "Walk 10 min south along the river to the next
   stop" or "Closed Mondays — check hours before visiting")
3. wanderlog_add_hotel — add accommodation with check-in/check-out dates
4. wanderlog_add_checklist — add a packing list to the trip, or per-day task lists
   (e.g. "Day 1 prep: print tickets, charge camera, pack umbrella")

A good itinerary has notes after most places — think of them as the connective tissue that
turns a list of pins on a map into a real travel plan.

Returns the new trip key so you can reference it in subsequent tool calls.
`.trim();

type Args = {
  destination: string;
  start_date: string;
  end_date: string;
  title?: string;
  privacy?: "private" | "friends" | "public";
};

export async function createTrip(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (args.end_date < args.start_date) {
      throw new WanderlogValidationError(
        `end_date (${args.end_date}) is before start_date (${args.start_date})`,
      );
    }

    const geos = await ctx.rest.geoAutocomplete(args.destination);
    if (geos.length === 0) {
      throw new WanderlogError(
        `No location found for "${args.destination}"`,
        "geo_not_found",
        "Try a more specific or well-known place name.",
      );
    }

    const top = geos[0]!;
    const result = await ctx.rest.createTrip({
      geoIds: [top.id],
      startDate: args.start_date,
      endDate: args.end_date,
      title: args.title ?? null,
      privacy: args.privacy ?? "private",
    });

    const locationLabel = top.stateName
      ? `${top.name}, ${top.stateName}, ${top.countryName}`
      : `${top.name}, ${top.countryName ?? ""}`.trim().replace(/,\s*$/, "");
    const days = result.key ? Math.round((new Date(args.end_date).getTime() - new Date(args.start_date).getTime()) / 86_400_000) + 1 : 0;
    const text = [
      `Created "${result.title}" for ${locationLabel}. Dates: ${args.start_date} → ${args.end_date} (${days} days). Key: ${result.key}`,
      ``,
      `Now build the itinerary. For each day, follow this pattern:`,
      `  1. wanderlog_add_place — add 3-5 places (attractions, food, activities)`,
      `  2. wanderlog_add_note — add a note after each place with transit directions, practical tips, or local advice`,
      `  3. wanderlog_add_checklist — add a day-specific task list if useful (e.g. "bring cash", "book ahead")`,
      `Also call wanderlog_add_hotel for accommodation, and wanderlog_add_checklist (no day) for a packing list.`,
      `A great itinerary interleaves places and notes — don't add all places first and skip the notes.`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
