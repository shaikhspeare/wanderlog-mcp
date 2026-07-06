import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import { tripForwardingEmail } from "../forwarding-email.js";

export const getTripForwardingEmailInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip key from wanderlog_list_trips."),
};

export const getTripForwardingEmailDescription = `
Returns the email address you can forward reservation emails to for
automatic import into this trip.

Wanderlog parses forwarded flight, hotel, and rental car confirmations
(from Booking.com, Airbnb, airlines, etc.) and attaches them to the
trip, deduplicating against existing reservations. See:
https://help.wanderlog.com/hc/en-us/articles/4625693334811

Use this when a user wants to set up automated import for a trip, for
example, configuring a mail filter, an integration or copy pasting
the address into a booking confirmation forward.
`.trim();

type Args = { trip_key: string };

export async function getTripForwardingEmail(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    return {
      content: [{ type: "text", text: tripForwardingEmail(trip.id) }],
    };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
