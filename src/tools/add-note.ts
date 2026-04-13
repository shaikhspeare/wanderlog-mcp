import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  buildNoteBlock,
  findTargetSection,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addNoteInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to add the note to. Use wanderlog_list_trips if you don't know the key."),
  text: z
    .string()
    .min(1)
    .describe("The note text. Plain text — can be multi-line."),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to add the note to. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. Omit to add to the 'Places to visit' list.",
    ),
};

export const addNoteDescription = `
Adds a text note to a Wanderlog trip. Notes appear inline between places in a day, acting as
the connective tissue of the itinerary. Every well-built day should have notes between stops.

When to add a note (do this after adding each place or group of places):
- How to get there: "Walk 15 min along the South Bank, or take the Jubilee line one stop"
- Practical tips: "Book tickets online at least 2 days ahead — sells out in summer"
- Food/drink recs: "Try the salt beef bagel at Beigel Bake — cash only, open 24hrs"
- Time guidance: "Budget 2-3 hours here. Open 10am-6pm, closed Tuesdays"
- Neighborhood context: "This area is great for wandering — no rush, just explore the lanes"

Returns a confirmation of where the note was added.
`.trim();

type Args = {
  trip_key: string;
  text: string;
  day?: string;
};

export async function addNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const target = findTargetSection(trip, args.day);

    // Step 1: Insert the note block with placeholder text
    const block = buildNoteBlock(userId);
    const insertIndex = target.section.blocks.length;
    const blockPath = ["itinerary", "sections", target.index, "blocks", insertIndex];
    const insertOps: Json0Op[] = [{ p: blockPath, li: block }];

    await submitOp(ctx, args.trip_key, insertOps);

    // Step 2: Set the note text via rich-text subtype op
    const textOps: Json0Op[] = [
      {
        p: [...blockPath, "text"],
        t: "rich-text",
        o: [{ insert: `${args.text}\n` }],
      },
    ];

    await submitOp(ctx, args.trip_key, textOps);

    const preview = args.text.length > 60 ? `${args.text.slice(0, 57)}…` : args.text;
    const text = `Added note "${preview}" to ${target.label} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
