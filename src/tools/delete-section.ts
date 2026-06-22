import { z } from "zod";
import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import {
  findPlacesToVisitSection,
  findSectionByRef,
  submitOp,
} from "./shared.js";

export const deleteSectionInputSchema = {
  trip_key: z
    .string()
    .min(1)
    .describe("The trip to delete the section from."),
  section: z
    .string()
    .min(1)
    .describe(
      "The section to delete, identified by its heading (e.g. 'Food & Drink'). Use wanderlog_get_trip to see available sections.",
    ),
};

export const deleteSectionDescription = `
Deletes a custom section from a Wanderlog trip itinerary. The section and all blocks inside it
are permanently removed.

Only custom sections (created via wanderlog_add_section or the Wanderlog UI) can be deleted.
Day sections, the default "Places to visit" list, and system sections (hotels, flights, transit)
are protected and cannot be removed with this tool.

Returns a confirmation with the deleted section's heading.
`.trim();

type Args = {
  trip_key: string;
  section: string;
};

const SYSTEM_SECTION_TYPES = new Set(["hotels", "flights", "transit"]);

export async function deleteSection(
  ctx: AppContext,
  args: Args,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const entry = await ctx.tripCache.getEntry(args.trip_key);
    const trip = entry.snapshot;

    const found = findSectionByRef(trip, args.section);
    if (!found) {
      throw new WanderlogValidationError(
        `Section "${args.section}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
      );
    }

    const { index, section } = found;

    if (section.mode === "dayPlan") {
      throw new WanderlogValidationError(
        `Day sections cannot be deleted here. Use wanderlog_update_trip_dates to change the trip's date range instead.`,
      );
    }

    if (findPlacesToVisitSection(trip)?.index === index) {
      throw new WanderlogValidationError(
        `The "Places to visit" section cannot be deleted — it is the trip's default place list.`,
      );
    }

    if (SYSTEM_SECTION_TYPES.has(section.type)) {
      throw new WanderlogValidationError(
        `The "${section.heading || section.type}" section is a system section and cannot be deleted.`,
      );
    }

    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", index], ld: section },
    ];
    await submitOp(ctx, args.trip_key, ops);

    const label = section.heading || "(untitled)";
    const text = `Deleted section "${label}" from "${trip.title}".`;
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg =
      err instanceof WanderlogError
        ? err.toUserMessage()
        : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}
