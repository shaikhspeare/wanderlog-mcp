import type { NoteBlock, Section, TripPlan } from "../types.js";
import { isNoteBlock, quillToPlain } from "../types.js";
import { parseOrdinal } from "./place-ref.js";
import { resolveDay } from "./day.js";

export type NoteRefMatch = {
  sectionIndex: number;
  blockIndex: number;
  section: Section;
  block: NoteBlock;
};

export type NoteRefResult =
  | { kind: "unique"; match: NoteRefMatch }
  | { kind: "ambiguous"; candidates: NoteRefMatch[] }
  | { kind: "none" };

const MAX_AMBIGUOUS_CANDIDATES = 10;

const ROLE_KEYWORDS = new Set(["note", "the note", "my note", "a note"]);

/**
 * Resolves a free-form natural-language reference to a note block in a trip.
 *
 * Strategy order (short-circuits on the first stage that yields candidates):
 *   0. Ordinal prefix ("1st X", "last X", "second X") — strips the ordinal,
 *      resolves the rest via the normal flow, then picks the N-th candidate.
 *      Combines with compound refs: "2nd milford on day 3" is valid.
 *   1. Compound "<thing> on <day>" — left side resolved by stages 2-3, then
 *      filtered to candidates whose parent section matches the day.
 *   2. Role keyword ("the note", "note") — every note in the trip (or the
 *      filtered day). Usually ambiguous unless there's exactly one.
 *   3. Substring (case-insensitive) match against the note's plain text.
 *
 * Matches the plain text extracted from `text.ops[].insert` — formatting and
 * links are stripped. Diacritics are not normalized.
 */
export function resolveNoteRef(trip: TripPlan, ref: string): NoteRefResult {
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
    ? filterByDay(trip, findByLeftSide(trip, compound.left), compound.right)
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

function findByLeftSide(trip: TripPlan, ref: string): NoteRefMatch[] {
  if (ROLE_KEYWORDS.has(ref)) {
    return allNotes(trip);
  }
  return matchNoteText(trip, ref);
}

function allNotes(trip: TripPlan): NoteRefMatch[] {
  const matches: NoteRefMatch[] = [];
  const sections = trip.itinerary.sections;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]!;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const block = section.blocks[blockIndex]!;
      if (isNoteBlock(block)) {
        matches.push({ sectionIndex, blockIndex, section, block });
      }
    }
  }
  return matches;
}

function matchNoteText(trip: TripPlan, ref: string): NoteRefMatch[] {
  const matches: NoteRefMatch[] = [];
  const sections = trip.itinerary.sections;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex]!;
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex++) {
      const block = section.blocks[blockIndex]!;
      if (!isNoteBlock(block)) continue;
      const text = normalize(quillToPlain(block.text));
      if (text && text.includes(ref)) {
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

function filterByDay(
  trip: TripPlan,
  candidates: NoteRefMatch[],
  context: string,
): NoteRefMatch[] {
  if (candidates.length === 0) return candidates;
  const daySection = tryResolveDay(trip, context);
  if (daySection) {
    return candidates.filter((c) => c.section === daySection);
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

function finalize(candidates: NoteRefMatch[]): NoteRefResult {
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
