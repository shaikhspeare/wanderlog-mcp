import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { RestClient } from "../../src/transport/rest.ts";

const TRIP_KEY = process.env.WANDERLOG_TRIP_KEY ?? "vzyrsyhgxvonvxcz";

describe("RestClient (live)", () => {
  let client: RestClient;

  beforeAll(() => {
    if (!process.env.WANDERLOG_COOKIE) {
      throw new Error("WANDERLOG_COOKIE must be set for integration tests");
    }
    client = new RestClient(loadConfig());
  });

  it("getUser returns the authenticated user", async () => {
    const user = await client.getUser();
    expect(user).toBeTruthy();
    expect(user.id).toBeTypeOf("number");
    expect(user.username).toBeTypeOf("string");
    console.log(`[test] authenticated as ${user.username} (${user.id})`);
  });

  it("listTrips returns an array containing our test trip", async () => {
    const trips = await client.listTrips();
    expect(Array.isArray(trips)).toBe(true);
    const testTrip = trips.find((t) => t.key === TRIP_KEY);
    expect(testTrip).toBeDefined();
    expect(testTrip?.title.length).toBeGreaterThan(0);
  });

  it("getTrip returns the test trip with valid shape", async () => {
    const trip = await client.getTrip(TRIP_KEY);
    expect(trip.key).toBe(TRIP_KEY);
    expect(trip.title.length).toBeGreaterThan(0);
    expect(trip.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(trip.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(trip.itinerary.sections.length).toBeGreaterThan(0);
    expect(trip.schemaVersion).toBe(2);
  });

  it("searchPlacesAutocomplete returns suggestions near Queenstown", async () => {
    const predictions = await client.searchPlacesAutocomplete({
      input: "queenstown gardens",
      sessionToken: crypto.randomUUID(),
      location: { latitude: -45.0312, longitude: 168.6626 },
      radius: 15000,
    });
    expect(predictions.length).toBeGreaterThan(0);
    const hasGardens = predictions.some((p) => /gardens/i.test(p.description));
    expect(hasGardens).toBe(true);
  });

  it("getPlaceDetails returns Queenstown Gardens detail", async () => {
    const detail = await client.getPlaceDetails("ChIJrwm7l7Tj1KkRtwIpvNpNEQs");
    expect(detail.name).toContain("Gardens");
    expect(detail.rating).toBeGreaterThan(0);
  });
});
