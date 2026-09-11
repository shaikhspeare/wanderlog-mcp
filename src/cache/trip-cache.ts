import { applyOp, type Json0Op } from "../ot/apply.js";
import { WanderlogError } from "../errors.js";
import type { RestClient } from "../transport/rest.js";
import type { ShareDBClient, ShareDBPool } from "../transport/sharedb.js";
import type { Geo, TripPlan } from "../types.js";

export type CacheEntry = {
  snapshot: TripPlan;
  version: number;
  geos: Geo[];
  client: ShareDBClient;
  remoteOpListener: (ops: Json0Op[], version: number) => void;
  closedListener: (code: number) => void;
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
    if (existing) {
      if (existing.client.isSubscribed) return existing;
      this.deleteEntry(tripKey);
    }

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
    try {
      const snapshot = await client.subscribe();

      const remoteOpListener = (ops: Json0Op[], version: number) => {
        const current = this.entries.get(tripKey);
        if (!current || current.client !== client) return;
        try {
          current.snapshot = applyOp(current.snapshot, ops);
          current.version = version;
        } catch {
          this.deleteEntry(tripKey);
        }
      };
      const closedListener = () => {
        if (this.entries.get(tripKey)?.client === client) {
          // Retiring the client suppresses background resubscription, which
          // could otherwise refresh the client without refreshing this cache.
          this.deleteEntry(tripKey);
        }
      };

      client.on("remoteOp", remoteOpListener);
      client.on("closed", closedListener);

      if (!client.isSubscribed) {
        client.off("remoteOp", remoteOpListener);
        client.off("closed", closedListener);
        throw new WanderlogError(
          `Trip ${tripKey} subscription closed before it could be cached`,
          "ws_closed",
        );
      }

      const entry: CacheEntry = {
        snapshot,
        version: client.version,
        geos,
        client,
        remoteOpListener,
        closedListener,
      };
      this.entries.set(tripKey, entry);
      return entry;
    } catch (err) {
      this.pool.evict(tripKey, client);
      throw err;
    }
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

  private deleteEntry(tripKey: string): void {
    const entry = this.entries.get(tripKey);
    if (!entry) return;
    entry.client.off("remoteOp", entry.remoteOpListener);
    entry.client.off("closed", entry.closedListener);
    this.entries.delete(tripKey);
    this.pool.evict(tripKey, entry.client);
  }

  invalidate(tripKey: string): void {
    this.deleteEntry(tripKey);
  }

  clear(): void {
    for (const tripKey of this.entries.keys()) {
      this.deleteEntry(tripKey);
    }
  }
}
