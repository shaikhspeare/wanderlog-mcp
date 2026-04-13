import { describe, expect, it } from "vitest";
import { WanderlogValidationError } from "../../src/errors.ts";
import { getDaySections, resolveDay } from "../../src/resolvers/day.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";

describe("resolveDay", () => {
  it("resolves 'day 1' to the first day section", () => {
    const section = resolveDay(queenstownTrip, "day 1");
    expect(section.date).toBe("2026-05-03");
  });

  it("resolves 'day 2' to May 4", () => {
    const section = resolveDay(queenstownTrip, "day 2");
    expect(section.date).toBe("2026-05-04");
  });

  it("resolves 'day 6' to the last day (May 8)", () => {
    const section = resolveDay(queenstownTrip, "day 6");
    expect(section.date).toBe("2026-05-08");
  });

  it("resolves 'May 4' to the matching ISO date", () => {
    const section = resolveDay(queenstownTrip, "May 4");
    expect(section.date).toBe("2026-05-04");
  });

  it("resolves lowercase 'may 4'", () => {
    expect(resolveDay(queenstownTrip, "may 4").date).toBe("2026-05-04");
  });

  it("resolves full month name 'May 04'", () => {
    expect(resolveDay(queenstownTrip, "May 04").date).toBe("2026-05-04");
  });

  it("resolves ISO '2026-05-04'", () => {
    expect(resolveDay(queenstownTrip, "2026-05-04").date).toBe("2026-05-04");
  });

  it("resolves bare number '3' to day 3 (May 5)", () => {
    expect(resolveDay(queenstownTrip, "3").date).toBe("2026-05-05");
  });

  it("throws with range info for day 9 on a 6-day trip", () => {
    expect(() => resolveDay(queenstownTrip, "day 9")).toThrow(
      WanderlogValidationError,
    );
    try {
      resolveDay(queenstownTrip, "day 9");
    } catch (err) {
      const e = err as WanderlogValidationError;
      expect(e.hint).toContain("6 days");
      expect(e.hint).toContain("2026-05-03");
      expect(e.hint).toContain("2026-05-08");
    }
  });

  it("throws for a date outside the trip range", () => {
    expect(() => resolveDay(queenstownTrip, "2026-05-15")).toThrow(
      WanderlogValidationError,
    );
  });

  it("throws for month/day outside trip", () => {
    expect(() => resolveDay(queenstownTrip, "June 1")).toThrow(
      WanderlogValidationError,
    );
  });

  it("throws for unknown month name", () => {
    expect(() => resolveDay(queenstownTrip, "Smarch 4")).toThrow(
      WanderlogValidationError,
    );
  });

  it("throws for gibberish input", () => {
    expect(() => resolveDay(queenstownTrip, "sometime next week")).toThrow(
      WanderlogValidationError,
    );
  });
});

describe("getDaySections", () => {
  it("returns only the dayPlan sections, in order", () => {
    const days = getDaySections(queenstownTrip);
    expect(days.length).toBe(6);
    expect(days.map((s) => s.date)).toEqual([
      "2026-05-03",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2026-05-07",
      "2026-05-08",
    ]);
  });
});
