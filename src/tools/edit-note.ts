import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { ChecklistBlock, NoteBlock, QuillDelta, TripPlan } from "../types.js";
import { isChecklistBlock, isPlaceBlock } from "../types.js";
import { findDaySectionByDate, submitOp } from "./shared.js";
import { extractDeltaText } from "./remove-note.js";

export const editNoteInputSchema = {
  trip_key: z.string().min(1).describe("The trip to edit."),
  old_text: z.string().min(1).describe("Substring to find and replace (case-insensitive)."),
  new_text: z.string().describe("Replacement text."),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to search. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. Omit to search the entire trip.",
    ),
};

export const editNoteDescription = `
Edits note content in a Wanderlog trip by finding and replacing a substring.

Searches across freestanding notes, place annotations, and checklist titles and items.
The match is case-insensitive. If exactly one match is found, the replacement is made in place.
If no matches are found, an error is returned. If multiple matches are found, a numbered list
of previews is returned — call again with a more specific substring.

Use the optional 'day' filter to limit the search to a specific day.
`.trim();

type Args = {
  trip_key: string;
  old_text: string;
  new_text: string;
  day?: string;
};

type RichTextTarget = {
  kind: "rich-text";
  label: string;
  preview: string;
  sectionIndex: number;
  blockIndex: number;
  fieldPath: (string | number)[];
  offset: number;
  matchedLen: number;
  crossesBoundary: boolean;
};

type PlainTarget = {
  kind: "plain";
  label: string;
  preview: string;
  sectionIndex: number;
  blockIndex: number;
  fieldPath: (string | number)[];
  oldValue: string;
  offset: number;
  matchedLen: number;
};

export type EditTarget = RichTextTarget | PlainTarget;

function previewText(text: string): string {
  const flat = text.replace(/\n/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

function matchInDelta(
  delta: QuillDelta | undefined,
  query: string,
): { offset: number; matchedLen: number; crossesBoundary: boolean } | null {
  const ops = delta?.ops ?? [];
  const lowerQuery = query.toLowerCase();
  const boundaries: number[] = [];
  let plainText = "";
  for (const op of ops) {
    boundaries.push(plainText.length);
    plainText += typeof op.insert === "string" ? op.insert : "";
  }
  const lowerText = plainText.toLowerCase();
  const matchStart = lowerText.indexOf(lowerQuery);
  if (matchStart === -1) return null;
  const matchEnd = matchStart + lowerQuery.length;
  const crossesBoundary = boundaries.some((b) => b > matchStart && b < matchEnd);
  return { offset: matchStart, matchedLen: lowerQuery.length, crossesBoundary };
}

export function findEditTargets(trip: TripPlan, query: string, day?: string): EditTarget[] {
  const sections = trip.itinerary.sections;
  const targets: EditTarget[] = [];
  const lowerQuery = query.toLowerCase();

  let sectionIndices: number[];
  if (day) {
    const resolved = resolveDay(trip, day);
    const found = findDaySectionByDate(trip, resolved.date!);
    if (!found) return [];
    sectionIndices = [found.index];
  } else {
    sectionIndices = Array.from({ length: sections.length }, (_, i) => i);
  }

  for (const si of sectionIndices) {
    const section = sections[si]!;
    for (let bi = 0; bi < section.blocks.length; bi++) {
      const block = section.blocks[bi]!;
      const blockBase: (string | number)[] = ["itinerary", "sections", si, "blocks", bi];

      if (block.type === "note") {
        const delta = (block as NoteBlock).text;
        const m = matchInDelta(delta, query);
        if (m) {
          targets.push({
            kind: "rich-text",
            label: "note",
            preview: `Note: "${previewText(extractDeltaText(delta))}"`,
            sectionIndex: si,
            blockIndex: bi,
            fieldPath: [...blockBase, "text"],
            offset: m.offset,
            matchedLen: m.matchedLen,
            crossesBoundary: m.crossesBoundary,
          });
        }
      } else if (isPlaceBlock(block)) {
        const delta = block.text;
        if (delta) {
          const m = matchInDelta(delta, query);
          if (m) {
            targets.push({
              kind: "rich-text",
              label: `"${block.place.name}" annotation`,
              preview: `"${block.place.name}" annotation: "${previewText(extractDeltaText(delta))}"`,
              sectionIndex: si,
              blockIndex: bi,
              fieldPath: [...blockBase, "text"],
              offset: m.offset,
              matchedLen: m.matchedLen,
              crossesBoundary: m.crossesBoundary,
            });
          }
        }
      } else if (isChecklistBlock(block)) {
        const cb = block as ChecklistBlock;
        // Checklist title (plain string)
        const title = cb.title ?? "";
        if (title && title.toLowerCase().includes(lowerQuery)) {
          const offset = title.toLowerCase().indexOf(lowerQuery);
          targets.push({
            kind: "plain",
            label: "checklist title",
            preview: `Checklist title: "${previewText(title)}"`,
            sectionIndex: si,
            blockIndex: bi,
            fieldPath: [...blockBase, "title"],
            oldValue: title,
            offset,
            matchedLen: query.length,
          });
        }
        // Checklist items
        for (let ii = 0; ii < cb.items.length; ii++) {
          const item = cb.items[ii]!;
          const m = matchInDelta(item.text, query);
          if (m) {
            targets.push({
              kind: "rich-text",
              label: "checklist item",
              preview: `Checklist item: "${previewText(extractDeltaText(item.text))}"`,
              sectionIndex: si,
              blockIndex: bi,
              fieldPath: [...blockBase, "items", ii, "text"],
              offset: m.offset,
              matchedLen: m.matchedLen,
              crossesBoundary: m.crossesBoundary,
            });
          }
        }
      }
    }
  }

  return targets;
}

export async function editNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const targets = findEditTargets(trip, args.old_text, args.day);

    if (targets.length === 0) {
      throw new WanderlogNotFoundError("Note", args.old_text);
    }

    if (targets.length > 1) {
      const lines = targets
        .slice(0, 5)
        .map((t, i) => `  ${i + 1}. ${t.preview}`)
        .join("\n");
      const suffix = targets.length > 5 ? `\n  (${targets.length - 5} more…)` : "";
      return {
        content: [
          {
            type: "text",
            text: `"${args.old_text}" matches ${targets.length} notes:\n${lines}${suffix}\n\nCall again with a more specific substring to identify the one you want.`,
          },
        ],
        isError: true,
      };
    }

    const target = targets[0]!;

    if (target.kind === "rich-text" && target.crossesBoundary) {
      return {
        content: [
          {
            type: "text",
            text: `Cannot replace "${args.old_text}": the match crosses a formatting boundary (e.g. a link or bold section). Use a more specific substring that stays within one formatting run.`,
          },
        ],
        isError: true,
      };
    }

    let ops: Json0Op[];
    if (target.kind === "rich-text") {
      const deltaOps: Array<Record<string, unknown>> = [];
      if (target.offset > 0) deltaOps.push({ retain: target.offset });
      deltaOps.push({ delete: target.matchedLen });
      if (args.new_text) deltaOps.push({ insert: args.new_text });
      ops = [{ p: target.fieldPath, t: "rich-text", o: deltaOps }];
    } else {
      const newValue =
        target.oldValue.slice(0, target.offset) +
        args.new_text +
        target.oldValue.slice(target.offset + target.matchedLen);
      ops = [{ p: target.fieldPath, od: target.oldValue, oi: newValue }];
    }

    await submitOp(ctx, args.trip_key, ops);

    const oldPreview = previewText(args.old_text);
    const newPreview = previewText(args.new_text || "(empty)");
    return {
      content: [
        {
          type: "text",
          text: `Updated ${target.label} in "${trip.title}". Changed "${oldPreview}" → "${newPreview}".`,
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
