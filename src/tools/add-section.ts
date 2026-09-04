import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  buildSectionObject,
  resolveSectionRef,
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

The new section is empty; add places to it with wanderlog_add_place by passing the section
heading as the "section" parameter, or use wanderlog_add_note / wanderlog_add_checklist.

Returns the heading and position of the inserted section.
The heading must be unique among undated sections; duplicate or ambiguous insertion targets
are rejected without making a change.
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
    const heading = args.heading ?? "";
    const tripTitle = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const normalizedHeading = heading.trim().toLowerCase();
      const duplicate =
        normalizedHeading === "places" ||
        normalizedHeading === "places to visit" ||
        trip.itinerary.sections.some(
        (section) =>
          section.mode !== "dayPlan" &&
          section.heading.trim().toLowerCase() === normalizedHeading,
        );
      if (duplicate) {
        throw new WanderlogValidationError(
          `A section named "${heading || "(untitled)"}" already exists in trip "${trip.title}". Choose a unique heading so future mutations can target it safely.`,
        );
      }
      let insertIndex: number;
      if (args.after_section) {
        const resolved = resolveSectionRef(trip, args.after_section);
        if (resolved.kind === "none") {
          throw new WanderlogValidationError(
            `Section "${args.after_section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
          );
        }
        if (resolved.kind === "ambiguous") {
          throw new WanderlogValidationError(
            `Section reference "${args.after_section}" is ambiguous: ${resolved.candidates.length} sections have that heading. Rename the duplicates in Wanderlog before choosing an insertion point.`,
          );
        }
        const found = resolved.match;
        insertIndex = found.index + 1;
      } else {
        insertIndex = trip.itinerary.sections.length;
      }
      const ops: Json0Op[] = [
        { p: ["itinerary", "sections", insertIndex], li: buildSectionObject(heading) },
      ];
      await submit(ops);
      return trip.title;
    });

    const headingLabel = heading || "(untitled)";
    const positionLabel = args.after_section
      ? `after "${args.after_section}"`
      : "at the end";
    const text = `Added section "${headingLabel}" ${positionLabel} in "${tripTitle}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
