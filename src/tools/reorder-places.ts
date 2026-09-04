import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { isPlaceBlock } from "../types.js";
import {
  placeInsertionIndex,
  resolveOrganizationTarget,
  resolvePlaceWithinSection,
  validatePosition,
} from "./organization-shared.js";
import { submitOp } from "./shared.js";

export const reorderPlacesInputSchema = z.object({
  trip_key: z.string().min(1).describe("The trip containing the list or day to reorder."),
  place_ref: z
    .string()
    .min(1)
    .describe(
      "Place name within the selected list/day. Use an ordinal such as '2nd Starbucks' when the name repeats there.",
    ),
  section: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Undated list heading to reorder. Provide exactly one of section and day.",
    ),
  day: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Itinerary day to reorder ('day 2', 'May 4', or ISO date). Provide exactly one of section and day.",
    ),
  position: z
    .number()
    .int()
    .positive()
    .describe("New 1-based position among places in the selected list/day."),
});

export const reorderPlacesDescription = `
Moves one place to a new position within the same undated list or itinerary day. The position
is 1-based among place blocks; non-place blocks such as notes and checklists remain in the
container and are never rewritten. The complete place block is moved, preserving all metadata.

Provide exactly one of section and day. Duplicate place names must be disambiguated with an
ordinal. Position 1 moves to the first place slot; the number of places moves it to the end.
`.trim();

type Args = z.infer<typeof reorderPlacesInputSchema>;

export async function reorderPlaces(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const target = resolveOrganizationTarget(entry.snapshot, {
        section: args.section,
        day: args.day,
      });
      const match = resolvePlaceWithinSection(entry.snapshot, target, args.place_ref);
      const placeCount = target.section.blocks.filter(isPlaceBlock).length;
      validatePosition(args.position, placeCount, "Place position");
      const currentPlacePosition = target.section.blocks
        .slice(0, match.blockIndex + 1)
        .filter(isPlaceBlock).length;

      const remaining = target.section.blocks.filter(
        (_block, index) => index !== match.blockIndex,
      );
      const destinationBlockIndex = placeInsertionIndex(remaining, args.position);
      if (currentPlacePosition !== args.position) {
        const ops: Json0Op[] = [
          {
            p: ["itinerary", "sections", target.index, "blocks", match.blockIndex],
            lm: destinationBlockIndex,
          },
        ];
        await submit(ops);
      }

      const reordered = entry.snapshot.itinerary.sections[target.index];
      const placeIds = reordered?.blocks.filter(isPlaceBlock).map((block) => block.id) ?? [];
      if (placeIds[args.position - 1] !== match.block.id) {
        throw new WanderlogError("Reordered place is not at the requested position", "stale_target");
      }
      return {
        name: match.block.place.name,
        targetLabel: target.label,
        tripTitle: entry.snapshot.title,
      };
    });

    return {
      content: [
        {
          type: "text",
          text: `Placed ${result.name} at position ${args.position} in ${result.targetLabel} of "${result.tripTitle}".`,
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
