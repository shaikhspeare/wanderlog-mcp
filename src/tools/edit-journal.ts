import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { JournalStop } from "../types.js";
import { findStopMatches, formatStop, formatStopCandidateList } from "./journal-shared.js";
import { submitOp } from "./shared.js";

export const editJournalInputSchema = {
  trip_key: z.string().min(1).describe("The trip whose journal to edit."),
  title: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Case-insensitive substring matching the title of the stop to edit. Required unless you are only setting new_summary.",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Optional exact date filter to disambiguate which stop to edit."),
  new_title: z.string().min(1).optional().describe("New stop title. Omit to leave unchanged."),
  new_text: z
    .string()
    .optional()
    .describe("New journal entry text for the stop (replaces the existing text). Omit to leave unchanged."),
  new_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("New date for the stop, YYYY-MM-DD. Omit to leave unchanged."),
  new_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("New time for the stop, HH:mm. Omit to leave unchanged."),
  new_summary: z
    .string()
    .optional()
    .describe(
      "New trip-level journal summary text (the overview shown above the stops). Edits the journal as a whole, not a stop — does not require a title.",
    ),
};

export const editJournalDescription = `
Edits a Wanderlog trip's journal. Usually you edit a single stop: find it by a case-insensitive
substring of its title, then change its title, text, date, and/or time. You can also set the
trip-level journal summary via new_summary (which doesn't require a stop title).

If none match, an error is returned. If several stops match, a numbered list is returned and
nothing is changed. Only the fields you supply are modified; the stop's place, media, and unknown
fields are preserved.
`.trim();

type Args = {
  trip_key: string;
  title?: string;
  date?: string;
  new_title?: string;
  new_text?: string;
  new_date?: string;
  new_time?: string;
  new_summary?: string;
};

/** od+oi replacement for an existing key; oi-only insert when the key is absent. */
function replaceField(path: (string | number)[], oldValue: unknown, newValue: unknown): Json0Op {
  return oldValue === undefined ? { p: path, oi: newValue } : { p: path, od: oldValue, oi: newValue };
}

/** Rebuilds a stop's dateTime from new date/time parts, preserving the timezone offset. */
function rebuildDateTime(current: string | undefined, newDate?: string, newTime?: string): string {
  const cur = current ?? "";
  const offset = /([+-]\d{2}:\d{2})$/.exec(cur)?.[1] ?? "";
  const date = newDate ?? (cur.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const time = newTime ?? (cur.slice(11, 16) || "09:00");
  return `${date}T${time}${offset}`;
}

function buildStopOps(
  stop: JournalStop,
  index: number,
  args: Args,
): { ops: Json0Op[]; changes: string[] } {
  const base = ["itinerary", "journal", "stops", index];
  const ops: Json0Op[] = [];
  const changes: string[] = [];

  if (args.new_title !== undefined && args.new_title !== stop.title) {
    ops.push(replaceField([...base, "title"], stop.title, args.new_title));
    changes.push(`title → "${args.new_title}"`);
  }

  if (args.new_text !== undefined) {
    const newDelta = { ops: [{ insert: args.new_text }] };
    if (JSON.stringify(newDelta) !== JSON.stringify(stop.text)) {
      ops.push(replaceField([...base, "text"], stop.text, newDelta));
      changes.push("text");
    }
  }

  if (args.new_date !== undefined || args.new_time !== undefined) {
    const next = rebuildDateTime(stop.dateTime, args.new_date, args.new_time);
    if (next !== stop.dateTime) {
      ops.push(replaceField([...base, "dateTime"], stop.dateTime, next));
      changes.push(`when → ${next.replace("T", " ").slice(0, 16)}`);
    }
  }

  return { ops, changes };
}

export async function editJournal(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const hasStopEdit =
      args.new_title !== undefined ||
      args.new_text !== undefined ||
      args.new_date !== undefined ||
      args.new_time !== undefined;
    const hasSummaryEdit = args.new_summary !== undefined;

    if (!hasStopEdit && !hasSummaryEdit) {
      throw new WanderlogValidationError(
        "Nothing to edit — supply at least one of new_title, new_text, new_date, new_time, or new_summary.",
      );
    }

    const trip = await ctx.tripCache.get(args.trip_key);
    const ops: Json0Op[] = [];
    const changes: string[] = [];
    let stopLabel = "";

    if (hasStopEdit) {
      if (!args.title) {
        throw new WanderlogValidationError(
          "Provide 'title' to identify which journal stop to edit.",
        );
      }
      const matches = findStopMatches(trip, { title: args.title, date: args.date });
      if (matches.length === 0) {
        throw new WanderlogNotFoundError("Journal stop", args.title);
      }
      if (matches.length > 1) {
        return {
          content: [
            {
              type: "text",
              text: `"${args.title}" matches ${matches.length} journal stops:\n${formatStopCandidateList(matches)}\n\nRe-call with a more specific title, or add a date filter to pick one.`,
            },
          ],
          isError: true,
        };
      }
      const { index, stop } = matches[0]!;
      stopLabel = formatStop(stop);
      const built = buildStopOps(stop, index, args);
      ops.push(...built.ops);
      changes.push(...built.changes);
    }

    if (hasSummaryEdit) {
      const current = trip.itinerary.journal?.summary;
      if (args.new_summary !== current) {
        ops.push(replaceField(["itinerary", "journal", "summary"], current, args.new_summary));
        changes.push("journal summary");
      }
    }

    if (ops.length === 0) {
      return {
        content: [
          { type: "text", text: `No changes — those values already match in "${trip.title}".` },
        ],
      };
    }

    await submitOp(ctx, args.trip_key, ops);

    const target = stopLabel ? `stop ${stopLabel}` : "journal";
    return {
      content: [
        {
          type: "text",
          text: `Updated ${target} in "${trip.title}": ${changes.join(", ")}.`,
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
