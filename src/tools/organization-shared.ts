import { WanderlogNotFoundError, WanderlogValidationError } from "../errors.js";
import { resolveDay } from "../resolvers/day.js";
import { resolvePlaceRef, type PlaceRefMatch } from "../resolvers/place-ref.js";
import type { PlaceBlock, Section, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";
import {
  describeSection,
  findDaySectionByDate,
  isSystemSection,
  resolveSectionRef,
  type SectionMatch,
} from "./shared.js";

export type OrganizationTarget = SectionMatch & { label: string };

export function resolveOrganizationTarget(
  trip: TripPlan,
  args: { section?: string; day?: string },
): OrganizationTarget {
  const supplied = Number(args.section !== undefined) + Number(args.day !== undefined);
  if (supplied !== 1) {
    throw new WanderlogValidationError(
      "Provide exactly one section/day target.",
    );
  }

  if (args.day !== undefined) {
    const day = resolveDay(trip, args.day);
    const found = findDaySectionByDate(trip, day.date!);
    if (!found) {
      throw new WanderlogValidationError(`Day "${args.day}" not found in trip.`);
    }
    return { ...found, label: `day ${found.section.date}` };
  }

  const ref = args.section!;
  const resolved = resolveSectionRef(trip, ref);
  if (resolved.kind === "none") {
    throw new WanderlogValidationError(
      `Section "${ref}" not found in trip "${trip.title}". Use wanderlog_get_trip to see available sections.`,
    );
  }
  if (resolved.kind === "ambiguous") {
    throw new WanderlogValidationError(
      `Section reference "${ref}" is ambiguous: ${resolved.candidates.length} sections have that heading. Rename the duplicate lists before retrying.`,
    );
  }
  if (resolved.match.section.mode === "dayPlan") {
    throw new WanderlogValidationError(
      `Section "${ref}" is a dated section. Use the day parameter instead.`,
    );
  }
  if (isSystemSection(resolved.match.section)) {
    throw new WanderlogValidationError(
      `Section "${ref}" is a system section and cannot be used as a custom place-list target.`,
    );
  }
  return {
    ...resolved.match,
    label: `section "${resolved.match.section.heading || "(untitled)"}"`,
  };
}

export function resolvePlaceWithinSection(
  trip: TripPlan,
  sectionMatch: SectionMatch,
  placeRef: string,
): PlaceRefMatch & { block: PlaceBlock } {
  const scopedTrip = {
    ...trip,
    itinerary: { ...trip.itinerary, sections: [sectionMatch.section] },
  };
  const resolved = resolvePlaceRef(scopedTrip, placeRef);
  if (resolved.kind === "none") throw new WanderlogNotFoundError("Place", placeRef);
  if (resolved.kind === "ambiguous") {
    const names = resolved.candidates
      .map((candidate, index) => {
        const name = isPlaceBlock(candidate.block)
          ? candidate.block.place.name
          : `${candidate.block.type} block`;
        return `${index + 1}. ${name}`;
      })
      .join("; ");
    throw new WanderlogValidationError(
      `Place reference "${placeRef}" is ambiguous within ${describeSection(sectionMatch.section)}: ${names}. Retry with an ordinal such as "1st ${placeRef}".`,
    );
  }
  if (!isPlaceBlock(resolved.match.block)) {
    throw new WanderlogValidationError(
      `"${placeRef}" identifies a ${resolved.match.block.type} block, not a place.`,
    );
  }
  return {
    ...resolved.match,
    sectionIndex: sectionMatch.index,
    section: sectionMatch.section,
    block: resolved.match.block,
  };
}

export function placeInsertionIndex(
  blocks: Section["blocks"],
  oneBasedPlacePosition: number,
): number {
  let seen = 0;
  for (let index = 0; index < blocks.length; index++) {
    if (!isPlaceBlock(blocks[index]!)) continue;
    seen += 1;
    if (seen === oneBasedPlacePosition) return index;
  }
  return blocks.length;
}

export function validatePosition(position: number, max: number, label: string): void {
  if (!Number.isInteger(position) || position < 1 || position > max) {
    throw new WanderlogValidationError(
      `${label} must be an integer from 1 to ${max}; received ${position}.`,
    );
  }
}
