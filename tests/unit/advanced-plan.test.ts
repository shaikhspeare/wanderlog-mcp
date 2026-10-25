import { describe, expect, it } from "vitest";
import type { PlaceBlock, Section, TripPlan } from "../../src/types.js";
import { planChanges } from "../../src/tools/advanced-plan.js";
import { stateHash } from "../../src/tools/advanced-state.js";

function place(id: number, name: string, overrides: Partial<PlaceBlock> = {}): PlaceBlock {
  return {
    id,
    type: "place",
    place: { name, place_id: "example-" + id },
    text: { ops: [{ insert: "An original note.\n" }] },
    startTime: "09:00",
    ...overrides,
  };
}
function section(id: number, date: string, blocks: PlaceBlock[]): Section {
  return {
    id,
    date,
    type: "normal",
    mode: "dayPlan",
    heading: "",
    blocks,
    text: { ops: [{ insert: "\n" }] },
  };
}
function trip(): TripPlan {
  return {
    id: 1,
    key: "exampletrip",
    userId: 1,
    privacy: "private",
    title: "Example",
    startDate: "2026-11-21",
    endDate: "2026-11-22",
    days: 2,
    placeCount: 3,
    schemaVersion: 2,
    createdAt: "",
    updatedAt: "",
    itinerary: {
      sections: [
        section(100, "2026-11-21", [place(1, "Museum"), place(2, "Garden")]),
        section(200, "2026-11-22", [place(3, "Cafe")]),
      ],
    },
  };
}
describe("advanced itinerary change planner", () => {
  it("moves the exact place block with all notes and times preserved", () => {
    const source = trip();
    const original = structuredClone(source.itinerary.sections[0]!.blocks[0]);
    const hash = stateHash(source);
    const result = planChanges(
      source,
      [
        {
          type: "move",
          place: "Museum",
          from_day: "2026-11-21",
          to_day: "2026-11-22",
          position: 2,
        },
      ],
      [],
    );
    expect(result.operations).toHaveLength(2);
    expect(result.expectedSections[1]!.blocks[1]).toEqual(original);
    expect(result.expectedSections[0]!.blocks).toHaveLength(1);
    expect(stateHash(source)).toBe(hash);
  });

  it("can apply multiple actions atomically in a simulated transaction", () => {
    const result = planChanges(
      trip(),
      [
        { type: "reorder", place: "Garden", day: "day 1", position: 1 },
        { type: "set_time", place: "Museum", day: "2026-11-21", start_time: "13:00" },
      ],
      [],
    );
    expect(result.summary.map((action) => action.type)).toEqual(["reorder", "set_time"]);
    expect(result.expectedSections[0]!.blocks.map((block) => block.id)).toEqual([2, 1]);
    expect(result.expectedSections[0]!.blocks[1]).toMatchObject({ startTime: "13:00" });
  });

  it("rejects manual protected places and automatic bookings", () => {
    expect(() =>
      planChanges(
        trip(),
        [
          {
            type: "move",
            place: "Museum",
            to_day: "day 2",
          },
        ],
        [1],
      ),
    ).toThrow(/Protected/);

    const source = trip();
    const block = source.itinerary.sections[0]!.blocks[0] as PlaceBlock;
    block.hotel = {
      checkIn: "2026-11-21",
      checkOut: "2026-11-22",
      confirmationNumber: "test-confirmation",
      travelerNames: [],
    };
    expect(() =>
      planChanges(
        source,
        [
          {
            type: "move",
            place: "Museum",
            to_day: "day 2",
          },
        ],
        [],
      ),
    ).toThrow(/Protected/);
  });

  it("rejects ambiguous references and invalid destinations without changes", () => {
    const source = trip();
    (source.itinerary.sections[1]!.blocks as PlaceBlock[]).push(place(4, "Museum"));
    expect(() =>
      planChanges(
        source,
        [
          {
            type: "move",
            place: "Museum",
            to_day: "day 2",
          },
        ],
        [],
      ),
    ).toThrow(/unique/);

    expect(() =>
      planChanges(
        trip(),
        [
          {
            type: "move",
            place: "Museum",
            to_day: "day 1",
          },
        ],
        [],
      ),
    ).toThrow(/different/);
  });

  it("rejects invalid times or reordered protected stops", () => {
    expect(() =>
      planChanges(
        trip(),
        [
          {
            type: "set_time",
            place: "Museum",
            day: "day 1",
            start_time: "25:01",
          },
        ],
        [],
      ),
    ).toThrow(/HH:mm/);
    expect(() =>
      planChanges(
        trip(),
        [
          {
            type: "reorder",
            place: "Museum",
            day: "day 1",
            position: 2,
          },
        ],
        [1],
      ),
    ).toThrow(/Protected/);
  });

  it("rejects more than 30 modifications", () => {
    const actions = Array.from({ length: 31 }, () => ({
      type: "reorder" as const,
      place: "Museum",
      day: "day 1",
      position: 1,
    }));
    expect(() => planChanges(trip(), actions, [])).toThrow(/1 to 30/);
  });
});
