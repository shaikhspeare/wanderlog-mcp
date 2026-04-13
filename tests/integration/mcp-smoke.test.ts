import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Smoke-tests the compiled stdio server by sending JSON-RPC frames and reading
 * stdout. Assumes `npm run build` has been run.
 */
describe("MCP stdio server (smoke)", () => {
  let proc: ChildProcessWithoutNullStreams | undefined;

  afterEach(() => {
    proc?.kill("SIGINT");
    proc = undefined;
  });

  const startServer = (): ChildProcessWithoutNullStreams => {
    proc = spawn("node", ["--env-file=.env", "dist/index.js"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return proc;
  };

  const sendRequest = async (
    p: ChildProcessWithoutNullStreams,
    request: object,
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if ("id" in msg && msg.id === (request as { id?: number }).id) {
              p.stdout.off("data", onData);
              resolve(msg);
              return;
            }
          } catch {
            // partial line; keep buffering
          }
        }
      };
      p.stdout.on("data", onData);
      p.stdin.write(`${JSON.stringify(request)}\n`);
      setTimeout(() => {
        p.stdout.off("data", onData);
        reject(new Error("Timeout waiting for response"));
      }, 10_000);
    });
  };

  const initialize = async (p: ChildProcessWithoutNullStreams) => {
    return sendRequest(p, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-test", version: "0.0.1" },
      },
    });
  };

  const waitForReady = (p: ChildProcessWithoutNullStreams): Promise<void> => {
    return new Promise((resolve, reject) => {
      const onStderr = (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes("ready")) {
          p.stderr.off("data", onStderr);
          resolve();
        }
      };
      p.stderr.on("data", onStderr);
      setTimeout(() => reject(new Error("Server did not become ready")), 10_000);
    });
  };

  it("boots and authenticates", async () => {
    const p = startServer();
    await waitForReady(p);
    // If we got here, the auth probe succeeded.
    expect(p.pid).toBeDefined();
  });

  it("responds to tools/list with all 9 tools", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(resp.result).toBeDefined();
    const names = resp.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "wanderlog_add_checklist",
      "wanderlog_add_hotel",
      "wanderlog_add_note",
      "wanderlog_add_place",
      "wanderlog_create_trip",
      "wanderlog_get_trip",
      "wanderlog_get_trip_url",
      "wanderlog_list_trips",
      "wanderlog_remove_place",
      "wanderlog_search_places",
      "wanderlog_update_trip_dates",
    ]);
  });

  it("invokes wanderlog_list_trips successfully", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "wanderlog_list_trips",
        arguments: { response_format: "concise" },
      },
    });
    expect(resp.result).toBeDefined();
    expect(resp.result.isError).not.toBe(true);
    const text = resp.result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
  });

  it("invokes wanderlog_get_trip and returns the trip header", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "wanderlog_get_trip",
        arguments: {
          trip_key: process.env.WANDERLOG_TRIP_KEY,
          response_format: "concise",
        },
      },
    });
    expect(resp.result).toBeDefined();
    expect(resp.result.isError).not.toBe(true);
    const text = resp.result.content[0].text;
    // Content-agnostic: every trip shows title · dates · day count.
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}\s+→\s+\d{4}-\d{2}-\d{2}/);
    expect(text).toMatch(/\d+\s+days/);
  });

  it("invokes wanderlog_search_places near trip", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "wanderlog_search_places",
        arguments: {
          trip_key: process.env.WANDERLOG_TRIP_KEY,
          query: "coffee",
          response_format: "concise",
        },
      },
    });
    expect(resp.result).toBeDefined();
    expect(resp.result.isError).not.toBe(true);
    const text = resp.result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
  });

  it("invokes wanderlog_get_trip_url and returns a valid URL", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "wanderlog_get_trip_url",
        arguments: {
          trip_key: process.env.WANDERLOG_TRIP_KEY,
          mode: "edit",
        },
      },
    });
    expect(resp.result).toBeDefined();
    expect(resp.result.isError).not.toBe(true);
    const text = resp.result.content[0].text;
    expect(text).toMatch(/^https:\/\/wanderlog\.com\/plan\/\w+/);
  });

  it("returns structured error for unknown trip_key", async () => {
    const p = startServer();
    await waitForReady(p);
    await initialize(p);
    const resp = await sendRequest(p, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "wanderlog_get_trip",
        arguments: { trip_key: "obviously_not_a_real_key" },
      },
    });
    expect(resp.result).toBeDefined();
    expect(resp.result.isError).toBe(true);
    const text = resp.result.content[0].text;
    expect(text.toLowerCase()).toMatch(/not found|auth/);
  });
});
