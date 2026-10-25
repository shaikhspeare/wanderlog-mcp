import type { Json0Op } from "../ot/apply.js";
import { applyOp } from "../ot/apply.js";
import type { PlaceBlock, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";
import { WanderlogValidationError } from "../errors.js";
import { resolveDay } from "../resolvers/day.js";
import { resolvePlaceRef } from "../resolvers/place-ref.js";
import { resolveSectionRef, findBlockById } from "./shared.js";
import { stateHash } from "./advanced-state.js";

export type PlanAction =
  | { type: "move"; place: string; to_day: string; from_day?: string; position?: number }
  | { type: "reorder"; place: string; day: string; position: number }
  | { type: "set_time"; place: string; day: string; start_time?: string; end_time?: string };

export type ProtectionState = { ids: number[]; updated_at: string };
const defaultProtections = (): ProtectionState => ({ ids: [], updated_at: "" });

export function parseProtection(value: unknown): ProtectionState {
  if (value === null || typeof value !== "object") return defaultProtections();
  const result = value as ProtectionState;
  if (!Array.isArray(result.ids) || !result.ids.every(Number.isSafeInteger)) {
    throw new WanderlogValidationError("Corrupt reservation protection record.");
  }
  return result;
}

export function bookingProtected(block: PlaceBlock): boolean {
  return Boolean(
    block.hotel && (block.hotel.confirmationNumber || block.hotel.checkIn || block.hotel.checkOut),
  );
}

export function assertUnprotected(block: PlaceBlock, protectedIds: number[]): void {
  if (bookingProtected(block) || protectedIds.includes(block.id)) {
    throw new WanderlogValidationError(
      "Protected reservation or place: " + block.place.name + ".",
      "Remove manual protection first, or preserve confirmed booking data without changes.",
    );
  }
}

function dayOrSection(trip: TripPlan, ref: string): number {
  if (ref.startsWith("section:")) {
    const result = resolveSectionRef(trip, ref.slice("section:".length));
    if (result.kind !== "unique") {
      throw new WanderlogValidationError("Custom section not found or ambiguous: " + ref);
    }
    if (
      result.match.section.mode !== "placeList" ||
      ["hotels", "flights", "transit", "rentalCars"].includes(result.match.section.type)
    ) {
      throw new WanderlogValidationError("This system section cannot receive moved places.");
    }
    return result.match.index;
  }
  const result = resolveDay(trip, ref);
  return trip.itinerary.sections.findIndex((section) => section.id === result.id);
}

function locate(trip: TripPlan, ref: string, context?: string) {
  const result = resolvePlaceRef(trip, ref);
  if (result.kind !== "unique" || !isPlaceBlock(result.match.block)) {
    throw new WanderlogValidationError("Place reference not unique or not found: " + ref);
  }
  const match = result.match;
  if (context && dayOrSection(trip, context) !== match.sectionIndex) {
    throw new WanderlogValidationError(
      "Place is not in the specified source day or section: " + ref,
    );
  }
  return match as typeof match & { block: PlaceBlock };
}

function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type PlannedChange = {
  operations: Json0Op[];
  expectedSections: TripPlan["itinerary"]["sections"];
  summary: Array<Record<string, string | number>>;
};

/** A pure multi-action simulator. No network or local state I/O. */
export function planChanges(
  trip: TripPlan,
  actions: PlanAction[],
  protectedIds: number[],
): PlannedChange {
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 30) {
    throw new WanderlogValidationError("Provide 1 to 30 actions.");
  }
  const working = structuredClone(trip);
  const operations: Json0Op[] = [];
  const summary: PlannedChange["summary"] = [];

  for (const action of actions) {
    if (action.type === "move") {
      const match = locate(working, action.place, action.from_day);
      assertUnprotected(match.block, protectedIds);
      const destination = dayOrSection(working, action.to_day);
      if (destination < 0 || destination === match.sectionIndex) {
        throw new WanderlogValidationError("Destination must be a different valid section.");
      }
      const to = working.itinerary.sections[destination]!;
      if (
        to.blocks.some(
          (block) =>
            isPlaceBlock(block) &&
            block.place.name.toLocaleLowerCase() === match.block.place.name.toLocaleLowerCase(),
        )
      ) {
        throw new WanderlogValidationError("Destination already contains a place with this name.");
      }
      const position = action.position === undefined ? to.blocks.length : action.position - 1;
      if (!Number.isInteger(position) || position < 0 || position > to.blocks.length) {
        throw new WanderlogValidationError("Destination position is out of range.");
      }
      const copy = structuredClone(match.block);
      const deletion: Json0Op = {
        p: ["itinerary", "sections", match.sectionIndex, "blocks", match.blockIndex],
        ld: copy,
      };
      const insertion: Json0Op = {
        p: ["itinerary", "sections", destination, "blocks", position],
        li: copy,
      };
      operations.push(deletion, insertion);
      match.section.blocks.splice(match.blockIndex, 1);
      to.blocks.splice(position, 0, copy);
      summary.push({
        type: "move",
        place: copy.place.name,
        id: copy.id,
        from: match.section.date || match.section.heading,
        to: to.date || to.heading,
        position: position + 1,
      });
    } else if (action.type === "reorder") {
      const match = locate(working, action.place, action.day);
      assertUnprotected(match.block, protectedIds);
      const target = action.position - 1;
      if (!Number.isInteger(target) || target < 0 || target >= match.section.blocks.length) {
        throw new WanderlogValidationError("Reorder position is out of range.");
      }
      if (target !== match.blockIndex) {
        operations.push({
          p: ["itinerary", "sections", match.sectionIndex, "blocks", match.blockIndex],
          lm: target,
        });
        const [moved] = match.section.blocks.splice(match.blockIndex, 1);
        match.section.blocks.splice(target, 0, moved!);
      }
      summary.push({
        type: "reorder",
        place: match.block.place.name,
        id: match.block.id,
        day: action.day,
        position: action.position,
      });
    } else if (action.type === "set_time") {
      const match = locate(working, action.place, action.day);
      assertUnprotected(match.block, protectedIds);
      if (action.start_time === undefined && action.end_time === undefined) {
        throw new WanderlogValidationError("Provide at least one start or end time.");
      }
      for (const [field, property] of [
        ["start_time", "startTime"],
        ["end_time", "endTime"],
      ] as const) {
        const value = action[field];
        if (value === undefined) continue;
        if (!validTime(value)) throw new WanderlogValidationError("Use HH:mm (24-hour) times.");
        const old = match.block[property];
        if (old === value) continue;
        const operation: Json0Op = {
          p: ["itinerary", "sections", match.sectionIndex, "blocks", match.blockIndex, property],
          oi: value,
        };
        if (old !== undefined) operation.od = old;
        operations.push(operation);
        match.block[property] = value;
      }
      summary.push({
        type: "set_time",
        place: match.block.place.name,
        id: match.block.id,
        day: action.day,
      });
    } else {
      throw new WanderlogValidationError("Unsupported action type.");
    }
  }

  // Guard against an inconsistency between the simulator and the JSON0 operations.
  const computed = applyOp(structuredClone(trip), operations);
  if (stateHash(computed.itinerary.sections) !== stateHash(working.itinerary.sections)) {
    throw new WanderlogValidationError("Generated operations do not match simulated changes.");
  }
  // Verify protected IDs are still present and byte-for-byte unchanged in the target snapshot.
  for (const section of trip.itinerary.sections) {
    for (const block of section.blocks) {
      if (!isPlaceBlock(block) || (!bookingProtected(block) && !protectedIds.includes(block.id)))
        continue;
      const before = findBlockById(trip, block.id);
      const after = findBlockById(working, block.id);
      if (
        !after ||
        !before ||
        after.section.id !== before.section.id ||
        stateHash(after.block) !== stateHash(before.block)
      ) {
        throw new WanderlogValidationError("Planned changes affect a protected booking or place.");
      }
    }
  }
  return { operations, expectedSections: working.itinerary.sections, summary };
}
