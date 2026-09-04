import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { validatePosition } from "./organization-shared.js";
import { isCustomSection, resolveSectionRef, submitOp } from "./shared.js";

export const reorderSectionsInputSchema = {
  trip_key: z.string().min(1).describe("The trip containing the custom list to reorder."),
  section: z
    .string()
    .min(1)
    .describe("Unique heading of the custom list to move."),
  position: z
    .number()
    .int()
    .positive()
    .describe("New 1-based position among custom lists only."),
};

export const reorderSectionsDescription = `
Moves one custom section/list to a new 1-based position among the trip's custom lists.
Day sections, the default Places to visit list, and system sections are not reorder targets;
their relative order is preserved. The section is moved intact with all of its blocks and
metadata. Duplicate section headings are rejected without making changes.
`.trim();

type Args = {
  trip_key: string;
  section: string;
  position: number;
};

export async function reorderSections(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const resolved = resolveSectionRef(trip, args.section);
      if (resolved.kind === "none") {
        throw new WanderlogValidationError(
          `Section "${args.section}" not found in trip "${trip.title}".`,
        );
      }
      if (resolved.kind === "ambiguous") {
        throw new WanderlogValidationError(
          `Section reference "${args.section}" is ambiguous: ${resolved.candidates.length} sections have that heading. Rename the duplicates before reordering.`,
        );
      }
      if (!isCustomSection(trip, resolved.match.index)) {
        throw new WanderlogValidationError(
          `Section "${args.section}" is not a custom list and cannot be reordered with this tool.`,
        );
      }

      const customSections = trip.itinerary.sections
        .map((section, index) => ({ section, index }))
        .filter(({ index }) => isCustomSection(trip, index));
      validatePosition(args.position, customSections.length, "Custom-list position");
      const currentCustomPosition =
        customSections.findIndex((item) => item.section.id === resolved.match.section.id) + 1;

      const source = resolved.match;
      const remaining = trip.itinerary.sections.filter(
        (_section, index) => index !== source.index,
      );
      const remainingCustom = remaining
        .map((section, index) => ({ section, index }))
        .filter(({ section }) => customSections.some((item) => item.section.id === section.id));

      let destinationIndex: number;
      if (args.position <= remainingCustom.length) {
        destinationIndex = remainingCustom[args.position - 1]!.index;
      } else if (remainingCustom.length > 0) {
        destinationIndex = remainingCustom[remainingCustom.length - 1]!.index + 1;
      } else {
        destinationIndex = Math.min(source.index, remaining.length);
      }

      if (currentCustomPosition !== args.position) {
        const ops: Json0Op[] = [
          { p: ["itinerary", "sections", source.index], lm: destinationIndex },
        ];
        await submit(ops);
      }

      const finalCustom = entry.snapshot.itinerary.sections.filter((_section, index) =>
        isCustomSection(entry.snapshot, index),
      );
      if (finalCustom[args.position - 1]?.id !== source.section.id) {
        throw new WanderlogError(
          "Reordered custom list is not at the requested position",
          "stale_target",
        );
      }
      return {
        heading: source.section.heading || "(untitled)",
        tripTitle: trip.title,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: `Placed custom section "${result.heading}" at position ${args.position} in "${result.tripTitle}".`,
        },
      ],
    };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
