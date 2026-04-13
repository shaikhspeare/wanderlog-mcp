import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import { submitOp } from "../../src/tools/shared.ts";

/**
 * Exercises the per-trip submit mutex in isolation. Uses a fake AppContext
 * that records the order and timing of submits against the fake ShareDBClient,
 * so we can prove parallel calls are actually serialized.
 */

type SubmitRecord = {
  tripKey: string;
  startedAt: number;
  endedAt: number;
  result: "ok" | "fail";
};

function makeFakeContext(options: {
  submitDelay: number;
  failOn?: (callIndex: number) => boolean;
}): {
  ctx: AppContext;
  records: SubmitRecord[];
  invalidateCount: number;
  applyLocalOpCount: number;
} {
  const records: SubmitRecord[] = [];
  let callIndex = 0;
  let invalidateCount = 0;
  let applyLocalOpCount = 0;

  const fakeClient = {
    isSubscribed: true,
    version: 0,
    async submit(_ops: Json0Op[]): Promise<void> {
      const thisCall = callIndex++;
      const rec: SubmitRecord = {
        tripKey: "",
        startedAt: Date.now(),
        endedAt: 0,
        result: "ok",
      };
      records.push(rec);
      await new Promise((r) => setTimeout(r, options.submitDelay));
      rec.endedAt = Date.now();
      if (options.failOn?.(thisCall)) {
        rec.result = "fail";
        throw new Error(`simulated failure on call ${thisCall}`);
      }
      this.version += 1;
    },
  };

  const ctx = {
    pool: {
      get: (_tripKey: string) => fakeClient,
    },
    tripCache: {
      applyLocalOp: (_tripKey: string, _ops: Json0Op[], _version: number) => {
        applyLocalOpCount++;
      },
      invalidate: (_tripKey: string) => {
        invalidateCount++;
      },
    },
  } as unknown as AppContext;

  return {
    ctx,
    records,
    get invalidateCount() {
      return invalidateCount;
    },
    get applyLocalOpCount() {
      return applyLocalOpCount;
    },
  };
}

describe("submitOp per-trip mutex", () => {
  it("serializes parallel submits on the same trip", async () => {
    const { ctx, records } = makeFakeContext({ submitDelay: 40 });
    const ops: Json0Op[] = [{ p: ["a"], oi: 1 }];

    // Fire 5 submits in parallel. They should run strictly one at a time.
    await Promise.all([
      submitOp(ctx, "tripA", ops),
      submitOp(ctx, "tripA", ops),
      submitOp(ctx, "tripA", ops),
      submitOp(ctx, "tripA", ops),
      submitOp(ctx, "tripA", ops),
    ]);

    expect(records.length).toBe(5);
    // Each submit starts after (or at) the previous one's end. With a 40ms
    // delay and strict serialization, gaps are >= 0; with parallelism they'd
    // all start near 0 and overlap heavily.
    for (let i = 1; i < records.length; i++) {
      expect(records[i]!.startedAt).toBeGreaterThanOrEqual(
        records[i - 1]!.endedAt - 5,
      );
    }
  });

  it("runs submits on different trips in parallel", async () => {
    const { ctx, records } = makeFakeContext({ submitDelay: 50 });
    const ops: Json0Op[] = [{ p: ["a"], oi: 1 }];

    const start = Date.now();
    await Promise.all([
      submitOp(ctx, "tripA", ops),
      submitOp(ctx, "tripB", ops),
      submitOp(ctx, "tripC", ops),
    ]);
    const elapsed = Date.now() - start;

    expect(records.length).toBe(3);
    // Parallel across trips: total time should be roughly one delay, not three.
    expect(elapsed).toBeLessThan(120);
  });

  it("a failed submit does not block the queue", async () => {
    const holder = makeFakeContext({
      submitDelay: 20,
      failOn: (i) => i === 0,
    });
    const ops: Json0Op[] = [{ p: ["a"], oi: 1 }];

    const results = await Promise.allSettled([
      submitOp(holder.ctx, "tripA", ops),
      submitOp(holder.ctx, "tripA", ops),
      submitOp(holder.ctx, "tripA", ops),
    ]);

    expect(results[0]!.status).toBe("rejected");
    expect(results[1]!.status).toBe("fulfilled");
    expect(results[2]!.status).toBe("fulfilled");
  });

  it("invalidates the cache on submit failure", async () => {
    const holder = makeFakeContext({
      submitDelay: 10,
      failOn: () => true,
    });
    const ops: Json0Op[] = [{ p: ["a"], oi: 1 }];

    await expect(submitOp(holder.ctx, "tripA", ops)).rejects.toThrow();
    expect(holder.invalidateCount).toBe(1);
    expect(holder.applyLocalOpCount).toBe(0);
  });

  it("applies op locally on submit success", async () => {
    const holder = makeFakeContext({ submitDelay: 10 });
    const ops: Json0Op[] = [{ p: ["a"], oi: 1 }];

    await submitOp(holder.ctx, "tripA", ops);
    expect(holder.applyLocalOpCount).toBe(1);
    expect(holder.invalidateCount).toBe(0);
  });
});
