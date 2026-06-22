import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  buildSectionObject,
  findSectionByRef,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addSectionInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to add the section to. Use wanderlog_list_trips if you don't know the key."),
  heading: z
    .string()
    .optional()
    .describe(
      "Heading for the new section (e.g. 'Food & Drink', 'Must-See Spots'). Omit for an untitled section.",
    ),
  after_section: z
    .string()
    .optional()
    .describe(
      "Insert the new section immediately after an existing section identified by its heading (e.g. 'Places to visit', 'Food & Drink'). Omit to append at the end of the trip.",
    ),
};

export const addSectionDescription = `
Adds a new custom section to a Wanderlog trip itinerary. Sections are containers for places,
notes, and other blocks — use them to group content thematically (e.g. "Food & Drink",
"Day Trips", "Must-See Spots") or to create additional place lists beyond the default
"Places to visit".

The new section is empty; add places to it with wanderlog_add_place using the section heading
as the "day" reference, or use wanderlog_add_note / wanderlog_add_checklist.

Returns the heading and position of the inserted section.
`.trim();

type Args = {
  trip_key: string;
  heading?: string;
  after_section?: string;
};

export async function addSection(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    let insertIndex: number;
    if (args.after_section) {
      const found = findSectionByRef(trip, args.after_section);
      if (!found) {
        throw new WanderlogValidationError(
          `Section "${args.after_section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
        );
      }
      insertIndex = found.index + 1;
    } else {
      insertIndex = trip.itinerary.sections.length;
    }

    const heading = args.heading ?? "";
    const section = buildSectionObject(heading);

    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", insertIndex], li: section },
    ];
    await submitOp(ctx, args.trip_key, ops);

    const headingLabel = heading || "(untitled)";
    const positionLabel = args.after_section
      ? `after "${args.after_section}"`
      : "at the end";
    const text = `Added section "${headingLabel}" ${positionLabel} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
