import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import {
  findStopMatches,
  formatStop,
  getJournalStops,
} from "../../src/tools/journal-shared.ts";
import { listJournal } from "../../src/tools/list-journal.ts";
import { addJournal } from "../../src/tools/add-journal.ts";
import { editJournal } from "../../src/tools/edit-journal.ts";
import { removeJournal } from "../../src/tools/remove-journal.ts";
import { journalTrip } from "../fixtures/journal-trip.ts";

function fresh(trip: TripPlan): TripPlan {
  return structuredClone(trip);
}

type RestMock = {
  searchPlacesAutocomplete?: (...a: any[]) => Promise<any[]>;
  getPlaceDetails?: (id: string) => Promise<any>;
};

function makeFakeContext(
  trip: TripPlan,
  rest: RestMock = {},
): { ctx: AppContext; submittedOps: Json0Op[][] } {
  const submittedOps: Json0Op[][] = [];
  const ctx = {
    userId: 555,
    rest: {
      searchPlacesAutocomplete:
        rest.searchPlacesAutocomplete ?? (async () => [{ place_id: "ChIJnew", description: "X" }]),
      getPlaceDetails: rest.getPlaceDetails ?? (async (id: string) => ({ name: "New Place", place_id: id })),
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
      get: async () => structuredClone(trip),
      getEntry: async () => ({
        snapshot: structuredClone(trip),
        version: 1,
        geos: [{ id: 1, name: "Fukuoka", latitude: 33.59, longitude: 130.4 }],
      }),
      applyLocalOp: () => {},
      invalidate: () => {},
    },
  } as unknown as AppContext;
  return { ctx, submittedOps };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

describe("getJournalStops / findStopMatches / formatStop", () => {
  it("returns indexed stops", () => {
    const stops = getJournalStops(fresh(journalTrip));
    expect(stops).toHaveLength(3);
    expect(stops[0]!.index).toBe(0);
  });

  it("returns empty when there is no journal", () => {
    const trip = fresh(journalTrip);
    delete (trip.itinerary as { journal?: unknown }).journal;
    expect(getJournalStops(trip)).toHaveLength(0);
  });

  it("matches a title substring case-insensitively", () => {
    expect(findStopMatches(fresh(journalTrip), { title: "FUSHIMI" })).toHaveLength(1);
  });

  it("returns multiple matches for a shared title", () => {
    expect(findStopMatches(fresh(journalTrip), { title: "ganso" })).toHaveLength(2);
  });

  it("matches across diacritics (Senso-ji finds Sensō-ji)", () => {
    const trip = fresh(journalTrip);
    trip.itinerary.journal!.stops![0]!.title = "Sensō-ji";
    expect(findStopMatches(trip, { title: "senso-ji" })).toHaveLength(1);
  });

  it("narrows duplicates with a date filter", () => {
    const m = findStopMatches(fresh(journalTrip), { title: "ganso", date: "2026-05-31" });
    expect(m).toHaveLength(1);
    expect(m[0]!.index).toBe(2);
  });

  it("formats a stop with title, datetime, and text preview", () => {
    const stop = fresh(journalTrip).itinerary.journal!.stops![0]!;
    expect(formatStop(stop)).toBe(
      'Ganso Hakata Mentaiju — 2026-05-29 09:00 — "Best mentaiko rice in the city."',
    );
  });
});

// ---------------------------------------------------------------------------
// listJournal
// ---------------------------------------------------------------------------

describe("listJournal", () => {
  it("lists stops and the summary", async () => {
    const { ctx } = makeFakeContext(journalTrip);
    const res = await listJournal(ctx, { trip_key: "journaltripkey" });
    expect(res.isError).toBeUndefined();
    const text = res.content[0]!.text;
    expect(text).toContain("3 journal stops");
    expect(text).toContain("Fushimi Inari Taisha");
    expect(text).toContain("Journal summary:");
  });

  it("filters by title", async () => {
    const { ctx } = makeFakeContext(journalTrip);
    const res = await listJournal(ctx, { trip_key: "journaltripkey", title: "fushimi" });
    expect(res.content[0]!.text).toContain("1 journal stop");
    expect(res.content[0]!.text).not.toContain("Ganso");
  });

  it("returns a friendly message when there are no stops", async () => {
    const trip = fresh(journalTrip);
    trip.itinerary.journal!.stops = [];
    const { ctx } = makeFakeContext(trip);
    const res = await listJournal(ctx, { trip_key: "journaltripkey" });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("no journal stops yet");
  });
});

// ---------------------------------------------------------------------------
// addJournal
// ---------------------------------------------------------------------------

describe("addJournal", () => {
  const noSearch = { searchPlacesAutocomplete: async () => { throw new Error("should not search"); } };

  it("reuses an existing itinerary place without searching", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, noSearch);
    const res = await addJournal(ctx, {
      trip_key: "journaltripkey",
      place: "Ohori", // matches "Ōhori Park" via diacritic folding
      text: "Cherry blossoms by the lake.",
      date: "2026-05-31",
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("reused a place already in your trip");

    const op = submittedOps[0]![0] as { p: (string | number)[]; li: Record<string, any> };
    expect(op.p).toEqual(["itinerary", "journal", "stops", 3]); // appended after 3 existing
    expect(op.li.type).toBe("confirmed");
    expect(op.li.title).toBe("Ōhori Park"); // defaults to the reused place name
    expect(op.li.place).toEqual({ name: "Ōhori Park", place_id: "ChIJohori" });
    expect(op.li.dateTime).toBe("2026-05-31T09:00+09:00"); // offset reused from existing stops
    expect(op.li.media).toEqual([]);
    expect(op.li.text).toEqual({ ops: [{ insert: "Cherry blossoms by the lake." }] });
  });

  it("defaults the date to the place's itinerary day when reused", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, noSearch);
    const res = await addJournal(ctx, {
      trip_key: "journaltripkey",
      place: "Tocho", // "Tōchō-ji Temple", scheduled on 2026-05-29
      text: "A quiet temple.",
    });
    expect(res.isError).toBeUndefined();
    const op = submittedOps[0]![0] as { li: { dateTime: string; place: { place_id: string } } };
    expect(op.li.dateTime).toBe("2026-05-29T09:00+09:00"); // the day it's planned on
    expect(op.li.place.place_id).toBe("ChIJtochoji");
  });

  it("reuses a place from an existing journal stop", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, noSearch);
    const res = await addJournal(ctx, { trip_key: "journaltripkey", place: "ganso" });
    expect(res.isError).toBeUndefined();
    const op = submittedOps[0]![0] as { li: { place: { place_id: string } } };
    expect(op.li.place.place_id).toBe("ChIJmentaiju");
  });

  it("prompts (no mutation) when the place isn't in the trip", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, noSearch);
    const res = await addJournal(ctx, { trip_key: "journaltripkey", place: "Canal City" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("isn't a place in");
    expect(res.content[0]!.text).toContain("allow_new_place");
    expect(submittedOps).toHaveLength(0);
  });

  it("adds a new place when allow_new_place is set", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, {
      searchPlacesAutocomplete: async () => [{ place_id: "ChIJcanal", description: "Canal City" }],
      getPlaceDetails: async (id) => ({ name: "Canal City Hakata", place_id: id }),
    });
    const res = await addJournal(ctx, {
      trip_key: "journaltripkey",
      place: "Canal City",
      allow_new_place: true,
      date: "2026-05-31",
    });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("new place");
    const op = submittedOps[0]![0] as { li: { place: any; dateTime: string } };
    expect(op.li.place).toEqual({ name: "Canal City Hakata", place_id: "ChIJcanal" });
    expect(op.li.dateTime).toBe("2026-05-31T09:00+09:00");
  });

  it("errors when the override search finds nothing", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip, {
      searchPlacesAutocomplete: async () => [],
    });
    const res = await addJournal(ctx, {
      trip_key: "journaltripkey",
      place: "nowhere_xyz",
      allow_new_place: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("No place found");
    expect(submittedOps).toHaveLength(0);
  });

  it("is ambiguous when multiple trip places match", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await addJournal(ctx, { trip_key: "journaltripkey", place: "tai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("matches 2 places");
    expect(submittedOps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeJournal
// ---------------------------------------------------------------------------

describe("removeJournal", () => {
  it("returns not-found when nothing matches", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await removeJournal(ctx, { trip_key: "journaltripkey", title: "nope" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("not found");
    expect(submittedOps).toHaveLength(0);
  });

  it("returns a candidate list and does not mutate when ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await removeJournal(ctx, { trip_key: "journaltripkey", title: "ganso" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("matches 2 journal stops");
    expect(submittedOps).toHaveLength(0);
  });

  it("deletes the matched stop with a JSON0 ld carrying the full object", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await removeJournal(ctx, { trip_key: "journaltripkey", title: "fushimi" });
    expect(res.isError).toBeUndefined();
    const op = submittedOps[0]![0] as { p: (string | number)[]; ld: { id: number } };
    expect(op.p).toEqual(["itinerary", "journal", "stops", 1]);
    expect(op.ld.id).toBe(571059555);
    // applies cleanly, removing only that stop
    const next = applyOp(fresh(journalTrip), submittedOps[0]!);
    expect(next.itinerary.journal!.stops!.map((s) => s.title)).toEqual([
      "Ganso Hakata Mentaiju",
      "Ganso Hakata Mentaiju",
    ]);
  });
});

// ---------------------------------------------------------------------------
// editJournal
// ---------------------------------------------------------------------------

describe("editJournal", () => {
  it("rejects when no new_* value is supplied", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, { trip_key: "journaltripkey", title: "fushimi" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Nothing to edit");
    expect(submittedOps).toHaveLength(0);
  });

  it("requires a title when editing stop fields", async () => {
    const { ctx } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, { trip_key: "journaltripkey", new_text: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("Provide 'title'");
  });

  it("returns a candidate list and does not mutate when ambiguous", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, {
      trip_key: "journaltripkey",
      title: "ganso",
      new_text: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("matches 2 journal stops");
    expect(submittedOps).toHaveLength(0);
  });

  it("edits title and text with od+oi for only those fields", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, {
      trip_key: "journaltripkey",
      title: "fushimi",
      new_title: "Fushimi Inari (early)",
      new_text: "Beat the crowds.",
    });
    expect(res.isError).toBeUndefined();
    const ops = submittedOps[0]!;
    expect(ops).toContainEqual({
      p: ["itinerary", "journal", "stops", 1, "title"],
      od: "Fushimi Inari Taisha",
      oi: "Fushimi Inari (early)",
    });
    expect(ops).toContainEqual({
      p: ["itinerary", "journal", "stops", 1, "text"],
      od: { ops: [{ insert: "Hiked the torii gates at dawn." }] },
      oi: { ops: [{ insert: "Beat the crowds." }] },
    });
  });

  it("edits the date while preserving the timezone offset", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, {
      trip_key: "journaltripkey",
      title: "fushimi",
      new_date: "2026-05-28",
    });
    expect(res.isError).toBeUndefined();
    expect(submittedOps[0]![0]).toEqual({
      p: ["itinerary", "journal", "stops", 1, "dateTime"],
      od: "2026-05-30T09:00+09:00",
      oi: "2026-05-28T09:00+09:00",
    });
  });

  it("edits the trip-level summary without a stop title", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    const res = await editJournal(ctx, {
      trip_key: "journaltripkey",
      new_summary: "Best food trip ever.",
    });
    expect(res.isError).toBeUndefined();
    expect(submittedOps[0]![0]).toEqual({
      p: ["itinerary", "journal", "summary"],
      od: "Three days of food in Fukuoka.",
      oi: "Best food trip ever.",
    });
  });

  it("preserves place and media when applied via applyOp", async () => {
    const { ctx, submittedOps } = makeFakeContext(journalTrip);
    await editJournal(ctx, {
      trip_key: "journaltripkey",
      title: "fushimi",
      new_title: "Fushimi Inari (early)",
      new_text: "Beat the crowds.",
    });
    const next = applyOp(fresh(journalTrip), submittedOps[0]!);
    const stop = next.itinerary.journal!.stops![1]!;
    expect(stop.title).toBe("Fushimi Inari (early)");
    expect(stop.place).toEqual({ name: "Fushimi Inari Taisha", place_id: "ChIJfushimi" });
    expect(stop.media).toHaveLength(1);
  });
});
