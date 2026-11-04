import { describe, expect, it } from "vitest";
import type { PlaceBlock, Section } from "../../src/types.js";
import {
  checkDayConflicts,
  straightLineKm,
  suggestProximityOrder,
} from "../../src/tools/planning-helpers.js";

function place(
  id: number,
  name: string,
  lng?: number,
  times?: { startTime?: string; endTime?: string },
): PlaceBlock {
  return {
    id,
    type: "place",
    place: {
      name,
      place_id: "example-" + id,
      ...(lng === undefined ? {} : { geometry: { location: { lat: 35.7, lng } } }),
    },
    ...times,
  };
}

function day(blocks: PlaceBlock[]): Section {
  return {
    id: 1,
    heading: "",
    type: "normal",
    mode: "dayPlan",
    date: "2026-11-27",
    blocks,
  };
}

describe("read-only itinerary planning", () => {
  it("computes a symmetric straight-line distance", () => {
    const a = { lat: 35.7, lng: 139.7 };
    const b = { lat: 35.7, lng: 139.8 };
    expect(straightLineKm(a, a)).toBe(0);
    expect(straightLineKm(a, b)).toBeCloseTo(straightLineKm(b, a), 8);
    expect(straightLineKm(a, b)).toBeGreaterThan(8);
  });

  it("reports overlapping scheduled visits", () => {
    const result = checkDayConflicts(
      day([
        place(1, "Museum", 139.7, { startTime: "09:00", endTime: "10:30" }),
        place(2, "Garden", 139.7, { startTime: "10:00", endTime: "11:00" }),
      ]),
    );
    expect(result.issues.some((issue) => issue.kind === "time_overlap")).toBe(true);
    expect(result.scheduled).toBe(2);
  });

  it("reports invalid time ranges and excessive daily stops", () => {
    const stops = Array.from({ length: 8 }, (_, index) => place(index + 1, "Stop " + index, 139.7));
    stops[0]!.startTime = "12:30";
    stops[0]!.endTime = "11:00";
    const result = checkDayConflicts(day(stops));
    expect(result.issues.map((issue) => issue.kind)).toContain("busy_day");
    expect(result.issues.map((issue) => issue.kind)).toContain("invalid_time");
    expect(result.places).toBe(8);
  });

  it("warns about a transfer that cannot fit the walking heuristic", () => {
    const result = checkDayConflicts(
      day([
        place(1, "Stop A", 139.0, { startTime: "09:00", endTime: "09:30" }),
        place(2, "Stop B", 140.0, { startTime: "10:00", endTime: "11:00" }),
      ]),
    );
    const transfer = result.issues.find((issue) => issue.kind === "transfer_risk");
    expect(transfer?.straight_line_km).toBeGreaterThan(50);
    expect(transfer?.walk_heuristic_minutes).toBeGreaterThan(30);
  });

  it("suggests a shorter proximity ordering without mutating the input", () => {
    const source = day([
      place(1, "A", 139.0),
      place(2, "D", 139.08),
      place(3, "B", 139.01),
      place(4, "C", 139.02),
    ]);
    const before = JSON.stringify(source);
    const result = suggestProximityOrder(source);
    expect(result.current_order).toEqual(["A", "D", "B", "C"]);
    expect(result.proposed_proximity_order).toEqual(["A", "B", "C", "D"]);
    expect(result.estimated_straight_line_km_after).toBeLessThan(
      result.estimated_straight_line_km_before,
    );
    expect(result.changed).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("keeps timed or reserved places and missing-coordinate entries in place", () => {
    const source = day([
      place(1, "A", 139.0),
      place(2, "Timed booking", 139.4, { startTime: "12:00" }),
      place(3, "B", 139.08),
      place(4, "Without coordinates"),
      place(5, "C", 139.02),
      place(6, "Tokyo Disneyland", 139.9),
    ]);
    const result = suggestProximityOrder(source);
    expect(result.proposed_proximity_order[1]).toBe("Timed booking");
    expect(result.proposed_proximity_order[3]).toBe("Without coordinates");
    expect(result.proposed_proximity_order[5]).toBe("Tokyo Disneyland");
    expect(result.fixed_places_preserved).toContain("Tokyo Disneyland");
    expect(result.missing_geocoordinates).toEqual(["Without coordinates"]);
  });

  it("ignores unusable coordinates without creating false distance estimates", () => {
    const source = day([
      place(1, "Valid stop", 139.7),
      {
        ...place(2, "Invalid coordinates", 139.8),
        place: {
          name: "Invalid coordinates",
          place_id: "example-2",
          geometry: { location: { lat: 400, lng: 139.8 } },
        },
      },
      place(3, "Missing coordinates"),
    ]);
    const result = suggestProximityOrder(source);
    expect(result.missing_geocoordinates).toEqual(["Invalid coordinates", "Missing coordinates"]);
    expect(result.current_order).toEqual(result.proposed_proximity_order);
  });

  it("does not treat a Disney Store as a booked theme park", () => {
    const result = suggestProximityOrder(
      day([place(1, "Disney Store Shibuya", 139.0), place(2, "Cafe", 139.02)]),
    );
    expect(result.fixed_places_preserved).toEqual([]);
  });
});
