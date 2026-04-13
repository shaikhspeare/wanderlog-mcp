import { describe, expect, it } from "vitest";
import { formatTrip, formatBlockLine } from "../../src/formatters/trip-summary.ts";
import { resolveDay } from "../../src/resolvers/day.ts";
import { mixedBlocksTrip } from "../fixtures/mixed-blocks-trip.ts";

describe("formatTrip with mixed block types (regression)", () => {
  it("renders the full trip without throwing", () => {
    expect(() => formatTrip(mixedBlocksTrip, "concise")).not.toThrow();
    expect(() => formatTrip(mixedBlocksTrip, "detailed")).not.toThrow();
  });

  it("concise format includes all block types rendered", () => {
    const out = formatTrip(mixedBlocksTrip, "concise");
    expect(out).toContain("NH 890");
    expect(out).toContain("Sydney");
    expect(out).toContain("Tokyo");
    expect(out).toContain("Odakyu Electric Railway");
    expect(out).toContain("Shinjuku Station");
    expect(out).toContain("Far East Village Hotel");
    expect(out).toContain("Sensō-ji");
    expect(out).toContain("14:00");
  });

  it("concise format renders the inline note text", () => {
    const out = formatTrip(mixedBlocksTrip, "concise");
    expect(out).toContain("Nakamise shopping street");
  });

  it("detailed format includes flight confirmation number", () => {
    const out = formatTrip(mixedBlocksTrip, "detailed");
    expect(out).toContain("ABC123");
    expect(out).toContain("HOTEL123");
  });

  it("gracefully handles an unknown block type without crashing", () => {
    const out = formatTrip(mixedBlocksTrip, "concise");
    expect(out).toContain("unsupported block type");
  });

  it("day filter on day with mixed blocks returns both the place and note", () => {
    const day = resolveDay(mixedBlocksTrip, "day 1");
    const out = formatTrip(mixedBlocksTrip, "concise", day);
    expect(out).toContain("Sensō-ji");
    expect(out).toContain("Nakamise shopping street");
  });

  it("renders the correct section icons", () => {
    const out = formatTrip(mixedBlocksTrip, "concise");
    expect(out).toContain("✈");
    expect(out).toContain("🚆");
    expect(out).toContain("🏨");
    expect(out).toContain("📅");
  });
});

describe("formatBlockLine defensive handling", () => {
  it("returns null for a place block with no place data", () => {
    const result = formatBlockLine(
      { id: 1, type: "place", place: undefined } as any,
      "concise",
    );
    expect(result).toBeNull();
  });

  it("returns null for a place block with empty place.name", () => {
    const result = formatBlockLine(
      { id: 1, type: "place", place: { place_id: "x", name: "" } } as any,
      "concise",
    );
    expect(result).toBeNull();
  });

  it("returns a malformed label for any garbage block", () => {
    const result = formatBlockLine(
      { type: "place", get place() { throw new Error("boom"); } } as any,
      "concise",
    );
    expect(result).toContain("malformed");
  });
});
