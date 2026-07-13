import { describe, expect, it } from "vitest";
import { validateTimeInputs, isValidDate, validateDateRange } from "../../src/tools/shared.ts";
import { annotatePlace } from "../../src/tools/annotate-place.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { updateTripDates } from "../../src/tools/update-trip-dates.ts";
import { WanderlogValidationError } from "../../src/errors.ts";
import type { AppContext } from "../../src/context.ts";

describe("validateTimeInputs", () => {
  it("accepts valid times and ranges", () => {
    expect(() => validateTimeInputs("09:00")).not.toThrow();
    expect(() => validateTimeInputs("00:00")).not.toThrow();
    expect(() => validateTimeInputs("23:59")).not.toThrow();
    expect(() => validateTimeInputs("09:00", "11:30")).not.toThrow();
  });

  it("rejects invalid hours or minutes", () => {
    expect(() => validateTimeInputs("24:00")).toThrow(WanderlogValidationError);
    expect(() => validateTimeInputs("25:00")).toThrow(WanderlogValidationError);
    expect(() => validateTimeInputs("09:60")).toThrow(WanderlogValidationError);
    expect(() => validateTimeInputs("09:99")).toThrow(WanderlogValidationError);
    expect(() => validateTimeInputs("abc:12")).toThrow(WanderlogValidationError);
  });

  it("rejects a non-chronological time range", () => {
    expect(() => validateTimeInputs("11:30", "09:00")).toThrow(WanderlogValidationError);
    expect(() => validateTimeInputs("09:00", "09:00")).toThrow(WanderlogValidationError);
  });

  it("does not range-check when only one bound is given", () => {
    expect(() => validateTimeInputs("11:30")).not.toThrow();
    expect(() => validateTimeInputs(undefined, "09:00")).not.toThrow();
  });
});

describe("validateDateRange", () => {
  it("accepts start before or equal to end", () => {
    expect(() => validateDateRange("2026-05-03", "2026-05-08")).not.toThrow();
    expect(() => validateDateRange("2026-05-03", "2026-05-03")).not.toThrow();
  });

  it("rejects start after end", () => {
    expect(() => validateDateRange("2026-05-10", "2026-05-05")).toThrow(
      WanderlogValidationError,
    );
  });
});

describe("isValidDate", () => {
  it("accepts valid calendar dates", () => {
    expect(isValidDate("2026-05-03")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects invalid calendar dates", () => {
    expect(isValidDate("2026-02-29")).toBe(false); // non-leap year
    expect(isValidDate("2026-04-31")).toBe(false); // april has 30 days
    expect(isValidDate("2026-13-01")).toBe(false); // invalid month
    expect(isValidDate("2026-05-32")).toBe(false); // invalid day
    expect(isValidDate("abc")).toBe(false);
  });
});

describe("addPlace input validation", () => {
  it("returns isError: true on semantically invalid times", async () => {
    const fakeCtx = {} as AppContext;
    const args = {
      trip_key: "tripA",
      place: "Louvre",
      start_time: "25:00",
    };
    const res = await addPlace(fakeCtx, args);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Invalid start_time");
  });

  it("returns isError: true when end_time is not after start_time", async () => {
    const fakeCtx = {} as AppContext;
    const args = {
      trip_key: "tripA",
      place: "Louvre",
      start_time: "11:30",
      end_time: "09:00",
    };
    const res = await addPlace(fakeCtx, args);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("must be after start_time");
  });
});

describe("annotatePlace input validation", () => {
  it("returns isError: true when end_time is not after start_time", async () => {
    const fakeCtx = {} as AppContext;
    const args = {
      trip_key: "tripA",
      place: "Louvre",
      start_time: "09:00",
      end_time: "09:00",
    };
    const res = await annotatePlace(fakeCtx, args);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("must be after start_time");
  });
});

describe("updateTripDates input validation", () => {
  it("returns isError: true on semantically invalid dates", async () => {
    const fakeCtx = {} as AppContext;
    const args = {
      trip_key: "tripA",
      start_date: "2026-02-29", // invalid
      end_date: "2026-03-01",
    };
    const res = await updateTripDates(fakeCtx, args);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Invalid start_date");
  });

  it("returns isError: true when end_date is before start_date", async () => {
    const fakeCtx = {} as AppContext;
    const args = {
      trip_key: "tripA",
      start_date: "2026-05-10",
      end_date: "2026-05-05",
    };
    const res = await updateTripDates(fakeCtx, args);
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("must be on or after start_date");
  });
});
