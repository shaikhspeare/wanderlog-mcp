import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { formatTrip } from "../../src/formatters/trip-summary.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { buildSectionObject, resolveListRef } from "../../src/tools/shared.ts";
import { isPlaceBlock, type TripPlan } from "../../src/types.ts";
import { checklistTrip } from "../fixtures/checklist-trip.ts";

function tripWithLists(...headings: string[]): TripPlan {
  const trip = structuredClone(checklistTrip);
  for (const heading of headings) trip.itinerary.sections.push(buildSectionObject(heading));
  return trip;
}

function makeFakeContext(trip: TripPlan) {
  const submittedOps: Json0Op[][] = [];
  const entry = { snapshot: structuredClone(trip), version: 1, geos: [] };
  const ctx = {
    userId: 3656632,
    rest: {
      searchPlacesAutocomplete: async () => {
        throw new Error("not expected");
      },
      getPlaceDetails: async (placeId: string) => ({ name: "Satan's Coffee", place_id: placeId }),
      getPlacePhotos: async () => [],
    },
    pool: {
      get: () => ({
        isSubscribed: true,
        version: 1,
        async submit(ops: Json0Op[]) {
          submittedOps.push(ops);
        },
      }),
    },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, entry, submittedOps };
}

function placeNamesIn(trip: TripPlan, heading: string): string[] {
  const section = trip.itinerary.sections.find((s) => s.heading === heading);
  return (section?.blocks ?? []).filter(isPlaceBlock).map((b) => b.place.name);
}

describe("resolveListRef", () => {
  const trip = tripWithLists("Food & Drink", "Coffee Shops", "Day Trips");

  it.each([
    ["Food & Drink", "Food & Drink"],
    ["food and drink", "Food & Drink"],
    ["FOOD-DRINK", "Food & Drink"],
    ["coffee", "Coffee Shops"],
    ["day trip", "Day Trips"],
    ["places", "Places to visit"],
  ])("resolves %s to %s", (ref, heading) => {
    const result = resolveListRef(trip, ref);
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") {
      expect(result.match.section.heading).toBe(heading);
    }
  });

  it("never guesses between several partial matches", () => {
    const result = resolveListRef(tripWithLists("Coffee Shops", "Coffee Roasters"), "coffee");
    expect(result.kind).toBe("ambiguous");
  });

  it("ignores very short partial refs", () => {
    expect(resolveListRef(trip, "co").kind).toBe("none");
  });

  it("does not fuzzy-match dated days", () => {
    expect(resolveListRef(trip, "arrival").kind).toBe("none");
  });
});

describe("resolveListRef never rejects a recognisable list", () => {
  const headings = [
    "Food & Drink",
    "Coffee Shops",
    "Coffee Roasters",
    "Coffee",
    "Cafés",
    "Rooftop Bars",
    "Rooftop Bars and Restaurants",
    "Museums",
    "Day Trips",
    "Kid-Friendly",
    "Late Night Eats",
    "Mom's Picks",
    "Arrival day",
    "Hotels to consider",
    "Bakeries",
  ];
  const trip = tripWithLists(...headings);

  function variants(heading: string): string[] {
    const lower = heading.toLowerCase();
    const out = new Set([
      heading,
      lower,
      heading.toUpperCase(),
      `  ${heading}  `,
      lower.replace(/&/g, "and"),
      lower.replace(/ and /g, " & "),
      lower.replace(/-/g, " "),
      lower.replace(/'/g, ""),
      lower.normalize("NFD").replace(/\p{M}+/gu, ""),
      `my ${lower} list`,
      `the ${lower}`,
      lower.replace(/ies\b/g, "y").replace(/([^s])s\b/g, "$1"),
    ]);
    return [...out];
  }

  for (const heading of headings) {
    for (const ref of variants(heading)) {
      it(`"${ref}" → "${heading}"`, () => {
        const result = resolveListRef(trip, ref);
        expect(result.kind).toBe("unique");
        if (result.kind === "unique") expect(result.match.section.heading).toBe(heading);
      });
    }
  }

  it("prefers a list over a dated day with the same heading", () => {
    const result = resolveListRef(trip, "Arrival day");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") expect(result.match.section.mode).toBe("placeList");
  });

  it("picks the closest partial match instead of rejecting", () => {
    const result = resolveListRef(trip, "rooftop");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") expect(result.match.section.heading).toBe("Rooftop Bars");
  });

  it("matches word order and prefixes", () => {
    const result = resolveListRef(trip, "late eats");
    expect(result.kind).toBe("unique");
    if (result.kind === "unique") expect(result.match.section.heading).toBe("Late Night Eats");
  });

  it("only reports ambiguity for genuinely indistinguishable lists", () => {
    const dupes = tripWithLists("Coffee Shops", "Coffee Roasters");
    expect(resolveListRef(dupes, "coffee").kind).toBe("ambiguous");
    expect(resolveListRef(tripWithLists("Bars", "Bars"), "bars").kind).toBe("ambiguous");
  });

  it("does not match unrelated names", () => {
    expect(resolveListRef(trip, "nightclubs").kind).toBe("none");
    expect(resolveListRef(trip, "").kind).toBe("none");
    expect(resolveListRef(trip, "!!!").kind).toBe("none");
  });

  it("skips partial matches when the caller would create a list instead", () => {
    const small = tripWithLists("Coffee Roasters");
    expect(resolveListRef(small, "coffee", { allowPartial: false }).kind).toBe("none");
    expect(resolveListRef(small, "coffee roaster", { allowPartial: false }).kind).toBe("unique");
  });
});

describe("addPlace into custom lists", () => {
  it("adds to a list matched loosely and reports its real heading", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists("Coffee Shops"));
    const result = await addPlace(ctx, { trip_key: "T", place_id: "x", section: "coffee" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('list "Coffee Shops"');
    expect(placeNamesIn(entry.snapshot, "Coffee Shops")).toEqual(["Satan's Coffee"]);
  });

  it("lists available lists when the target is missing", async () => {
    const { ctx, submittedOps } = makeFakeContext(tripWithLists("Food & Drink"));
    const result = await addPlace(ctx, { trip_key: "T", place_id: "x", section: "Bars" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"Food & Drink"');
    expect(result.content[0]!.text).toContain("create_list_if_missing");
    expect(submittedOps).toHaveLength(0);
  });

  it("reports ambiguity instead of 'not found'", async () => {
    const { ctx, submittedOps } = makeFakeContext(tripWithLists("Coffee Shops", "Coffee Roasters"));
    const result = await addPlace(ctx, { trip_key: "T", place_id: "x", section: "coffee" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("matches several lists");
    expect(submittedOps).toHaveLength(0);
  });

  it("creates the list on the fly when asked", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists());
    const result = await addPlace(ctx, {
      trip_key: "T",
      place_id: "x",
      section: "Coffee",
      create_list_if_missing: true,
      note: "Get the cortado",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('new list "Coffee"');
    const last = entry.snapshot.itinerary.sections.at(-1)!;
    expect(last.heading).toBe("Coffee");
    expect(placeNamesIn(entry.snapshot, "Coffee")).toEqual(["Satan's Coffee"]);
  });

  it("creates a new list instead of redirecting into a partial match", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists("Coffee Roasters"));
    const result = await addPlace(ctx, {
      trip_key: "T",
      place_id: "x",
      section: "Coffee",
      create_list_if_missing: true,
    });

    expect(result.isError).toBeUndefined();
    expect(placeNamesIn(entry.snapshot, "Coffee")).toEqual(["Satan's Coffee"]);
    expect(placeNamesIn(entry.snapshot, "Coffee Roasters")).toEqual([]);
  });

  it("reuses an equivalent list instead of creating a duplicate", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists("Coffee Shops"));
    await addPlace(ctx, {
      trip_key: "T",
      place_id: "x",
      section: "coffee shop",
      create_list_if_missing: true,
    });

    expect(entry.snapshot.itinerary.sections.filter((s) => /coffee/i.test(s.heading))).toHaveLength(
      1,
    );
    expect(placeNamesIn(entry.snapshot, "Coffee Shops")).toEqual(["Satan's Coffee"]);
  });

  it("adds to a list that shares its name with a day", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists("Arrival day"));
    const result = await addPlace(ctx, { trip_key: "T", place_id: "x", section: "Arrival day" });

    expect(result.isError).toBeUndefined();
    const list = entry.snapshot.itinerary.sections.find(
      (s) => s.heading === "Arrival day" && s.mode === "placeList",
    )!;
    expect(list.blocks.filter(isPlaceBlock).map((b) => b.place.name)).toEqual(["Satan's Coffee"]);
  });

  it("can add to a day and a list in one call", async () => {
    const { ctx, entry } = makeFakeContext(tripWithLists("Coffee Shops"));
    const result = await addPlace(ctx, {
      trip_key: "T",
      place_id: "x",
      day: "day 1",
      section: "coffee shops",
    });

    expect(result.isError).toBeUndefined();
    expect(placeNamesIn(entry.snapshot, "Coffee Shops")).toEqual(["Satan's Coffee"]);
    expect(placeNamesIn(entry.snapshot, "Arrival day")).toContain("Satan's Coffee");
  });
});

describe("formatTrip with empty lists", () => {
  it("shows named empty lists so they can be targeted", () => {
    const text = formatTrip(tripWithLists("Coffee Shops"), "concise");
    expect(text).toContain("Coffee Shops\n  (empty list)");
  });
});
