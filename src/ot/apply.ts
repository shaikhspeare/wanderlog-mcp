import { WanderlogError } from "../errors.js";
import type { TripPlan } from "../types.js";

export type Json0Op = {
  p: (string | number)[];
  li?: unknown;
  ld?: unknown;
  lm?: number;
  oi?: unknown;
  od?: unknown;
  si?: string;
  sd?: string;
  r?: unknown;
  na?: number;
  /** ShareDB subtype identifier (e.g. "rich-text" for Quill Delta ops). */
  t?: string;
  /** Subtype operation payload — shape depends on `t`. */
  o?: unknown;
};

type JsonContainer = Record<string, unknown> | unknown[];

function pathInvalid(path: (string | number)[], reason: string): never {
  const rendered = path.map((p) => JSON.stringify(p)).join(", ");
  throw new WanderlogError(
    `JSON0 op path [${rendered}] is invalid: ${reason}`,
    "ot_path_invalid",
    "Verify the op path matches the current document shape (parent containers must exist and have the correct type).",
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function navigateParent(
  doc: JsonContainer,
  path: (string | number)[],
): JsonContainer {
  let current: unknown = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (Array.isArray(current)) {
      if (typeof key !== "number") {
        pathInvalid(path, `expected numeric index at position ${i}, got ${typeof key}`);
      }
      if (key < 0 || key >= current.length) {
        pathInvalid(path, `array index ${key} out of bounds at position ${i}`);
      }
      current = current[key];
    } else if (isObject(current)) {
      if (typeof key !== "string") {
        pathInvalid(path, `expected string key at position ${i}, got ${typeof key}`);
      }
      if (!(key in current)) {
        pathInvalid(path, `key "${key}" missing on parent object at position ${i}`);
      }
      current = current[key];
    } else {
      pathInvalid(path, `cannot traverse into non-container at position ${i}`);
    }
  }
  if (!isObject(current) && !Array.isArray(current)) {
    pathInvalid(path, "parent of target is not an object or array");
  }
  return current as JsonContainer;
}

/**
 * Apply a Quill Delta "rich-text" subtype op to a QuillDelta field.
 *
 * Quill Delta compose semantics: walk through the incoming ops in order.
 * `retain(n)` skips n characters, `insert(s)` inserts text, `delete(n)`
 * removes n characters. We rebuild the delta's plain-text string, then
 * write back a new `{ops: [{insert: result}]}`.
 *
 * This is intentionally simplified — we flatten the existing delta to
 * plain text, apply the transform, and produce a single-insert delta.
 * Formatting attributes on the original text are lost, which is acceptable
 * because our tools only create plain-text notes. Remote rich-text edits
 * from the UI that carry attributes will lose formatting in our cache, but
 * the server holds the authoritative version.
 */
function applyRichTextOp(
  parent: JsonContainer,
  key: string | number,
  payload: unknown,
): void {
  const target = Array.isArray(parent)
    ? parent[key as number]
    : (parent as Record<string, unknown>)[key as string];

  // Extract current plain text from the QuillDelta
  let current = "";
  if (target && typeof target === "object" && "ops" in (target as Record<string, unknown>)) {
    const ops = (target as { ops: Array<{ insert?: string }> }).ops;
    if (Array.isArray(ops)) {
      current = ops
        .map((op) => (typeof op.insert === "string" ? op.insert : ""))
        .join("");
    }
  }

  // Apply the delta ops to the current text
  if (!Array.isArray(payload)) return;
  let pos = 0;
  let result = current;
  for (const dop of payload as Array<Record<string, unknown>>) {
    if (typeof dop.retain === "number") {
      pos += dop.retain;
    } else if (typeof dop.insert === "string") {
      result = result.slice(0, pos) + dop.insert + result.slice(pos);
      pos += dop.insert.length;
    } else if (typeof dop.delete === "number") {
      result = result.slice(0, pos) + result.slice(pos + dop.delete);
    }
  }

  const newDelta = { ops: [{ insert: result }] };
  if (Array.isArray(parent)) {
    parent[key as number] = newDelta;
  } else {
    (parent as Record<string, unknown>)[key as string] = newDelta;
  }
}

function applySingleOp(doc: JsonContainer, op: Json0Op): void {
  const { p } = op;

  if (p.length === 0) {
    if ("r" in op) {
      pathInvalid(p, "whole-document replacement at empty path is not supported");
    }
    pathInvalid(p, "op path must not be empty");
  }

  // ShareDB subtype ops — the `t` field names the subtype, `o` is its payload.
  // We support "rich-text" (Quill Delta compose); unknown subtypes are skipped
  // so remote ops from the UI don't crash our cache.
  if ("t" in op && op.t !== undefined) {
    const parent = navigateParent(doc, p);
    const last = p[p.length - 1]!;
    if (op.t === "rich-text") {
      applyRichTextOp(parent, last, op.o);
    }
    // Unknown subtypes: silently skip rather than crash.
    return;
  }

  if ("r" in op) {
    if (p.length === 0) {
      pathInvalid(p, "replace at empty path is not supported");
    }
    const parent = navigateParent(doc, p);
    const last = p[p.length - 1]!;
    if (Array.isArray(parent)) {
      if (typeof last !== "number") {
        pathInvalid(p, "expected numeric index for replace on array");
      }
      if (last < 0 || last >= parent.length) {
        pathInvalid(p, `array index ${last} out of bounds for replace`);
      }
      parent[last] = op.r;
    } else {
      if (typeof last !== "string") {
        pathInvalid(p, "expected string key for replace on object");
      }
      parent[last] = op.r;
    }
    return;
  }

  if ("na" in op && op.na !== undefined) {
    const parent = navigateParent(doc, p);
    const last = p[p.length - 1]!;
    const current = Array.isArray(parent)
      ? typeof last === "number"
        ? parent[last]
        : pathInvalid(p, "expected numeric index for na on array")
      : typeof last === "string"
        ? parent[last]
        : pathInvalid(p, "expected string key for na on object");
    if (typeof current !== "number") {
      pathInvalid(p, `na target is not a number (got ${typeof current})`);
    }
    const next = current + op.na;
    if (Array.isArray(parent)) {
      parent[last as number] = next;
    } else {
      parent[last as string] = next;
    }
    return;
  }

  if ("si" in op || "sd" in op) {
    const idx = p[p.length - 1]!;
    if (typeof idx !== "number") {
      pathInvalid(p, "string op requires numeric index as final path element");
    }
    if (p.length < 2) {
      pathInvalid(p, "string op path must contain at least the string key and an index");
    }
    const stringKey = p[p.length - 2]!;
    const stringParent = navigateParent(doc, p.slice(0, -1));
    const current = Array.isArray(stringParent)
      ? typeof stringKey === "number"
        ? stringParent[stringKey]
        : pathInvalid(p, "expected numeric index for string container in array")
      : typeof stringKey === "string"
        ? stringParent[stringKey]
        : pathInvalid(p, "expected string key for string container in object");
    if (typeof current !== "string") {
      pathInvalid(p, `string op target is not a string (got ${typeof current})`);
    }
    let updated = current;
    if ("sd" in op && op.sd !== undefined) {
      const slice = updated.slice(idx, idx + op.sd.length);
      if (slice !== op.sd) {
        pathInvalid(
          p,
          `sd verification failed: expected "${op.sd}" at index ${idx}, found "${slice}"`,
        );
      }
      updated = updated.slice(0, idx) + updated.slice(idx + op.sd.length);
    }
    if ("si" in op && op.si !== undefined) {
      updated = updated.slice(0, idx) + op.si + updated.slice(idx);
    }
    if (Array.isArray(stringParent)) {
      stringParent[stringKey as number] = updated;
    } else {
      stringParent[stringKey as string] = updated;
    }
    return;
  }

  const parent = navigateParent(doc, p);
  const last = p[p.length - 1]!;

  const hasLd = "ld" in op && op.ld !== undefined;
  const hasLi = "li" in op && op.li !== undefined;
  const hasLm = "lm" in op && op.lm !== undefined;
  const hasOi = "oi" in op && op.oi !== undefined;
  const hasOd = "od" in op && op.od !== undefined;

  if (hasLd || hasLi || hasLm) {
    if (!Array.isArray(parent)) {
      pathInvalid(p, "list op target parent is not an array");
    }
    if (typeof last !== "number") {
      pathInvalid(p, "list op requires numeric final path element");
    }

    if (hasLm) {
      const from = last;
      const to = op.lm!;
      if (from < 0 || from >= parent.length) {
        pathInvalid(p, `lm source index ${from} out of bounds`);
      }
      if (to < 0 || to >= parent.length) {
        pathInvalid(p, `lm destination index ${to} out of bounds`);
      }
      const [item] = parent.splice(from, 1);
      parent.splice(to, 0, item);
      return;
    }

    if (hasLd) {
      if (last < 0 || last >= parent.length) {
        pathInvalid(p, `ld index ${last} out of bounds`);
      }
      const existing = parent[last];
      if (op.ld !== null && JSON.stringify(existing) !== JSON.stringify(op.ld)) {
        throw new WanderlogError(
          `JSON0 ld verification failed at path [${p.join(", ")}]: existing element does not match provided ld value`,
          "ot_path_invalid",
          "The cached document drifted from the server snapshot. Refresh the trip before retrying.",
        );
      }
      if (hasLi) {
        parent[last] = op.li;
      } else {
        parent.splice(last, 1);
      }
      return;
    }

    if (hasLi) {
      if (last < 0 || last > parent.length) {
        pathInvalid(p, `li index ${last} out of bounds`);
      }
      parent.splice(last, 0, op.li);
      return;
    }
  }

  if (hasOi || hasOd) {
    if (!isObject(parent)) {
      pathInvalid(p, "object op target parent is not an object");
    }
    if (typeof last !== "string") {
      pathInvalid(p, "object op requires string final path element");
    }
    if (hasOd) {
      if (!(last in parent)) {
        pathInvalid(p, `od key "${last}" missing from parent object`);
      }
      if (hasOi) {
        parent[last] = op.oi;
      } else {
        delete parent[last];
      }
      return;
    }
    if (hasOi) {
      parent[last] = op.oi;
      return;
    }
  }

  pathInvalid(p, "op contains no recognized action field");
}

export function applyOp(doc: TripPlan, ops: Json0Op[]): TripPlan {
  const next = structuredClone(doc) as unknown as JsonContainer;
  for (const op of ops) {
    applySingleOp(next, op);
  }
  return next as unknown as TripPlan;
}
