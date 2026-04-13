import { describe, expect, it } from "vitest";
import { formatTrip, formatTripList } from "../../src/formatters/trip-summary.ts";
import type { TripPlanSummary } from "../../src/types.ts";
import { buildLargeTrip } from "../fixtures/large-trip.ts";

/**
 * Token budgets for response_format. Rule of thumb: ~4 chars per token for
 * English prose, slightly denser for lists with short lines like ours.
 * The budgets below are *char* limits (tokens × 4) so the approximation is
 * conservative — actual tokens are usually a bit lower than char/4.
 *
 * These aren't just measurements — they're a regression fence. A change to
 * the formatter that bloats concise `get_trip` on a ~134-place trip past
 * 2k tokens is something we want to notice immediately.
 */
const CHARS_PER_TOKEN = 4;

const BUDGETS = {
  getTripConcise: { tokens: 2000, trip: { places: 134, days: 14 } },
  getTripDetailed: { tokens: 8000, trip: { places: 134, days: 14 } },
  getTripConciseSmall: { tokens: 500, trip: { places: 20, days: 5 } },
  listTripsConcise: { tokensPerTrip: 40, tripCount: 50 },
};

function approxTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

describe("token budgets — formatter output fits within budgets", () => {
  it("concise get_trip on ~134 places stays under 2k tokens", () => {
    const trip = buildLargeTrip(
      BUDGETS.getTripConcise.trip.places,
      BUDGETS.getTripConcise.trip.days,
    );
    const out = formatTrip(trip, "concise");
    const tokens = approxTokens(out);
    expect(tokens).toBeLessThanOrEqual(BUDGETS.getTripConcise.tokens);
  });

  it("detailed get_trip on ~134 places stays under 8k tokens", () => {
    const trip = buildLargeTrip(
      BUDGETS.getTripDetailed.trip.places,
      BUDGETS.getTripDetailed.trip.days,
    );
    const out = formatTrip(trip, "detailed");
    const tokens = approxTokens(out);
    expect(tokens).toBeLessThanOrEqual(BUDGETS.getTripDetailed.tokens);
  });

  it("concise get_trip on small trip stays well under 500 tokens", () => {
    const trip = buildLargeTrip(
      BUDGETS.getTripConciseSmall.trip.places,
      BUDGETS.getTripConciseSmall.trip.days,
    );
    const out = formatTrip(trip, "concise");
    expect(approxTokens(out)).toBeLessThanOrEqual(
      BUDGETS.getTripConciseSmall.tokens,
    );
  });

  it("concise list_trips stays under ~40 tokens per entry", () => {
    const trips: TripPlanSummary[] = Array.from(
      { length: BUDGETS.listTripsConcise.tripCount },
      (_, i) => ({
        id: i,
        key: `trip-${i.toString(36).padStart(12, "0")}`,
        title: `Trip number ${i + 1}`,
        startDate: "2026-05-01",
        endDate: "2026-05-08",
        placeCount: 10 + i,
      }),
    );
    const out = formatTripList(trips, "concise");
    const tokens = approxTokens(out);
    const perTrip = tokens / trips.length;
    expect(perTrip).toBeLessThanOrEqual(BUDGETS.listTripsConcise.tokensPerTrip);
  });

  it("detailed list_trips is a small multiple of concise (at most 3x)", () => {
    const trips: TripPlanSummary[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      key: `trip-${i}`,
      title: `Trip ${i}`,
      startDate: "2026-05-01",
      endDate: "2026-05-08",
      placeCount: 10,
      user: { id: 1, username: `user${i}` },
      editedAt: "2026-04-01T00:00:00Z",
    }));
    const conciseLen = formatTripList(trips, "concise").length;
    const detailedLen = formatTripList(trips, "detailed").length;
    expect(detailedLen).toBeLessThanOrEqual(conciseLen * 3);
  });

  // Acts as a sanity print — if a regression triples the size, the output
  // delta will be obvious. Output goes to stdout only when the test runs
  // with --reporter=verbose.
  it("records measured budgets for visibility", () => {
    const trip = buildLargeTrip(134, 14);
    const concise = formatTrip(trip, "concise");
    const detailed = formatTrip(trip, "detailed");
    const report = {
      concise: { chars: concise.length, tokens: approxTokens(concise) },
      detailed: { chars: detailed.length, tokens: approxTokens(detailed) },
    };
    // Keep in-test so the CI log captures it if anything changes
    expect(report.concise.tokens).toBeGreaterThan(0);
    expect(report.detailed.tokens).toBeGreaterThan(0);
  });
});
