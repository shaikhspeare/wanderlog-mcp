import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { PlaceData } from "../types.js";
import {
  buildPlaceBlock,
  findDaySectionByDate,
  findPlacesToVisitSection,
  findTripCenter,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addPlaceInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to add to. Use wanderlog_list_trips if you don't know the key."),
  place: z
    .string()
    .min(1)
    .describe(
      "Name of the place to add. Examples: 'Sensō-ji', 'a ramen place in Shinjuku', 'Louvre'. Will be matched against Google Places near the trip's destination; if multiple match, the top result is used.",
    ),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to add the place to. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. Omit to add the place to the trip's 'Places to visit' list (unscheduled).",
    ),
  note: z
    .string()
    .optional()
    .describe(
      "Optional inline note attached directly to this place. Use for practical context: transit directions, what to order, booking tips, time guidance. Appears on the place itself in Wanderlog (not as a separate note block).",
    ),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Optional start time in HH:mm format (e.g. '09:00'). Adds a scheduled time to the place."),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Optional end time in HH:mm format (e.g. '11:30'). Only used with start_time."),
};

export const addPlaceDescription = `
Adds a place to a Wanderlog trip. Searches for the place near the trip's destination, picks the
best match, and inserts it into either a specific day or the general "Places to visit" list.

PREFERRED: Use the "note" parameter to attach practical context directly to each place — transit
directions, what to order, booking tips, time guidance. This is better than a separate
wanderlog_add_note call because the note lives on the place itself in the itinerary. Use the
"start_time" and "end_time" parameters to give the place a scheduled time window.

Use standalone wanderlog_add_note only for freestanding commentary between places (neighborhood
context, multi-stop transit, day-level tips that aren't about a specific place).

Returns a confirmation including the resolved place name and where it was added.
`.trim();

type Args = {
  trip_key: string;
  place: string;
  day?: string;
  note?: string;
  start_time?: string;
  end_time?: string;
};

export async function addPlace(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    // Resolve target section
    let targetIndex: number;
    let targetLabel: string;
    if (args.day) {
      const daySection = resolveDay(trip, args.day);
      const found = findDaySectionByDate(trip, daySection.date!);
      if (!found) {
        throw new WanderlogValidationError(
          `Day ${args.day} not found in trip`,
        );
      }
      targetIndex = found.index;
      targetLabel = `day ${daySection.date}`;
    } else {
      const places = findPlacesToVisitSection(trip);
      if (!places) {
        throw new WanderlogError(
          "Trip has no 'Places to visit' list",
          "no_places_section",
          "This is unexpected — Wanderlog usually creates one automatically. Try adding to a specific day instead.",
        );
      }
      targetIndex = places.index;
      targetLabel = "places to visit";
    }

    const center = findTripCenter(trip, entry.geos);
    if (!center) {
      throw new WanderlogValidationError(
        `Cannot add places to "${trip.title}" because no location anchor is available`,
        "This trip has no associated geo and no existing places. Add a place via the Wanderlog UI first.",
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
            `Call wanderlog_search_places with trip_key "${args.trip_key}" and a broader query to see nearby candidates.`,
            "Retry wanderlog_add_place with a more specific place name (include the city or neighborhood).",
          ],
        },
      );
    }
    const topPrediction = predictions[0]!;
    const detail: PlaceData = await ctx.rest.getPlaceDetails(topPrediction.place_id);

    // Build the block WITHOUT timing — timing is set via separate oi ops
    // to match the Wanderlog UI's two-step pattern (insert block, then set fields).
    const block = buildPlaceBlock(detail, userId);
    const section = trip.itinerary.sections[targetIndex]!;
    const insertIndex = section.blocks.length;
    const blockPath = ["itinerary", "sections", targetIndex, "blocks", insertIndex];
    const ops: Json0Op[] = [
      { p: blockPath, li: block },
    ];

    await submitOp(ctx, args.trip_key, ops);

    // Follow-up: set inline note text via rich-text subtype op
    if (args.note) {
      const textOps: Json0Op[] = [
        {
          p: [...blockPath, "text"],
          t: "rich-text",
          o: [{ insert: `${args.note}\n` }],
        },
      ];
      await submitOp(ctx, args.trip_key, textOps);
    }

    // Follow-up: set timing via plain oi ops. The block was inserted without
    // timing fields, so we use oi (object insert) without od — the key doesn't
    // exist yet. This matches the Wanderlog UI's two-step pattern.
    if (args.start_time || args.end_time) {
      const timeOps: Json0Op[] = [];
      if (args.start_time) {
        timeOps.push({
          p: [...blockPath, "startTime"],
          oi: args.start_time,
        });
      }
      if (args.end_time) {
        timeOps.push({
          p: [...blockPath, "endTime"],
          oi: args.end_time,
        });
      }
      await submitOp(ctx, args.trip_key, timeOps);
    }

    const parts = [`Added ${detail.name} to ${targetLabel} in "${trip.title}".`];
    if (args.start_time) {
      parts.push(`Scheduled: ${args.start_time}${args.end_time ? `–${args.end_time}` : ""}.`);
    }
    if (args.note) {
      const preview = args.note.length > 60 ? `${args.note.slice(0, 57)}…` : args.note;
      parts.push(`Note: "${preview}"`);
    }
    const text = parts.join(" ");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

