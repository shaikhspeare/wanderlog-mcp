import { describe, expect, it } from "vitest";
import { loadConfig, normalizeCookie } from "../../src/config.ts";
import { WanderlogValidationError } from "../../src/errors.ts";

describe("normalizeCookie", () => {
  it("wraps a bare s%3A... value in connect.sid=", () => {
    const result = normalizeCookie("s%3AabcDEF123.signature");
    expect(result).toBe("connect.sid=s%3AabcDEF123.signature");
  });

  it("wraps a bare s: value (unencoded) in connect.sid=", () => {
    const result = normalizeCookie("s:abcDEF123.signature");
    expect(result).toBe("connect.sid=s:abcDEF123.signature");
  });

  it("passes through a full connect.sid=... value", () => {
    const input = "connect.sid=s%3AabcDEF123.signature";
    expect(normalizeCookie(input)).toBe(input);
  });

  it("passes through a multi-cookie header", () => {
    const input = "connect.sid=s%3AabcDEF123.signature; other=value";
    expect(normalizeCookie(input)).toBe(input);
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeCookie("  s%3Axyz.sig  ")).toBe("connect.sid=s%3Axyz.sig");
  });

  it("rejects empty strings", () => {
    expect(() => normalizeCookie("")).toThrow(WanderlogValidationError);
    expect(() => normalizeCookie("   ")).toThrow(WanderlogValidationError);
  });

  it("rejects values that don't look like connect.sid cookies", () => {
    expect(() => normalizeCookie("random garbage")).toThrow(WanderlogValidationError);
    expect(() => normalizeCookie("jwt=eyJhbGci...")).toThrow(WanderlogValidationError);
  });
});

describe("loadConfig", () => {
  it("loads with WANDERLOG_COOKIE set", () => {
    const config = loadConfig({
      WANDERLOG_COOKIE: "s%3Atest.signature",
    } as NodeJS.ProcessEnv);

    expect(config.cookieHeader).toBe("connect.sid=s%3Atest.signature");
    expect(config.baseUrl).toBe("https://wanderlog.com");
    expect(config.wsBaseUrl).toBe("wss://wanderlog.com");
    expect(config.userAgent).toContain("Mozilla");
  });

  it("throws actionable error when WANDERLOG_COOKIE is missing", () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(WanderlogValidationError);
  });

  it("allows base URL override", () => {
    const config = loadConfig({
      WANDERLOG_COOKIE: "s%3Atest.sig",
      WANDERLOG_BASE_URL: "https://staging.wanderlog.com",
    } as NodeJS.ProcessEnv);

    expect(config.baseUrl).toBe("https://staging.wanderlog.com");
  });
});
