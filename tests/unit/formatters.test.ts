import { describe, expect, it } from "vitest";
import { formatTrip, formatTripList } from "../../src/formatters/trip-summary.ts";
import type { TripPlanSummary } from "../../src/types.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";
import { resolveDay } from "../../src/resolvers/day.ts";

describe("formatTripList", () => {
  const trips: TripPlanSummary[] = [
    {
      id: 1,
      key: "abc",
      title: "Trip to Queenstown",
      startDate: "2026-05-03",
      endDate: "2026-05-08",
      placeCount: 2,
    },
  ];

  it("concise format includes title, dates, place count, and key", () => {
    const out = formatTripList(trips, "concise");
    expect(out).toContain("Trip to Queenstown");
    expect(out).toContain("2026-05-03");
    expect(out).toContain("2026-05-08");
    expect(out).toContain("2 places");
    expect(out).toContain("abc");
  });

  it("empty list is handled", () => {
    expect(formatTripList([], "concise")).toBe("No trips found in this account.");
  });

  it("detailed format includes key on its own line", () => {
    const out = formatTripList(trips, "detailed");
    expect(out).toContain("Key:      abc");
  });
});

describe("formatTrip", () => {
  it("concise format mentions both places", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("Queenstown Gardens");
    expect(out).toContain("Rendezvous Heritage Hotel Queenstown");
  });

  it("concise format shows all 6 days", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("May 3");
    expect(out).toContain("May 4");
    expect(out).toContain("May 5");
    expect(out).toContain("May 6");
    expect(out).toContain("May 7");
    expect(out).toContain("May 8");
  });

  it("concise format includes hotel check-in window", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out).toContain("2026-05-03");
    expect(out).toContain("2026-05-06");
  });

  it("concise format stays under 1000 chars for this small trip", () => {
    const out = formatTrip(queenstownTrip, "concise");
    expect(out.length).toBeLessThan(1000);
  });

  it("detailed format includes phone, address, rating details", () => {
    const out = formatTrip(queenstownTrip, "detailed");
    expect(out).toContain("+64 3 450 1500");
    expect(out).toContain("Fernhill");
    expect(out).toContain("1566 reviews");
  });

  it("day filter returns only that day's content", () => {
    const day = resolveDay(queenstownTrip, "day 2");
    const out = formatTrip(queenstownTrip, "concise", day);
    expect(out).toContain("May 4");
    expect(out).not.toContain("May 5");
    expect(out).not.toContain("Queenstown Gardens");
  });

  it("day filter on empty day shows friendly placeholder", () => {
    const day = resolveDay(queenstownTrip, "day 3");
    const out = formatTrip(queenstownTrip, "concise", day);
    expect(out).toContain("no plans");
  });
});
