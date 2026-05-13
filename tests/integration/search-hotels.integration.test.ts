import { describe, expect, it } from "vitest";
import { createContext } from "../../src/context.ts";
import { searchHotels } from "../../src/tools/search-hotels.ts";

const HAS_COOKIE = Boolean(process.env.WANDERLOG_COOKIE);

describe.skipIf(!HAS_COOKIE)("wanderlog_search_hotels (integration)", () => {
  it("returns offers for Bangkok with valid shape", async () => {
    const ctx = createContext();
    // Use ~30 days out to avoid date-too-soon edge cases
    const start = new Date(Date.now() + 30 * 86400e3);
    const end = new Date(Date.now() + 32 * 86400e3);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const res = await searchHotels(ctx, {
      destination: "Bangkok",
      check_in: fmt(start),
      check_out: fmt(end),
      limit: 5,
    });

    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.geo.name).toMatch(/bangkok/i);
    expect(parsed.offers.length).toBeGreaterThan(0);
    expect(parsed.offers.length).toBeLessThanOrEqual(5);

    const first = parsed.offers[0];
    expect(typeof first.name).toBe("string");
    expect(typeof first.url).toBe("string");
    expect(typeof first.price_min).toBe("number");
    expect(typeof first.price_max).toBe("number");
    expect(Array.isArray(first.deals)).toBe(true);
    expect(first.deals.length).toBeGreaterThan(0);

    expect(parsed.available_filters).toBeDefined();
    expect(typeof parsed.total_results).toBe("number");
  }, 30_000);
});
