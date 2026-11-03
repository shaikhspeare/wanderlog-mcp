import { describe, expect, it } from "vitest";
import { formatBlockLine, formatTrip, formatTripList } from "../../src/formatters/trip-summary.ts";
import type { Block, TripPlanSummary } from "../../src/types.ts";
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

  it("detailed format includes numeric id and forwarding email", () => {
    const out = formatTripList(trips, "detailed");
    expect(out).toContain("ID:       1");
    expect(out).toContain("Email:    trip+1@wanderlog.com");
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

  it("detailed format includes numeric id and forwarding email", () => {
    const out = formatTrip(queenstownTrip, "detailed");
    expect(out).toContain("ID: 18313259");
    expect(out).toContain("Forwarding email: trip+18313259@wanderlog.com");
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

const mkTransit = (type: string) =>
  ({
    id: 1,
    type,
    carrier: "Acme Line",
    depart: { place: { name: "Port A", place_id: "a" }, date: "2026-11-08", time: "09:00" },
    arrive: { place: { name: "Port B", place_id: "b" }, date: "2026-11-08", time: "10:00" },
    confirmationNumber: "CN1",
  }) as unknown as Block;

describe("transit block formatting", () => {
  it("renders ferry, bus, train with an icon and route", () => {
    for (const [type, icon] of [
      ["ferry", "⛴"],
      ["bus", "🚌"],
      ["train", "🚆"],
    ] as const) {
      const line = formatBlockLine(mkTransit(type), "concise")!;
      expect(line).toContain(icon);
      expect(line).toContain("Acme Line");
      expect(line).toContain("Port A");
      expect(line).toContain("Port B");
    }
  });

  it("includes the transit block's note text", () => {
    const withNote = {
      ...(mkTransit("bus") as object),
      text: { ops: [{ insert: "Be at stop H2 by 9:20. E-ticket emailed.\n" }] },
    } as unknown as Block;
    expect(formatBlockLine(withNote, "concise")).toContain("📝 Be at stop H2 by 9:20.");
    expect(formatBlockLine(withNote, "detailed")).toContain(
      "📝 Be at stop H2 by 9:20. E-ticket emailed.",
    );
    expect(formatBlockLine(mkTransit("bus"), "detailed")).not.toContain("📝");
  });

  it("renders a rentalCar with pickup/dropoff", () => {
    const rental = {
      id: 2,
      type: "rentalCar",
      pickUp: { date: "2026-11-01", time: "10:00", place: { name: "Europcar CUN", place_id: "c" } },
      dropOff: {
        date: "2026-11-08",
        time: "13:00",
        place: { name: "Europcar PDC", place_id: "d" },
      },
      confirmationNumber: "R9",
    } as unknown as Block;
    const line = formatBlockLine(rental, "detailed")!;
    expect(line).toContain("🚗");
    expect(line).toContain("Europcar CUN");
    expect(line).toContain("Europcar PDC");
    expect(line).toContain("R9");
  });
});

describe("note formatting", () => {
  const place = {
    id: 1,
    type: "place",
    place: { name: "Col des Posettes", place_id: "p" },
    text: {
      ops: [
        { insert: "Option A", attributes: { bold: true } },
        { insert: "\nGPX: " },
        { insert: "komoot.com", attributes: { link: "https://www.komoot.com/smarttour/1" } },
        { insert: "\n" },
      ],
    },
  } as unknown as Block;

  it("detailed format renders bold and links as Markdown and keeps line breaks", () => {
    const line = formatBlockLine(place, "detailed")!;
    expect(line).toContain(
      "📝 **Option A**\n      GPX: [komoot.com](https://www.komoot.com/smarttour/1)",
    );
  });

  it("concise format keeps the Markdown on one line", () => {
    const line = formatBlockLine(place, "concise")!;
    expect(line).toContain("📝 **Option A** GPX: [komoot.com](https://www.komoot.com/smarttour/1)");
  });
});
