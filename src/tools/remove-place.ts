import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { isPlaceBlock } from "../types.js";
import { submitOp } from "./shared.js";

export const removePlaceInputSchema = {
  trip_key: z.string().min(1).describe("The trip to remove from."),
  place_ref: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to the place you want to remove. Examples: 'Queenstown Gardens', 'the hotel', 'the sushi place on day 3'. Supports ordinal prefixes for duplicates: '1st Queenstown Gardens', 'second Queenstown Gardens', 'last Queenstown Gardens'. Supports day filters via ' on ': 'Queenstown Gardens on May 4'. Ordinals and day filters can be combined: '2nd Queenstown Gardens on May 4'.",
    ),
};

export const removePlaceDescription = `
Removes a place (or flight, train, hotel — any block) from a Wanderlog trip based on a
natural-language reference.

Supported reference forms:
  - Exact or partial name: "Queenstown Gardens", "Gardens"
  - Role keywords: "the hotel", "the flight", "the train"
  - Day filter: "Queenstown Gardens on May 4" or "... on day 3"
  - Ordinal prefix (for duplicates): "1st Queenstown Gardens", "second X", "last X"
  - Combined: "2nd Queenstown Gardens on May 4"

If the reference is ambiguous (multiple places match), the tool returns a numbered list of
candidates and does NOT make any change. Re-call with an ordinal prefix ("1st X", "2nd X") or
a more specific filter to pick the one you want.
`.trim();

type Args = {
  trip_key: string;
  place_ref: string;
};

export async function removePlace(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const result = resolvePlaceRef(trip, args.place_ref);

    if (result.kind === "none") {
      throw new WanderlogNotFoundError("Place", args.place_ref);
    }

    if (result.kind === "ambiguous") {
      const lines = result.candidates
        .slice(0, 10)
        .map((c, i) => {
          const name = isPlaceBlock(c.block)
            ? c.block.place.name
            : `${c.block.type} block`;
          const where = formatLocation(c.section);
          const ordinal = ordinalLabel(i + 1);
          return `  ${i + 1}. ${name} — ${where} (${ordinal})`;
        })
        .join("\n");

      const firstCandidateName = isPlaceBlock(result.candidates[0]!.block)
        ? result.candidates[0]!.block.place.name
        : "the block";
      const retryHint = `Call this tool again with an ordinal to pick one, e.g. place_ref: "1st ${firstCandidateName}" or "last ${firstCandidateName}". You can also combine with a day filter, e.g. "2nd ${firstCandidateName} on day 2".`;

      return {
        content: [
          {
            type: "text",
            text: `"${args.place_ref}" matches ${result.candidates.length} places:\n${lines}\n\n${retryHint}`,
          },
        ],
        isError: true,
      };
    }

    const { sectionIndex, blockIndex, block, section } = result.match;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", sectionIndex, "blocks", blockIndex],
        ld: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const removedName = isPlaceBlock(block)
      ? block.place.name
      : `${block.type} block`;
    const text = `Removed ${removedName} from ${formatLocation(section)} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

function formatLocation(section: {
  heading?: string;
  type?: string;
  mode?: string;
  date?: string | null;
}): string {
  if (section.mode === "dayPlan" && section.date) {
    return `day ${section.date}`;
  }
  if (section.heading) return `"${section.heading}"`;
  return `"${section.type ?? "section"}"`;
}

function ordinalLabel(n: number): string {
  const suffix = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]}`;
}
