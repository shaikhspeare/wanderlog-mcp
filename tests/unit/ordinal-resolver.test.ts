import { describe, expect, it } from "vitest";
import { parseOrdinal, resolvePlaceRef } from "../../src/resolvers/place-ref.ts";
import { duplicatedTrip } from "../fixtures/duplicated-trip.ts";
import { isPlaceBlock } from "../../src/types.ts";

describe("parseOrdinal", () => {
  it("parses '1st X' / '2nd X' / '3rd X'", () => {
    expect(parseOrdinal("1st queenstown gardens")).toEqual({
      position: 1,
      rest: "queenstown gardens",
    });
    expect(parseOrdinal("2nd queenstown gardens")).toEqual({
      position: 2,
      rest: "queenstown gardens",
    });
    expect(parseOrdinal("3rd queenstown gardens")).toEqual({
      position: 3,
      rest: "queenstown gardens",
    });
  });

  it("parses 'Nth X' for N >= 4", () => {
    expect(parseOrdinal("4th x")).toEqual({ position: 4, rest: "x" });
    expect(parseOrdinal("10th x")).toEqual({ position: 10, rest: "x" });
    expect(parseOrdinal("21st x")).toEqual({ position: 21, rest: "x" });
  });

  it("parses word ordinals", () => {
    expect(parseOrdinal("first queenstown gardens")).toEqual({
      position: 1,
      rest: "queenstown gardens",
    });
    expect(parseOrdinal("second gardens")).toEqual({
      position: 2,
      rest: "gardens",
    });
    expect(parseOrdinal("tenth hotel")).toEqual({ position: 10, rest: "hotel" });
  });

  it("parses 'last X'", () => {
    expect(parseOrdinal("last queenstown gardens")).toEqual({
      position: "last",
      rest: "queenstown gardens",
    });
  });

  it("returns null for refs with no ordinal prefix", () => {
    expect(parseOrdinal("queenstown gardens")).toBeNull();
    expect(parseOrdinal("the hotel")).toBeNull();
    expect(parseOrdinal("sensō-ji")).toBeNull();
  });

  it("doesn't false-match words that start with 'first-letters'", () => {
    // "firstly reminder" shouldn't parse as "first" + "ly reminder" because
    // "firstly" is one word. parseOrdinal only matches when the word boundary
    // is exactly after the ordinal.
    expect(parseOrdinal("firstly")).toBeNull();
  });

  it("returns null for 'last' with no remainder", () => {
    expect(parseOrdinal("last")).toBeNull();
    expect(parseOrdinal("last ")).toBeNull();
  });
});

describe("resolvePlaceRef ordinal disambiguation", () => {
  it("'Queenstown Gardens' is ambiguous in the duplicated fixture", () => {
    const result = resolvePlaceRef(duplicatedTrip, "Queenstown Gardens");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.length).toBe(3); // 1 in Places-to-visit + 2 on May 4
    }
  });

  it("'1st Queenstown Gardens' picks the first candidate (Places to visit)", () => {
    const result = resolvePlaceRef(duplicatedTrip, "1st Queenstown Gardens");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.sectionIndex).toBe(1); // Places-to-visit section
      expect(result.match.blockIndex).toBe(0);
    }
  });

  it("'2nd Queenstown Gardens' picks the second (day 2026-05-04, block 0)", () => {
    const result = resolvePlaceRef(duplicatedTrip, "2nd Queenstown Gardens");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(0);
    }
  });

  it("'3rd Queenstown Gardens' picks the third (day 2026-05-04, block 1)", () => {
    const result = resolvePlaceRef(duplicatedTrip, "3rd Queenstown Gardens");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(1);
    }
  });

  it("'last Queenstown Gardens' picks the third (last) candidate", () => {
    const result = resolvePlaceRef(duplicatedTrip, "last Queenstown Gardens");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(1);
    }
  });

  it("'first' and '1st' resolve identically", () => {
    const a = resolvePlaceRef(duplicatedTrip, "first Queenstown Gardens");
    const b = resolvePlaceRef(duplicatedTrip, "1st Queenstown Gardens");
    expect(a.kind).toBe("unique");
    expect(b.kind).toBe("unique");
    if (a.kind === "unique" && b.kind === "unique") {
      expect(a.match.sectionIndex).toBe(b.match.sectionIndex);
      expect(a.match.blockIndex).toBe(b.match.blockIndex);
    }
  });

  it("'5th Queenstown Gardens' (out of range) returns none", () => {
    const result = resolvePlaceRef(duplicatedTrip, "5th Queenstown Gardens");
    expect(result.kind).toBe("none");
  });

  it("'1st Queenstown Gardens on May 4' narrows by day before picking", () => {
    const result = resolvePlaceRef(duplicatedTrip, "1st Queenstown Gardens on May 4");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(0);
    }
  });

  it("'2nd Queenstown Gardens on May 4' picks the second one on day 4", () => {
    const result = resolvePlaceRef(duplicatedTrip, "2nd Queenstown Gardens on May 4");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(1);
    }
  });

  it("'last Queenstown Gardens on May 4' picks the last on day 4", () => {
    const result = resolvePlaceRef(duplicatedTrip, "last Queenstown Gardens on May 4");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.date).toBe("2026-05-04");
      expect(result.match.blockIndex).toBe(1);
    }
  });

  it("'3rd Queenstown Gardens on May 4' (only 2 on that day) returns none", () => {
    const result = resolvePlaceRef(duplicatedTrip, "3rd Queenstown Gardens on May 4");
    expect(result.kind).toBe("none");
  });

  it("'last Lake Hayes Estate' picks the 2nd of 2 duplicate entries on May 7", () => {
    const result = resolvePlaceRef(duplicatedTrip, "last Lake Hayes Estate");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique" && isPlaceBlock(result.match.block)) {
      expect(result.match.section.date).toBe("2026-05-07");
      expect(result.match.blockIndex).toBe(1);
    }
  });

  it("'1st Walter Peak' (substring match with ordinal)", () => {
    const result = resolvePlaceRef(duplicatedTrip, "1st Walter Peak");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique" && isPlaceBlock(result.match.block)) {
      expect(result.match.blockIndex).toBe(0);
      expect(result.match.section.date).toBe("2026-05-05");
    }
  });

  it("ordinal on a non-existent name returns none", () => {
    const result = resolvePlaceRef(duplicatedTrip, "1st nonexistent place xyz");
    expect(result.kind).toBe("none");
  });
});
