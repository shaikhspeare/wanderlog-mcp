import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../../src/context.ts";
import { addPlace } from "../../src/tools/add-place.ts";
import { createTrip } from "../../src/tools/create-trip.ts";

/**
 * Isolated live test for the per-trip submit mutex introduced to fix the
 * "Conflict from simultaneous commit" bug observed during real Claude Code
 * usage. Creates a dedicated throwaway trip so nothing can interact with
 * other mutation tests in the same run.
 */
describe("Parallel write safety (live)", () => {
  let ctx: AppContext;
  let tripKey: string | undefined;

  beforeAll(async () => {
    if (!process.env.WANDERLOG_COOKIE) {
      throw new Error("WANDERLOG_COOKIE must be set");
    }
    ctx = createContext();
    const user = await ctx.rest.getUser();
    ctx.userId = user.id;

    const timestamp = Date.now();
    const create = await createTrip(ctx, {
      destination: "Lisbon",
      start_date: "2099-06-01",
      end_date: "2099-06-05",
      title: `WANDERDOG_PARALLEL_${timestamp}`,
      privacy: "private",
    });
    if (create.isError) throw new Error(create.content[0]!.text);
    const keyMatch = /Key: (\w+)/.exec(create.content[0]!.text);
    tripKey = keyMatch![1]!;
  }, 30_000);

  afterAll(async () => {
    ctx?.pool.closeAll();
    if (tripKey) {
      try {
        await ctx.rest.deleteTrip(tripKey);
      } catch {
        /* best-effort */
      }
    }
  });

  it("five parallel add_place calls on the same trip all succeed with no conflicts or duplicates", async () => {
    expect(tripKey).toBeDefined();

    const queries = [
      { place: "Mosteiro dos Jerónimos", day: "day 1" },
      { place: "Oceanário de Lisboa", day: "day 2" },
      { place: "Castelo de São Jorge", day: "day 3" },
      { place: "Pastéis de Belém", day: "day 4" },
      { place: "Parque Eduardo VII", day: "day 5" },
    ];

    const results = await Promise.all(
      queries.map((q) =>
        addPlace(ctx, {
          trip_key: tripKey!,
          place: q.place,
          day: q.day,
        }),
      ),
    );

    const failures = results.filter((r) => r.isError);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length}/${results.length} parallel adds failed:\n${failures.map((f) => f.content[0]!.text).join("\n---\n")}`,
      );
    }

    const trip = await ctx.rest.getTrip(tripKey!);
    const dayBlocks = trip.itinerary.sections
      .filter((s) => s.mode === "dayPlan")
      .map((s) => ({
        date: s.date,
        count: s.blocks.length,
      }));

    // Each of the 5 days should have exactly 1 place. Before the mutex fix,
    // most would race and fail with "Conflict from simultaneous commit",
    // leaving days empty, and LLM retries would create duplicates.
    const counts = dayBlocks.map((d) => d.count);
    expect(counts).toEqual([1, 1, 1, 1, 1]);

    // Total = 5 blocks across 5 days, no duplicates on any day
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(5);
  }, 90_000);
});
