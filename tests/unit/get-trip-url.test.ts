import { describe, expect, it } from "vitest";
import { buildTripUrl, pickKey } from "../../src/tools/get-trip-url.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";
import type { TripPlan } from "../../src/types.ts";

describe("pickKey", () => {
  it("edit mode returns editKey", () => {
    expect(pickKey(queenstownTrip, "edit")).toBe("vzyrsyhgxvonvxcz");
  });

  it("view mode returns viewKey", () => {
    expect(pickKey(queenstownTrip, "view")).toBe("qsqxrlrzov");
  });

  it("suggest mode returns suggestKey", () => {
    expect(pickKey(queenstownTrip, "suggest")).toBe("zztknrxgjxrv");
  });

  it("view mode falls back to editKey when viewKey is missing", () => {
    const trip: TripPlan = { ...queenstownTrip, viewKey: undefined };
    expect(pickKey(trip, "view")).toBe("vzyrsyhgxvonvxcz");
  });

  it("suggest mode falls back to editKey when suggestKey is missing", () => {
    const trip: TripPlan = { ...queenstownTrip, suggestKey: undefined };
    expect(pickKey(trip, "suggest")).toBe("vzyrsyhgxvonvxcz");
  });

  it("falls back to trip.key when neither editKey nor mode-specific key exists", () => {
    const trip: TripPlan = {
      ...queenstownTrip,
      editKey: undefined,
      viewKey: undefined,
      suggestKey: undefined,
    };
    expect(pickKey(trip, "edit")).toBe("vzyrsyhgxvonvxcz");
    expect(pickKey(trip, "view")).toBe("vzyrsyhgxvonvxcz");
  });
});

describe("buildTripUrl", () => {
  it("builds an edit URL with the default base", () => {
    expect(buildTripUrl(queenstownTrip, "edit")).toBe(
      "https://wanderlog.com/plan/vzyrsyhgxvonvxcz",
    );
  });

  it("builds a view URL", () => {
    expect(buildTripUrl(queenstownTrip, "view")).toBe(
      "https://wanderlog.com/plan/qsqxrlrzov",
    );
  });

  it("builds a suggest URL", () => {
    expect(buildTripUrl(queenstownTrip, "suggest")).toBe(
      "https://wanderlog.com/plan/zztknrxgjxrv",
    );
  });

  it("honors a custom base URL", () => {
    expect(
      buildTripUrl(queenstownTrip, "edit", "https://staging.wanderlog.com"),
    ).toBe("https://staging.wanderlog.com/plan/vzyrsyhgxvonvxcz");
  });
});
