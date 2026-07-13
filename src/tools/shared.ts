import type { AppContext } from "../context.js";
import { WanderlogError, WanderlogValidationError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import { resolveDay } from "../resolvers/day.js";
import type { Block, ChecklistItem, Geo, PlaceData, Section, TripPlan } from "../types.js";
import { isPlaceBlock } from "../types.js";

/**
 * Per-trip mutex — serializes submits against the same trip so concurrent
 * callers can't race each other on the ShareDB version vector. Without this,
 * parallel Promise.all batches of mutations all read the cache at version N
 * simultaneously and submit stale ops that the server rejects as conflicts.
 */
const submitLocks = new Map<string, Promise<unknown>>();

async function withSubmitLock<T>(
  tripKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = submitLocks.get(tripKey) ?? Promise.resolve();
  // Chain regardless of whether the previous op succeeded or failed —
  // one failed op should not permanently block the queue.
  const next = prev.then(fn, fn);
  // The map always holds a never-rejecting tail so the next caller can chain
  // onto it safely. Dead promises are negligible; the map is keyed by trip.
  submitLocks.set(
    tripKey,
    next.catch(() => {}),
  );
  return next;
}

/**
 * Submit a JSON0 op array to the server and apply it to the live cache on
 * success. Encapsulates the version handshake so tools don't touch
 * ShareDBClient directly.
 *
 * Rules:
 * - Trip must already be in the cache (caller should have called tripCache.get()).
 * - Per-trip mutex: concurrent calls on the same trip serialize automatically.
 * - Op fails atomically: if submit rejects, the cache is invalidated so the
 *   next read refetches a fresh snapshot from the server.
 * - On success, cache.applyLocalOp() is called with the server-accepted version.
 */
export async function submitOp(
  ctx: AppContext,
  tripKey: string,
  ops: Json0Op[],
): Promise<void> {
  return withSubmitLock(tripKey, async () => {
    const client = ctx.pool.get(tripKey);
    if (!client.isSubscribed) {
      throw new WanderlogError(
        `Trip ${tripKey} is not subscribed — call tripCache.get() first`,
        "not_subscribed",
      );
    }
    try {
      await submitWithRateLimitRetry(client, ops);
      ctx.tripCache.applyLocalOp(tripKey, ops, client.version);
    } catch (err) {
      // Any submit failure leaves our cached view possibly inconsistent with
      // the server. Invalidate so the next get() refetches + resubscribes.
      ctx.tripCache.invalidate(tripKey);
      throw err;
    }
  });
}

const RATE_LIMIT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

// A rate-limited op (code 4001) is rejected before the server processes it —
// it never acks and never applies — so resubmitting the same ops at the same
// version is safe. Burst mutations (e.g. an LLM building a full itinerary)
// hit the limit routinely; waiting out the window beats surfacing an error.
async function submitWithRateLimitRetry(
  client: { submit(ops: Json0Op[]): Promise<void> },
  ops: Json0Op[],
): Promise<void> {
  let attempt = 0;
  for (;;) {
    try {
      await client.submit(ops);
      return;
    } catch (err) {
      const isRateLimit =
        err instanceof WanderlogError && err.code === "rate_limited";
      if (!isRateLimit || attempt >= RATE_LIMIT_RETRY_DELAYS_MS.length) {
        throw err;
      }
      await new Promise((r) =>
        setTimeout(r, RATE_LIMIT_RETRY_DELAYS_MS[attempt]),
      );
      attempt += 1;
    }
  }
}

/** Wanderlog block IDs are 9-digit numeric. Sections use the same format. */
export function generateBlockId(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/**
 * Build a new custom section matching the shape Wanderlog inserts from its UI.
 * Always type "normal" / mode "placeList" — day sections are managed by update-trip-dates.
 */
export function buildSectionObject(heading: string): Section {
  return {
    id: generateBlockId(),
    type: "normal",
    mode: "placeList",
    heading,
    date: null,
    blocks: [],
    text: { ops: [{ insert: "\n" }] },
    placeMarkerColor: "#3498db",
    placeMarkerIcon: "map-marker",
  };
}

/**
 * Resolves a natural-language section reference to its index and Section object.
 * Resolution order:
 *   1. "places to visit" / "places" → the default placeList section (via findPlacesToVisitSection)
 *   2. Case-insensitive heading match across all sections
 * Returns null when no section matches.
 */
export function findSectionByRef(
  trip: TripPlan,
  ref: string,
): { index: number; section: Section } | null {
  const normalized = ref.trim().toLowerCase();
  if (normalized === "places to visit" || normalized === "places") {
    return findPlacesToVisitSection(trip);
  }
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.heading.trim().toLowerCase() === normalized) {
      return { index: i, section: s };
    }
  }
  return null;
}

export function requireUserId(ctx: AppContext): number {
  if (ctx.userId == null) {
    throw new WanderlogError(
      "User ID not available — auth probe has not completed",
      "no_user_id",
    );
  }
  return ctx.userId;
}

/**
 * Build a newly-inserted place block matching Wanderlog's schema.
 * Based on the shape captured in HAR during real trip-add operations.
 */
export function buildPlaceBlock(
  place: PlaceData,
  userId: number,
  extras: {
    hotel?: {
      checkIn: string;
      checkOut: string;
      travelerNames?: string[];
      confirmationNumber?: string | null;
    };
    startTime?: string;
    endTime?: string;
  } = {},
): Block {
  const base: Record<string, unknown> = {
    id: generateBlockId(),
    type: "place",
    place,
    text: { ops: [{ insert: "\n" }] },
    addedBy: { type: "user", userId },
    imageSize: "small",
    upvotedBy: [],
    travelMode: null,
    attachments: [],
  };
  if (extras.hotel) {
    base.hotel = {
      checkIn: extras.hotel.checkIn,
      checkOut: extras.hotel.checkOut,
      travelerNames: extras.hotel.travelerNames ?? [],
      confirmationNumber: extras.hotel.confirmationNumber ?? null,
    };
  }
  if (extras.startTime) base.startTime = extras.startTime;
  if (extras.endTime) base.endTime = extras.endTime;
  return base as unknown as Block;
}

/**
 * Finds the "Places to visit" section (the default normal+placeList section
 * at the top of every trip). Returns its index in trip.itinerary.sections.
 */
export function findPlacesToVisitSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (
      s.type === "normal" &&
      s.mode === "placeList" &&
      (s.heading === "Places to visit" || s.heading === "")
    ) {
      return { index: i, section: s };
    }
  }
  return null;
}

/** Finds the first hotels-type section in the trip. */
export function findHotelsSection(trip: TripPlan): {
  index: number;
  section: Section;
} | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.type === "hotels") return { index: i, section: s };
  }
  return null;
}

/**
 * Finds a day section by ISO date. Returns null if no matching section exists
 * (e.g. the date is outside the trip range).
 */
export function findDaySectionByDate(
  trip: TripPlan,
  isoDate: string,
): { index: number; section: Section } | null {
  for (let i = 0; i < trip.itinerary.sections.length; i++) {
    const s = trip.itinerary.sections[i]!;
    if (s.mode === "dayPlan" && s.date === isoDate) {
      return { index: i, section: s };
    }
  }
  return null;
}

/**
 * Returns a search-biasing location for the trip. Tries in order:
 *   1. The first place block with geometry (most specific)
 *   2. The trip's first associated geo (from /api/tripPlans/{key} resources)
 *   3. Null if both are absent
 */
export function findTripCenter(
  trip: TripPlan,
  geos?: Geo[],
): { lat: number; lng: number } | null {
  for (const section of trip.itinerary.sections) {
    for (const block of section.blocks) {
      if (!isPlaceBlock(block)) continue;
      const loc = block.place.geometry?.location;
      if (loc) return loc;
    }
  }
  const first = geos?.[0];
  if (first) return { lat: first.latitude, lng: first.longitude };
  return null;
}

/**
 * Resolves the target section for adding a block — either a specific day
 * or the "Places to visit" list. Shared by add-place, add-note, add-checklist.
 */
export function findTargetSection(
  trip: TripPlan,
  day?: string,
): { index: number; section: Section; label: string } {
  if (day) {
    const daySection = resolveDay(trip, day);
    const found = findDaySectionByDate(trip, daySection.date!);
    if (!found) {
      throw new WanderlogValidationError(`Day ${day} not found in trip`);
    }
    return { index: found.index, section: found.section, label: `day ${daySection.date}` };
  }
  const places = findPlacesToVisitSection(trip);
  if (!places) {
    throw new WanderlogError(
      "Trip has no 'Places to visit' list",
      "no_places_section",
      "This is unexpected — Wanderlog usually creates one automatically. Try adding to a specific day instead.",
    );
  }
  return { index: places.index, section: places.section, label: "places to visit" };
}

/** Build a note block matching the shape captured from the Wanderlog UI. */
export function buildNoteBlock(userId: number): Record<string, unknown> {
  return {
    id: generateBlockId(),
    type: "note",
    text: { ops: [{ insert: "\n" }] },
    addedBy: { type: "user", userId },
    attachments: [],
  };
}

/** Build a checklist block with pre-populated items. */
export function buildChecklistBlock(
  items: string[],
  title: string,
  userId: number,
): Record<string, unknown> {
  const checklistItems: ChecklistItem[] = items.map((text) => ({
    id: generateBlockId(),
    checked: false,
    text: { ops: [{ insert: `${text}\n` }] },
  }));
  return {
    id: generateBlockId(),
    type: "checklist",
    items: checklistItems,
    title,
    addedBy: { type: "user", userId },
    attachments: [],
  };
}

const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validateTimeInputs(startTime?: string, endTime?: string): void {
  if (startTime && !TIME_REGEX.test(startTime)) {
    throw new WanderlogValidationError(
      `Invalid start_time: "${startTime}". Hours must be between 00 and 23, and minutes between 00 and 59.`,
    );
  }
  if (endTime && !TIME_REGEX.test(endTime)) {
    throw new WanderlogValidationError(
      `Invalid end_time: "${endTime}". Hours must be between 00 and 23, and minutes between 00 and 59.`,
    );
  }
  // Format is validated above, so a lexicographic compare on zero-padded HH:mm
  // is equivalent to a chronological compare.
  if (startTime && endTime && startTime >= endTime) {
    throw new WanderlogValidationError(
      `end_time (${endTime}) must be after start_time (${startTime}).`,
    );
  }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;

  const [year, month, day] = dateStr.split("-").map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

export function validateDateRange(startDate: string, endDate: string): void {
  // Both dates are validated as YYYY-MM-DD before this runs, so a
  // lexicographic compare matches chronological order.
  if (startDate > endDate) {
    throw new WanderlogValidationError(
      `end_date (${endDate}) must be on or after start_date (${startDate}).`,
    );
  }
}
