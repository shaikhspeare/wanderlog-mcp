import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ws from "ws";
import { ShareDBClient } from "../../src/transport/sharedb.ts";

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebSocket extends EventEmitter {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];

    readyState = FakeWebSocket.CONNECTING;
    readonly sent: Array<Record<string, unknown>> = [];

    constructor() {
      super();
      FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
      if (this.readyState !== FakeWebSocket.OPEN) throw new Error("WebSocket is not open");
      this.sent.push(JSON.parse(data));
    }

    close(): void {
      this.terminate();
    }

    terminate(): void {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.CLOSED;
      this.emit("close", 1006);
    }

    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open");
    }

    receive(frame: unknown): void {
      this.emit("message", Buffer.from(JSON.stringify(frame)));
    }

    sentActions(): unknown[] {
      return this.sent.map((f) => f.a);
    }
  }

  return { default: FakeWebSocket };
});

type FakeSocket = {
  readyState: number;
  sent: Array<Record<string, unknown>>;
  emit(event: string, ...args: unknown[]): boolean;
  open(): void;
  receive(frame: unknown): void;
  terminate(): void;
  sentActions(): unknown[];
};
const FakeWebSocket = ws as unknown as { instances: FakeSocket[] };

const config = { wsBaseUrl: "wss://test", baseUrl: "https://test", userAgent: "test" } as any;
const INIT = { a: "init", id: "sess", protocol: 1, protocolMinor: 2, type: "json0" };
const HS = { a: "hs", id: "sess", protocol: 1, protocolMinor: 2, type: "json0" };
const SUBSCRIBE_ACK = { a: "s", c: "TripPlans", d: "tripA", data: { v: 7, data: { title: "t" } } };

const flush = () => vi.advanceTimersByTimeAsync(0);
const latestSocket = () => FakeWebSocket.instances.at(-1)!;

function completeHandshake(socket: FakeSocket): void {
  socket.open();
  socket.receive(INIT);
  socket.receive(HS);
}

async function subscribedClient() {
  const client = new ShareDBClient(config, "tripA");
  const subscribed = client.subscribe();
  completeHandshake(latestSocket());
  await flush();
  latestSocket().receive(SUBSCRIBE_ACK);
  await subscribed;
  return client;
}

describe("ShareDBClient connection lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends the handshake only after the server's init frame", async () => {
    const client = new ShareDBClient(config, "tripA");
    const connected = client.connect();
    const socket = latestSocket();

    socket.open();
    expect(socket.sent).toEqual([]);

    socket.receive(INIT);
    expect(socket.sentActions()).toEqual(["hs"]);

    socket.receive(HS);
    await expect(connected).resolves.toBeUndefined();
    client.close();
  });

  it("ignores late events from a socket that has been replaced", async () => {
    const client = new ShareDBClient(config, "tripA");
    const first = client.connect();
    const staleSocket = latestSocket();
    const firstFailed = expect(first).rejects.toMatchObject({ code: "ws_timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await firstFailed;

    const subscribed = client.subscribe();
    const current = latestSocket();
    expect(current).not.toBe(staleSocket);
    completeHandshake(current);
    await flush();
    current.receive(SUBSCRIBE_ACK);
    await subscribed;

    const timerBefore = (client as any).reconnectTimer;
    expect(() => {
      staleSocket.emit("open");
      staleSocket.emit("message", Buffer.from(JSON.stringify(INIT)));
      staleSocket.emit("close", 1006);
    }).not.toThrow();
    expect(client.isSubscribed).toBe(true);
    expect((client as any).reconnectTimer).toBe(timerBefore);

    // The reconnect scheduled by the timed-out attempt finds the live socket.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.isSubscribed).toBe(true);
    client.close();
  });

  it("shares one socket between the reconnect timer and an in-flight connect()", async () => {
    const client = await subscribedClient();
    latestSocket().terminate();
    expect((client as any).reconnectTimer).toBeDefined();

    const toolConnect = client.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    completeHandshake(latestSocket());
    await toolConnect;
    await flush();
    latestSocket().receive(SUBSCRIBE_ACK);
    await flush();
    expect(client.isSubscribed).toBe(true);
    client.close();
  });

  it("does not leak a rejection when resubscribing after a reconnect fails", async () => {
    const client = await subscribedClient();
    latestSocket().terminate();

    await vi.advanceTimersByTimeAsync(1_000);
    const reconnected = latestSocket();
    completeHandshake(reconnected);
    await flush();
    expect(reconnected.sentActions()).toEqual(["hs", "s"]);

    reconnected.receive({ error: { message: "boom" } });
    await flush();

    expect(client.isSubscribed).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect((client as any).reconnectTimer).toBeUndefined();
    client.close();
  });

  it("deduplicates concurrent subscribe() calls into one request", async () => {
    const client = new ShareDBClient(config, "tripA");
    const a = client.subscribe();
    const b = client.subscribe();
    const socket = latestSocket();
    completeHandshake(socket);
    await flush();

    expect(socket.sentActions().filter((x) => x === "s")).toHaveLength(1);
    socket.receive(SUBSCRIBE_ACK);
    await expect(Promise.all([a, b])).resolves.toEqual([{ title: "t" }, { title: "t" }]);
    client.close();
  });
});
