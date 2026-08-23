import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  buildNoteBlock,
  findBlockById,
  findBlockTargetSection,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addNoteInputSchema = z
  .object({
    trip_key: z
      .string()
      .min(1)
      .describe(
        "The trip to add the note to. Use wanderlog_list_trips if you don't know the key.",
      ),
    text: z
      .string()
      .min(1)
      .describe("The note text. Plain text — can be multi-line."),
    day: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional day to add the note to. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. If 'section' is also provided, the section takes precedence. Omit both to add to the 'Places to visit' list.",
      ),
    section: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional undated section to add the note to, identified by its heading (e.g. 'Notes', 'Food & Drink', or 'Places to visit'). Matching is case-insensitive and takes precedence over 'day'. Omit both to add to the 'Places to visit' list.",
      ),
  });

export const addNoteDescription = `
Adds a text note to a Wanderlog trip. Notes appear inline between places in a day, acting as
the connective tissue of the itinerary. Every well-built day should have notes between stops.
Supply "day" for a dated itinerary day or "section" for an undated section such as "Notes"
or "Food & Drink". When both are provided, "section" takes precedence. Omit both to add to
the default "Places to visit" list.

When to add a note (do this after adding each place or group of places):
- How to get there: "Walk 15 min along the South Bank, or take the Jubilee line one stop"
- Practical tips: "Book tickets online at least 2 days ahead — sells out in summer"
- Food/drink recs: "Try the salt beef bagel at Beigel Bake — cash only, open 24hrs"
- Time guidance: "Budget 2-3 hours here. Open 10am-6pm, closed Tuesdays"
- Neighborhood context: "This area is great for wandering — no rush, just explore the lanes"

Returns a confirmation of where the note was added.
`.trim();

type Args = z.infer<typeof addNoteInputSchema>;

export async function addNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const result = await submitOp(ctx, args.trip_key, async (entry, submit) => {
      const trip = entry.snapshot;
      const target = findBlockTargetSection(trip, args, "note");
      const block = buildNoteBlock(userId);
      const insertOps: Json0Op[] = [
        {
          p: [
            "itinerary",
            "sections",
            target.index,
            "blocks",
            target.section.blocks.length,
          ],
          li: block,
        },
      ];
      await submit(insertOps);

      const inserted = findBlockById(entry.snapshot, block.id as number);
      if (!inserted || inserted.block.type !== "note") {
        throw new WanderlogError("Inserted note could not be found", "stale_target");
      }
      const textOps: Json0Op[] = [
        {
          p: [
            "itinerary",
            "sections",
            inserted.sectionIndex,
            "blocks",
            inserted.blockIndex,
            "text",
          ],
          t: "rich-text",
          o: [{ insert: `${args.text}\n` }],
        },
      ];
      await submit(textOps);
      return { targetLabel: target.label, tripTitle: entry.snapshot.title };
    });

    const preview = args.text.length > 60 ? `${args.text.slice(0, 57)}…` : args.text;
    const text = `Added note "${preview}" to ${result.targetLabel} in "${result.tripTitle}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
