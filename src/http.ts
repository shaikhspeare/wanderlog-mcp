#!/usr/bin/env node
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { normalizeCookie, type Config } from "./config.js";
import { RestClient } from "./transport/rest.js";
import { ShareDBPool } from "./transport/sharedb.js";
import { TripCache } from "./cache/trip-cache.js";
import type { AppContext } from "./context.js";
import { WanderlogError } from "./errors.js";
import { buildServer } from "./server.js";

// --- per-user context cache keyed by cookie hash ---

type CachedContext = { ctx: AppContext; lastUsed: number };

const CTX_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ctxCache = new Map<string, CachedContext>();
const ctxPending = new Map<string, Promise<AppContext>>();

function hashCookie(cookie: string): string {
  return createHash("sha256").update(cookie).digest("hex").slice(0, 16);
}

function evictStaleContexts() {
  const now = Date.now();
  for (const [key, entry] of ctxCache) {
    if (now - entry.lastUsed > CTX_TTL_MS) {
      entry.ctx.pool.closeAll();
      ctxCache.delete(key);
    }
  }
}

// Run eviction every 2 minutes
setInterval(evictStaleContexts, 2 * 60 * 1000).unref();

async function getOrCreateContext(cookieRaw: string): Promise<AppContext> {
  const cookie = normalizeCookie(cookieRaw);
  const key = hashCookie(cookie);

  const cached = ctxCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.ctx;
  }

  // Deduplicate concurrent requests for the same cookie
  const pending = ctxPending.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const config: Config = {
      cookieHeader: cookie,
      baseUrl: process.env.WANDERLOG_BASE_URL ?? "https://wanderlog.com",
      wsBaseUrl: process.env.WANDERLOG_WS_BASE_URL ?? "wss://wanderlog.com",
      userAgent:
        process.env.WANDERLOG_USER_AGENT ??
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    };
    const rest = new RestClient(config);
    const pool = new ShareDBPool(config);
    const tripCache = new TripCache(rest, pool);

    const user = await rest.getUser();
    const ctx: AppContext = { config, rest, pool, tripCache, userId: user.id, authenticated: true };

    ctxCache.set(key, { ctx, lastUsed: Date.now() });
    return ctx;
  })();

  ctxPending.set(key, promise);
  try {
    return await promise;
  } finally {
    ctxPending.delete(key);
  }
}

// --- extract cookie from Authorization header or query param ---

function extractCookie(req: { headers: Record<string, string | undefined>; url?: string }): string | null {
  const auth = req.headers.authorization;
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1];
  }

  // Fall back to ?token= query parameter (for clients without Bearer support)
  if (req.url) {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    if (token) return token;
  }

  return null;
}

// --- HTTP server ---

async function main() {
  const app = createMcpExpressApp({ host: "0.0.0.0" });

  // All MCP methods (POST, GET, DELETE) go through auth + transport so
  // the transport itself decides what's allowed per the spec.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleMcp = async (req: any, res: any) => {
    const cookie = extractCookie(req);
    if (!cookie) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Missing Authorization header. Set Bearer token to your Wanderlog connect.sid cookie value.",
        },
        id: null,
      });
      return;
    }

    let ctx: AppContext;
    try {
      ctx = await getOrCreateContext(cookie);
    } catch (err) {
      const msg =
        err instanceof WanderlogError
          ? err.toUserMessage()
          : (err as Error).message;
      console.error(`[wanderdog] auth failed: ${msg}`);
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Authentication failed: ${msg}` },
        id: null,
      });
      return;
    }

    const server = buildServer(ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[wanderdog] error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }

    res.on("close", () => {
      transport.close();
      server.close();
    });
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  // Health check for fly.io
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get("/health", (_req: any, res: any) => {
    res.status(200).json({ status: "ok" });
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, "0.0.0.0", () => {
    console.log(`[wanderdog] HTTP server listening on 0.0.0.0:${port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[wanderdog] ${signal} received, shutting down`);
    for (const [, entry] of ctxCache) {
      entry.ctx.pool.closeAll();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[wanderdog] fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
