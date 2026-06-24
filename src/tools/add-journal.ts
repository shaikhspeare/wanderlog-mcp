import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { JournalStop, PlaceData } from "../types.js";
import { findTripCenter, generateBlockId, submitOp } from "./shared.js";
import { findTripPlaces, getJournalStops, placeItineraryDate } from "./journal-shared.js";

export const addJournalInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the journal stop to."),
  place: z
    .string()
    .min(1)
    .describe(
      "The place this journal stop is about (e.g. 'Marina Bay Sands', 'Gardens by the Bay'). Reuses a matching place already in the trip; if none matches, you'll be prompted to add it to the itinerary first (or pass allow_new_place).",
    ),
  title: z
    .string()
    .min(1)
    .optional()
    .describe("Title for the stop. Defaults to the place name."),
  text: z
    .string()
    .optional()
    .describe("The journal entry text for this stop (your notes/story about the place)."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Date of the stop, YYYY-MM-DD. Defaults to today."),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Time of the stop, HH:mm. Defaults to 09:00."),
  allow_new_place: z
    .boolean()
    .optional()
    .describe(
      "Set true to journal a place that isn't in your itinerary — it's searched and added as a new (unplanned) place. Leave unset to be prompted instead.",
    ),
};

export const addJournalDescription = `
Adds a stop to a Wanderlog trip's journal (travelogue). A stop pins a place with a date/time and
an optional text entry, and appears in the trip's journal timeline.

Place handling: the tool first reuses a place already in the trip (an itinerary place or an
existing journal stop) that matches the name. If the place isn't in the trip yet, it does NOT
add it silently — it returns a prompt suggesting you add it to the itinerary first
(wanderlog_add_place), or re-call with allow_new_place: true to journal it as a new place.
`.trim();

type Args = {
  trip_key: string;
  place: string;
  title?: string;
  text?: string;
  date?: string;
  time?: string;
  allow_new_place?: boolean;
};

/**
 * Wanderlog stores each stop's dateTime with a destination timezone offset
 * (e.g. "+08:00"). We don't carry a tz database, so reuse the offset from an
 * existing stop on the trip; absent that, send a bare local datetime and let
 * the server attach the offset (verified against live data).
 */
function existingStopOffset(stops: JournalStop[]): string {
  for (const s of stops) {
    const m = typeof s.dateTime === "string" ? /([+-]\d{2}:\d{2})$/.exec(s.dateTime) : null;
    if (m) return m[1]!;
  }
  return "";
}

export async function addJournal(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    // Tier 1: reuse a place the trip already references (itinerary or journal).
    const existing = findTripPlaces(trip, args.place);
    let place: PlaceData;
    let linkedToTrip: boolean;

    if (existing.length > 1) {
      const lines = existing.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.name}`).join("\n");
      return {
        content: [
          {
            type: "text",
            text: `"${args.place}" matches ${existing.length} places already in "${trip.title}":\n${lines}\n\nRe-call with a more specific name.`,
          },
        ],
        isError: true,
      };
    }

    if (existing.length === 1) {
      place = existing[0]!;
      linkedToTrip = true;
    } else if (!args.allow_new_place) {
      // Tier 2: not in the trip — prompt rather than silently adding a new place.
      return {
        content: [
          {
            type: "text",
            text: `"${args.place}" isn't a place in "${trip.title}" yet. Add it to the trip first with wanderlog_add_place and then journal it, or re-call wanderlog_add_journal with allow_new_place: true to add it as a new (unplanned) journal place.`,
          },
        ],
        isError: true,
      };
    } else {
      // Override: search for the place and embed a fresh result.
      const center = findTripCenter(trip, entry.geos);
      if (!center) {
        throw new WanderlogError(
          `Cannot resolve a new place for the journal stop in "${trip.title}"`,
          "no_location_anchor",
          "This trip has no associated geo and no existing places to anchor the search. Add a place to the trip first.",
        );
      }
      const predictions = await ctx.rest.searchPlacesAutocomplete({
        input: args.place,
        sessionToken: crypto.randomUUID(),
        location: { latitude: center.lat, longitude: center.lng },
        radius: 15000,
      });
      if (predictions.length === 0) {
        throw new WanderlogError(
          `No place found matching "${args.place}" near ${trip.title}`,
          "place_not_found",
          {
            hint: "Try a more specific name, or widen the search with wanderlog_search_places first.",
            followUps: [
              `Call wanderlog_search_places with trip_key "${args.trip_key}" and a broader query to see candidates.`,
            ],
          },
        );
      }
      place = await ctx.rest.getPlaceDetails(predictions[0]!.place_id);
      linkedToTrip = false;
    }

    const stops = getJournalStops(trip).map((m) => m.stop);
    // Default to the day this place is scheduled on in the itinerary, else today.
    const date =
      args.date ?? placeItineraryDate(trip, place) ?? new Date().toISOString().slice(0, 10);
    const time = args.time ?? "09:00";
    const dateTime = `${date}T${time}${existingStopOffset(stops)}`;

    const stop: Record<string, unknown> = {
      id: generateBlockId(),
      type: "confirmed",
      title: args.title ?? place.name,
      dateTime,
      place,
      media: [],
    };
    if (args.text) {
      stop.text = { ops: [{ insert: args.text }] };
    }

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "journal", "stops", stops.length],
        li: stop,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const titleLabel = args.title ?? place.name;
    const suffix = linkedToTrip
      ? " (reused a place already in your trip)"
      : ` (new place — ${place.name} wasn't in your itinerary)`;
    return {
      content: [
        {
          type: "text",
          text: `Added journal stop "${titleLabel}" (${date}) at ${place.name} in "${trip.title}"${suffix}.`,
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
