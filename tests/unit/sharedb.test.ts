import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDBClient } from "../../src/transport/sharedb.ts";
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

    let rejectErr = new WanderlogAuthError();
    const doConnectSpy = vi.spyOn(client as any, "doConnect").mockRejectedValue(rejectErr);
    const failAllPendingSpy = vi.spyOn(client as any, "failAllPending").mockImplementation(() => {});

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
    expect(consoleWarnSpy.mock.calls[0]![0]).toContain("Reconnection has failed 6 times consecutively");
  });
});
