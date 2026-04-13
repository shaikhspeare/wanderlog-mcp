import type { Block, Section, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";
import { resolveDay } from "./day.js";

export type PlaceRefMatch = {
  sectionIndex: number;
  blockIndex: number;
  section: Section;
  block: Block;
};

export type PlaceRefResult =
  | { kind: "unique"; match: PlaceRefMatch }
  | { kind: "ambiguous"; candidates: PlaceRefMatch[] }
  | { kind: "none" };

const MAX_AMBIGUOUS_CANDIDATES = 10;

const HOTEL_KEYWORDS = new Set(["the hotel", "hotel", "my hotel"]);
const FLIGHT_KEYWORDS = new Set(["the flight", "flight", "my flight"]);
const TRAIN_KEYWORDS = new Set(["the train", "train", "my train"]);

const WORD_ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

type ParsedOrdinal = { position: number | "last"; rest: string };

/**
 * Detects an ordinal prefix on a normalized ref. Returns the 1-based position
 * (or "last") and the remaining ref with the ordinal stripped. Handles:
 *   - numeric suffixes: "1st X", "2nd X", "3rd X", "4th X", ...
 *   - word ordinals: "first X", "second X", ..., "tenth X"
 *   - "last X"
 *
 * Returns null if no ordinal prefix is present.
 */
export function parseOrdinal(ref: string): ParsedOrdinal | null {
  if (ref.startsWith("last ")) {
    const rest = ref.slice(5).trim();
    if (rest) return { position: "last", rest };
  }

  const numMatch = /^(\d+)(?:st|nd|rd|th)\s+(.+)$/.exec(ref);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1]!, 10);
    if (n >= 1) return { position: n, rest: numMatch[2]!.trim() };
  }

  const wordMatch = /^([a-z]+)\s+(.+)$/.exec(ref);
  if (wordMatch) {
    const word = wordMatch[1]!;
    const n = WORD_ORDINALS[word];
    if (n !== undefined) return { position: n, rest: wordMatch[2]!.trim() };
  }

  return null;
}

/**
 * Resolves a free-form natural-language reference to a block in a trip.
 *
 * Strategy order (short-circuits on the first stage that yields candidates):
 *   0. Ordinal prefix ("1st X", "2nd X", "last X", "third X") — strips the
 *      ordinal, resolves the rest via the normal flow, then picks the N-th
 *      (or last) candidate from the resulting list. Combines with compound
 *      refs: "2nd Queenstown Gardens on day 4" is valid.
 *   1. Compound "<thing> on <context>" — left side resolved by stages 2-4,
 *      then filtered to candidates whose parent section matches the context
 *      (currently only day references are understood on the right).
 *   2. Role keywords ("the hotel", "the flight", "the train") — first block
 *      in the appropriate role section.
 *   3. Exact (case-insensitive) match against `block.place.name`.
 *   4. Substring (case-insensitive) match against `block.place.name`.
 *
 * Diacritics are not normalized: "Senso-ji" will not match "Sensō-ji".
 * Whitespace is collapsed and trimmed before matching.
 */
export function resolvePlaceRef(trip: TripPlan, ref: string): PlaceRefResult {
  const normalized = normalize(ref);
  if (!normalized) {
    return { kind: "none" };
  }

  const sections = trip.itinerary.sections;
  if (sections.length === 0) {
    return { kind: "none" };
  }

  const ordinal = parseOrdinal(normalized);
  const body = ordinal ? ordinal.rest : normalized;

  const compound = splitCompound(body);
  const candidates = compound
    ? filterByContext(trip, findByLeftSide(trip, compound.left), compound.right)
    : findByLeftSide(trip, body);

  if (ordinal) {
    if (candidates.length === 0) return { kind: "none" };
    const index =
      ordinal.position === "last" ? candidates.length - 1 : ordinal.position - 1;
    if (index < 0 || index >= candidates.length) {
      return { kind: "none" };
    }
    return { kind: "unique", match: candidates[index]! };
  }

  return finalize(candidates);
}

function findByLeftSide(trip: TripPlan, ref: string): PlaceRefMatch[] {
  const roleMatches = matchRoleKeyword(trip, ref);
  if (roleMatches.length > 0) {
    return roleMatches;
  }

  const exact = matchPlaceName(trip, ref, "exact");
  if (exact.length > 0) {
    return exact;
  }

  return matchPlaceName(trip, ref, "substring");
}

function matchRoleKeyword(trip: TripPlan, ref: string): PlaceRefMatch[] {
  if (HOTEL_KEYWORDS.has(ref)) {
    return firstBlockOfSectionType(trip, (s) => s.type === "hotels");
  }
  if (FLIGHT_KEYWORDS.has(ref)) {
    return firstBlockOfSectionType(trip, (s) => s.type === "flights");
  }
  if (TRAIN_KEYWORDS.has(ref)) {
    return firstBlockOfSectionType(
      trip,
      (s) => s.type === "transit",
      (b) => b.type === "train",
    );
  }
  return [];
}

function firstBlockOfSectionType(
  trip: TripPlan,
  sectionPredicate: (s: Section) => boolean,
  blockPredicate?: (b: Block) => boolean,
): PlaceRefMatch[] {
  const sections = trip.itinerary.sections;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]!;
    if (!sectionPredicate(section)) continue;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const block = section.blocks[blockIndex]!;
      if (blockPredicate && !blockPredicate(block)) continue;
      return [{ sectionIndex, blockIndex, section, block }];
    }
  }
  return [];
}

function matchPlaceName(
  trip: TripPlan,
  ref: string,
  mode: "exact" | "substring",
): PlaceRefMatch[] {
  const matches: PlaceRefMatch[] = [];
  const sections = trip.itinerary.sections;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]!;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const block = section.blocks[blockIndex]!;
      if (!isPlaceBlock(block)) continue;
      const name = normalize(block.place.name ?? "");
      if (!name) continue;
      const hit = mode === "exact" ? name === ref : name.includes(ref);
      if (hit) {
        matches.push({ sectionIndex, blockIndex, section, block });
      }
    }
  }
  return matches;
}

function splitCompound(ref: string): { left: string; right: string } | null {
  const idx = ref.indexOf(" on ");
  if (idx < 0) return null;
  const left = ref.slice(0, idx).trim();
  const right = ref.slice(idx + 4).trim();
  if (!left || !right) return null;
  return { left, right };
}

function filterByContext(
  trip: TripPlan,
  candidates: PlaceRefMatch[],
  context: string,
): PlaceRefMatch[] {
  if (candidates.length === 0) return candidates;

  const contextSection = tryResolveDay(trip, context);
  if (contextSection) {
    return candidates.filter((c) => c.section === contextSection);
  }

  return [];
}

function tryResolveDay(trip: TripPlan, ref: string): Section | null {
  try {
    return resolveDay(trip, ref);
  } catch {
    return null;
  }
}

function finalize(candidates: PlaceRefMatch[]): PlaceRefResult {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "unique", match: candidates[0]! };
  return {
    kind: "ambiguous",
    candidates: candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES),
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
