import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { PlaceData } from "../types.js";
import {
  buildPlaceBlock,
  findHotelsSection,
  findTripCenter,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addHotelInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the hotel to."),
  hotel: z
    .string()
    .min(1)
    .describe(
      "Hotel name to search for. Examples: 'Park Hyatt Tokyo', 'the cheap hostel near the train station'. Matched against Google Places near the trip's destination.",
    ),
  check_in: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Check-in date, YYYY-MM-DD."),
  check_out: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Check-out date, YYYY-MM-DD. Must be after check_in."),
};

export const addHotelDescription = `
Adds a hotel booking to a Wanderlog trip with check-in and check-out dates. If the trip does
not yet have a "Hotels and lodging" section, one is created automatically.

Returns confirmation with the resolved hotel name and the booking window.
`.trim();

type Args = {
  trip_key: string;
  hotel: string;
  check_in: string;
  check_out: string;
};

export async function addHotel(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (args.check_out <= args.check_in) {
      throw new WanderlogValidationError(
        `check_out (${args.check_out}) must be after check_in (${args.check_in})`,
      );
    }

    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const center = findTripCenter(trip, entry.geos);
    if (!center) {
      throw new WanderlogValidationError(
        `Cannot add hotel to "${trip.title}" because no location anchor is available`,
        "This trip has no associated geo and no existing places.",
      );
    }

    const predictions = await ctx.rest.searchPlacesAutocomplete({
      input: args.hotel,
      sessionToken: crypto.randomUUID(),
      location: { latitude: center.lat, longitude: center.lng },
      radius: 15000,
    });
    if (predictions.length === 0) {
      throw new WanderlogError(
        `No hotel found matching "${args.hotel}" near ${trip.title}`,
        "hotel_not_found",
        "Try a more specific name or check the spelling.",
      );
    }
    const detail: PlaceData = await ctx.rest.getPlaceDetails(predictions[0]!.place_id);

    const block = buildPlaceBlock(detail, userId, {
      hotel: {
        checkIn: args.check_in,
        checkOut: args.check_out,
        travelerNames: [],
        confirmationNumber: null,
      },
    });

    const existing = findHotelsSection(trip);
    const ops: Json0Op[] = existing
      ? [
          {
            p: ["itinerary", "sections", existing.index, "blocks", existing.section.blocks.length],
            li: block,
          },
        ]
      : [
          {
            // Insert a new hotels section after the Notes section (index 1).
            // The existing sections shift down by 1.
            p: ["itinerary", "sections", 1],
            li: {
              id: Math.floor(Math.random() * 1_000_000_000),
              type: "hotels",
              mode: "placeList",
              heading: "Hotels and lodging",
              date: null,
              blocks: [block],
              placeMarkerColor: "#7045af",
              placeMarkerIcon: "bed",
              text: { ops: [{ insert: "\n" }] },
            },
          },
        ];

    await submitOp(ctx, args.trip_key, ops);

    const text = `Added ${detail.name} to "${trip.title}" · check-in ${args.check_in} → check-out ${args.check_out}.`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
