import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../../src/context.ts";
import { createTrip } from "../../src/tools/create-trip.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { addJournal } from "../../src/tools/add-journal.ts";
import { listJournal } from "../../src/tools/list-journal.ts";
import { editJournal } from "../../src/tools/edit-journal.ts";
import { removeJournal } from "../../src/tools/remove-journal.ts";
import type { JournalStop, TripPlan } from "../../src/types.ts";

/**
 * Live round-trip for the journal tools against the real Wanderlog API.
 * Creates a throwaway trip, adds a place (location anchor for place search),
 * then adds / lists / edits / removes a journal stop — re-reading over REST
 * between steps for authoritative assertions. Deletes the trip in afterAll.
 *
 * A stray trip from a mid-run crash shows up as "WANDERDOG_TEST_<timestamp>".
 */
describe("Journal tools (live round-trip)", () => {
  let ctx: AppContext;
  let tripKey: string | undefined;

  const stopByTitle = (trip: TripPlan, sub: string): JournalStop | undefined =>
    (trip.itinerary.journal?.stops ?? []).find((s) =>
      (s.title ?? "").toLowerCase().includes(sub.toLowerCase()),
    );

  beforeAll(async () => {
    if (!process.env.WANDERLOG_COOKIE) {
      throw new Error("WANDERLOG_COOKIE must be set");
    }
    ctx = createContext();
    const user = await ctx.rest.getUser();
    ctx.userId = user.id;
  }, 20_000);

  afterAll(async () => {
    ctx?.pool.closeAll();
    if (tripKey) {
      try {
        await ctx.rest.deleteTrip(tripKey);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("creates a throwaway trip with a place anchor", async () => {
    const result = await createTrip(ctx, {
      destination: "Tokyo",
      start_date: "2099-03-01",
      end_date: "2099-03-03",
      title: `WANDERDOG_TEST_${Date.now()}`,
      privacy: "private",
    });
    expect(result.isError).not.toBe(true);
    tripKey = /Key: (\w+)/.exec(result.content[0]!.text)?.[1];
    expect(tripKey).toBeTruthy();
    await addPlace(ctx, { trip_key: tripKey!, place: "Tokyo Tower" });
  }, 30_000);

  it("add_journal resolves a place and appends a stop", async () => {
    const res = await addJournal(ctx, {
      trip_key: tripKey!,
      place: "Senso-ji",
      text: "Visited the temple at dawn.",
      date: "2099-03-02",
      time: "08:30",
    });
    if (res.isError) throw new Error(`add_journal failed: ${res.content[0]!.text}`);

    const trip = await ctx.rest.getTrip(tripKey!);
    const stop = stopByTitle(trip, "sens"); // diacritic-free substring of "Sensō-ji"
    expect(stop).toBeDefined();
    expect(stop!.type).toBe("confirmed");
    expect(stop!.place?.name).toMatch(/Sens/);
    expect(stop!.dateTime).toBe("2099-03-02T08:30");
    expect(stop!.media).toEqual([]);
    expect(stop!.text?.ops?.[0]?.insert).toBe("Visited the temple at dawn.");
  }, 30_000);

  it("list_journal shows the stop", async () => {
    const res = await listJournal(ctx, { trip_key: tripKey! });
    expect(res.isError).not.toBe(true);
    expect(res.content[0]!.text).toMatch(/Sens/);
    expect(res.content[0]!.text).toContain("Visited the temple at dawn.");
  }, 15_000);

  it("edit_journal changes title/text/date and summary (server-confirmed)", async () => {
    const res = await editJournal(ctx, {
      trip_key: tripKey!,
      title: "senso", // matches "Sensō-ji" via diacritic folding
      new_title: "Sensō-ji (sunrise)",
      new_text: "Beat the crowds before 9am.",
      new_date: "2099-03-01",
      new_summary: "Three days in Tokyo.",
    });
    if (res.isError) throw new Error(`edit_journal failed: ${res.content[0]!.text}`);

    const trip = await ctx.rest.getTrip(tripKey!);
    const stop = stopByTitle(trip, "sunrise");
    expect(stop).toBeDefined();
    expect(stop!.title).toBe("Sensō-ji (sunrise)");
    expect(stop!.text?.ops?.[0]?.insert).toBe("Beat the crowds before 9am.");
    expect(stop!.dateTime).toBe("2099-03-01T08:30"); // date changed, time preserved
    expect(stop!.place?.name).toMatch(/Sens/); // place preserved
    expect(trip.itinerary.journal?.summary).toBe("Three days in Tokyo.");
  }, 30_000);

  it("edit_journal returns not-found for a non-matching title", async () => {
    const res = await editJournal(ctx, {
      trip_key: tripKey!,
      title: "no_such_stop_xyz",
      new_text: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text.toLowerCase()).toContain("not found");
  }, 15_000);

  it("remove_journal deletes the stop", async () => {
    const res = await removeJournal(ctx, { trip_key: tripKey!, title: "sunrise" });
    if (res.isError) throw new Error(`remove_journal failed: ${res.content[0]!.text}`);

    const trip = await ctx.rest.getTrip(tripKey!);
    expect(trip.itinerary.journal?.stops ?? []).toHaveLength(0);
  }, 30_000);
});
