import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import { annotatePlace } from "../../src/tools/annotate-place.ts";
import { extractDeltaText } from "../../src/tools/remove-note.ts";
import { buildNoteReplaceDelta, quillLength } from "../../src/tools/shared.ts";
import type { QuillDelta, TripPlan } from "../../src/types.ts";

/** A one-day trip holding a single place whose note starts as `note`. */
function makeCtx(note: string) {
  const place = {
    id: 202,
    type: "place" as const,
    place: { name: "Le Bistrot des Bleus", place_id: "bistrot" },
    text: { ops: [{ insert: note }] },
  };
  const trip = {
    title: "Annotate trip",
    itinerary: {
      sections: [
        {
          id: 10,
          type: "normal",
          mode: "dayPlan",
          heading: "",
          date: "2099-01-01",
          blocks: [place],
        },
      ],
    },
  } as unknown as TripPlan;

  const entry = { snapshot: trip, version: 1, geos: [] };
  const client = {
    isSubscribed: true,
    version: 1,
    async submit(_ops: Json0Op[]) {
      this.version++;
    },
  };
  const ctx = {
    pool: { get: () => client },
    tripCache: {
      getEntry: async () => entry,
      applyLocalOp: (_key: string, ops: Json0Op[], version: number) => {
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: () => {},
    },
  } as unknown as AppContext;

  const currentDelta = () =>
    (entry.snapshot.itinerary.sections[0]!.blocks[0]! as { text?: QuillDelta }).text;
  const currentNote = () => extractDeltaText(currentDelta());

  return { ctx, currentNote, currentDelta };
}

const annotate = (ctx: AppContext, note: string) =>
  annotatePlace(ctx, { trip_key: "trip", place: "Le Bistrot des Bleus", note });

describe("annotatePlace note replacement", () => {
  it("replaces an existing note instead of appending to it", async () => {
    const { ctx, currentNote } = makeCtx("NOT YET BOOKED — call to reserve\n");

    const result = await annotate(ctx, "BOOKED — 19:30, confirmation on file");

    expect(result.isError).toBeFalsy();
    expect(currentNote()).toBe("BOOKED — 19:30, confirmation on file\n");
  });

  it("sets a note on a place that has none", async () => {
    const { ctx, currentNote } = makeCtx("\n");

    await annotate(ctx, "Book two weeks ahead");

    expect(currentNote()).toBe("Book two weeks ahead\n");
  });

  it("does not duplicate the note when the same annotation is sent twice", async () => {
    const { ctx, currentNote } = makeCtx("\n");

    await annotate(ctx, "Book two weeks ahead");
    await annotate(ctx, "Book two weeks ahead");

    expect(currentNote()).toBe("Book two weeks ahead\n");
  });

  it("keeps a single trailing newline across repeated replacements", async () => {
    const { ctx, currentNote } = makeCtx("first\n");

    await annotate(ctx, "second");
    await annotate(ctx, "third");

    expect(currentNote()).toBe("third\n");
  });

  it("replaces a multi-line note in full", async () => {
    const { ctx, currentNote } = makeCtx("line one\nline two\nline three\n");

    await annotate(ctx, "single replacement line");

    expect(currentNote()).toBe("single replacement line\n");
  });

  it("writes Markdown bold and links as formatted runs", async () => {
    const { ctx, currentDelta } = makeCtx("old\n");

    const result = await annotate(
      ctx,
      "**Option A**\nGPX: [komoot.com](https://www.komoot.com/smarttour/1)",
    );

    expect(result.isError).toBeFalsy();
    expect(currentDelta()?.ops).toEqual([
      { insert: "Option A", attributes: { bold: true } },
      { insert: "\nGPX: " },
      { insert: "komoot.com", attributes: { link: "https://www.komoot.com/smarttour/1" } },
      { insert: "\n" },
    ]);
  });

  it("writes a list over a list, ending in the right line format", async () => {
    const { ctx, currentDelta } = makeCtx("old\n");

    await annotate(ctx, "- a\n  - b");
    await annotate(ctx, "**Neu**\n1. x");

    expect(currentDelta()?.ops).toEqual([
      { insert: "Neu", attributes: { bold: true } },
      { insert: "\nx" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
  });
});

describe("buildNoteReplaceDelta", () => {
  it("deletes the existing text and keeps the trailing newline", () => {
    expect(buildNoteReplaceDelta({ ops: [{ insert: "old\n" }] }, "new")).toEqual([
      { delete: 3 },
      { insert: "new" },
    ]);
  });

  it("emits no delete when the note is empty", () => {
    expect(buildNoteReplaceDelta({ ops: [{ insert: "\n" }] }, "new")).toEqual([{ insert: "new" }]);
  });

  it("adds a trailing newline when the existing text has none", () => {
    expect(buildNoteReplaceDelta({ ops: [{ insert: "old" }] }, "new")).toEqual([
      { delete: 3 },
      { insert: "new\n" },
    ]);
  });

  it("handles an absent text field", () => {
    expect(buildNoteReplaceDelta(undefined, "new")).toEqual([{ insert: "new\n" }]);
  });

  it("gives the kept newline the new last line's list format", () => {
    expect(buildNoteReplaceDelta({ ops: [{ insert: "old\n" }] }, "- a\n- b")).toEqual([
      { delete: 3 },
      { insert: "a" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "b" },
      { retain: 1, attributes: { list: "bullet" } },
    ]);
  });

  it("clears a list format the kept newline no longer needs", () => {
    const existing = {
      ops: [{ insert: "a" }, { insert: "\n", attributes: { list: "bullet", indent: 1 } }],
    };
    expect(buildNoteReplaceDelta(existing, "plain")).toEqual([
      { delete: 1 },
      { insert: "plain" },
      { retain: 1, attributes: { list: null, indent: null } },
    ]);
  });

  it("does not double the newline when the note already ends in one", () => {
    expect(buildNoteReplaceDelta({ ops: [{ insert: "old\n" }] }, "new\n")).toEqual([
      { delete: 3 },
      { insert: "new" },
    ]);
  });

  it("deletes an embed along with the text around it", () => {
    // 4 + 1 (embed) + 5 = 10 units; the trailing newline stays, so 9 go.
    // Counting plain-text characters deleted 8 and left "e" behind.
    const existing = {
      ops: [{ insert: "Old " }, { insert: { image: "k" } }, { insert: "note\n" }],
    };
    expect(buildNoteReplaceDelta(existing, "New")).toEqual([{ delete: 9 }, { insert: "New" }]);
  });
});

describe("quillLength", () => {
  it("counts characters for text", () => {
    expect(quillLength({ ops: [{ insert: "abc" }, { insert: "de\n" }] })).toBe(6);
  });

  it("counts an embed as one unit", () => {
    const withEmbed = { ops: [{ insert: "a" }, { insert: { image: "k" } }, { insert: "b\n" }] };
    expect(extractDeltaText(withEmbed)).toBe("ab\n");
    expect(quillLength(withEmbed)).toBe(4);
  });

  it("is zero for an absent or empty delta", () => {
    expect(quillLength(undefined)).toBe(0);
    expect(quillLength({ ops: [] })).toBe(0);
  });
});
