import { describe, expect, it } from "vitest";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { resolveNoteRef } from "../../src/resolvers/note-ref.ts";
import { quillToPlain, type TripPlan } from "../../src/types.ts";
import { notesTrip } from "../fixtures/notes-trip.ts";

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

/**
 * Builds the rich-text replacement op the same way `editNote` does. Kept here
 * so the test asserts on the exact op shape submitted to ShareDB without
 * needing an AppContext + transport mock.
 */
function buildEditOp(
  trip: TripPlan,
  note_ref: string,
  newText: string,
): Json0Op[] {
  const result = resolveNoteRef(trip, note_ref);
  if (result.kind !== "unique") {
    throw new Error(`expected unique resolution, got ${result.kind}`);
  }
  const { sectionIndex, blockIndex, block } = result.match;
  const oldLength = quillToPlain(block.text).length;
  const body = `${newText}\n`;
  return [
    {
      p: ["itinerary", "sections", sectionIndex, "blocks", blockIndex, "text"],
      t: "rich-text",
      o: oldLength > 0 ? [{ delete: oldLength }, { insert: body }] : [{ insert: body }],
    },
  ];
}

describe("editNote rich-text op", () => {
  it("replaces the entire text of a uniquely-resolved note", () => {
    const trip = fresh(notesTrip);
    const ops = buildEditOp(trip, "anniversary", "Anniversary dinner — confirmed at Rata, 19:00");

    const next = applyOp(trip, ops) as TripPlan;
    const updated = next.itinerary.sections[2]!.blocks[0]!;
    expect(updated.type).toBe("note");
    if (updated.type !== "note") return;
    expect(quillToPlain(updated.text)).toBe("Anniversary dinner — confirmed at Rata, 19:00\n");
  });

  it("preserves the note's position in the day's block list", () => {
    const trip = fresh(notesTrip);
    const ops = buildEditOp(trip, "1st coach tour", "Coach pickup — 06:45 sharp at Steamer Wharf");

    const next = applyOp(trip, ops) as TripPlan;
    const day = next.itinerary.sections[1]!;
    expect(day.blocks).toHaveLength(2);
    expect(day.blocks[0]!.id).toBe(5002);
    expect(day.blocks[1]!.id).toBe(5003);

    const first = day.blocks[0]!;
    if (first.type !== "note") throw new Error("expected note");
    expect(quillToPlain(first.text)).toBe("Coach pickup — 06:45 sharp at Steamer Wharf\n");

    const second = day.blocks[1]!;
    if (second.type !== "note") throw new Error("expected note");
    expect(quillToPlain(second.text)).toBe("Coach tour return — back by 19:30\n");
  });

  it("targets the text field (not the block) so the block id and addedBy survive", () => {
    const trip = fresh(notesTrip);
    const ops = buildEditOp(trip, "anniversary", "new text");

    expect(ops).toHaveLength(1);
    expect(ops[0]!.p).toEqual([
      "itinerary",
      "sections",
      2,
      "blocks",
      0,
      "text",
    ]);
    expect(ops[0]!.t).toBe("rich-text");

    const next = applyOp(trip, ops) as TripPlan;
    const updated = next.itinerary.sections[2]!.blocks[0]!;
    expect(updated.id).toBe(5004);
    if (updated.type !== "note") return;
    expect(updated.addedBy).toEqual({ type: "user", userId: 3656632 });
  });
});
