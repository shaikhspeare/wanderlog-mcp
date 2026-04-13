import { applyOp, type Json0Op } from "../ot/apply.js";
import type { RestClient } from "../transport/rest.js";
import type { ShareDBPool } from "../transport/sharedb.js";
import type { Geo, TripPlan } from "../types.js";

type CacheEntry = {
  snapshot: TripPlan;
  version: number;
  geos: Geo[];
};

/**
 * Live trip cache. On first access, validates the trip exists via REST
 * (fast 404 path for bad keys), then subscribes via ShareDBPool for live
 * updates. Incoming remote ops are applied to the cached doc so reads stay
 * current without refetching.
 *
 * Callers can read `entry.snapshot` and `entry.version` to prepare submit
 * ops with the correct version vector.
 */
export class TripCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly subscribing = new Map<string, Promise<CacheEntry>>();

  constructor(
    private readonly rest: RestClient,
    private readonly pool: ShareDBPool,
  ) {}

  async get(tripKey: string): Promise<TripPlan> {
    const entry = await this.ensureEntry(tripKey);
    return entry.snapshot;
  }

  async getEntry(tripKey: string): Promise<CacheEntry> {
    return this.ensureEntry(tripKey);
  }

  private async ensureEntry(tripKey: string): Promise<CacheEntry> {
    const existing = this.entries.get(tripKey);
    if (existing) return existing;

    const pending = this.subscribing.get(tripKey);
    if (pending) return pending;

    const promise = this.subscribeAndCache(tripKey);
    this.subscribing.set(tripKey, promise);
    try {
      return await promise;
    } finally {
      this.subscribing.delete(tripKey);
    }
  }

  private async subscribeAndCache(tripKey: string): Promise<CacheEntry> {
    // REST pre-check: fails fast with 404 → WanderlogNotFoundError.
    // Without this, a bogus trip key hangs on the WS subscribe timeout.
    // The response also gives us the trip's associated geos, which the
    // WebSocket snapshot doesn't include — we store them for search biasing.
    const { geos } = await this.rest.getTripWithResources(tripKey);

    const client = this.pool.get(tripKey);
    const snapshot = await client.subscribe();
    const entry: CacheEntry = { snapshot, version: client.version, geos };
    this.entries.set(tripKey, entry);

    client.on("remoteOp", (ops: Json0Op[], version: number) => {
      const current = this.entries.get(tripKey);
      if (!current) return;
      try {
        current.snapshot = applyOp(current.snapshot, ops);
        current.version = version;
      } catch {
        // If a remote op fails to apply to our snapshot, our view is stale.
        // Drop the entry; next get() re-subscribes from a fresh snapshot.
        this.entries.delete(tripKey);
      }
    });

    return entry;
  }

  /**
   * Called after submitting an op ourselves. Applies the op locally and
   * bumps the version so the cache matches what the server just accepted.
   */
  applyLocalOp(tripKey: string, ops: Json0Op[], newVersion: number): void {
    const entry = this.entries.get(tripKey);
    if (!entry) return;
    entry.snapshot = applyOp(entry.snapshot, ops);
    entry.version = newVersion;
  }

  invalidate(tripKey: string): void {
    this.entries.delete(tripKey);
  }

  clear(): void {
    this.entries.clear();
  }
}
