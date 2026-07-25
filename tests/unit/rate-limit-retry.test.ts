import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../src/context.ts";
import { WanderlogError } from "../../src/errors.ts";
import type { Json0Op } from "../../src/ot/apply.ts";
import { submitOp } from "../../src/tools/shared.ts";
import { ShareDBClient } from "../../src/transport/sharedb.ts";

const ops: Json0Op[] = [{ p: ["days"], od: 3, oi: 5 }];

function makeFakeContext(failures: Array<Error | null>): {
  ctx: AppContext;
  submitCalls: () => number;
  invalidateCount: () => number;
  applyLocalOpCount: () => number;
} {
  let callIndex = 0;
  let invalidateCount = 0;
  let applyLocalOpCount = 0;

  const fakeClient = {
    isSubscribed: true,
    version: 0,
    async submit(_ops: Json0Op[]): Promise<void> {
      const failure = failures[callIndex++];
      if (failure) throw failure;
      this.version += 1;
    },
  };

  const ctx = {
    pool: { get: () => fakeClient },
    tripCache: {
      applyLocalOp: () => {
        applyLocalOpCount++;
      },
      invalidate: () => {
        invalidateCount++;
      },
    },
  } as unknown as AppContext;

  return {
    ctx,
    submitCalls: () => callIndex,
    invalidateCount: () => invalidateCount,
    applyLocalOpCount: () => applyLocalOpCount,
  };
}

const rateLimitError = () =>
  new WanderlogError(
    "Wanderlog rejected the request (4001): Too many requests",
    "rate_limited",
  );

describe("submitOp rate-limit retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries after a rate_limited error and succeeds", async () => {
    const fake = makeFakeContext([rateLimitError(), null]);
    const promise = submitOp(fake.ctx, "tripA", ops);
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
    expect(fake.submitCalls()).toBe(2);
    expect(fake.applyLocalOpCount()).toBe(1);
    expect(fake.invalidateCount()).toBe(0);
  });

  it("gives up after exhausting retries and invalidates the cache", async () => {
    const fake = makeFakeContext([
      rateLimitError(),
      rateLimitError(),
      rateLimitError(),
      rateLimitError(),
    ]);
    const promise = submitOp(fake.ctx, "tripA", ops);
    const assertion = expect(promise).rejects.toMatchObject({
      code: "rate_limited",
    });
    await vi.advanceTimersByTimeAsync(2_000 + 4_000 + 8_000);
    await assertion;
    expect(fake.submitCalls()).toBe(4);
    expect(fake.applyLocalOpCount()).toBe(0);
    expect(fake.invalidateCount()).toBe(1);
  });

  it("does not retry non-rate-limit errors", async () => {
    const fake = makeFakeContext([
      new WanderlogError("Submit op timeout", "submit_timeout"),
    ]);
    await expect(submitOp(fake.ctx, "tripA", ops)).rejects.toMatchObject({
      code: "submit_timeout",
    });
    expect(fake.submitCalls()).toBe(1);
    expect(fake.invalidateCount()).toBe(1);
  });
});

describe("ShareDBClient bare {code, message} rejection frames", () => {
  const config = {
    cookieHeader: "connect.sid=test",
    baseUrl: "https://example.test",
    wsBaseUrl: "wss://example.test",
    userAgent: "test",
  };

  function clientWithPendingOp(): {
    client: ShareDBClient;
    pending: Promise<void>;
  } {
    const client = new ShareDBClient(config, "tripA");
    const internals = client as unknown as {
      pendingOps: Map<
        number,
        { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
      >;
      handleFrame: (
        frame: Record<string, unknown>,
        handshakeTimeout: NodeJS.Timeout,
        connectResolve: () => void,
      ) => void;
    };
    const pending = new Promise<void>((resolve, reject) => {
      internals.pendingOps.set(1, {
        resolve,
        reject,
        timer: setTimeout(() => {}, 60_000),
      });
    });
    return { client, pending };
  }

  function deliverFrame(client: ShareDBClient, frame: Record<string, unknown>) {
    (
      client as unknown as {
        handleFrame: (
          frame: Record<string, unknown>,
          handshakeTimeout: NodeJS.Timeout,
          connectResolve: () => void,
        ) => void;
      }
    ).handleFrame(frame, setTimeout(() => {}, 60_000), () => {});
  }

  it("maps code 4001 to a rate_limited error on pending ops", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, {
      code: 4001,
      message: "Too many requests; please try again later",
    });
    await expect(pending).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("maps other bare codes to ws_rejected", async () => {
    const { client, pending } = clientWithPendingOp();
    deliverFrame(client, { code: 4999, message: "nope" });
    await expect(pending).rejects.toMatchObject({ code: "ws_rejected" });
  });

  it("does not treat op acks (which carry `a`) as rejections", async () => {
    const { client, pending } = clientWithPendingOp();
    const internals = client as unknown as { sessionId?: string };
    internals.sessionId = "session-1";
    deliverFrame(client, {
      a: "op",
      src: "session-1",
      seq: 1,
      v: 7,
      c: "TripPlans",
      d: "tripA",
    });
    await expect(pending).resolves.toBeUndefined();
    expect(client.version).toBe(8);
  });
});

describe("ShareDBClient own-op idempotency", () => {
  const config = {
    cookieHeader: "connect.sid=test",
    baseUrl: "https://example.test",
    wsBaseUrl: "wss://example.test",
    userAgent: "test",
  };

  function deliverFrame(client: ShareDBClient, frame: Record<string, unknown>) {
    (
      client as unknown as {
        handleFrame: (
          frame: Record<string, unknown>,
          handshakeTimeout: NodeJS.Timeout,
          connectResolve: () => void,
        ) => void;
      }
    ).handleFrame(frame, setTimeout(() => {}, 60_000), () => {});
  }

  it("does not re-emit an op we authored when no pending entry matches", () => {
    // Reproduces the double-apply bug: a late ack (its submit already timed out)
    // or a duplicate ack from a rate-limit retry echoes our own src with a seq
    // we've already cleared. It must NOT surface as a remoteOp — the cache
    // already applied it once, and replaying it duplicates the mutation.
    const client = new ShareDBClient(config, "tripA");
    const internals = client as unknown as { sessionId?: string; _version: number };
    internals.sessionId = "me";
    internals._version = 3;

    let remoteOps = 0;
    client.on("remoteOp", () => {
      remoteOps++;
    });

    deliverFrame(client, {
      a: "op",
      src: "me",
      seq: 99, // no pending entry with this seq
      v: 2,
      op: [{ p: ["days"], oi: 5 }],
      c: "TripPlans",
      d: "tripA",
    });

    expect(remoteOps).toBe(0);
    // Version must not rewind below the value newer ops already advanced it to.
    expect(client.version).toBe(3);
  });

  it("still emits genuine remote ops from other sessions", () => {
    const client = new ShareDBClient(config, "tripA");
    const internals = client as unknown as { sessionId?: string };
    internals.sessionId = "me";

    const seen: Array<{ ops: unknown; version: number }> = [];
    client.on("remoteOp", (ops, version) => {
      seen.push({ ops, version });
    });

    deliverFrame(client, {
      a: "op",
      src: "someone-else",
      v: 10,
      op: [{ p: ["days"], oi: 7 }],
      c: "TripPlans",
      d: "tripA",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.version).toBe(11);
    expect(client.version).toBe(11);
  });

  it("discardSnapshot forces the next subscribe to refetch", () => {
    const client = new ShareDBClient(config, "tripA");
    const internals = client as unknown as {
      subscribed: boolean;
      snapshot: unknown;
    };
    internals.subscribed = true;
    internals.snapshot = { title: "cached" };

    expect(client.isSubscribed).toBe(true);
    expect(client.currentSnapshot).toEqual({ title: "cached" });

    client.discardSnapshot();

    expect(client.isSubscribed).toBe(false);
    expect(client.currentSnapshot).toBeUndefined();
  });
});
