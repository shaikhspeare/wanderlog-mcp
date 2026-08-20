import { describe, expect, it } from "vitest";
import type { CacheEntry } from "../../src/cache/trip-cache.ts";
import type { AppContext } from "../../src/context.ts";
import { applyOp, type Json0Op } from "../../src/ot/apply.ts";
import type { TripPlan } from "../../src/types.ts";
import { submitOp } from "../../src/tools/shared.ts";

type Snapshot = TripPlan & { counter: number };

function makeEntry(): CacheEntry {
  return {
    snapshot: { counter: 0 } as Snapshot,
    version: 0,
    geos: [],
  };
}

function makeFakeContext(options: {
  submitDelay?: number;
  failOn?: (callIndex: number) => boolean;
  failApply?: boolean;
} = {}) {
  const entries = new Map<string, CacheEntry>();
  const activeByTrip = new Map<string, number>();
  let activeTotal = 0;
  let maxActiveTotal = 0;
  let maxActiveSameTrip = 0;
  let callIndex = 0;
  let invalidateCount = 0;
  let applyLocalOpCount = 0;
  let getEntryCount = 0;

  const getEntry = (tripKey: string): CacheEntry => {
    getEntryCount++;
    let entry = entries.get(tripKey);
    if (!entry) {
      entry = makeEntry();
      entries.set(tripKey, entry);
    }
    return entry;
  };

  const clients = new Map<string, {
    isSubscribed: boolean;
    version: number;
    submit(ops: Json0Op[]): Promise<void>;
  }>();
  const ctx = {
    pool: {
      get: (tripKey: string) => {
        let client = clients.get(tripKey);
        if (!client) {
          client = {
            isSubscribed: true,
            version: 0,
            async submit(_ops: Json0Op[]) {
              const thisCall = callIndex++;
              const activeForTrip = (activeByTrip.get(tripKey) ?? 0) + 1;
              activeByTrip.set(tripKey, activeForTrip);
              activeTotal++;
              maxActiveSameTrip = Math.max(maxActiveSameTrip, activeForTrip);
              maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
              await new Promise((resolve) =>
                setTimeout(resolve, options.submitDelay ?? 5),
              );
              activeByTrip.set(tripKey, activeForTrip - 1);
              activeTotal--;
              if (options.failOn?.(thisCall)) {
                throw new Error(`simulated failure on call ${thisCall}`);
              }
              this.version++;
            },
          };
          clients.set(tripKey, client);
        }
        return client;
      },
    },
    tripCache: {
      getEntry: async (tripKey: string) => getEntry(tripKey),
      applyLocalOp: (tripKey: string, ops: Json0Op[], version: number) => {
        applyLocalOpCount++;
        if (options.failApply) throw new Error("simulated apply failure");
        const entry = getEntry(tripKey);
        entry.snapshot = applyOp(entry.snapshot, ops);
        entry.version = version;
      },
      invalidate: (tripKey: string) => {
        invalidateCount++;
        entries.delete(tripKey);
      },
    },
  } as unknown as AppContext;

  return {
    ctx,
    entry: (tripKey = "tripA") => getEntry(tripKey),
    counts: () => ({
      applyLocalOpCount,
      getEntryCount,
      invalidateCount,
      maxActiveSameTrip,
      maxActiveTotal,
    }),
  };
}

const increment = async (
  _entry: CacheEntry,
  submit: (ops: Json0Op[]) => Promise<void>,
) => submit([{ p: ["counter"], na: 1 }]);

describe("submitOp per-trip mutation transaction", () => {
  it("serializes same-trip mutations", async () => {
    const fake = makeFakeContext({ submitDelay: 15 });
    await Promise.all(
      Array.from({ length: 5 }, () => submitOp(fake.ctx, "tripA", increment)),
    );
    expect(fake.counts().maxActiveSameTrip).toBe(1);
    expect((fake.entry().snapshot as Snapshot).counter).toBe(5);
  });

  it("runs different-trip mutations in parallel", async () => {
    const fake = makeFakeContext({ submitDelay: 20 });
    await Promise.all([
      submitOp(fake.ctx, "tripA", increment),
      submitOp(fake.ctx, "tripB", increment),
      submitOp(fake.ctx, "tripC", increment),
    ]);
    expect(fake.counts().maxActiveTotal).toBe(3);
  });

  it("recovers the queue after a failed submit", async () => {
    const fake = makeFakeContext({ failOn: (index) => index === 0 });
    const results = await Promise.allSettled([
      submitOp(fake.ctx, "tripA", increment),
      submitOp(fake.ctx, "tripA", increment),
      submitOp(fake.ctx, "tripA", increment),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
    ]);
  });

  it("gives queued callbacks the snapshot updated by prior mutations", async () => {
    const fake = makeFakeContext({ submitDelay: 15 });
    const seen: number[] = [];
    const mutation = (entry: CacheEntry, submit: (ops: Json0Op[]) => Promise<void>) => {
      seen.push((entry.snapshot as Snapshot).counter);
      return submit([{ p: ["counter"], na: 1 }]);
    };
    await Promise.all([
      submitOp(fake.ctx, "tripA", mutation),
      submitOp(fake.ctx, "tripA", mutation),
    ]);
    expect(seen).toEqual([0, 1]);
  });

  it("applies successful batches to the stable cache entry", async () => {
    const fake = makeFakeContext();
    const entry = fake.entry();
    await submitOp(fake.ctx, "tripA", increment);
    expect(fake.entry()).toBe(entry);
    expect((entry.snapshot as Snapshot).counter).toBe(1);
    expect(fake.counts()).toMatchObject({
      applyLocalOpCount: 1,
      invalidateCount: 0,
    });
  });

  it("invalidates on submit or local-apply failure", async () => {
    const submitFailure = makeFakeContext({ failOn: () => true });
    await expect(
      submitOp(submitFailure.ctx, "tripA", increment),
    ).rejects.toThrow("simulated failure");
    expect(submitFailure.counts().invalidateCount).toBe(1);

    const applyFailure = makeFakeContext({ failApply: true });
    await expect(
      submitOp(applyFailure.ctx, "tripA", increment),
    ).rejects.toThrow("simulated apply failure");
    expect(applyFailure.counts().invalidateCount).toBe(1);
  });

  it("does not invalidate on callback validation errors", async () => {
    const fake = makeFakeContext();
    await expect(
      submitOp(fake.ctx, "tripA", () => {
        throw new Error("validation failed");
      }),
    ).rejects.toThrow("validation failed");
    expect(fake.counts().invalidateCount).toBe(0);
    await expect(submitOp(fake.ctx, "tripA", increment)).resolves.toBeUndefined();
  });
});
