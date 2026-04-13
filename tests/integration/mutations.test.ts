import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../../src/context.ts";
import { addChecklist } from "../../src/tools/add-checklist.ts";
import { addHotel } from "../../src/tools/add-hotel.ts";
import { addNote } from "../../src/tools/add-note.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { createTrip } from "../../src/tools/create-trip.ts";
import { getTrip } from "../../src/tools/get-trip.ts";
import { removePlace } from "../../src/tools/remove-place.ts";
import { updateTripDates } from "../../src/tools/update-trip-dates.ts";
import { isChecklistBlock, isPlaceBlock } from "../../src/types.ts";
import type { ChecklistBlock, NoteBlock } from "../../src/types.ts";

/**
 * End-to-end mutation round trip. Creates a throwaway trip, exercises
 * add_place / add_hotel / remove_place, deletes the trip. Runs against
 * the live Wanderlog API.
 *
 * If this test leaves a stray trip behind (e.g. crash mid-run), it'll
 * show up in wanderlog.com labeled "WANDERDOG_TEST_<timestamp>" — delete
 * it manually.
 */
describe("Mutation tools (live round-trip)", () => {
  let ctx: AppContext;
  let tripKey: string | undefined;

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

  it("creates a trip to Lisbon for 3 days", async () => {
    const timestamp = Date.now();
    const result = await createTrip(ctx, {
      destination: "Lisbon",
      start_date: "2099-01-01",
      end_date: "2099-01-03",
      title: `WANDERDOG_TEST_${timestamp}`,
      privacy: "private",
    });
    expect(result.isError).not.toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain("Lisbon");
    const keyMatch = /Key: (\w+)/.exec(text);
    expect(keyMatch).not.toBeNull();
    tripKey = keyMatch![1]!;
    expect(tripKey.length).toBeGreaterThan(8);
  }, 15_000);

  it("get_trip returns the newly created trip with all expected day sections", async () => {
    expect(tripKey).toBeDefined();
    const result = await getTrip(ctx, {
      trip_key: tripKey!,
      response_format: "concise",
    });
    expect(result.isError).not.toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain("Jan 1");
    expect(text).toContain("Jan 3");
  }, 15_000);

  it("add_place adds Castelo de São Jorge to day 1", async () => {
    expect(tripKey).toBeDefined();
    const result = await addPlace(ctx, {
      trip_key: tripKey!,
      place: "Castelo de São Jorge",
      day: "day 1",
    });
    if (result.isError) {
      throw new Error(`add_place failed: ${result.content[0]!.text}`);
    }
    expect(result.content[0]!.text.toLowerCase()).toContain("castelo");

    const trip = await ctx.rest.getTrip(tripKey!);
    const foundInDay1 = trip.itinerary.sections.some(
      (s) =>
        s.mode === "dayPlan" &&
        s.date === "2099-01-01" &&
        s.blocks.some((b) => isPlaceBlock(b) && /castelo/i.test(b.place.name)),
    );
    expect(foundInDay1).toBe(true);
  }, 30_000);

  it("add_hotel adds a hotel with a check-in window", async () => {
    expect(tripKey).toBeDefined();
    const result = await addHotel(ctx, {
      trip_key: tripKey!,
      hotel: "Pestana Palace Lisboa",
      check_in: "2099-01-01",
      check_out: "2099-01-03",
    });
    if (result.isError) {
      throw new Error(`add_hotel failed: ${result.content[0]!.text}`);
    }

    const trip = await ctx.rest.getTrip(tripKey!);
    const hotelsSection = trip.itinerary.sections.find((s) => s.type === "hotels");
    expect(hotelsSection).toBeDefined();
    expect(hotelsSection!.blocks.length).toBeGreaterThanOrEqual(1);
    const first = hotelsSection!.blocks[0]!;
    expect(isPlaceBlock(first)).toBe(true);
    if (isPlaceBlock(first)) {
      expect(first.hotel?.checkIn).toBe("2099-01-01");
      expect(first.hotel?.checkOut).toBe("2099-01-03");
    }
  }, 30_000);

  it("add_note adds a note to day 1", async () => {
    expect(tripKey).toBeDefined();
    const result = await addNote(ctx, {
      trip_key: tripKey!,
      text: "Remember to bring sunscreen",
      day: "day 1",
    });
    if (result.isError) {
      throw new Error(`add_note failed: ${result.content[0]!.text}`);
    }
    expect(result.content[0]!.text).toContain("note");

    const trip = await ctx.rest.getTrip(tripKey!);
    const day1 = trip.itinerary.sections.find(
      (s) => s.mode === "dayPlan" && s.date === "2099-01-01",
    );
    expect(day1).toBeDefined();
    const noteBlock = day1!.blocks.find((b) => b.type === "note") as NoteBlock | undefined;
    expect(noteBlock).toBeDefined();
    expect(noteBlock!.text?.ops?.some((op) => typeof op.insert === "string" && op.insert.includes("sunscreen"))).toBe(true);
  }, 30_000);

  it("add_note adds a note to the unscheduled list", async () => {
    expect(tripKey).toBeDefined();
    const result = await addNote(ctx, {
      trip_key: tripKey!,
      text: "General trip reminder",
    });
    if (result.isError) {
      throw new Error(`add_note failed: ${result.content[0]!.text}`);
    }
    expect(result.content[0]!.text).toContain("places to visit");
  }, 30_000);

  it("add_checklist adds a checklist with title and items to day 2", async () => {
    expect(tripKey).toBeDefined();
    const result = await addChecklist(ctx, {
      trip_key: tripKey!,
      items: ["book restaurant", "charge camera", "pack jacket"],
      title: "Evening prep",
      day: "day 2",
    });
    if (result.isError) {
      throw new Error(`add_checklist failed: ${result.content[0]!.text}`);
    }
    expect(result.content[0]!.text).toContain("checklist");
    expect(result.content[0]!.text).toContain("3 items");

    const trip = await ctx.rest.getTrip(tripKey!);
    const day2 = trip.itinerary.sections.find(
      (s) => s.mode === "dayPlan" && s.date === "2099-01-02",
    );
    expect(day2).toBeDefined();
    const clBlock = day2!.blocks.find((b) => b.type === "checklist") as ChecklistBlock | undefined;
    expect(clBlock).toBeDefined();
    expect(isChecklistBlock(clBlock!)).toBe(true);
    expect(clBlock!.items).toHaveLength(3);
    expect(clBlock!.title).toBe("Evening prep");
  }, 30_000);

  it("remove_place removes the castle", async () => {
    expect(tripKey).toBeDefined();
    const result = await removePlace(ctx, {
      trip_key: tripKey!,
      place_ref: "Castelo de São Jorge",
    });
    if (result.isError) {
      throw new Error(`remove_place failed: ${result.content[0]!.text}`);
    }
    expect(result.content[0]!.text.toLowerCase()).toContain("removed");

    const trip = await ctx.rest.getTrip(tripKey!);
    const stillThere = trip.itinerary.sections.some((s) =>
      s.blocks.some((b) => isPlaceBlock(b) && /castelo/i.test(b.place.name)),
    );
    expect(stillThere).toBe(false);
  }, 30_000);

  it("remove_place with ambiguous ref returns candidates without mutating", async () => {
    expect(tripKey).toBeDefined();
    // "hotel" is a role keyword which will match our one hotel → unique
    const result = await removePlace(ctx, {
      trip_key: tripKey!,
      place_ref: "definitely not a real place xyzzy",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text.toLowerCase()).toMatch(/not found/);
  });

  it("update_trip_dates extends the range by 2 days", async () => {
    expect(tripKey).toBeDefined();
    const result = await updateTripDates(ctx, {
      trip_key: tripKey!,
      start_date: "2099-01-01",
      end_date: "2099-01-05",
    });
    if (result.isError) {
      throw new Error(`update_trip_dates failed: ${result.content[0]!.text}`);
    }

    const trip = await ctx.rest.getTrip(tripKey!);
    expect(trip.startDate).toBe("2099-01-01");
    expect(trip.endDate).toBe("2099-01-05");
    expect(trip.days).toBe(5);

    const dayDates = trip.itinerary.sections
      .filter((s) => s.mode === "dayPlan" && s.date)
      .map((s) => s.date);
    expect(dayDates).toContain("2099-01-04");
    expect(dayDates).toContain("2099-01-05");
    expect(dayDates).toHaveLength(5);
  }, 30_000);

  it("update_trip_dates refuses to shorten a trip that would drop a day with content", async () => {
    expect(tripKey).toBeDefined();
    // Add a place to day 4 (a day we'd lose if we shorten to Jan 1-3)
    const addResult = await addPlace(ctx, {
      trip_key: tripKey!,
      place: "Torre de Belém",
      day: "day 4",
    });
    if (addResult.isError) {
      throw new Error(`add_place(day 4) failed: ${addResult.content[0]!.text}`);
    }

    // Now try to shorten — should refuse
    const shortenResult = await updateTripDates(ctx, {
      trip_key: tripKey!,
      start_date: "2099-01-01",
      end_date: "2099-01-03",
    });
    expect(shortenResult.isError).toBe(true);
    expect(shortenResult.content[0]!.text).toContain("2099-01-04");
    expect(shortenResult.content[0]!.text.toLowerCase()).toContain("force");

    // Confirm the trip is unchanged
    const trip = await ctx.rest.getTrip(tripKey!);
    expect(trip.endDate).toBe("2099-01-05");
  }, 45_000);

  it("update_trip_dates shortens with force:true when content would be dropped", async () => {
    expect(tripKey).toBeDefined();
    const result = await updateTripDates(ctx, {
      trip_key: tripKey!,
      start_date: "2099-01-01",
      end_date: "2099-01-03",
      force: true,
    });
    if (result.isError) {
      throw new Error(`update_trip_dates(force) failed: ${result.content[0]!.text}`);
    }

    const trip = await ctx.rest.getTrip(tripKey!);
    expect(trip.startDate).toBe("2099-01-01");
    expect(trip.endDate).toBe("2099-01-03");
    expect(trip.days).toBe(3);

    const dayDates = trip.itinerary.sections
      .filter((s) => s.mode === "dayPlan" && s.date)
      .map((s) => s.date);
    expect(dayDates).toHaveLength(3);
    expect(dayDates).not.toContain("2099-01-04");
  }, 30_000);
});
