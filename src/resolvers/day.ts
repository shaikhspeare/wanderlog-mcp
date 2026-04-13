import { WanderlogValidationError } from "../errors.js";
import type { Section, TripPlan } from "../types.js";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Given a trip and a natural-language day reference, returns the section
 * matching that day. Accepts "day 2", "May 4", "2026-05-04".
 * Throws WanderlogValidationError with helpful message if unresolvable.
 */
export function resolveDay(trip: TripPlan, ref: string): Section {
  const daySections = getDaySections(trip);
  const trimmed = ref.trim().toLowerCase();

  if (daySections.length === 0) {
    throw new WanderlogValidationError(
      `Trip "${trip.title}" has no day-by-day plan`,
      "This trip does not yet have per-day sections to target.",
    );
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const iso = trimmed;
    const section = daySections.find((s) => s.date === iso);
    if (!section) {
      throw outOfRange(trip, `no day matches ${iso}`);
    }
    return section;
  }

  const dayNumMatch = /^day\s*(\d+)$/.exec(trimmed);
  if (dayNumMatch) {
    const n = Number.parseInt(dayNumMatch[1]!, 10);
    if (n < 1 || n > daySections.length) {
      throw outOfRange(trip, `you asked for day ${n}`);
    }
    return daySections[n - 1]!;
  }

  const plainNum = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
  if (plainNum !== null) {
    if (plainNum < 1 || plainNum > daySections.length) {
      throw outOfRange(trip, `you asked for day ${plainNum}`);
    }
    return daySections[plainNum - 1]!;
  }

  const monthDayMatch = /^([a-z]+)\s+(\d{1,2})$/.exec(trimmed);
  if (monthDayMatch) {
    const monthName = monthDayMatch[1]!;
    const day = Number.parseInt(monthDayMatch[2]!, 10);
    const month = MONTHS[monthName];
    if (!month) {
      throw new WanderlogValidationError(
        `Unknown month "${monthName}" in day reference "${ref}"`,
        'Try a format like "day 2", "May 4", or "2026-05-04".',
      );
    }
    const year = new Date(trip.startDate).getUTCFullYear();
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    const section = daySections.find((s) => s.date === iso);
    if (!section) {
      throw outOfRange(trip, `${monthName} ${day} is not in this trip`);
    }
    return section;
  }

  throw new WanderlogValidationError(
    `Could not understand day reference "${ref}"`,
    'Try a format like "day 2", "May 4", or "2026-05-04".',
  );
}

export function getDaySections(trip: TripPlan): Section[] {
  return trip.itinerary.sections.filter((s) => s.mode === "dayPlan" && s.date);
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function outOfRange(trip: TripPlan, detail: string): WanderlogValidationError {
  return new WanderlogValidationError(
    `Day reference out of range: ${detail}`,
    {
      hint: `Trip "${trip.title}" runs ${trip.startDate} to ${trip.endDate} (${trip.days} days).`,
      followUps: [
        `Call wanderlog_get_trip with trip_key "${trip.key}" (no day filter) to see the available dates, then retry with a valid day.`,
      ],
    },
  );
}
