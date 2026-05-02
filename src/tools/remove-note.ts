import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveNoteRef } from "../resolvers/note-ref.js";
import { quillToPlain } from "../types.js";
import { submitOp } from "./shared.js";

export const removeNoteInputSchema = {
  trip_key: z.string().min(1).describe("The trip to remove the note from."),
  note_ref: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to the note you want to remove. Examples: 'coach tour' (substring of the note text), 'the note' (if the trip has exactly one note), 'milford prep on day 3'. Supports ordinal prefixes for duplicates: '1st note', 'second note on day 2', 'last note'. Supports day filters via ' on ': 'coach tour on May 6'.",
    ),
};

export const removeNoteDescription = `
Removes a note block from a Wanderlog trip, resolved by natural-language reference.

Supported reference forms:
  - Substring of the note text (case-insensitive): "coach tour", "milford"
  - Role keyword: "the note" / "note" — picks the only note in scope, or returns
    a numbered list if there are multiple
  - Day filter: "coach tour on May 6" or "... on day 3"
  - Ordinal prefix for duplicates: "1st note", "second note", "last milford"
  - Combined: "2nd note on day 4"

If the reference is ambiguous (multiple notes match), the tool returns a numbered
list of candidates and does NOT make any change. Re-call with an ordinal prefix or
a more specific substring.
`.trim();

type Args = {
  trip_key: string;
  note_ref: string;
};

export async function removeNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const result = resolveNoteRef(trip, args.note_ref);

    if (result.kind === "none") {
      throw new WanderlogNotFoundError("Note", args.note_ref);
    }

    if (result.kind === "ambiguous") {
      const lines = result.candidates
        .slice(0, 10)
        .map((c, i) => {
          const preview = notePreview(c.block.text);
          const where = formatLocation(c.section);
          const ordinal = ordinalLabel(i + 1);
          return `  ${i + 1}. "${preview}" — ${where} (${ordinal})`;
        })
        .join("\n");

      const retryHint =
        'Call this tool again with an ordinal to pick one, e.g. note_ref: "1st note" or "last note". You can also combine with a day filter, e.g. "2nd note on day 2", or refine the substring.';

      return {
        content: [
          {
            type: "text",
            text: `"${args.note_ref}" matches ${result.candidates.length} notes:\n${lines}\n\n${retryHint}`,
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

    const preview = notePreview(block.text);
    const text = `Removed note "${preview}" from ${formatLocation(section)} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

function notePreview(text: { ops?: Array<{ insert?: string }> } | undefined): string {
  const plain = quillToPlain(text).replace(/\s+/g, " ").trim();
  if (plain.length <= 60) return plain;
  return `${plain.slice(0, 57)}…`;
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
