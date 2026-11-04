import { describe, expect, it } from "vitest";
import { applyOp } from "../../src/ot/apply.ts";
import {
  composeDelta,
  deltaPlainText,
  deltaToMarkdown,
  markdownToDelta,
} from "../../src/rich-text.ts";
import type { TripPlan } from "../../src/types.ts";

/** A note as Wanderlog's editor stores it after formatting by hand. */
const handFormattedNote = {
  ops: [
    { insert: "🥾 ~10km / ↗️ 700m\n" },
    { attributes: { bold: true }, insert: "Option A: Aiguillette des Posettes. " },
    { insert: "\n📋 Breiter Rücken.\n\nKomoot: " },
    { insert: "komoot.com", attributes: { link: "https://www.komoot.com/smarttour/36747079" } },
    { insert: "\n" },
  ],
};

describe("markdownToDelta", () => {
  it("leaves plain text as a single insert", () => {
    expect(markdownToDelta("Book two weeks ahead\n")).toEqual([
      { insert: "Book two weeks ahead\n" },
    ]);
  });

  it("turns **bold** into a bold run", () => {
    expect(markdownToDelta("Go **early** please")).toEqual([
      { insert: "Go " },
      { insert: "early", attributes: { bold: true } },
      { insert: " please" },
    ]);
  });

  it("turns [label](url) into a linked run", () => {
    expect(markdownToDelta("GPX: [komoot.com](https://www.komoot.com/smarttour/1)")).toEqual([
      { insert: "GPX: " },
      { insert: "komoot.com", attributes: { link: "https://www.komoot.com/smarttour/1" } },
    ]);
  });

  it("links bare URLs without swallowing trailing punctuation", () => {
    expect(markdownToDelta("See https://example.com/a.")).toEqual([
      { insert: "See " },
      { insert: "https://example.com/a", attributes: { link: "https://example.com/a" } },
      { insert: "." },
    ]);
  });

  it("combines bold and link", () => {
    expect(markdownToDelta("**[Map](https://m.example)**")).toEqual([
      { insert: "Map", attributes: { bold: true, link: "https://m.example" } },
    ]);
  });

  it("keeps escaped and unmatched markers literal", () => {
    expect(deltaPlainText(markdownToDelta("2 \\* 3 = 6, a ** b, [x] done"))).toBe(
      "2 * 3 = 6, a ** b, [x] done",
    );
  });

  it("does not link a URL that is glued to a word", () => {
    expect(markdownToDelta("xhttps://example.com")).toEqual([{ insert: "xhttps://example.com" }]);
  });

  it("reads italic, strike and underline", () => {
    expect(markdownToDelta("_a_ *b* ~~c~~ <u>d</u>")).toEqual([
      { insert: "a", attributes: { italic: true } },
      { insert: " " },
      { insert: "b", attributes: { italic: true } },
      { insert: " " },
      { insert: "c", attributes: { strike: true } },
      { insert: " " },
      { insert: "d", attributes: { underline: true } },
    ]);
  });

  it("nests formats", () => {
    expect(markdownToDelta("***x*** **a _b_**")).toEqual([
      { insert: "x", attributes: { bold: true, italic: true } },
      { insert: " " },
      { insert: "a ", attributes: { bold: true } },
      { insert: "b", attributes: { bold: true, italic: true } },
    ]);
  });

  it("keeps underscores inside words and lone tildes literal", () => {
    expect(markdownToDelta("snake_case_name ~10km")).toEqual([{ insert: "snake_case_name ~10km" }]);
  });

  it("puts list formats on the line's newline", () => {
    expect(markdownToDelta("Packen:\n- Jacke\n  - Mütze\n1. Ticket\n")).toEqual([
      { insert: "Packen:\nJacke" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Mütze" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      { insert: "Ticket" },
      { insert: "\n", attributes: { list: "ordered" } },
    ]);
  });

  it("reads list markers only on newline-terminated lines and in block mode", () => {
    expect(markdownToDelta("- a")).toEqual([{ insert: "- a" }]);
    expect(markdownToDelta("- a\n", { blocks: false })).toEqual([{ insert: "- a\n" }]);
  });
});

describe("deltaToMarkdown", () => {
  it("renders bold and links, keeping whitespace outside the markers", () => {
    expect(deltaToMarkdown(handFormattedNote)).toBe(
      "🥾 ~10km / ↗️ 700m\n**Option A: Aiguillette des Posettes.** \n📋 Breiter Rücken.\n\nKomoot: [komoot.com](https://www.komoot.com/smarttour/36747079)\n",
    );
  });

  it("round-trips a hand-formatted note through Markdown", () => {
    const markdown = deltaToMarkdown(handFormattedNote);
    const roundTripped = markdownToDelta(markdown);

    expect(deltaPlainText(roundTripped)).toBe(deltaPlainText(handFormattedNote));
    expect(deltaToMarkdown({ ops: roundTripped })).toBe(markdown);
    // Only whitespace at the edge of a bold run may lose its bold attribute.
    expect(roundTripped).toContainEqual({
      insert: "Option A: Aiguillette des Posettes.",
      attributes: { bold: true },
    });
    expect(roundTripped).toContainEqual(handFormattedNote.ops[3]);
  });

  it("renders a link whose label is its URL as the bare URL", () => {
    const url = "https://example.com/x";
    expect(deltaToMarkdown({ ops: [{ insert: url, attributes: { link: url } }] })).toBe(url);
  });

  it("escapes literal markers so they survive a round trip", () => {
    const delta = { ops: [{ insert: "2 * 3 [approx]\n" }] };
    expect(deltaToMarkdown(delta)).toBe("2 \\* 3 \\[approx\\]\n");
    expect(markdownToDelta(deltaToMarkdown(delta))).toEqual(delta.ops);
  });

  it("renders italic, strike and underline inside bold", () => {
    const delta = {
      ops: [
        { insert: "a", attributes: { bold: true, italic: true } },
        { insert: " " },
        { insert: "b", attributes: { strike: true } },
        { insert: " " },
        { insert: "c", attributes: { underline: true, link: "https://u.example" } },
      ],
    };
    const markdown = deltaToMarkdown(delta);
    expect(markdown).toBe("**_a_** ~~b~~ <u>[c](https://u.example)</u>");
    expect(markdownToDelta(markdown)).toEqual(delta.ops);
  });

  it("uses * for italic inside a word, where _ would not parse", () => {
    const delta = {
      ops: [
        { insert: "Rund" },
        { insert: "wander", attributes: { italic: true } },
        { insert: "weg", attributes: { bold: true } },
      ],
    };
    expect(deltaToMarkdown(delta)).toBe("Rund*wander***weg**");
    expect(markdownToDelta(deltaToMarkdown(delta))).toEqual(delta.ops);
  });

  it("renders lists with indentation and running numbers", () => {
    const delta = {
      ops: [
        { insert: "Tipps\nA" },
        { insert: "\n", attributes: { list: "ordered" } },
        { insert: "A.1" },
        { insert: "\n", attributes: { list: "bullet", indent: 1 } },
        { insert: "B" },
        { insert: "\n", attributes: { list: "ordered" } },
        { insert: "Ende\n" },
      ],
    };
    const markdown = deltaToMarkdown(delta);
    expect(markdown).toBe("Tipps\n1. A\n  - A.1\n2. B\nEnde\n");
    expect(markdownToDelta(markdown)).toEqual(delta.ops);
  });

  it("escapes plain lines and markers that would read back as formatting", () => {
    const delta = { ops: [{ insert: "- kein Punkt\n3. auch nicht\n~~x~~ <u> _y_ a_b\n" }] };
    const markdown = deltaToMarkdown(delta);
    expect(markdown).toBe("\\- kein Punkt\n3\\. auch nicht\n\\~\\~x\\~\\~ \\<u> \\_y\\_ a_b\n");
    expect(markdownToDelta(markdown)).toEqual(delta.ops);
  });

  it("ignores embeds", () => {
    expect(deltaToMarkdown({ ops: [{ insert: { image: "x.png" } }, { insert: "after\n" }] })).toBe(
      "after\n",
    );
  });
});

describe("composeDelta", () => {
  it("keeps formatting outside the edited range", () => {
    const result = composeDelta(handFormattedNote.ops, [{ retain: 2 }, { delete: 5 }]);
    expect(deltaPlainText(result)).toBe(
      deltaPlainText(handFormattedNote.ops).slice(0, 2) +
        deltaPlainText(handFormattedNote.ops).slice(7),
    );
    expect(result).toContainEqual(handFormattedNote.ops[1]);
    expect(result).toContainEqual(handFormattedNote.ops[3]);
  });

  it("inserts formatted text in the middle of a run", () => {
    expect(
      composeDelta(
        [{ insert: "ab\n" }],
        [{ retain: 1 }, { insert: "X", attributes: { bold: true } }],
      ),
    ).toEqual([{ insert: "a" }, { insert: "X", attributes: { bold: true } }, { insert: "b\n" }]);
  });

  it("applies and removes attributes on retain", () => {
    const bolded = composeDelta([{ insert: "abc" }], [{ retain: 2, attributes: { bold: true } }]);
    expect(bolded).toEqual([{ insert: "ab", attributes: { bold: true } }, { insert: "c" }]);
    expect(composeDelta(bolded, [{ retain: 1, attributes: { bold: null } }])).toEqual([
      { insert: "a" },
      { insert: "b", attributes: { bold: true } },
      { insert: "c" },
    ]);
  });

  it("counts an embed as one unit", () => {
    expect(
      composeDelta(
        [{ insert: { image: "x.png" } }, { insert: "ab" }],
        [{ retain: 1 }, { delete: 1 }],
      ),
    ).toEqual([{ insert: { image: "x.png" } }, { insert: "b" }]);
  });
});

describe("applyOp rich-text subtype", () => {
  it("keeps a note's formatting in the cached snapshot", () => {
    const trip = {
      itinerary: {
        sections: [{ id: 1, blocks: [{ id: 2, type: "place", text: handFormattedNote }] }],
      },
    } as unknown as TripPlan;

    const next = applyOp(trip, [
      {
        p: ["itinerary", "sections", 0, "blocks", 0, "text"],
        t: "rich-text",
        o: [{ insert: "NEU " }],
      },
    ]);

    const text = (next.itinerary.sections[0]!.blocks[0] as { text: { ops: unknown[] } }).text;
    expect(text.ops[0]).toEqual({ insert: "NEU 🥾 ~10km / ↗️ 700m\n" });
    expect(text.ops).toContainEqual(handFormattedNote.ops[1]);
    expect(text.ops).toContainEqual(handFormattedNote.ops[3]);
  });
});
