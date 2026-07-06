import type { JournalStop, PlaceData, QuillDelta, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";

/** A located journal stop: its index in the stops array plus the stop itself. */
export type StopMatch = {
  index: number;
  stop: JournalStop;
};

export type StopFilters = {
  title?: string;
  date?: string;
};

/** Flattens a QuillDelta to plain text. */
export function extractStopText(text: QuillDelta | undefined): string {
  return (text?.ops ?? [])
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

/** The YYYY-MM-DD part of a stop's `dateTime`, or "" if absent. */
export function stopDate(stop: JournalStop): string {
  return typeof stop.dateTime === "string" ? stop.dateTime.slice(0, 10) : "";
}

/**
 * Lowercase + strip diacritics so a user's "Senso-ji" matches a stop titled
 * "Sensō-ji". Stop titles default to resolved place names, which routinely
 * carry accents the user won't type.
 */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Reads `trip.itinerary.journal.stops`, pairing each stop with its array index
 * so callers can build JSON0 list paths. Empty when the trip has no journal.
 */
export function getJournalStops(trip: TripPlan): StopMatch[] {
  const stops = trip.itinerary.journal?.stops ?? [];
  return stops.map((stop, index) => ({ index, stop }));
}

/**
 * Finds journal stops matching a diacritic- and case-insensitive title
 * substring, optionally narrowed by an exact date (YYYY-MM-DD). An empty/omitted
 * title matches every stop, so `list_journal` can call with filters alone.
 */
export function findStopMatches(trip: TripPlan, filters: StopFilters): StopMatch[] {
  const title = filters.title ? fold(filters.title) : undefined;
  return getJournalStops(trip).filter(({ stop }) => {
    if (title && !fold(stop.title ?? "").includes(title)) return false;
    if (filters.date && stopDate(stop) !== filters.date) return false;
    return true;
  });
}

/**
 * Finds places already referenced by the trip — both itinerary place blocks and
 * existing journal-stop places — whose name matches the query (diacritic- and
 * case-insensitive substring). Deduplicated by place_id. Lets add_journal reuse
 * a place the user already has rather than embedding a fresh search result.
 */
export function findTripPlaces(trip: TripPlan, query: string): PlaceData[] {
  const q = fold(query);
  const byKey = new Map<string, PlaceData>();
  const collect = (place: PlaceData | undefined) => {
    if (!place?.name) return;
    const key = place.place_id || place.name;
    if (!byKey.has(key)) byKey.set(key, place);
  };
  for (const section of trip.itinerary.sections) {
    for (const block of section.blocks) {
      if (isPlaceBlock(block)) collect(block.place);
    }
  }
  for (const { stop } of getJournalStops(trip)) collect(stop.place);
  return [...byKey.values()].filter((p) => fold(p.name).includes(q));
}

/**
 * The date of the itinerary day that schedules this place, if any — so a
 * journal stop for a planned place defaults to the day it's planned on rather
 * than today. Matches by place_id across dayPlan sections; returns undefined
 * for unscheduled places (or places only present in the journal).
 */
export function placeItineraryDate(trip: TripPlan, place: PlaceData): string | undefined {
  for (const section of trip.itinerary.sections) {
    if (section.mode !== "dayPlan" || !section.date) continue;
    for (const block of section.blocks) {
      if (isPlaceBlock(block) && block.place.place_id === place.place_id) return section.date;
    }
  }
  return undefined;
}

function preview(text: string): string {
  const flat = text.replace(/\n/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/** One-line label, e.g. `Marina Bay Sands — 2026-06-14 09:00 — "journal testing!"`. */
export function formatStop(stop: JournalStop): string {
  const title = stop.title?.trim() || stop.place?.name || "(untitled stop)";
  const when =
    typeof stop.dateTime === "string"
      ? stop.dateTime.replace("T", " ").slice(0, 16)
      : "(no date)";
  const body = extractStopText(stop.text).trim();
  const bodyLabel = body ? ` — "${preview(body)}"` : "";
  return `${title} — ${when}${bodyLabel}`;
}

/** Numbered candidate list for an ambiguity prompt, capped with a "(N more…)" tail. */
export function formatStopCandidateList(matches: StopMatch[], limit = 10): string {
  const lines = matches
    .slice(0, limit)
    .map((m, i) => `  ${i + 1}. ${formatStop(m.stop)}`)
    .join("\n");
  const suffix = matches.length > limit ? `\n  (${matches.length - limit} more…)` : "";
  return `${lines}${suffix}`;
}
