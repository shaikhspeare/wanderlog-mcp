import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { findSectionByRef, submitOp } from "./shared.js";

export const updateSectionInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip containing the section to update."),
  section: z
    .string()
    .min(1)
    .describe(
      "The section to update, identified by its current heading (e.g. 'Food & Drink', 'Places to visit'). Use wanderlog_get_trip to see available sections.",
    ),
  heading: z
    .string()
    .describe(
      'New heading for the section. Pass "" (empty string) to clear it back to an untitled section.',
    ),
};

export const updateSectionDescription = `
Renames the heading of a custom section in a Wanderlog trip.

Identify the section by its current heading. Use wanderlog_get_trip to see all sections and
their current headings if you are unsure. Pass an empty string for "heading" to clear the
section title.

Returns a confirmation showing the old and new heading.
`.trim();

type Args = {
  trip_key: string;
  section: string;
  heading: string;
};

export async function updateSection(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const found = findSectionByRef(trip, args.section);
    if (!found) {
      throw new WanderlogValidationError(
        `Section "${args.section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
      );
    }

    const oldHeading = found.section.heading;
    const newHeading = args.heading;

    if (oldHeading === newHeading) {
      return {
        content: [
          {
            type: "text",
            text: `Section heading is already "${newHeading || "(untitled)"}" — no change made.`,
          },
        ],
      };
    }

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", found.index, "heading"],
        od: oldHeading,
        oi: newHeading,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const oldLabel = oldHeading || "(untitled)";
    const newLabel = newHeading || "(untitled)";
    const text = `Renamed section "${oldLabel}" → "${newLabel}" in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
