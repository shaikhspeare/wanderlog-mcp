import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { TripPlan } from "../types.js";
import { isChecklistBlock } from "../types.js";
import { extractDeltaText } from "./remove-note.js";
import { describeSection, findDaySectionByDate, resolveSectionRef, submitOp } from "./shared.js";

export const setChecklistItemInputSchema = {
  trip_key: z.string().min(1).describe("The trip containing the checklist."),
  item: z
    .string()
    .min(1)
    .describe("Substring of the checklist item's text to tick or untick (case-insensitive)."),
  checked: z
    .boolean()
    .default(true)
    .describe("true to tick the item (default), false to untick it."),
  checklist: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional substring of the checklist's title (e.g. 'Packing') to narrow the search when several checklists contain similar items.",
    ),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to search. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. If 'section' is also provided, the section takes precedence.",
    ),
  section: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional undated section heading to search (e.g. 'Trip Preparations'). Matching is case-insensitive and takes precedence over 'day'.",
    ),
};

export const setChecklistItemDescription = `
Ticks or unticks a checklist item in a Wanderlog trip, identified by a substring of its text.

Only the checkbox changes; the item text and the rest of the checklist are untouched. If the item
is already in the requested state nothing is changed. If no item matches, an error is returned. If
several items match, a numbered list of previews (with each item's list/day, checklist title and
current state) is returned and nothing is changed — call again with a longer substring or add the
'checklist', 'day' or 'section' filter.

Use wanderlog_add_checklist to create checklists and wanderlog_edit_note to change item text.
`.trim();

type Args = {
  trip_key: string;
  item: string;
  checked?: boolean;
  checklist?: string;
  day?: string;
  section?: string;
};

export type ChecklistItemTarget = {
  sectionIndex: number;
  blockIndex: number;
  itemIndex: number;
  location: string;
  checklistTitle: string;
  itemText: string;
  checked: boolean;
  hasCheckedField: boolean;
};

function flat(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

function resolveSectionIndices(trip: TripPlan, args: Pick<Args, "day" | "section">): number[] {
  const sections = trip.itinerary.sections;
  if (args.section) {
    const resolved = resolveSectionRef(trip, args.section);
    if (resolved.kind === "none") throw new WanderlogNotFoundError("Section", args.section);
    if (resolved.kind === "ambiguous") {
      throw new WanderlogValidationError(
        `Section "${args.section}" matches ${resolved.candidates.length} sections. Rename one of them or filter by 'day' or 'checklist' instead.`,
      );
    }
    return [resolved.match.index];
  }
  if (args.day) {
    const resolved = resolveDay(trip, args.day);
    const found = findDaySectionByDate(trip, resolved.date!);
    return found ? [found.index] : [];
  }
  return sections.map((_section, index) => index);
}

export function findChecklistItemTargets(
  trip: TripPlan,
  args: Pick<Args, "item" | "checklist" | "day" | "section">,
): ChecklistItemTarget[] {
  const itemQuery = args.item.toLowerCase();
  const titleQuery = args.checklist?.toLowerCase();
  const targets: ChecklistItemTarget[] = [];

  for (const sectionIndex of resolveSectionIndices(trip, args)) {
    const section = trip.itinerary.sections[sectionIndex]!;
    section.blocks.forEach((block, blockIndex) => {
      if (!isChecklistBlock(block)) return;
      const title = block.title ?? "";
      if (titleQuery && !title.toLowerCase().includes(titleQuery)) return;
      block.items.forEach((item, itemIndex) => {
        const itemText = extractDeltaText(item.text).trim();
        if (!itemText.toLowerCase().includes(itemQuery)) return;
        targets.push({
          sectionIndex,
          blockIndex,
          itemIndex,
          location: describeSection(section),
          checklistTitle: title,
          itemText,
          checked: item.checked === true,
          hasCheckedField: "checked" in item,
        });
      });
    });
  }
  return targets;
}

function describeTarget(target: ChecklistItemTarget): string {
  const box = target.checked ? "[x]" : "[ ]";
  const list = target.checklistTitle ? `"${flat(target.checklistTitle)}" checklist` : "checklist";
  return `${box} "${flat(target.itemText)}" — ${list} in ${target.location}`;
}

export async function setChecklistItem(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const checked = args.checked ?? true;
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const targets = findChecklistItemTargets(trip, args);
      if (targets.length === 0) throw new WanderlogNotFoundError("Checklist item", args.item);
      if (targets.length > 1) {
        const lines = targets
          .slice(0, 5)
          .map((target, index) => `  ${index + 1}. ${describeTarget(target)}`)
          .join("\n");
        const suffix = targets.length > 5 ? `\n  (${targets.length - 5} more…)` : "";
        return {
          response: {
            content: [
              {
                type: "text" as const,
                text: `"${args.item}" matches ${targets.length} checklist items:\n${lines}${suffix}\n\nCall again with a more specific substring, or narrow with 'checklist', 'day' or 'section'.`,
              },
            ],
            isError: true,
          },
        };
      }

      const target = targets[0]!;
      if (target.checked === checked && target.hasCheckedField) {
        return { target, tripTitle: trip.title, changed: false };
      }
      const op: Json0Op = {
        p: [
          "itinerary",
          "sections",
          target.sectionIndex,
          "blocks",
          target.blockIndex,
          "items",
          target.itemIndex,
          "checked",
        ],
        oi: checked,
      };
      if (target.hasCheckedField) op.od = target.checked;
      await submit([op]);
      return { target, tripTitle: trip.title, changed: true };
    });
    if ("response" in result && result.response) return result.response;

    const { target, tripTitle, changed } = result as {
      target: ChecklistItemTarget;
      tripTitle: string;
      changed: boolean;
    };
    const state = checked ? "ticked" : "unticked";
    const text = changed
      ? `Marked "${flat(target.itemText)}" as ${state} in ${target.location} of "${tripTitle}".`
      : `"${flat(target.itemText)}" is already ${state} in ${target.location} of "${tripTitle}". No change made.`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
