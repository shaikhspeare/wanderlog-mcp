import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import { formatTripList } from "../formatters/trip-summary.js";

export const listTripsInputSchema = {
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe(
      "Output verbosity. 'concise' (default) gives a one-line summary per trip; 'detailed' includes key, numeric id, owner, last-edited time, and the trip's forwarding email address.",
    ),
};

export const listTripsDescription = `
Lists all Wanderlog trips in the authenticated user's account (owned and shared-with-you).

Returns a compact list with title, dates, place count, and trip_key. Use this tool first when
the user mentions a trip by name but you don't have its trip_key yet — the key is required by
wanderlog_get_trip and wanderlog_search_places.

Each line includes a [key: ...] suffix — extract that key for downstream tool calls.
For the numeric trip id and the import/forwarding email address, request
response_format='detailed'. The forwarding email can be used to import
reservation confirmations into the trip; see also wanderlog_get_trip_forwarding_email.
`.trim();

type Args = { response_format?: "concise" | "detailed" };

export async function listTrips(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trips = await ctx.rest.listTrips();
    const text = formatTripList(trips, args.response_format ?? "concise");
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const e = err instanceof WanderlogError
      ? err.toUserMessage()
      : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: e }], isError: true };
  }
}
