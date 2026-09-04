import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  isCustomSection,
  resolveSectionRef,
  submitOp,
} from "./shared.js";

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
The current heading must identify exactly one section and the new heading must not duplicate
another undated section.
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
    const newHeading = args.heading;
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const resolved = resolveSectionRef(trip, args.section);
      if (resolved.kind === "none") {
        throw new WanderlogValidationError(
          `Section "${args.section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
        );
      }
      if (resolved.kind === "ambiguous") {
        throw new WanderlogValidationError(
          `Section reference "${args.section}" is ambiguous: ${resolved.candidates.length} sections have that heading. Rename the duplicates in Wanderlog before retrying.`,
        );
      }
      const found = resolved.match;
      const { index, section } = found;
      if (!isCustomSection(trip, index)) {
        const reason = section.mode === "dayPlan"
          ? `Day sections cannot be renamed here. Use wanderlog_rename_day to change a day's heading instead.`
          : section.heading === "Places to visit"
            ? `The "Places to visit" section cannot be renamed — it is the trip's default place list. Use wanderlog_get_trip to see your custom sections.`
            : `The "${section.heading || section.type}" section is a system section and cannot be renamed. Use wanderlog_get_trip to see your custom sections.`;
        throw new WanderlogValidationError(
          reason,
        );
      }
      const oldHeading = section.heading;
      if (oldHeading === newHeading) {
        return {
          response: {
            content: [
              {
                type: "text" as const,
                text: `Section heading is already "${newHeading || "(untitled)"}" — no change made.`,
              },
            ],
          },
        };
      }
      const normalizedHeading = newHeading.trim().toLowerCase();
      const duplicate =
        normalizedHeading === "places" ||
        normalizedHeading === "places to visit" ||
        trip.itinerary.sections.some(
          (candidate) =>
            candidate.id !== section.id &&
            candidate.mode !== "dayPlan" &&
            candidate.heading.trim().toLowerCase() === normalizedHeading,
        );
      if (duplicate) {
        throw new WanderlogValidationError(
          `A different section named "${newHeading || "(untitled)"}" already exists. Choose a unique heading so future mutations can target it safely.`,
        );
      }
      const ops: Json0Op[] = [
        {
          p: ["itinerary", "sections", index, "heading"],
          od: oldHeading,
          oi: newHeading,
        },
      ];
      await submit(ops);
      return { oldHeading, tripTitle: trip.title };
    });
    if ("response" in result && result.response) return result.response;

    const oldLabel = result.oldHeading || "(untitled)";
    const newLabel = newHeading || "(untitled)";
    const text = `Renamed section "${oldLabel}" → "${newLabel}" in "${result.tripTitle}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
