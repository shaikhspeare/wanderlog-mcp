import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { ShareDBClient, ShareDBPool } from "../../src/transport/sharedb.ts";

const TRIP_KEY = process.env.WANDERLOG_TRIP_KEY ?? "vzyrsyhgxvonvxcz";

describe("ShareDBClient (live)", () => {
  let client: ShareDBClient;

  beforeAll(() => {
    if (!process.env.WANDERLOG_COOKIE) {
      throw new Error("WANDERLOG_COOKIE must be set for integration tests");
    }
  });

  afterEach(() => {
    client?.close();
  });

  it("subscribes and receives a valid snapshot of the test trip", async () => {
    client = new ShareDBClient(loadConfig(), TRIP_KEY);
    const snapshot = await client.subscribe();

    expect(snapshot.key).toBe(TRIP_KEY);
    expect(snapshot.title.length).toBeGreaterThan(0);
    expect(client.version).toBeGreaterThanOrEqual(1);
    expect(snapshot.itinerary.sections.length).toBeGreaterThan(0);
    expect(client.isSubscribed).toBe(true);
  });

  it("reuses the snapshot on repeat subscribe calls", async () => {
    client = new ShareDBClient(loadConfig(), TRIP_KEY);
    const a = await client.subscribe();
    const b = await client.subscribe();
    expect(b).toBe(a);
  });

  it("submit throws cleanly when called before subscribe", async () => {
    client = new ShareDBClient(loadConfig(), TRIP_KEY);
    await client.connect();
    await expect(
      client.submit([{ p: ["title"], r: "noop" }]),
    ).rejects.toThrow(/subscrib/i);
  });

  it("submit rejects an empty op array", async () => {
    client = new ShareDBClient(loadConfig(), TRIP_KEY);
    await client.subscribe();
    await expect(client.submit([])).rejects.toThrow(/empty/i);
  });
});

describe("ShareDBPool", () => {
  it("returns the same client for the same trip key", () => {
    const pool = new ShareDBPool(loadConfig());
    const a = pool.get(TRIP_KEY);
    const b = pool.get(TRIP_KEY);
    expect(b).toBe(a);
    pool.closeAll();
  });

  it("returns different clients for different trip keys", () => {
    const pool = new ShareDBPool(loadConfig());
    const a = pool.get("trip1");
    const b = pool.get("trip2");
    expect(a).not.toBe(b);
    pool.closeAll();
  });
});
