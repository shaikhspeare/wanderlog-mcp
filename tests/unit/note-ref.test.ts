import { describe, expect, it } from "vitest";
import { resolveNoteRef } from "../../src/resolvers/note-ref.ts";
import { quillToPlain } from "../../src/types.ts";
import { notesTrip } from "../fixtures/notes-trip.ts";

describe("resolveNoteRef", () => {
  it("matches a unique substring in one note", () => {
    const result = resolveNoteRef(notesTrip, "anniversary");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("Anniversary dinner");
    expect(result.match.section.date).toBe("2026-05-07");
  });

  it("is case-insensitive", () => {
    const result = resolveNoteRef(notesTrip, "ANNIVERSARY");
    expect(result.kind).toBe("unique");
  });

  it("returns ambiguous when the substring matches multiple notes", () => {
    const result = resolveNoteRef(notesTrip, "coach tour");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.candidates).toHaveLength(2);
  });

  it("disambiguates with ordinal prefix '1st'", () => {
    const result = resolveNoteRef(notesTrip, "1st coach tour");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("departure");
  });

  it("disambiguates with word ordinal 'second'", () => {
    const result = resolveNoteRef(notesTrip, "second coach tour");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("return");
  });

  it("disambiguates with 'last'", () => {
    const result = resolveNoteRef(notesTrip, "last coach tour");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("return");
  });

  it("filters by day via ' on <date>'", () => {
    const result = resolveNoteRef(notesTrip, "coach tour on May 6");
    expect(result.kind).toBe("ambiguous"); // still two coach-tour notes, both on May 6
    if (result.kind !== "ambiguous") return;
    expect(result.candidates).toHaveLength(2);
    for (const c of result.candidates) {
      expect(c.section.date).toBe("2026-05-06");
    }
  });

  it("filters by day and resolves uniquely when a day has one match", () => {
    const result = resolveNoteRef(notesTrip, "note on May 7");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("Anniversary");
  });

  it("combines ordinal + day filter", () => {
    const result = resolveNoteRef(notesTrip, "2nd coach tour on day 1");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(quillToPlain(result.match.block.text)).toContain("return");
  });

  it("resolves role keyword 'note' — ambiguous across the whole trip", () => {
    const result = resolveNoteRef(notesTrip, "note");
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.candidates).toHaveLength(4);
  });

  it("resolves 'the note on day 2' — uniquely on the anniversary day", () => {
    const result = resolveNoteRef(notesTrip, "the note on day 2");
    expect(result.kind).toBe("unique");
    if (result.kind !== "unique") return;
    expect(result.match.section.date).toBe("2026-05-07");
  });

  it("returns none for an unmatched ref", () => {
    const result = resolveNoteRef(notesTrip, "does not appear anywhere");
    expect(result.kind).toBe("none");
  });

  it("returns none when ordinal overflows candidate count", () => {
    const result = resolveNoteRef(notesTrip, "5th coach tour");
    expect(result.kind).toBe("none");
  });

  it("returns none for empty ref", () => {
    expect(resolveNoteRef(notesTrip, "").kind).toBe("none");
    expect(resolveNoteRef(notesTrip, "   ").kind).toBe("none");
  });

  it("ignores non-note blocks when matching", () => {
    // Trip has no places, but the textOnly "Notes" section is populated with notes.
    // The role keyword must not pick up a place even if this trip had one.
    const result = resolveNoteRef(notesTrip, "note");
    if (result.kind !== "ambiguous") return;
    for (const c of result.candidates) {
      expect(c.block.type).toBe("note");
    }
  });
});
