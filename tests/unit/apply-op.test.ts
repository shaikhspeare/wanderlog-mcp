import { describe, expect, it } from "vitest";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { WanderlogError } from "../../src/errors.ts";
import { queenstownTrip } from "../fixtures/queenstown-trip.ts";
import { mixedBlocksTrip } from "../fixtures/mixed-blocks-trip.ts";
import type { PlaceBlock, Section, TripPlan } from "../../src/types.ts";

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

describe("applyOp – list insert (li)", () => {
  it("inserts a new place block as the first block of 'Places to visit'", () => {
    const doc = fresh(queenstownTrip);
    const newBlock: PlaceBlock = {
      id: 999,
      type: "place",
      place: {
        name: "Skyline Queenstown",
        place_id: "ChIJ_skyline",
      },
    };
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 2, "blocks", 0], li: newBlock },
    ];
    const next = applyOp(doc, ops);
    const placesSection = next.itinerary.sections[2]!;
    expect(placesSection.blocks).toHaveLength(2);
    expect(placesSection.blocks[0]).toEqual(newBlock);
    // existing block was preserved at index 1
    expect((placesSection.blocks[1] as PlaceBlock).place.name).toBe("Queenstown Gardens");
  });

  it("inserts a brand-new section at sections[1] and shifts subsequent sections right", () => {
    const doc = fresh(queenstownTrip);
    const originalSection1Id = doc.itinerary.sections[1]!.id;
    const originalSection2Id = doc.itinerary.sections[2]!.id;

    const newSection: Section = {
      id: 12345,
      type: "hotels",
      mode: "placeList",
      heading: "Hotels and lodging",
      date: null,
      blocks: [],
    };

    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 1], li: newSection },
    ];
    const next = applyOp(doc, ops);

    expect(next.itinerary.sections).toHaveLength(
      queenstownTrip.itinerary.sections.length + 1,
    );
    expect(next.itinerary.sections[1]!.id).toBe(12345);
    expect(next.itinerary.sections[2]!.id).toBe(originalSection1Id);
    expect(next.itinerary.sections[3]!.id).toBe(originalSection2Id);
  });
});

describe("applyOp – list delete (ld)", () => {
  it("removes a block and leaves neighbors intact", () => {
    const doc = fresh(mixedBlocksTrip);
    const daySection = doc.itinerary.sections[4]!;
    expect(daySection.blocks).toHaveLength(2);
    const placeBlock = daySection.blocks[0]!;

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 4, "blocks", 0],
        ld: placeBlock,
      },
    ];
    const next = applyOp(doc, ops);
    const updatedSection = next.itinerary.sections[4]!;
    expect(updatedSection.blocks).toHaveLength(1);
    expect(updatedSection.blocks[0]!.type).toBe("note");
  });

  it("ld + li together replaces an element in place", () => {
    const doc = fresh(queenstownTrip);
    const original = doc.itinerary.sections[2]!.blocks[0]!;
    const replacement: PlaceBlock = {
      id: 555,
      type: "place",
      place: { name: "Lake Wakatipu", place_id: "ChIJ_lake" },
    };
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 2, "blocks", 0],
        ld: original,
        li: replacement,
      },
    ];
    const next = applyOp(doc, ops);
    expect(next.itinerary.sections[2]!.blocks).toHaveLength(1);
    expect(next.itinerary.sections[2]!.blocks[0]).toEqual(replacement);
  });

  it("ld with mismatched value throws ot_path_invalid", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 2, "blocks", 0],
        ld: { id: 1, type: "place", place: { name: "wrong", place_id: "x" } },
      },
    ];
    expect(() => applyOp(doc, ops)).toThrowError(WanderlogError);
    try {
      applyOp(doc, ops);
    } catch (err) {
      expect((err as WanderlogError).code).toBe("ot_path_invalid");
    }
  });
});

describe("applyOp – object insert (oi)", () => {
  it("sets hotel.checkIn on an existing block", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 1, "blocks", 0, "hotel", "checkIn"],
        oi: "2026-05-04",
      },
    ];
    const next = applyOp(doc, ops);
    const hotelBlock = next.itinerary.sections[1]!.blocks[0] as PlaceBlock;
    expect(hotelBlock.hotel?.checkIn).toBe("2026-05-04");
  });

  it("adds a brand-new field via oi", () => {
    const doc = fresh(queenstownTrip);
    const placeBlock = doc.itinerary.sections[2]!.blocks[0] as PlaceBlock;
    expect(placeBlock.startTime).toBeUndefined();

    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 2, "blocks", 0, "startTime"],
        oi: "10:00",
      },
    ];
    const next = applyOp(doc, ops);
    const updated = next.itinerary.sections[2]!.blocks[0] as PlaceBlock;
    expect(updated.startTime).toBe("10:00");
  });
});

describe("applyOp – object delete (od)", () => {
  it("removes a field from an object", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 1, "blocks", 0, "hotel", "checkIn"],
        od: "2026-05-03",
      },
    ];
    const next = applyOp(doc, ops);
    const hotelBlock = next.itinerary.sections[1]!.blocks[0] as PlaceBlock;
    expect(hotelBlock.hotel).toBeDefined();
    expect("checkIn" in (hotelBlock.hotel as object)).toBe(false);
  });

  it("od + oi replaces a value (object replace)", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 1, "blocks", 0, "hotel", "checkOut"],
        od: "2026-05-06",
        oi: "2026-05-07",
      },
    ];
    const next = applyOp(doc, ops);
    const hotelBlock = next.itinerary.sections[1]!.blocks[0] as PlaceBlock;
    expect(hotelBlock.hotel?.checkOut).toBe("2026-05-07");
  });
});

describe("applyOp – list move (lm)", () => {
  it("reorders two blocks within the same parent array", () => {
    const doc = fresh(mixedBlocksTrip);
    const daySection = doc.itinerary.sections[4]!;
    const before = daySection.blocks.map((b) => b.id);
    expect(before).toEqual([10001, 10002]);

    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 4, "blocks", 0], lm: 1 },
    ];
    const next = applyOp(doc, ops);
    const after = next.itinerary.sections[4]!.blocks.map((b) => b.id);
    expect(after).toEqual([10002, 10001]);
  });
});

describe("applyOp – replace (r)", () => {
  it("replaces the trip title", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      { p: ["title"], r: "Queenstown Long Weekend" },
    ];
    const next = applyOp(doc, ops);
    expect(next.title).toBe("Queenstown Long Weekend");
  });

  it("replaces a whole subtree (block.place)", () => {
    const doc = fresh(queenstownTrip);
    const newPlace = {
      name: "Lake Hayes",
      place_id: "ChIJ_hayes",
      rating: 4.9,
    };
    const ops: Json0Op[] = [
      { p: ["itinerary", "sections", 2, "blocks", 0, "place"], r: newPlace },
    ];
    const next = applyOp(doc, ops);
    const updated = next.itinerary.sections[2]!.blocks[0] as PlaceBlock;
    expect(updated.place).toEqual(newPlace);
  });
});

describe("applyOp – numeric add (na)", () => {
  it("increments placeCount", () => {
    const doc = fresh(queenstownTrip);
    const before = doc.placeCount;
    const ops: Json0Op[] = [{ p: ["placeCount"], na: 3 }];
    const next = applyOp(doc, ops);
    expect(next.placeCount).toBe(before + 3);
  });

  it("supports negative na", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [{ p: ["placeCount"], na: -1 }];
    const next = applyOp(doc, ops);
    expect(next.placeCount).toBe(queenstownTrip.placeCount - 1);
  });
});

describe("applyOp – string insert/delete (si/sd)", () => {
  it("si inserts characters into the title", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      { p: ["title", 8], si: "lovely " },
    ];
    const next = applyOp(doc, ops);
    expect(next.title).toBe("Trip to lovely Queenstown");
  });

  it("sd removes characters from the title", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      { p: ["title"], r: "Trip to wonderful Queenstown" },
      { p: ["title", 8], sd: "wonderful " },
    ];
    const next = applyOp(doc, ops);
    expect(next.title).toBe("Trip to Queenstown");
  });

  it("sd verification fails when substring does not match", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      { p: ["title", 0], sd: "Voyage" },
    ];
    expect(() => applyOp(doc, ops)).toThrowError(WanderlogError);
  });

  it("si on a deeply-nested string field", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 2, "blocks", 0, "place", "name", 0],
        si: "Beautiful ",
      },
    ];
    const next = applyOp(doc, ops);
    const updated = next.itinerary.sections[2]!.blocks[0] as PlaceBlock;
    expect(updated.place.name).toBe("Beautiful Queenstown Gardens");
  });
});

describe("applyOp – multiple ops in one call", () => {
  it("applies ops in order", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      { p: ["title"], r: "Adventure" },
      { p: ["title", 9], si: " in NZ" },
      { p: ["placeCount"], na: 5 },
      {
        p: ["itinerary", "sections", 2, "blocks", 0, "startTime"],
        oi: "09:00",
      },
    ];
    const next = applyOp(doc, ops);
    expect(next.title).toBe("Adventure in NZ");
    expect(next.placeCount).toBe(queenstownTrip.placeCount + 5);
    const block = next.itinerary.sections[2]!.blocks[0] as PlaceBlock;
    expect(block.startTime).toBe("09:00");
  });
});

describe("applyOp – invalid path", () => {
  it("throws WanderlogError with code ot_path_invalid when parent missing", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 99, "blocks", 0],
        li: { id: 1, type: "place" },
      },
    ];
    expect(() => applyOp(doc, ops)).toThrowError(WanderlogError);
    try {
      applyOp(doc, ops);
    } catch (err) {
      expect(err).toBeInstanceOf(WanderlogError);
      expect((err as WanderlogError).code).toBe("ot_path_invalid");
      expect((err as WanderlogError).message).toContain("99");
    }
  });

  it("throws when an object key is missing for an od op", () => {
    const doc = fresh(queenstownTrip);
    const ops: Json0Op[] = [
      {
        p: ["itinerary", "sections", 0, "blocks", 0, "nope"],
        od: "value",
      },
    ];
    expect(() => applyOp(doc, ops)).toThrowError(WanderlogError);
  });

  it("throws ot_path_invalid for an empty path", () => {
    const doc = fresh(queenstownTrip);
    expect(() => applyOp(doc, [{ p: [], r: {} }])).toThrowError(WanderlogError);
  });
});

describe("applyOp – immutability", () => {
  it("does not mutate the input document", () => {
    const doc = fresh(queenstownTrip);
    const snapshot = JSON.stringify(doc);

    const ops: Json0Op[] = [
      { p: ["title"], r: "Mutated" },
      {
        p: ["itinerary", "sections", 2, "blocks", 0],
        li: { id: 999, type: "place", place: { name: "x", place_id: "y" } },
      },
      { p: ["placeCount"], na: 10 },
      {
        p: ["itinerary", "sections", 1, "blocks", 0, "hotel", "checkIn"],
        oi: "1999-01-01",
      },
    ];
    const next = applyOp(doc, ops);

    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(next).not.toBe(doc);
    expect(next.title).toBe("Mutated");
    expect(next.itinerary.sections).not.toBe(doc.itinerary.sections);
  });

  it("returned doc is independent — mutating it does not affect input", () => {
    const doc = fresh(queenstownTrip);
    const next = applyOp(doc, [{ p: ["title"], r: "X" }]);
    next.title = "Y";
    expect(doc.title).toBe(queenstownTrip.title);
  });
});
