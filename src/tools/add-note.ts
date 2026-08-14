import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { TripPlan } from "../types.js";
import {
  buildNoteBlock,
  findSectionByRef,
  findTargetSection,
  requireUserId,
  submitOp,
  type TargetSection,
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

function evaluateTargetSection(
  trip: TripPlan,
  { day, section }: Pick<Args, "day" | "section">,
): TargetSection {
  if (section !== undefined) {
    const found = findSectionByRef(trip, section);
    if (!found) {
      throw new WanderlogValidationError(
        `Section "${section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
      );
    }
    if (found.section.mode === "dayPlan") {
      throw new WanderlogValidationError(
        `Section "${found.section.heading || section}" is a dated section. Use the "day" parameter to add a note to an itinerary day.`,
      );
    }
    return {
      index: found.index,
      section: found.section,
      label: `section "${found.section.heading || section}"`,
    };
  }

  if (day !== undefined) return findTargetSection(trip, day);

  return findTargetSection(trip);
}

export async function addNote(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const target = evaluateTargetSection(trip, args);

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
