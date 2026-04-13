import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WanderlogAuthError,
  WanderlogError,
  WanderlogNetworkError,
  WanderlogNotFoundError,
  WanderlogValidationError,
} from "../../src/errors.ts";
import { loadConfig, normalizeCookie } from "../../src/config.ts";
import { RestClient } from "../../src/transport/rest.ts";

/**
 * Secret-leak canary. The `connect.sid` cookie is a long-lived credential.
 * Invariant #5 in docs/architecture.md: "Cookie must never appear in tool
 * responses, logs, or error messages." This test plants a sentinel cookie
 * and walks every path that might touch it — success, error, and parse
 * failure — asserting the sentinel never makes it out alive.
 *
 * If this test fails, something started echoing `config.cookieHeader` into
 * user-visible output. Find it and stop it — do not loosen the assertion.
 */
const SENTINEL = "s%3ASENTINEL-COOKIE-VALUE-DO-NOT-LEAK.signaturepart";
const SENTINEL_FRAGMENTS = [
  SENTINEL,
  "SENTINEL-COOKIE-VALUE",
  "signaturepart",
];

function containsSentinel(s: string): string | null {
  for (const f of SENTINEL_FRAGMENTS) {
    if (s.includes(f)) return f;
  }
  return null;
}

describe("secret-leak canary — cookie never appears in errors", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeClient(): RestClient {
    return new RestClient({
      cookieHeader: `connect.sid=${SENTINEL}`,
      baseUrl: "https://wanderlog.test",
      wsBaseUrl: "wss://wanderlog.test",
      userAgent: "wanderdog-test",
    });
  }

  async function assertNoLeakFromThrowable(fn: () => Promise<unknown>) {
    try {
      await fn();
      throw new Error("expected function to throw");
    } catch (err) {
      const e = err as Error & { toUserMessage?: () => string; stack?: string };
      const surfaces = [
        e.message,
        e.stack ?? "",
        e instanceof WanderlogError ? e.toUserMessage() : "",
        JSON.stringify(e, Object.getOwnPropertyNames(e)),
      ];
      for (const s of surfaces) {
        const hit = containsSentinel(s);
        if (hit) {
          throw new Error(
            `secret leak: surface contained '${hit}'\n--- surface ---\n${s}`,
          );
        }
      }
    }
  }

  it("401 auth errors do not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    );
    await assertNoLeakFromThrowable(() => makeClient().listTrips());
  });

  it("403 auth errors do not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await assertNoLeakFromThrowable(() => makeClient().getTrip("abc123"));
  });

  it("404 not-found errors do not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await assertNoLeakFromThrowable(() => makeClient().getTrip("abc123"));
  });

  it("5xx server errors do not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("kaboom", { status: 503 }),
    );
    await assertNoLeakFromThrowable(() => makeClient().listTrips());
  });

  it("network errors do not include the cookie", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await assertNoLeakFromThrowable(() => makeClient().listTrips());
  });

  it("JSON parse errors do not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await assertNoLeakFromThrowable(() => makeClient().listTrips());
  });

  it("unexpected 4xx status does not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("teapot", { status: 418 }),
    );
    await assertNoLeakFromThrowable(() => makeClient().listTrips());
  });

  it("delete-trip error path does not include the cookie", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await assertNoLeakFromThrowable(() =>
      makeClient().deleteTrip("abc123"),
    );
  });
});

describe("secret-leak canary — config errors", () => {
  it("normalizeCookie validation error for malformed value does not echo the input", () => {
    // Defense in depth: even if a malformed cookie is passed in, we don't
    // want to echo it back in the error message.
    try {
      normalizeCookie("malformed-but-long-and-contains-SENTINEL-like-data");
      throw new Error("expected throw");
    } catch (err) {
      const e = err as WanderlogValidationError;
      expect(e).toBeInstanceOf(WanderlogValidationError);
      expect(e.message).not.toContain("SENTINEL");
      expect(e.toUserMessage()).not.toContain("SENTINEL");
    }
  });

  it("loadConfig missing env error does not contain environment dump", () => {
    try {
      loadConfig({ FOO: "bar" } as NodeJS.ProcessEnv);
      throw new Error("expected throw");
    } catch (err) {
      const e = err as WanderlogValidationError;
      expect(e).toBeInstanceOf(WanderlogValidationError);
      expect(e.toUserMessage()).not.toContain("FOO=bar");
    }
  });
});

describe("secret-leak canary — toUserMessage is sanitized for all error types", () => {
  it("each error type's toUserMessage can be rendered without crashing", () => {
    const errors: WanderlogError[] = [
      new WanderlogAuthError(),
      new WanderlogNotFoundError("Trip", "abc"),
      new WanderlogNetworkError("connection reset"),
      new WanderlogError("generic", "generic_code"),
      new WanderlogValidationError("bad input"),
    ];
    for (const e of errors) {
      const msg = e.toUserMessage();
      expect(typeof msg).toBe("string");
      expect(containsSentinel(msg)).toBeNull();
    }
  });
});
