import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  buildChecklistBlock,
  findTargetSection,
  requireUserId,
  submitOp,
} from "./shared.js";

export const addChecklistInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to add the checklist to. Use wanderlog_list_trips if you don't know the key."),
  items: z
    .array(z.string().min(1))
    .min(1)
    .describe("Checklist items. Each string becomes one checkbox item, initially unchecked."),
  title: z
    .string()
    .optional()
    .describe("Optional title for the checklist (e.g. 'Packing list'). Omit for an untitled checklist."),
  day: z
    .string()
    .optional()
    .describe(
      "Optional day to add the checklist to. Accepts 'day 2', 'May 4', or ISO '2026-05-04'. Omit to add to the 'Places to visit' list.",
    ),
};

export const addChecklistDescription = `
Adds a checklist to a Wanderlog trip. Each item starts unchecked and can be ticked off in the
Wanderlog app.

Add at least one checklist per trip. Common patterns:
- On the trip (no day): a packing list or "before departure" checklist
- On day 1: an arrival-day checklist ("pick up Oyster card", "check into hotel", "buy SIM")
- On specific days: day-of tasks ("bring swimsuit", "charge camera", "carry cash for market")

Returns a confirmation including the checklist title and item count.
`.trim();

type Args = {
  trip_key: string;
  items: string[];
  title?: string;
  day?: string;
};

export async function addChecklist(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const userId = requireUserId(ctx);
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const target = findTargetSection(trip, args.day);

    const block = buildChecklistBlock(args.items, args.title ?? "", userId);
    const insertIndex = target.section.blocks.length;
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", target.index, "blocks", insertIndex],
        li: block,
      },
    ];

    await submitOp(ctx, args.trip_key, ops);

    const titlePart = args.title ? `"${args.title}" ` : "";
    const text = `Added checklist ${titlePart}(${args.items.length} items) to ${target.label} in "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
