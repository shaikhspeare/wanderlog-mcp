import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { TransitEndpoint } from "../types.js";
import {
  buildTransitBlock,
  requireUserId,
  resolveEndpointPlace,
  sectionInsertOp,
  submitOp,
  validateChronology,
} from "./shared.js";

export const addTransitInputSchema = {
  trip_key: z.string().min(1).describe("The trip to add the transit leg to."),
  type: z
    .enum(["ferry", "bus", "train"])
    .describe("Kind of transit reservation. Flights use their own flow; not here."),
  carrier: z
    .string()
    .min(1)
    .describe("Operator / line name, e.g. 'Brittany Ferries', 'FlixBus', 'SNCF'."),
  from: z.string().min(1).describe("Departure place (terminal/station), resolved near the trip."),
  to: z.string().min(1).describe("Arrival place (terminal/station)."),
  depart_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Departure date."),
  depart_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (00:00–23:59)")
    .describe("Departure time (24h)."),
  arrive_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .describe("Arrival date."),
  arrive_time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "must be HH:mm (00:00–23:59)")
    .describe("Arrival time (24h)."),
  confirmation_number: z.string().optional().describe("Booking/confirmation number (optional)."),
  notes: z.string().optional().describe("Free-text notes shown on the block (optional)."),
};

export const addTransitDescription = `
Adds a ferry, bus, or train leg to a Wanderlog trip. Departure and arrival places are matched
against Google Places near the trip's destination. Ferries, buses and trains share the trip's
"Transit" section, which is created automatically if absent.

Returns confirmation with the resolved route and departure time.
`.trim();

type Args = {
  trip_key: string;
  type: "ferry" | "bus" | "train";
  carrier: string;
  from: string;
  to: string;
  depart_date: string;
  depart_time: string;
  arrive_date: string;
  arrive_time: string;
  confirmation_number?: string;
  notes?: string;
};

export async function addTransit(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    validateChronology(
      "depart",
      args.depart_date,
      args.depart_time,
      "arrive",
      args.arrive_date,
      args.arrive_time,
    );

    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const [fromPlace, toPlace] = await Promise.all([
      resolveEndpointPlace(ctx, entry.snapshot, entry.geos, args.from),
      resolveEndpointPlace(ctx, entry.snapshot, entry.geos, args.to),
    ]);

    const depart: TransitEndpoint = {
      place: fromPlace,
      date: args.depart_date,
      time: args.depart_time,
    };
    const arrive: TransitEndpoint = {
      place: toPlace,
      date: args.arrive_date,
      time: args.arrive_time,
    };

    const tripTitle = await submitOp(ctx, args.trip_key, async (lockedEntry, submit) => {
      const block = buildTransitBlock(args.type, userId, {
        carrier: args.carrier,
        depart,
        arrive,
        confirmationNumber: args.confirmation_number,
        notes: args.notes,
      });
      await submit([sectionInsertOp(lockedEntry.snapshot, "transit", block)]);
      return lockedEntry.snapshot.title;
    });

    const text = `Added ${args.type} ${args.carrier} to "${tripTitle}" · ${fromPlace.name} → ${toPlace.name} · ${args.depart_date} ${args.depart_time}.`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
