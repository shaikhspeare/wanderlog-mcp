import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { ShareDBClient, ShareDBPool } from "../../src/transport/sharedb.ts";
import { WanderlogAuthError, WanderlogError } from "../../src/errors.ts";

describe("ShareDBClient reconnect logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops reconnecting immediately when encountering WanderlogAuthError", async () => {
    const config = {
      wsBaseUrl: "wss://test",
      baseUrl: "https://test",
      userAgent: "test",
    } as any;
    const client = new ShareDBClient(config, "tripA");

    const rejectErr = new WanderlogAuthError();
    const doConnectSpy = vi.spyOn(client as any, "doConnect").mockRejectedValue(rejectErr);
    const failAllPendingSpy = vi
      .spyOn(client as any, "failAllPending")
      .mockImplementation(() => {});

    // Trigger scheduleReconnect
    (client as any).scheduleReconnect(false);

    // Initial reconnect is scheduled, wait for the timer to fire (delay is 1000 * 2^0 = 1000ms)
    expect((client as any).reconnectTimer).toBeDefined();

    await vi.advanceTimersByTimeAsync(1000);

    // doConnect should have been called
    expect(doConnectSpy).toHaveBeenCalledTimes(1);

    // The timer should be cleared/undefined, and no further reconnect scheduled
    expect((client as any).reconnectTimer).toBeUndefined();
    expect(failAllPendingSpy).toHaveBeenCalledWith(rejectErr);

    // Advance time further to make sure no more retries fire
    await vi.advanceTimersByTimeAsync(30000);
    expect(doConnectSpy).toHaveBeenCalledTimes(1);
  });

  it("deduplicates multiple scheduleReconnect calls using reconnectTimer", () => {
    const config = {
      wsBaseUrl: "wss://test",
      baseUrl: "https://test",
      userAgent: "test",
    } as any;
    const client = new ShareDBClient(config, "tripA");

    // Stub doConnect so it doesn't do real ws
    vi.spyOn(client as any, "doConnect").mockResolvedValue(undefined);

    // First call should schedule reconnect
    (client as any).scheduleReconnect(false);
    const initialTimer = (client as any).reconnectTimer;
    expect(initialTimer).toBeDefined();

    // Second call while timer is active should do nothing and keep the same timer
    (client as any).scheduleReconnect(false);
    expect((client as any).reconnectTimer).toBe(initialTimer);
  });

  it("resets reconnectAttempts back to 0 on a successful connection", async () => {
    const config = {
      wsBaseUrl: "wss://test",
      baseUrl: "https://test",
      userAgent: "test",
    } as any;
    const client = new ShareDBClient(config, "tripA");

    const doConnectSpy = vi.spyOn(client as any, "doConnect").mockResolvedValue(undefined);
    (client as any).reconnectAttempts = 3;

    (client as any).scheduleReconnect(false);
    await vi.advanceTimersByTimeAsync(8000); // 1000 * 2^3 = 8000ms

    expect(doConnectSpy).toHaveBeenCalledTimes(1);
    expect((client as any).reconnectAttempts).toBe(0);
  });

  it("logs a warning after N consecutive failures (reconnectAttempts > 5)", async () => {
    const config = {
      wsBaseUrl: "wss://test",
      baseUrl: "https://test",
      userAgent: "test",
    } as any;
    const client = new ShareDBClient(config, "tripA");

    // Mock failures
    vi.spyOn(client as any, "doConnect").mockRejectedValue(new Error("Transient connection error"));
    const consoleWarnSpy = vi.spyOn(console, "warn");

    // Set attempts to 5, so the next attempt increments it to 6 and warns
    (client as any).reconnectAttempts = 5;

    (client as any).scheduleReconnect(false);

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain(
      "Reconnection has failed 6 times consecutively",
    );
  });
});

describe("ShareDBPool eviction", () => {
  const config = {
    wsBaseUrl: "wss://test",
    baseUrl: "https://test",
    userAgent: "test",
  } as any;

  it("closes and removes the current trip client", () => {
    const pool = new ShareDBPool(config);
    const client = pool.get("tripA");
    const closeSpy = vi.spyOn(client, "close");

    expect(pool.evict("tripA", client)).toBe(true);
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(pool.has("tripA")).toBe(false);
    expect(pool.get("tripA")).not.toBe(client);
    pool.closeAll();
  });

  it("does not evict a replacement client for a stale caller", () => {
    const pool = new ShareDBPool(config);
    const staleClient = pool.get("tripA");
    pool.evict("tripA", staleClient);
    const replacement = pool.get("tripA");
    const closeSpy = vi.spyOn(replacement, "close");

    expect(pool.evict("tripA", staleClient)).toBe(false);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(pool.get("tripA")).toBe(replacement);
    pool.closeAll();
  });
});

describe("ShareDBClient connect failures against a local server", () => {
  let server: WebSocketServer;
  let config: any;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    config = {
      cookieHeader: "connect.sid=test",
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      baseUrl: "https://test",
      userAgent: "test",
    };
  });

  afterEach(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function sendInit(socket: WsSocket): void {
    socket.send(
      JSON.stringify({ a: "init", id: "session-1", protocol: 1, protocolMinor: 2, type: "json0" }),
    );
  }

  function onHandshake(reply: (socket: WsSocket) => void): void {
    server.on("connection", (socket) => {
      sendInit(socket);
      socket.on("message", (raw) => {
        if (JSON.parse(raw.toString()).a === "hs") reply(socket);
      });
    });
  }

  it("rejects instead of hanging when the server closes before the handshake", async () => {
    server.on("connection", (socket) => socket.close(4000, "go away"));
    const client = new ShareDBClient(config, "tripA");

    await expect(client.connect()).rejects.toMatchObject({ code: "ws_closed" });
    expect((client as any).reconnectTimer).toBeUndefined();
    client.close();
  });

  it("does not leave a stuck connect promise behind after a pre-handshake close", async () => {
    let attempts = 0;
    server.on("connection", (socket) => {
      attempts += 1;
      if (attempts === 1) {
        socket.close(4000, "go away");
        return;
      }
      sendInit(socket);
      socket.on("message", (raw) => {
        if (JSON.parse(raw.toString()).a === "hs") {
          socket.send(JSON.stringify({ a: "hs", id: "session-2", protocol: 1, protocolMinor: 2 }));
        }
      });
    });
    const client = new ShareDBClient(config, "tripA");

    await expect(client.connect()).rejects.toMatchObject({ code: "ws_closed" });
    await expect(client.connect()).resolves.toBeUndefined();
    client.close();
  });

  it("surfaces a bare rejection frame sent in place of the handshake ack", async () => {
    onHandshake((socket) =>
      socket.send(JSON.stringify({ code: 4001, message: "Too many requests" })),
    );
    const client = new ShareDBClient(config, "tripA");

    await expect(client.connect()).rejects.toMatchObject({
      code: "rate_limited",
      message: "Wanderlog rejected the request (4001): Too many requests",
    });
    expect((client as any).reconnectTimer).toBeUndefined();
    client.close();
  });

  it("surfaces an error frame sent in place of the handshake ack", async () => {
    onHandshake((socket) =>
      socket.send(JSON.stringify({ a: "hs", error: { message: "Handshake rejected" } })),
    );
    const client = new ShareDBClient(config, "tripA");

    await expect(client.connect()).rejects.toMatchObject({
      code: "ws_error",
      message: "Handshake rejected",
    });
    client.close();
  });

  it("still reconnects when an established socket drops", async () => {
    onHandshake((socket) =>
      socket.send(JSON.stringify({ a: "hs", id: "session-1", protocol: 1, protocolMinor: 2 })),
    );
    const client = new ShareDBClient(config, "tripA");
    await client.connect();

    const closed = new Promise((resolve) => client.once("closed", resolve));
    for (const socket of server.clients) socket.terminate();
    await closed;

    expect((client as any).reconnectTimer).toBeDefined();
    client.close();
  });
});

describe("ShareDBClient subscribe bookkeeping", () => {
  const config = {
    cookieHeader: "connect.sid=test",
    wsBaseUrl: "wss://test",
    baseUrl: "https://test",
    userAgent: "test",
  } as any;
  const subscribeAck = (snapshot: unknown) => ({
    a: "s",
    c: "TripPlans",
    d: "tripA",
    data: { v: 1, data: snapshot },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not let an earlier subscribe's timeout reject a later subscribe", async () => {
    const client = new ShareDBClient(config, "tripA");
    vi.spyOn(client, "connect").mockResolvedValue(undefined);
    vi.spyOn(client as any, "send").mockImplementation(() => {});

    const first = client.subscribe();
    await vi.advanceTimersByTimeAsync(5_000);
    (client as any).failAllPending(new WanderlogError("WebSocket closed", "ws_closed"));
    await expect(first).rejects.toMatchObject({ code: "ws_closed" });

    const second = client.subscribe();
    // Past the first request's deadline, well within the second's.
    await vi.advanceTimersByTimeAsync(6_000);
    const snapshot = { title: "Trip" };
    (client as any).handleFrame(
      subscribeAck(snapshot),
      undefined,
      () => {},
      () => {},
    );

    await expect(second).resolves.toBe(snapshot);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately when the subscribe frame cannot be sent", async () => {
    const client = new ShareDBClient(config, "tripA");
    vi.spyOn(client, "connect").mockResolvedValue(undefined);

    await expect(client.subscribe()).rejects.toMatchObject({ code: "ws_not_open" });
    expect((client as any).subscribePending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
