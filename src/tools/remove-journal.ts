import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogNotFoundError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { findStopMatches, formatStop, formatStopCandidateList } from "./journal-shared.js";
import { submitOp } from "./shared.js";

export const removeJournalInputSchema = {
  trip_key: z.string().min(1).describe("The trip to remove the journal stop from."),
  title: z
    .string()
    .min(1)
    .describe("Case-insensitive substring matching the title of the journal stop to remove."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("Optional exact date filter to disambiguate duplicate titles, YYYY-MM-DD."),
};

export const removeJournalDescription = `
Removes a stop from a Wanderlog trip's journal by matching a substring of its title.

The match is case-insensitive. If exactly one stop matches, it is deleted. If none match, an
error is returned. If several match, a numbered list is returned and nothing is deleted — re-call
with a more specific title or add a date filter to pick one.
`.trim();

type Args = {
  trip_key: string;
  title: string;
  date?: string;
};

export async function removeJournal(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const trip = await ctx.tripCache.get(args.trip_key);
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
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "journal", "stops", index],
        ld: stop,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    return {
      content: [
        { type: "text", text: `Removed journal stop ${formatStop(stop)} from "${trip.title}".` },
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
