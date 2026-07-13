import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { WanderlogError, WanderlogNotFoundError } from "../../src/errors.ts";
import { getGuide } from "../../src/tools/get-guide.ts";
import type { TripPlan } from "../../src/types.ts";

function tripFixture(): TripPlan {
  return {
    key: "abc",
    title: "Vietnam by Sea",
    startDate: "2026-06-01",
    endDate: "2026-06-10",
    days: 10,
    placeCount: 25,
    itinerary: {
      sections: [
        {
          heading: "About Vietnam",
          text: { ops: [{ insert: "A long-form travel guide." }] },
          blocks: [],
        },
      ],
      budget: {
        amount: { amount: 0, currencyCode: "USD" },
        expenses: [],
        payments: [],
        simplifyDebt: false,
      },
    },
  } as unknown as TripPlan;
}

function ctxWith(getGuideContent: AppContext["rest"]["getGuideContent"]): AppContext {
  return {
    rest: { getGuideContent } as unknown as AppContext["rest"],
  } as AppContext;
}

describe("getGuide", () => {
  it("renders via formatTrip and returns text content", async () => {
    const ctx = ctxWith(async () => tripFixture());
    const res = await getGuide(ctx, { guide_key: "abc" });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toMatch(/Vietnam by Sea/);
  });

  it("rejects empty guide_key with a validation error", async () => {
    const ctx = ctxWith(async () => tripFixture());
    const res = await getGuide(ctx, { guide_key: "" });
    expect(res.isError).toBe(true);
  });

  it("renders 'Guide not found' on 404", async () => {
    const ctx = ctxWith(async () => {
      throw new WanderlogNotFoundError("Guide", "missing");
    });
    const res = await getGuide(ctx, { guide_key: "missing" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Guide.*not found/i);
    expect(res.content[0]!.text).toMatch(/wanderlog_search_guides/);
  });

  it("surfaces unexpected errors with the 'Unexpected error' prefix", async () => {
    const ctx = ctxWith(async () => {
      throw new Error("network down");
    });
    const res = await getGuide(ctx, { guide_key: "abc" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Unexpected error.*network down/);
  });
});
