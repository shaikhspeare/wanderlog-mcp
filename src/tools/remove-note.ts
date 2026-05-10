import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { NoteBlock, TripPlan } from "../types.js";
import { findDaySectionByDate, submitOp } from "./shared.js";

export const removeNoteInputSchema = {
  trip_key: z.string().min(1).describe("The trip to remove from."),
  text: z
    .string()
    .min(1)
    .describe("Substring to match against note content (case-insensitive)."),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to search. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. Omit to search the entire trip.",
    ),
};

export const removeNoteDescription = `
Removes a note block from a Wanderlog trip by matching a substring of its text content.

The match is case-insensitive. If exactly one note matches, it is deleted. If no notes match,
an error is returned. If multiple notes match, a list of previews is returned — supply a more
specific substring to narrow to one.

Use the optional 'day' filter to limit the search to a specific day.
`.trim();

type Args = {
  trip_key: string;
  text: string;
  day?: string;
};

export type NoteMatch = {
  sectionIndex: number;
  blockIndex: number;
  plainText: string;
  block: NoteBlock;
};

export function extractPlainText(block: NoteBlock): string {
  const ops = block.text?.ops ?? [];
  return ops.map((op) => op.insert ?? "").join("");
}

export function findNoteMatches(trip: TripPlan, query: string, day?: string): NoteMatch[] {
  const lowerQuery = query.toLowerCase();
  const sections = trip.itinerary.sections;
  const matches: NoteMatch[] = [];

  let sectionIndices: number[];
  if (day) {
    const resolved = resolveDay(trip, day);
    const found = findDaySectionByDate(trip, resolved.date!);
    if (!found) return [];
    sectionIndices = [found.index];
  } else {
    sectionIndices = Array.from({ length: sections.length }, (_, i) => i);
  }

  for (const sectionIndex of sectionIndices) {
    const section = sections[sectionIndex]!;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const block = section.blocks[blockIndex]!;
      if (block.type !== "note") continue;
      const noteBlock = block as NoteBlock;
      const plainText = extractPlainText(noteBlock);
      if (plainText.toLowerCase().includes(lowerQuery)) {
        matches.push({ sectionIndex, blockIndex, plainText, block: noteBlock });
      }
    }
  }

  return matches;
}

function notePreview(plainText: string): string {
  const flat = plainText.replace(/\n/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

export async function removeNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const matches = findNoteMatches(trip, args.text, args.day);

    if (matches.length === 0) {
      throw new WanderlogNotFoundError("Note", args.text);
    }

    if (matches.length > 1) {
      const lines = matches
        .slice(0, 5)
        .map((m, i) => `  ${i + 1}. "${notePreview(m.plainText)}"`)
        .join("\n");
      const suffix = matches.length > 5 ? `\n  (${matches.length - 5} more…)` : "";
      return {
        content: [
          {
            type: "text",
            text: `"${args.text}" matches ${matches.length} notes:\n${lines}${suffix}\n\nCall again with a more specific substring to identify the one you want.`,
          },
        ],
        isError: true,
      };
    }

    const { sectionIndex, blockIndex, block, plainText } = matches[0]!;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", sectionIndex, "blocks", blockIndex],
        ld: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const text = `Removed note "${notePreview(plainText)}" from "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
