import { isDeepStrictEqual } from "node:util";
import type { QuillDelta } from "./types.js";

export type DeltaOp = {
  insert?: string | Record<string, unknown>;
  retain?: number;
  delete?: number;
  attributes?: Record<string, unknown>;
};

type Attributes = Record<string, unknown>;

/** Formats Quill keeps on a line's trailing newline rather than on its text. */
export const LINE_FORMATS = ["list", "indent"] as const;

/** Tool-description sentence for parameters that take a note. */
export const NOTE_MARKDOWN_HINT =
  "Supports Markdown: **bold**, _italic_, ~~strike~~, <u>underline</u>, [label](https://…) links (bare URLs become links), and lines starting with '- ' or '1. ' as bullet or numbered lists, indented two spaces per level. Escape a literal marker with a backslash.";

const ESCAPABLE = "\\*_~<[]-.";
const MARKDOWN_LINK = /^\[((?:\\.|[^\]\\])+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/;
const BARE_URL = /^https?:\/\/[^\s<>]+/;
const URL_TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;
const LIST_LINE = /^((?: {2})*)(?:[-*] |(\d+)\. )/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Inline formats in nesting order, outermost first, with the markers deltaToMarkdown writes. */
const INLINE_FORMATS: Array<[key: string, open: string, close: string]> = [
  ["bold", "**", "**"],
  ["italic", "_", "_"],
  ["strike", "~~", "~~"],
  ["underline", "<u>", "</u>"],
];

/**
 * Converts the Markdown subset Wanderlog's editor can represent into Quill
 * ops: `**bold**`, `_italic_` or `*italic*`, `~~strike~~`, `<u>underline</u>`,
 * `[label](url)`, bare http(s) URLs as links, and backslash escapes. With
 * `blocks` (the default), a line ending in a newline that starts with `- ` or
 * `1. ` becomes a bullet or numbered list item, indented one level per two
 * leading spaces. Everything else is literal text.
 */
export function markdownToDelta(markdown: string, options: { blocks?: boolean } = {}): DeltaOp[] {
  const ops: DeltaOp[] = [];
  if (options.blocks === false) {
    parseInline(markdown, {}, ops);
    return ops;
  }

  const lines = markdown.split("\n");
  lines.forEach((line, index) => {
    const terminated = index < lines.length - 1;
    const match = terminated ? LIST_LINE.exec(line) : null;
    const format: Attributes = {};
    if (match) {
      format.list = match[2] ? "ordered" : "bullet";
      const indent = match[1]!.length / 2;
      if (indent > 0) format.indent = indent;
    }
    parseInline(match ? line.slice(match[0].length) : line, {}, ops);
    if (terminated) pushInsert(ops, "\n", format);
  });
  return ops;
}

function parseInline(src: string, attrs: Attributes, ops: DeltaOp[]): void {
  let buffer = "";
  const flush = () => {
    if (buffer) pushInsert(ops, buffer, attrs);
    buffer = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);

    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1]!)) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    const span = matchSpan(src, i, attrs);
    if (span) {
      flush();
      parseInline(src.slice(span.start, span.end), { ...attrs, [span.format]: true }, ops);
      i = span.next;
      continue;
    }

    if (ch === "[" && !attrs.link) {
      const match = MARKDOWN_LINK.exec(rest);
      if (match) {
        flush();
        parseInline(match[1]!, { ...attrs, link: match[2] }, ops);
        i += match[0].length;
        continue;
      }
    }

    if (ch === "h" && !attrs.link && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      const match = BARE_URL.exec(rest);
      if (match) {
        const url = match[0].replace(URL_TRAILING_PUNCTUATION, "");
        flush();
        pushInsert(ops, url, { ...attrs, link: url });
        i += url.length;
        continue;
      }
    }

    buffer += ch;
    i++;
  }
  flush();
}

type Span = { format: string; start: number; end: number; next: number };

/** The formatted span opening at `i`, if its markers close; `start`/`end` bound the inner text. */
function matchSpan(src: string, i: number, attrs: Attributes): Span | null {
  const span = (format: string, open: number, end: number, close: number): Span | null =>
    end > i + open ? { format, start: i + open, end, next: end + close } : null;
  const next = src[i + 1];

  if (src.startsWith("**", i) && !attrs.bold) {
    let close = findClosing(src, i + 2, (j) => src.startsWith("**", j));
    // `***x***`: the bold closes on the last two stars, the italic on the first.
    if (close !== -1 && src[i + 2] === "*" && src[close + 2] === "*") close++;
    return span("bold", 2, close, 2);
  }
  if (src[i] === "*" && !attrs.italic && next !== undefined && !/[\s*]/.test(next)) {
    // A run of two stars is bold inside the italic; one or three closes it.
    const close = findClosing(
      src,
      i + 1,
      (j) => src[j] === "*" && !/[\s*]/.test(src[j - 1]!) && starRun(src, j) !== 2,
    );
    return span("italic", 1, close, 1);
  }
  if (src[i] === "_" && !attrs.italic && next !== undefined && !/\s/.test(next)) {
    if (i > 0 && WORD_CHAR.test(src[i - 1]!)) return null;
    const close = findClosing(
      src,
      i + 1,
      (j) =>
        src[j] === "_" &&
        !/\s/.test(src[j - 1]!) &&
        (j + 1 >= src.length || !WORD_CHAR.test(src[j + 1]!)),
    );
    return span("italic", 1, close, 1);
  }
  if (src.startsWith("~~", i) && !attrs.strike) {
    return span(
      "strike",
      2,
      findClosing(src, i + 2, (j) => src.startsWith("~~", j)),
      2,
    );
  }
  if (src.startsWith("<u>", i) && !attrs.underline) {
    return span(
      "underline",
      3,
      findClosing(src, i + 3, (j) => src.startsWith("</u>", j)),
      4,
    );
  }
  return null;
}

function starRun(src: string, from: number): number {
  let end = from;
  while (src[end] === "*") end++;
  return end - from;
}

function findClosing(src: string, from: number, closesAt: (j: number) => boolean): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j++;
      continue;
    }
    if (closesAt(j)) return j;
  }
  return -1;
}

function pushInsert(ops: DeltaOp[], text: string, attrs: Attributes): void {
  const attributes = Object.keys(attrs).length > 0 ? attrs : undefined;
  pushOp(ops, attributes ? { insert: text, attributes } : { insert: text });
}

/** Appends an op, merging it into the previous one when both are same-attribute text inserts. */
function pushOp(ops: DeltaOp[], op: DeltaOp): void {
  const last = ops.at(-1);
  if (
    last &&
    typeof last.insert === "string" &&
    typeof op.insert === "string" &&
    isDeepStrictEqual(last.attributes ?? {}, op.attributes ?? {})
  ) {
    last.insert += op.insert;
    return;
  }
  ops.push(op.attributes ? { ...op, attributes: { ...op.attributes } } : { ...op });
}

export function deltaPlainText(delta: QuillDelta | DeltaOp[] | undefined): string {
  const ops = Array.isArray(delta) ? delta : (delta?.ops ?? []);
  return ops.map((op) => (typeof op.insert === "string" ? op.insert : "")).join("");
}

type Segment = { text: string; attributes: Attributes };
type Line = { segments: Segment[]; format?: Attributes };

/**
 * Renders a note as the Markdown markdownToDelta reads, so it can be read,
 * edited and written back without losing its formatting. Embeds, and indents
 * on lines that aren't list items, have no Markdown form and are dropped.
 */
export function deltaToMarkdown(delta: QuillDelta | undefined): string {
  const lines: Line[] = [{ segments: [] }];
  for (const op of delta?.ops ?? []) {
    if (typeof op.insert !== "string") continue;
    const attributes = op.attributes ?? {};
    op.insert.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.at(-1)!.format = attributes;
        lines.push({ segments: [] });
      }
      if (part) lines.at(-1)!.segments.push({ text: part, attributes });
    });
  }

  const counters: number[] = [];
  return lines
    .map((line) => {
      let text = renderInline(line.segments, 0);
      const list = line.format?.list;
      if (list === "bullet" || list === "ordered") {
        const indent = typeof line.format?.indent === "number" ? line.format.indent : 0;
        counters.length = indent + 1;
        counters[indent] = list === "ordered" ? (counters[indent] ?? 0) + 1 : 0;
        text = `${"  ".repeat(indent)}${list === "ordered" ? `${counters[indent]}.` : "-"} ${text}`;
      } else {
        counters.length = 0;
        text = escapeLineStart(text);
      }
      return line.format ? `${text}\n` : text;
    })
    .join("");
}

function renderInline(segments: Segment[], level: number): string {
  const format = INLINE_FORMATS[level];
  if (!format) return segments.map(renderText).join("");

  const [key, open, close] = format;
  const groups: Array<{ on: boolean; segments: Segment[] }> = [];
  for (const segment of segments) {
    // Whitespace alone can't carry markers: `** **` would not parse back.
    const on = segment.attributes[key] === true && segment.text.trim() !== "";
    const last = groups.at(-1);
    if (last && last.on === on) last.segments.push(segment);
    else groups.push({ on, segments: [segment] });
  }
  const inners = groups.map((group) => renderInline(group.segments, level + 1));
  return groups
    .map((group, index) => {
      const inner = inners[index]!;
      if (!group.on) return inner;
      // `_` doesn't open or close next to a letter (snake_case), `*` does.
      const touchesWord =
        WORD_CHAR.test(inners[index - 1]?.at(-1) ?? "") ||
        WORD_CHAR.test(inners[index + 1]?.[0] ?? "");
      return key === "italic" && touchesWord ? wrap(inner, "*", "*") : wrap(inner, open, close);
    })
    .join("");
}

function renderText(segment: Segment): string {
  const link = typeof segment.attributes.link === "string" ? segment.attributes.link : undefined;
  if (!link) return escapeMarkdown(segment.text);
  if (segment.text === link && BARE_URL.test(link)) return link;
  return `[${escapeMarkdown(segment.text)}](${link})`;
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\*[\]]/g, "\\$&")
    .replace(/~(?=~)|(?<=~)~/g, "\\~")
    .replace(/<(?=\/?u>)/g, "\\<")
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
}

/** Escapes a plain line that would otherwise read back as a list item. */
function escapeLineStart(text: string): string {
  const match = LIST_LINE.exec(text);
  if (!match) return text;
  const at = match[1]!.length + (match[2]?.length ?? 0);
  return `${text.slice(0, at)}\\${text.slice(at)}`;
}

/** Keeps surrounding whitespace outside the markers — `** x**` would not parse back. */
function wrap(text: string, open: string, close: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return `${match[1]}${open}${match[2]}${close}${match[3]}`;
}

function opLength(op: DeltaOp): number {
  if (typeof op.insert === "string") return op.insert.length;
  if (op.insert !== undefined) return 1;
  return op.retain ?? op.delete ?? 0;
}

/** Walks a document's insert ops, handing out pieces of at most `max` units. */
class InsertIterator {
  private index = 0;
  private offset = 0;

  constructor(private readonly ops: DeltaOp[]) {}

  hasNext(): boolean {
    return this.index < this.ops.length;
  }

  next(max: number): DeltaOp {
    const op = this.ops[this.index]!;
    const remaining = opLength(op) - this.offset;
    const take = Math.min(remaining, max);
    let piece: DeltaOp;
    if (typeof op.insert === "string") {
      piece = { insert: op.insert.slice(this.offset, this.offset + take) };
    } else {
      piece = { insert: op.insert };
    }
    if (op.attributes) piece.attributes = { ...op.attributes };
    if (take === remaining) {
      this.index++;
      this.offset = 0;
    } else {
      this.offset += take;
    }
    return piece;
  }
}

function applyAttributes(piece: DeltaOp, change: Attributes | undefined): DeltaOp {
  if (!change) return piece;
  const merged: Attributes = { ...piece.attributes };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return Object.keys(merged).length > 0
    ? { insert: piece.insert, attributes: merged }
    : { insert: piece.insert };
}

/**
 * Quill Delta compose of a document (inserts only) with a change. Keeps
 * attributes and embeds intact, so formatting survives in the cached snapshot.
 */
export function composeDelta(document: DeltaOp[], change: DeltaOp[]): DeltaOp[] {
  const result: DeltaOp[] = [];
  const iterator = new InsertIterator(document.filter((op) => opLength(op) > 0));

  for (const op of change) {
    if (op.insert !== undefined) {
      if (opLength(op) > 0) pushOp(result, { insert: op.insert, attributes: op.attributes });
    } else if (typeof op.delete === "number") {
      let left = op.delete;
      while (left > 0 && iterator.hasNext()) left -= opLength(iterator.next(left));
    } else if (typeof op.retain === "number") {
      let left = op.retain;
      while (left > 0 && iterator.hasNext()) {
        const piece = iterator.next(left);
        left -= opLength(piece);
        pushOp(result, applyAttributes(piece, op.attributes));
      }
    }
  }
  while (iterator.hasNext()) pushOp(result, iterator.next(Number.POSITIVE_INFINITY));

  return result.map((op) => (op.attributes === undefined ? { insert: op.insert } : op));
}
