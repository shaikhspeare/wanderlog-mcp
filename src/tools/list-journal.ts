import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import { findStopMatches, formatStop } from "./journal-shared.js";

export const listJournalInputSchema = {
  trip_key: z.string().min(1).describe("The trip whose journal to list."),
  title: z
    .string()
    .min(1)
    .optional()
    .describe("Optional case-insensitive substring to filter stops by title."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Optional exact date filter, YYYY-MM-DD."),
};

export const listJournalDescription = `
Lists the stops in a Wanderlog trip's journal (travelogue), in order.

Each line shows the stop's title, date/time, and a preview of its text entry. Use the optional
title / date filters to narrow the list — handy for finding the exact stop to pass to
wanderlog_edit_journal or wanderlog_remove_journal. Also reports the journal summary when set.

Returns a friendly message when the trip has no journal stops.
`.trim();

type Args = {
  trip_key: string;
  title?: string;
  date?: string;
};

export async function listJournal(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
    const matches = findStopMatches(trip, { title: args.title, date: args.date });
    const summary = trip.itinerary.journal?.summary?.trim();

    if (matches.length === 0) {
      const filtered = args.title || args.date;
      const text = filtered
        ? `No journal stops match those filters in "${trip.title}".`
        : `"${trip.title}" has no journal stops yet. Add one with wanderlog_add_journal.`;
      return { content: [{ type: "text", text }] };
    }

    const lines = matches.map((m, i) => `  ${i + 1}. ${formatStop(m.stop)}`).join("\n");
    const noun = matches.length === 1 ? "stop" : "stops";
    const summaryLine = summary ? `\n\nJournal summary: "${summary}"` : "";
    return {
      content: [
        {
          type: "text",
          text: `${matches.length} journal ${noun} in "${trip.title}":\n${lines}${summaryLine}`,
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
