import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveNoteRef } from "../resolvers/note-ref.js";
import { quillToPlain } from "../types.js";
import { submitOp } from "./shared.js";

export const editNoteInputSchema = {
  trip_key: z.string().min(1).describe("The trip containing the note."),
  note_ref: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to the note you want to edit. Same forms as wanderlog_remove_note: substring of the note text ('coach tour'), role keyword ('the note'), day filter ('coach tour on May 6'), ordinal prefix for duplicates ('1st note', 'last note'), or combinations ('2nd note on day 4').",
    ),
  text: z
    .string()
    .min(1)
    .describe("The new note text. Plain text — can be multi-line. Replaces the existing text entirely."),
};

export const editNoteDescription = `
Replaces the text of an existing note in a Wanderlog trip, in place. The note keeps its
position in the day's block list — preferred over remove_note + add_note, which forces a
full rewrite and re-inserts the note at the end of the day, breaking original ordering.

Resolves the target note via the same natural-language references as wanderlog_remove_note.
If the reference is ambiguous (multiple notes match), the tool returns a numbered list of
candidates and does NOT make any change. Re-call with an ordinal prefix or a more specific
substring.

Use this for stale or partially-correct notes. For freshly added notes you don't yet have a
reference for, prefer including the final text on the original add_note call.
`.trim();

type Args = {
  trip_key: string;
  note_ref: string;
  text: string;
};

export async function editNote(
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
    const oldLength = quillToPlain(block.text).length;
    const newText = `${args.text}\n`;

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", sectionIndex, "blocks", blockIndex, "text"],
        t: "rich-text",
        o: oldLength > 0
          ? [{ delete: oldLength }, { insert: newText }]
          : [{ insert: newText }],
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const preview = args.text.length > 60 ? `${args.text.slice(0, 57)}…` : args.text;
    const text = `Updated note in ${formatLocation(section)} of "${trip.title}" to "${preview}".`;
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
