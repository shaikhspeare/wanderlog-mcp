import type { PlaceBlock, Section } from "../types.js";
import { isPlaceBlock } from "../types.js";

type Point = { lat: number; lng: number };
type PlanningPlace = { block: PlaceBlock; name: string; point: Point | null; fixed: boolean };

export type PlanningIssue = {
  level: "warning" | "error";
  kind: "busy_day" | "invalid_time" | "time_overlap" | "transfer_risk";
  message: string;
  between?: [string, string];
  straight_line_km?: number;
  walk_heuristic_minutes?: number;
};

const LIMITATIONS =
  "Distances are straight-line geographic estimates, not walking or transit routes. " +
  "Opening hours, traffic, closures, and bookings outside the itinerary are not verified.";

function coordinates(place: PlaceBlock): Point | null {
  const point = place.place.geometry?.location;
  if (
    !point ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    return null;
  return { lat: point.lat, lng: point.lng };
}

export function straightLineKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function timeMinutes(time?: string): number | null {
  if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}

/** Only obvious bookings and timed visits are anchored; this code never writes data. */
function isFixed(block: PlaceBlock): boolean {
  const namedBooking = /teamlabs?|disneyland|disneysea|universal studios/i.test(block.place.name);
  return Boolean(
    block.startTime ||
    block.endTime ||
    block.hotel?.confirmationNumber ||
    block.hotel?.checkIn ||
    namedBooking,
  );
}

function placesIn(section: Section): PlanningPlace[] {
  return section.blocks.filter(isPlaceBlock).map((block) => ({
    block,
    name: block.place.name,
    point: coordinates(block),
    fixed: isFixed(block),
  }));
}

function lengthKm(items: PlanningPlace[]): number {
  let km = 0;
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1]!.point;
    const b = items[i]!.point;
    if (a && b) km += straightLineKm(a, b);
  }
  return km;
}
const round2 = (value: number) => Math.round(value * 100) / 100;

export function checkDayConflicts(section: Section) {
  const places = placesIn(section);
  const issues: PlanningIssue[] = [];
  if (places.length > 7) {
    issues.push({
      level: "warning",
      kind: "busy_day",
      message: places.length + " places may make this day rushed.",
    });
  }
  const timed: { place: PlanningPlace; start: number; end: number | null }[] = [];
  for (const place of places) {
    const { startTime, endTime } = place.block;
    const start = timeMinutes(startTime);
    const end = timeMinutes(endTime);
    if (
      (startTime && start === null) ||
      (endTime && end === null) ||
      (!startTime && !!endTime) ||
      (start !== null && end !== null && end <= start)
    ) {
      issues.push({
        level: "error",
        kind: "invalid_time",
        message: "Invalid time range for " + place.name + ".",
      });
    }
    if (start !== null) timed.push({ place, start, end });
  }
  timed.sort((a, b) => a.start - b.start);
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!;
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]!;
      if (a.end !== null && a.end > b.start) {
        issues.push({
          level: "error",
          kind: "time_overlap",
          between: [a.place.name, b.place.name],
          message: "Scheduled activities overlap.",
        });
      }
    }
    const next = timed[i + 1];
    if (!next || a.end === null || a.end > next.start) continue;
    if (a.place.point && next.place.point) {
      const km = straightLineKm(a.place.point, next.place.point);
      const walkMinutes = Math.ceil((km / 4.5) * 60 * 1.3);
      if (a.end + walkMinutes > next.start) {
        issues.push({
          level: "warning",
          kind: "transfer_risk",
          between: [a.place.name, next.place.name],
          straight_line_km: round2(km),
          walk_heuristic_minutes: walkMinutes,
          message: "Approximate walking transfer may not fit; check an actual route.",
        });
      }
    }
  }
  return {
    day: section.date,
    places: places.length,
    scheduled: timed.length,
    untimed: places.filter((p) => timeMinutes(p.block.startTime) === null).map((p) => p.name),
    fixed_places: places.filter((p) => p.fixed).map((p) => p.name),
    issues,
    limitations: LIMITATIONS,
  };
}

/**
 * Nearest-neighbor suggestions within contiguous movable groups. Timed,
 * booked, and ungeolocated places retain their exact positions.
 * Proposals cannot increase the measurable straight-line distance.
 */
export function suggestProximityOrder(section: Section) {
  const current = placesIn(section);
  const suggested = [...current];
  let start = 0;
  while (start < suggested.length) {
    if (suggested[start]!.fixed || !suggested[start]!.point) {
      start++;
      continue;
    }
    let end = start;
    while (end < suggested.length && !suggested[end]!.fixed && suggested[end]!.point) end++;
    if (end - start > 2) {
      const remaining = suggested.slice(start, end);
      const selected: PlanningPlace[] = [];
      const predecessor = suggested[start - 1];
      const first = predecessor?.point
        ? remaining.reduce(
            (best, p) =>
              straightLineKm(predecessor.point!, p.point!) <
              straightLineKm(predecessor.point!, best.point!)
                ? p
                : best,
            remaining[0]!,
          )
        : remaining[0]!;
      selected.push(first);
      remaining.splice(remaining.indexOf(first), 1);
      while (remaining.length > 0) {
        const last = selected[selected.length - 1]!;
        let nearestIndex = 0;
        for (let i = 1; i < remaining.length; i++) {
          if (
            straightLineKm(last.point!, remaining[i]!.point!) <
            straightLineKm(last.point!, remaining[nearestIndex]!.point!)
          )
            nearestIndex = i;
        }
        selected.push(remaining.splice(nearestIndex, 1)[0]!);
      }
      const candidate = [...suggested.slice(0, start), ...selected, ...suggested.slice(end)];
      if (lengthKm(candidate) + 0.00001 < lengthKm(suggested)) {
        suggested.splice(start, end - start, ...selected);
      }
    }
    start = end;
  }
  return {
    day: section.date,
    current_order: current.map((p) => p.name),
    proposed_proximity_order: suggested.map((p) => p.name),
    fixed_places_preserved: current.filter((p) => p.fixed).map((p) => p.name),
    missing_geocoordinates: current.filter((p) => !p.point).map((p) => p.name),
    estimated_straight_line_km_before: round2(lengthKm(current)),
    estimated_straight_line_km_after: round2(lengthKm(suggested)),
    changed: current.some((p, i) => suggested[i]!.block.id !== p.block.id),
    limitations: LIMITATIONS + " This tool never edits an itinerary.",
  };
}
