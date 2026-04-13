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
};

export const addPlaceDescription = `
Adds a place to a Wanderlog trip. Searches for the place near the trip's destination, picks the
best match, and inserts it into either a specific day or the general "Places to visit" list.

After adding a place, follow up with wanderlog_add_note on the same day to provide context a
traveler needs: how to get there from the previous stop, what to order, whether to book ahead,
or how long to budget. Places without notes are just pins on a map.

Returns a confirmation including the resolved place name and where it was added. If the place
can't be found near the trip, the tool returns an actionable error suggesting a more specific
query.
`.trim();

type Args = {
  trip_key: string;
  place: string;
  day?: string;
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

    // Build the block and the op
    const block = buildPlaceBlock(detail, userId);
    const section = trip.itinerary.sections[targetIndex]!;
    const insertIndex = section.blocks.length;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", targetIndex, "blocks", insertIndex],
        li: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const text = `Added ${detail.name} to ${targetLabel} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

