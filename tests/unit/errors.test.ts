import { describe, expect, it } from "vitest";
import {
  WanderlogAuthError,
  WanderlogError,
  WanderlogNetworkError,
  WanderlogNotFoundError,
  WanderlogValidationError,
} from "../../src/errors.ts";
import { resolveDay } from "../../src/resolvers/day.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";

/**
 * Structured-error contract: `toUserMessage()` returns a single string the
 * agent can render, with a clear "Next steps:" block when follow-ups exist.
 * These tests pin the contract so future error sites keep populating it.
 */
describe("WanderlogError — options-form constructor", () => {
  it("accepts a bare hint string (backwards compatible)", () => {
    const e = new WanderlogError("boom", "test", "try again");
    expect(e.hint).toBe("try again");
    expect(e.followUps).toBeUndefined();
    const msg = e.toUserMessage();
    expect(msg).toContain("boom");
    expect(msg).toContain("try again");
    expect(msg).not.toContain("Next steps:");
  });

  it("accepts an options object with hint + followUps", () => {
    const e = new WanderlogError("boom", "test", {
      hint: "try again",
      followUps: ["call foo", "then call bar"],
    });
    expect(e.hint).toBe("try again");
    expect(e.followUps).toEqual(["call foo", "then call bar"]);
    const msg = e.toUserMessage();
    expect(msg).toContain("boom");
    expect(msg).toContain("try again");
    expect(msg).toContain("Next steps:");
    expect(msg).toContain("• call foo");
    expect(msg).toContain("• then call bar");
  });

  it("renders without hint when only followUps are provided", () => {
    const e = new WanderlogError("boom", "test", {
      followUps: ["call foo"],
    });
    const msg = e.toUserMessage();
    expect(msg).toContain("boom");
    expect(msg).toContain("Next steps:");
    expect(msg).toContain("• call foo");
  });
});

describe("WanderlogAuthError follow-ups", () => {
  it("suggests refreshing the cookie", () => {
    const msg = new WanderlogAuthError().toUserMessage();
    expect(msg).toContain("Next steps:");
    expect(msg).toMatch(/WANDERLOG_COOKIE/);
  });
});

describe("WanderlogNotFoundError follow-ups", () => {
  it("Trip not-found suggests wanderlog_list_trips", () => {
    const msg = new WanderlogNotFoundError("Trip", "abc").toUserMessage();
    expect(msg).toContain("wanderlog_list_trips");
    expect(msg).toContain("Next steps:");
  });

  it("Place not-found suggests wanderlog_search_places", () => {
    const msg = new WanderlogNotFoundError("Place", "xyz").toUserMessage();
    expect(msg).toContain("wanderlog_search_places");
    expect(msg).toContain("Next steps:");
  });

  it("unknown resource type has no follow-ups and does not crash", () => {
    const e = new WanderlogNotFoundError("Widget", "abc");
    expect(e.followUps).toBeUndefined();
    const msg = e.toUserMessage();
    expect(msg).toContain("Widget");
    expect(msg).not.toContain("Next steps:");
  });
});

describe("WanderlogNetworkError follow-ups", () => {
  it("suggests retrying the call", () => {
    const msg = new WanderlogNetworkError("ECONNRESET").toUserMessage();
    expect(msg).toContain("Next steps:");
    expect(msg).toMatch(/Retry/);
  });
});

describe("day resolver — out-of-range errors include follow-up", () => {
  it("points the agent back at wanderlog_get_trip", () => {
    try {
      resolveDay(queenstownTrip, "day 99");
      throw new Error("expected throw");
    } catch (err) {
      const e = err as WanderlogValidationError;
      expect(e).toBeInstanceOf(WanderlogValidationError);
      const msg = e.toUserMessage();
      expect(msg).toContain("wanderlog_get_trip");
      expect(msg).toContain(queenstownTrip.key);
      expect(msg).toContain("Next steps:");
    }
  });
});
