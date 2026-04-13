import { describe, expect, it } from "vitest";
import { WanderlogValidationError } from "../../src/errors.ts";
import { applyOp } from "../../src/ot/apply.ts";
import {
  buildEmptyDaySection,
  buildUpdateDatesOps,
  diffDays,
  enumerateDates,
  findDayInsertIndex,
} from "../../src/tools/update-trip-dates.ts";
import type { Section, TripPlan } from "../../src/types.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";

describe("enumerateDates", () => {
  it("handles a single-day range", () => {
    expect(enumerateDates("2026-05-03", "2026-05-03")).toEqual(["2026-05-03"]);
  });

  it("enumerates a 6-day range inclusively", () => {
    expect(enumerateDates("2026-05-03", "2026-05-08")).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
    ]);
  });

  it("handles month boundaries", () => {
    expect(enumerateDates("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("handles leap year february", () => {
    const range = enumerateDates("2024-02-28", "2024-03-01");
    expect(range).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
  });

  it("returns empty when end precedes start", () => {
    expect(enumerateDates("2026-05-08", "2026-05-03")).toEqual([]);
  });
});

describe("findDayInsertIndex", () => {
  const baseSections: Section[] = [
    { id: 1, type: "textOnly", mode: "placeList", heading: "Notes", date: null, blocks: [] },
    { id: 2, type: "normal", mode: "placeList", heading: "Places to visit", date: null, blocks: [] },
    { id: 3, type: "normal", mode: "dayPlan", heading: "", date: "2026-05-03", blocks: [] },
    { id: 4, type: "normal", mode: "dayPlan", heading: "", date: "2026-05-04", blocks: [] },
    { id: 5, type: "normal", mode: "dayPlan", heading: "", date: "2026-05-05", blocks: [] },
  ];

  it("inserts before the first day section for earlier dates", () => {
    expect(findDayInsertIndex(baseSections, "2026-05-01")).toBe(2);
  });

  it("inserts between two day sections", () => {
    expect(findDayInsertIndex(baseSections, "2026-05-035")).toBe(3);
  });

  it("inserts at the end for later dates", () => {
    expect(findDayInsertIndex(baseSections, "2026-05-10")).toBe(5);
  });

  it("appends to an all-non-dayPlan section list", () => {
    const meta = baseSections.slice(0, 2);
    expect(findDayInsertIndex(meta, "2026-05-01")).toBe(2);
  });
});

describe("diffDays", () => {
  it("reports pure extension", () => {
    const diff = diffDays(queenstownTrip, "2026-05-03", "2026-05-10");
    expect(diff.toRemove).toHaveLength(0);
    expect(diff.toAdd).toEqual(["2026-05-09", "2026-05-10"]);
  });

  it("reports pure shortening", () => {
    const diff = diffDays(queenstownTrip, "2026-05-03", "2026-05-06");
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove.map((r) => r.date).sort()).toEqual([
      "2026-05-07",
      "2026-05-08",
    ]);
  });

  it("reports a shift (both ends move)", () => {
    const diff = diffDays(queenstownTrip, "2026-05-05", "2026-05-10");
    expect(diff.toRemove.map((r) => r.date).sort()).toEqual([
      "2026-05-03",
      "2026-05-04",
    ]);
    expect(diff.toAdd.sort()).toEqual(["2026-05-09", "2026-05-10"]);
  });

  it("reports no-op when dates unchanged", () => {
    const diff = diffDays(queenstownTrip, "2026-05-03", "2026-05-08");
    expect(diff.toAdd).toHaveLength(0);
    expect(diff.toRemove).toHaveLength(0);
  });
});

describe("buildUpdateDatesOps", () => {
  it("throws when end_date is before start_date", () => {
    expect(() =>
      buildUpdateDatesOps(queenstownTrip, "2026-05-10", "2026-05-05", false),
    ).toThrow(WanderlogValidationError);
  });

  it("returns an empty op list when nothing changes", () => {
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-05-03", "2026-05-08", false);
    expect(ops).toEqual([]);
  });

  it("pure extension: inserts new day sections and updates end/days", () => {
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-05-03", "2026-05-10", false);
    const liOps = ops.filter((o) => "li" in o);
    expect(liOps).toHaveLength(2);
    // Last two ops should be endDate + days od/oi
    const endOp = ops.find((o) => Array.isArray(o.p) && o.p[0] === "endDate");
    expect(endOp).toMatchObject({ od: "2026-05-08", oi: "2026-05-10" });
    const daysOp = ops.find((o) => Array.isArray(o.p) && o.p[0] === "days");
    expect(daysOp).toMatchObject({ od: 6, oi: 8 });
  });

  it("pure shortening on empty days: emits ld ops for removed sections", () => {
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-05-03", "2026-05-06", false);
    const ldOps = ops.filter((o) => "ld" in o);
    expect(ldOps).toHaveLength(2);
  });

  it("refuses destructive shortening without force", () => {
    const tripWithContent: TripPlan = structuredClone(queenstownTrip);
    // Add a place to the May 7 section (index 8)
    const day7 = tripWithContent.itinerary.sections[8]!;
    day7.blocks = [
      {
        id: 999,
        type: "place",
        place: {
          name: "Some Place",
          place_id: "ChIJfake",
          geometry: { location: { lat: 0, lng: 0 } },
        },
      },
    ];

    expect(() =>
      buildUpdateDatesOps(tripWithContent, "2026-05-03", "2026-05-06", false),
    ).toThrow(WanderlogValidationError);

    try {
      buildUpdateDatesOps(tripWithContent, "2026-05-03", "2026-05-06", false);
    } catch (err) {
      const e = err as WanderlogValidationError;
      expect(e.message).toContain("2026-05-07");
      expect(e.hint).toContain("force");
    }
  });

  it("allows destructive shortening with force: true", () => {
    const tripWithContent: TripPlan = structuredClone(queenstownTrip);
    const day7 = tripWithContent.itinerary.sections[8]!;
    day7.blocks = [
      {
        id: 999,
        type: "place",
        place: { name: "X", place_id: "p" },
      },
    ];

    const ops = buildUpdateDatesOps(tripWithContent, "2026-05-03", "2026-05-06", true);
    expect(ops.filter((o) => "ld" in o)).toHaveLength(2);
  });

  it("ordered deletions: reverse index order", () => {
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-05-03", "2026-05-05", false);
    const ldOps = ops.filter((o) => "ld" in o);
    expect(ldOps).toHaveLength(3);
    const indices = ldOps.map((o) => (o.p as (string | number)[])[2] as number);
    // Indices must be strictly descending so the second ld doesn't hit a shifted array
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeLessThan(indices[i - 1]!);
    }
  });

  it("round-trips: applying the generated ops produces the expected trip shape", () => {
    // Extension case
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-05-03", "2026-05-10", false);
    const result = applyOp(queenstownTrip, ops);

    expect(result.startDate).toBe("2026-05-03");
    expect(result.endDate).toBe("2026-05-10");
    expect(result.days).toBe(8);

    const dayDates = result.itinerary.sections
      .filter((s) => s.mode === "dayPlan" && s.date)
      .map((s) => s.date);
    expect(dayDates).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
      "2026-05-09",
      "2026-05-10",
    ]);

    // Original non-day sections still present
    const headings = result.itinerary.sections
      .filter((s) => s.mode !== "dayPlan")
      .map((s) => s.heading);
    expect(headings).toContain("Notes");
    expect(headings).toContain("Hotels and lodging");
    expect(headings).toContain("Places to visit");
  });

  it("round-trips: shortening preserves content on surviving days", () => {
    const tripWithContent: TripPlan = structuredClone(queenstownTrip);
    const day4 = tripWithContent.itinerary.sections[5]!; // May 4
    day4.blocks = [
      {
        id: 42,
        type: "place",
        place: { name: "Survivor", place_id: "p1" },
      },
    ];

    const ops = buildUpdateDatesOps(tripWithContent, "2026-05-04", "2026-05-06", false);
    const result = applyOp(tripWithContent, ops);

    expect(result.startDate).toBe("2026-05-04");
    expect(result.endDate).toBe("2026-05-06");
    expect(result.days).toBe(3);

    const dayDates = result.itinerary.sections
      .filter((s) => s.mode === "dayPlan" && s.date)
      .map((s) => s.date);
    expect(dayDates).toEqual(["2026-05-04", "2026-05-05", "2026-05-06"]);

    // Survivor block preserved
    const day4After = result.itinerary.sections.find(
      (s) => s.mode === "dayPlan" && s.date === "2026-05-04",
    );
    expect(day4After?.blocks).toHaveLength(1);
    expect((day4After!.blocks[0] as { place: { name: string } }).place.name).toBe(
      "Survivor",
    );
  });

  it("round-trips: shift (disjoint range) adds and removes correctly", () => {
    const ops = buildUpdateDatesOps(queenstownTrip, "2026-06-01", "2026-06-03", false);
    const result = applyOp(queenstownTrip, ops);

    expect(result.startDate).toBe("2026-06-01");
    expect(result.endDate).toBe("2026-06-03");
    expect(result.days).toBe(3);

    const dayDates = result.itinerary.sections
      .filter((s) => s.mode === "dayPlan" && s.date)
      .map((s) => s.date);
    expect(dayDates).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
});

describe("buildEmptyDaySection", () => {
  it("has the required fields", () => {
    const section = buildEmptyDaySection("2026-05-15");
    expect(section.mode).toBe("dayPlan");
    expect(section.type).toBe("normal");
    expect(section.date).toBe("2026-05-15");
    expect(section.blocks).toEqual([]);
    expect(section.heading).toBe("");
    expect(typeof section.id).toBe("number");
  });
});
