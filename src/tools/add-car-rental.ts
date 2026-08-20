import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { RentalCarEndpoint } from "../types.js";
import {
  buildRentalCarBlock,
  requireUserId,
  resolveEndpointPlace,
  sectionInsertOp,
  submitOp,
  validateChronology,
} from "./shared.js";

export const addCarRentalInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the rental car to."),
  pickup_location: z
    .string()
    .min(1)
    .describe("Pick-up location — agency branch or airport, e.g. 'Europcar Cancun Airport'."),
  pickup_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Pick-up date."),
  pickup_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (00:00–23:59)")
    .describe("Pick-up time (24h)."),
  dropoff_location: z.string().min(1).describe("Drop-off location."),
  dropoff_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Drop-off date."),
  dropoff_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (00:00–23:59)")
    .describe("Drop-off time (24h)."),
  confirmation_number: z.string().optional().describe("Booking/confirmation number (optional)."),
  notes: z.string().optional().describe("Free-text notes shown on the block (optional)."),
};

export const addCarRentalDescription = `
Adds a rental car to a Wanderlog trip, covering a pick-up and drop-off window. Locations are
matched against Google Places near the trip. The rental firm is whatever you pick as the
location — there is no separate company field. A "Rental cars" section is created if absent.

Returns confirmation with the resolved pick-up and drop-off.
`.trim();

type Args = {
  trip_key: string;
  pickup_location: string;
  pickup_date: string;
  pickup_time: string;
  dropoff_location: string;
  dropoff_date: string;
  dropoff_time: string;
  confirmation_number?: string;
  notes?: string;
};

export async function addCarRental(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    validateChronology(
      "pickup",
      args.pickup_date,
      args.pickup_time,
      "dropoff",
      args.dropoff_date,
      args.dropoff_time,
    );

    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const [pickPlace, dropPlace] = await Promise.all([
      resolveEndpointPlace(ctx, entry.snapshot, entry.geos, args.pickup_location),
      resolveEndpointPlace(ctx, entry.snapshot, entry.geos, args.dropoff_location),
    ]);

    const pickUp: RentalCarEndpoint = {
      date: args.pickup_date,
      time: args.pickup_time,
      place: pickPlace,
    };
    const dropOff: RentalCarEndpoint = {
      date: args.dropoff_date,
      time: args.dropoff_time,
      place: dropPlace,
    };

    const tripTitle = await submitOp(ctx, args.trip_key, async (lockedEntry, submit) => {
      const block = buildRentalCarBlock(userId, {
        pickUp,
        dropOff,
        confirmationNumber: args.confirmation_number,
        notes: args.notes,
      });
      await submit([sectionInsertOp(lockedEntry.snapshot, "rentalCars", block)]);
      return lockedEntry.snapshot.title;
    });

    const text = `Added rental car to "${tripTitle}" · pick-up ${pickPlace.name} ${args.pickup_date} ${args.pickup_time} → drop-off ${dropPlace.name} ${args.dropoff_date} ${args.dropoff_time}.`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
