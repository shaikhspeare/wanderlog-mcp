import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { isPlaceBlock } from "../types.js";
import {
  placeInsertionIndex,
  resolveOrganizationTarget,
  validatePosition,
} from "./organization-shared.js";
import { describeSection, findBlockById, submitOp } from "./shared.js";

export const movePlaceInputSchema = z.object({
  trip_key: z.string().min(1).describe("The trip containing the place to move."),
  place_ref: z
    .string()
    .min(1)
    .describe(
      "Natural-language place reference. Use a day filter or ordinal when names repeat, e.g. '2nd Starbucks on day 3'.",
    ),
  target_section: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Destination undated list heading, such as 'Food & Drink' or 'Places to visit'. Provide exactly one of target_section and target_day.",
    ),
  target_day: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Destination day ('day 2', 'May 4', or '2026-05-04'). Provide exactly one of target_section and target_day.",
    ),
  position: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional 1-based position among places in the destination. Omit to place it last.",
    ),
});

export const movePlaceDescription = `
Moves an existing place to a custom/undated list or a dated itinerary day without recreating
it. The exact block is moved, preserving notes, start/end times, images, hotel data, and all
other metadata. Provide exactly one of target_section and target_day.

Place and destination references must resolve uniquely. Duplicate place names require an
ordinal/day-qualified place_ref, and duplicate section headings are rejected without changes.
The optional position is 1-based among places at the destination; omitted means last.
`.trim();

type Args = z.infer<typeof movePlaceInputSchema>;

export async function movePlace(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const resolved = resolvePlaceRef(trip, args.place_ref);
      if (resolved.kind === "none") throw new WanderlogNotFoundError("Place", args.place_ref);
      if (resolved.kind === "ambiguous") {
        const candidates = resolved.candidates
          .map((candidate, index) => {
            const name = isPlaceBlock(candidate.block)
              ? candidate.block.place.name
              : `${candidate.block.type} block`;
            return `${index + 1}. ${name} in ${describeSection(candidate.section)}`;
          })
          .join("; ");
        throw new WanderlogValidationError(
          `Place reference "${args.place_ref}" is ambiguous: ${candidates}. Retry with an ordinal and/or day filter.`,
        );
      }
      const sourceBlock = resolved.match.block;
      if (!isPlaceBlock(sourceBlock)) {
        throw new WanderlogValidationError(
          `"${args.place_ref}" identifies a ${resolved.match.block.type} block, not a place.`,
        );
      }

      const target = resolveOrganizationTarget(trip, {
        section: args.target_section,
        day: args.target_day,
      });
      const source = resolved.match;
      const sameSection = source.section.id === target.section.id;
      const targetPlaceCount = target.section.blocks.filter(isPlaceBlock).length;
      const maxPosition = sameSection ? targetPlaceCount : targetPlaceCount + 1;
      const position = args.position ?? maxPosition;
      validatePosition(position, maxPosition, "Destination position");
      const currentPlacePosition = source.section.blocks
        .slice(0, source.blockIndex + 1)
        .filter(isPlaceBlock).length;

      const remainingBlocks = sameSection
        ? target.section.blocks.filter((_block, index) => index !== source.blockIndex)
        : target.section.blocks;
      const destinationBlockIndex = placeInsertionIndex(remainingBlocks, position);

      if (sameSection && currentPlacePosition === position) {
        return {
          placeName: sourceBlock.place.name,
          sourceLabel: describeSection(source.section),
          targetLabel: target.label,
          position,
          tripTitle: trip.title,
          unchanged: true,
        };
      }

      const ops: Json0Op[] = sameSection
        ? [
            {
              p: ["itinerary", "sections", source.sectionIndex, "blocks", source.blockIndex],
              lm: destinationBlockIndex,
            },
          ]
        : [
            {
              p: ["itinerary", "sections", source.sectionIndex, "blocks", source.blockIndex],
              ld: sourceBlock,
            },
            {
              p: ["itinerary", "sections", target.index, "blocks", destinationBlockIndex],
              li: sourceBlock,
            },
          ];
      await submit(ops);

      const matches = entry.snapshot.itinerary.sections.flatMap((section, sectionIndex) =>
        section.blocks.flatMap((block, blockIndex) =>
          block.id === sourceBlock.id ? [{ section, sectionIndex, block, blockIndex }] : [],
        ),
      );
      if (
        matches.length !== 1 ||
        matches[0]!.section.id !== target.section.id ||
        !isDeepStrictEqual(matches[0]!.block, sourceBlock)
      ) {
        throw new WanderlogError(
          "Moved place could not be verified with all metadata intact",
          "stale_target",
        );
      }
      const current = findBlockById(entry.snapshot, sourceBlock.id);
      if (!current) throw new WanderlogError("Moved place could not be found", "stale_target");

      return {
        placeName: sourceBlock.place.name,
        sourceLabel: describeSection(source.section),
        targetLabel: target.label,
        position,
        tripTitle: trip.title,
        unchanged: false,
      };
    });

    const action = result.unchanged ? "Already positioned" : "Moved";
    return {
      content: [
        {
          type: "text",
          text: `${action} ${result.placeName} from ${result.sourceLabel} to ${result.targetLabel} at place position ${result.position} in "${result.tripTitle}".`,
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
