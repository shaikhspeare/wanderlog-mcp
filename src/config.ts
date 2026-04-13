import { WanderlogValidationError } from "./errors.js";

export type Config = {
  cookieHeader: string;
  baseUrl: string;
  wsBaseUrl: string;
  userAgent: string;
};

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/**
 * Normalizes a cookie value into a valid Cookie header.
 *
 * Accepts:
 *   - `s%3A...`                           → wraps as `connect.sid=s%3A...`
 *   - `connect.sid=s%3A...`               → passes through
 *   - `connect.sid=s%3A...; other=x`      → passes through
 *
 * Rejects empty strings and obviously malformed values.
 */
export function normalizeCookie(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new WanderlogValidationError(
      "WANDERLOG_COOKIE is empty",
      "Set WANDERLOG_COOKIE to the connect.sid cookie value from wanderlog.com.",
    );
  }

  if (trimmed.includes("connect.sid=")) {
    return trimmed;
  }

  if (trimmed.startsWith("s%3A") || trimmed.startsWith("s:")) {
    return `connect.sid=${trimmed}`;
  }

  throw new WanderlogValidationError(
    "WANDERLOG_COOKIE does not look like a connect.sid cookie",
    "Expected a value starting with 's%3A' or 'connect.sid=s%3A'. Copy the exact value from DevTools → Application → Cookies → wanderlog.com → connect.sid.",
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.WANDERLOG_COOKIE;
  if (!raw) {
    throw new WanderlogValidationError(
      "WANDERLOG_COOKIE environment variable is not set",
      "Set WANDERLOG_COOKIE in your MCP config. See README for how to capture the cookie.",
    );
  }

  return {
    cookieHeader: normalizeCookie(raw),
    baseUrl: env.WANDERLOG_BASE_URL ?? "https://wanderlog.com",
    wsBaseUrl: env.WANDERLOG_WS_BASE_URL ?? "wss://wanderlog.com",
    userAgent: env.WANDERLOG_USER_AGENT ?? DEFAULT_USER_AGENT,
  };
}
