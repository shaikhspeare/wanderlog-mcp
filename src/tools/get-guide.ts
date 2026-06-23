import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import { formatTrip } from "../formatters/trip-summary.js";
import { resolveDay } from "../resolvers/day.js";

export const getGuideInputSchema = {
  guide_key: z
    .string()
    .min(1)
    .describe(
      "Guide's viewKey (the 'guide_key' returned by wanderlog_search_guides, e.g. 'hejurejdks').",
    ),
  day: z
    .string()
    .optional()
    .describe("Optional day filter — pass a day heading or date to scope the output to one day."),
  response_format: z
    .enum(["concise", "detailed"])
    .default("concise")
    .describe(
      "Output verbosity. 'concise' is a readable summary; 'detailed' adds addresses, phone numbers, ratings.",
    ),
};

export const getGuideDescription = `
Fetches the full content of a public Wanderlog guide — sections, places, and notes — and
renders it as readable text. Pass the guide_key from a wanderlog_search_guides response.

For your own trips, use wanderlog_get_trip instead.
`.trim();

export type GetGuideArgs = {
  guide_key: string;
  day?: string;
  response_format?: "concise" | "detailed";
};

export async function getGuide(
  ctx: AppContext,
  args: GetGuideArgs,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (!args.guide_key || args.guide_key.trim().length === 0) {
      throw new WanderlogValidationError("guide_key is required");
    }
    const trip = await ctx.rest.getGuideContent(args.guide_key);
    const day = args.day ? resolveDay(trip, args.day) : undefined;
    const text = formatTrip(trip, args.response_format ?? "concise", day);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const e =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: e }], isError: true };
  }
}
