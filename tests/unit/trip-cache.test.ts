import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { TripCache } from "../../src/cache/trip-cache.ts";
import type { RestClient } from "../../src/transport/rest.ts";
import type { ShareDBPool } from "../../src/transport/sharedb.ts";

class FakeShareDBClient extends EventEmitter {
  public version = 1;
  public subscribeCalled = 0;

  async subscribe() {
    this.subscribeCalled++;
    return { title: "Test Trip", sections: [] };
  }
}

describe("TripCache event listener leak", () => {
  it("unregisters remoteOp listener on invalidate", async () => {
    const fakeClient = new FakeShareDBClient();
    const fakeRest = {
      getTripWithResources: async () => ({ geos: [] }),
    } as unknown as RestClient;

    const fakePool = {
      get: () => fakeClient,
    } as unknown as ShareDBPool;

    const cache = new TripCache(fakeRest, fakePool);

    // Initial get, should subscribe and register listener
    await cache.get("tripA");
    expect(fakeClient.listenerCount("remoteOp")).toBe(1);

    // Invalidate, should unregister listener
    cache.invalidate("tripA");
    expect(fakeClient.listenerCount("remoteOp")).toBe(0);
  });

  it("handles multiple get/invalidate cycles without leaking listeners", async () => {
    const fakeClient = new FakeShareDBClient();
    const fakeRest = {
      getTripWithResources: async () => ({ geos: [] }),
    } as unknown as RestClient;

    const fakePool = {
      get: () => fakeClient,
    } as unknown as ShareDBPool;

    const cache = new TripCache(fakeRest, fakePool);

    for (let i = 0; i < 5; i++) {
      await cache.get("tripA");
      expect(fakeClient.listenerCount("remoteOp")).toBe(1);
      cache.invalidate("tripA");
      expect(fakeClient.listenerCount("remoteOp")).toBe(0);
    }
  });

  it("unregisters listener on clear", async () => {
    const fakeClient1 = new FakeShareDBClient();
    const fakeClient2 = new FakeShareDBClient();
    const fakeRest = {
      getTripWithResources: async () => ({ geos: [] }),
    } as unknown as RestClient;

    const fakePool = {
      get: (tripKey: string) => (tripKey === "tripA" ? fakeClient1 : fakeClient2),
    } as unknown as ShareDBPool;

    const cache = new TripCache(fakeRest, fakePool);

    await cache.get("tripA");
    await cache.get("tripB");

    expect(fakeClient1.listenerCount("remoteOp")).toBe(1);
    expect(fakeClient2.listenerCount("remoteOp")).toBe(1);

    cache.clear();

    expect(fakeClient1.listenerCount("remoteOp")).toBe(0);
    expect(fakeClient2.listenerCount("remoteOp")).toBe(0);
  });
});
