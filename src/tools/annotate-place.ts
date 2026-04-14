import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { isPlaceBlock } from "../types.js";
import { submitOp } from "./shared.js";

export const annotatePlaceInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip containing the place."),
  place: z
    .string()
    .min(1)
    .describe(
      "Natural-language reference to the place. Examples: 'Sensō-ji', 'the hotel', 'Queenstown Gardens on day 2'. Supports ordinals for duplicates: '2nd Starbucks'.",
    ),
  note: z
    .string()
    .optional()
    .describe("Set or replace the inline note on this place. Practical context: transit, tips, timing, what to see."),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Set or replace the start time (HH:mm format)."),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "must be HH:mm")
    .optional()
    .describe("Set or replace the end time (HH:mm format)."),
};

export const annotatePlaceDescription = `
Updates an existing place in a Wanderlog trip with an inline note, start/end time, or both.
Use this to enrich places that were already added — set practical context, scheduled times,
or both in one call.

At least one of note, start_time, or end_time must be provided.

The place is resolved by natural-language reference (same syntax as wanderlog_remove_place).
If ambiguous, returns a disambiguation list without making changes.
`.trim();

type Args = {
  trip_key: string;
  place: string;
  note?: string;
  start_time?: string;
  end_time?: string;
};

export async function annotatePlace(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    if (!args.note && !args.start_time && !args.end_time) {
      throw new WanderlogValidationError(
        "At least one of note, start_time, or end_time must be provided",
      );
    }

    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const result = resolvePlaceRef(trip, args.place);
    if (result.kind === "none") {
      throw new WanderlogError(
        `No place matching "${args.place}" found in "${trip.title}"`,
        "place_ref_not_found",
        {
          hint: "Check the place name or use wanderlog_get_trip to see what's in the itinerary.",
          followUps: [
            `Call wanderlog_get_trip with trip_key "${args.trip_key}" to see all places.`,
          ],
        },
      );
    }
    if (result.kind === "ambiguous") {
      const lines = result.candidates.map((c, i) => {
        const name = isPlaceBlock(c.block) ? c.block.place.name : `block #${c.block.id}`;
        const loc = c.section.date ? `day ${c.section.date}` : c.section.heading || "unscheduled";
        return `  ${i + 1}. ${name} (${loc})`;
      });
      const text = `Multiple places match "${args.place}":\n${lines.join("\n")}\n\nRetry with a more specific reference or an ordinal prefix (e.g. "1st ${args.place}").`;
      return { content: [{ type: "text", text }] };
    }

    const { sectionIndex, blockIndex, block } = result.match;
    const blockPath = ["itinerary", "sections", sectionIndex, "blocks", blockIndex];
    const placeName = isPlaceBlock(block) ? block.place.name : `block #${block.id}`;

    // Set inline note via rich-text subtype op
    if (args.note) {
      const textOps: Json0Op[] = [
        {
          p: [...blockPath, "text"],
          t: "rich-text",
          o: [{ insert: `${args.note}\n` }],
        },
      ];
      await submitOp(ctx, args.trip_key, textOps);
    }

    // Set timing — use od+oi when the field already exists, plain oi when it doesn't
    if (args.start_time || args.end_time) {
      const timeOps: Json0Op[] = [];
      const existingBlock = block as Record<string, unknown>;
      if (args.start_time) {
        const op: Json0Op = { p: [...blockPath, "startTime"], oi: args.start_time };
        if ("startTime" in existingBlock) op.od = existingBlock.startTime as string | null;
        timeOps.push(op);
      }
      if (args.end_time) {
        const op: Json0Op = { p: [...blockPath, "endTime"], oi: args.end_time };
        if ("endTime" in existingBlock) op.od = existingBlock.endTime as string | null;
        timeOps.push(op);
      }
      await submitOp(ctx, args.trip_key, timeOps);
    }

    const parts = [`Updated ${placeName} in "${trip.title}".`];
    if (args.start_time) {
      parts.push(`Time: ${args.start_time}${args.end_time ? `–${args.end_time}` : ""}.`);
    }
    if (args.note) {
      const preview = args.note.length > 60 ? `${args.note.slice(0, 57)}…` : args.note;
      parts.push(`Note: "${preview}"`);
    }
    return { content: [{ type: "text", text: parts.join(" ") }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
