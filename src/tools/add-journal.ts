import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { JournalStop, PlaceData } from "../types.js";
import { findTripCenter, generateBlockId, submitOp } from "./shared.js";
import { getJournalStops } from "./journal-shared.js";

export const addJournalInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the journal stop to."),
  place: z
    .string()
    .min(1)
    .describe(
      "Natural-language place this journal stop is about (e.g. 'Marina Bay Sands', 'the ramen place in Hakata'). Resolved against Wanderlog's place search near the trip and embedded in the stop.",
    ),
  title: z
    .string()
    .min(1)
    .optional()
    .describe("Title for the stop. Defaults to the resolved place name."),
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
};

export const addJournalDescription = `
Adds a stop to a Wanderlog trip's journal (travelogue). A stop pins a place with a date/time and
an optional text entry, and appears in the trip's journal timeline.

The place is resolved against Wanderlog's place search near the trip's destination — pass a
natural-language name and the best match is embedded in the stop. Returns confirmation with the
resolved place name.
`.trim();

type Args = {
  trip_key: string;
  place: string;
  title?: string;
  text?: string;
  date?: string;
  time?: string;
};

/**
 * Wanderlog stores each stop's dateTime with a destination timezone offset
 * (e.g. "+08:00"). We don't carry a tz database, so reuse the offset from an
 * existing stop on the trip; absent that, send a bare local datetime and let
 * the server attach the offset (verified against live data).
 */
function buildDateTime(date: string, time: string, existingOffset: string): string {
  return `${date}T${time}${existingOffset}`;
}

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

    const center = findTripCenter(trip, entry.geos);
    if (!center) {
      throw new WanderlogError(
        `Cannot resolve a place for the journal stop in "${trip.title}"`,
        "no_location_anchor",
        "This trip has no associated geo and no existing places. Add a place to the trip first.",
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
    const detail: PlaceData = await ctx.rest.getPlaceDetails(predictions[0]!.place_id);

    const stops = getJournalStops(trip).map((m) => m.stop);
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const time = args.time ?? "09:00";
    const dateTime = buildDateTime(date, time, existingStopOffset(stops));

    const stop: Record<string, unknown> = {
      id: generateBlockId(),
      type: "confirmed",
      title: args.title ?? detail.name,
      dateTime,
      place: detail,
      media: [],
    };
    if (args.text) {
      stop.text = { ops: [{ insert: args.text }] };
    }

    const insertIndex = stops.length;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "journal", "stops", insertIndex],
        li: stop,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const titleLabel = (args.title ?? detail.name) || detail.name;
    return {
      content: [
        {
          type: "text",
          text: `Added journal stop "${titleLabel}" (${date}) at ${detail.name} in "${trip.title}".`,
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
