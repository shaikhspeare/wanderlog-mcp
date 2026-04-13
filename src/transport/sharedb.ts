import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { Config } from "../config.js";
import { WanderlogAuthError, WanderlogError } from "../errors.js";
import type { Json0Op } from "../ot/apply.js";
import type { TripPlan } from "../types.js";

export type { Json0Op };

type InitFrame = {
  a: "init";
  id: string;
  protocol: number;
  protocolMinor: number;
  type: string;
};

type HandshakeAckFrame = {
  a: "hs";
  id: string;
  protocol: number;
  protocolMinor: number;
  type: string;
};

type SubscribeAckFrame = {
  a: "s";
  c: string;
  d: string;
  data?: { v: number; data: TripPlan };
};

type OpFrame = {
  a: "op";
  c: string;
  d: string;
  v: number;
  seq?: number;
  src?: string;
  op?: Json0Op[];
};

type Frame = InitFrame | HandshakeAckFrame | SubscribeAckFrame | OpFrame;

export interface ShareDBClient {
  /** Fired when a remote op (not one we submitted) is received. */
  on(event: "remoteOp", listener: (ops: Json0Op[], version: number) => void): this;
  on(event: "reconnected", listener: () => void): this;
  on(event: "closed", listener: (code: number) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

/**
 * ShareDB JSONv0 client bound to a single trip key.
 * Exposes subscribe() for the initial snapshot, submit() for outgoing ops
 * (with version tracking and ack waiting), and a `remoteOp` event for ops
 * pushed by the server from other clients.
 */
export class ShareDBClient extends EventEmitter {
  private ws?: WebSocket;
  private sessionId?: string;
  private handshakeComplete = false;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private seqCounter = 0;
  private snapshot?: TripPlan;
  private _version = 0;
  private subscribed = false;
  private subscribePending?: {
    resolve: (ack: SubscribeAckFrame) => void;
    reject: (err: Error) => void;
  };
  private readonly pendingOps = new Map<
    number,
    { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private connectPromise?: Promise<void>;

  constructor(
    private readonly config: Config,
    private readonly tripKey: string,
  ) {
    super();
  }

  get version(): number {
    return this._version;
  }

  get currentSnapshot(): TripPlan | undefined {
    return this.snapshot;
  }

  get isSubscribed(): boolean {
    return this.subscribed;
  }

  private url(): string {
    return `${this.config.wsBaseUrl}/api/tripPlans/wsOverall/${encodeURIComponent(
      this.tripKey,
    )}?clientSchemaVersion=2`;
  }

  async connect(): Promise<void> {
    if (this.handshakeComplete) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.doConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url(), {
        headers: {
          Cookie: this.config.cookieHeader,
          Origin: this.config.baseUrl,
          "User-Agent": this.config.userAgent,
        },
      });
      this.ws = ws;
      this.handshakeComplete = false;

      const handshakeTimeout = setTimeout(() => {
        reject(new WanderlogError("ShareDB handshake timeout", "ws_timeout"));
        ws.close();
      }, 10_000);

      ws.on("open", () => {
        this.send({ a: "hs", id: null, protocol: 1, protocolMinor: 2 });
      });

      ws.on("message", (raw) => {
        const text = raw.toString();
        let msg: unknown;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (!msg || typeof msg !== "object") return;
        this.handleFrame(msg as Frame & { error?: unknown }, handshakeTimeout, resolve);
      });

      ws.on("close", (code: number) => {
        clearTimeout(handshakeTimeout);
        const wasSubscribed = this.subscribed;
        this.handshakeComplete = false;
        this.subscribed = false;
        this.failAllPending(
          new WanderlogError("WebSocket closed", "ws_closed"),
        );
        this.emit("closed", code);
        if (!this.closedByUser && code !== 1000) {
          this.scheduleReconnect(wasSubscribed);
        }
      });

      ws.on("unexpected-response", (_req, res) => {
        clearTimeout(handshakeTimeout);
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new WanderlogAuthError());
        } else {
          reject(
            new WanderlogError(
              `WebSocket upgrade failed: ${res.statusCode}`,
              "ws_upgrade_failed",
            ),
          );
        }
      });

      ws.on("error", (err: Error) => {
        clearTimeout(handshakeTimeout);
        if (!this.handshakeComplete) reject(err);
      });
    });
  }

  private handleFrame(
    frame: Frame & { error?: unknown; seq?: number },
    handshakeTimeout: NodeJS.Timeout,
    connectResolve: () => void,
  ): void {
    if (frame.error) {
      const err = frame.error as string | { message?: string };
      const errMsg = typeof err === "string" ? err : err.message ?? "unknown";

      // If the error frame carries a seq, it belongs to a specific submit.
      // Fail only that one pending op, so concurrent/queued submits are not
      // collateral damage.
      if (typeof frame.seq === "number" && this.pendingOps.has(frame.seq)) {
        const pending = this.pendingOps.get(frame.seq)!;
        this.pendingOps.delete(frame.seq);
        clearTimeout(pending.timer);
        pending.reject(new WanderlogError(errMsg, "ws_error"));
        return;
      }

      // No seq, or unknown seq — fall back to failing everything, since we
      // can't safely attribute the error.
      this.failAllPending(new WanderlogError(errMsg, "ws_error"));
      return;
    }

    if (frame.a === "init") {
      this.sessionId = (frame as InitFrame).id;
      return;
    }

    if (frame.a === "hs" && !this.handshakeComplete) {
      this.handshakeComplete = true;
      clearTimeout(handshakeTimeout);
      this.reconnectAttempts = 0;
      const hs = frame as HandshakeAckFrame;
      if (!this.sessionId && hs.id) this.sessionId = hs.id;
      connectResolve();
      return;
    }

    if (frame.a === "s") {
      const pending = this.subscribePending;
      if (pending) {
        this.subscribePending = undefined;
        pending.resolve(frame as SubscribeAckFrame);
      }
      return;
    }

    if (frame.a === "op") {
      this.handleOpFrame(frame as OpFrame);
    }
  }

  private handleOpFrame(frame: OpFrame): void {
    const isOurAck =
      frame.src === this.sessionId &&
      frame.seq !== undefined &&
      this.pendingOps.has(frame.seq);

    if (isOurAck) {
      const pending = this.pendingOps.get(frame.seq!)!;
      this.pendingOps.delete(frame.seq!);
      clearTimeout(pending.timer);
      this._version = frame.v + 1;
      pending.resolve();
      return;
    }

    if (frame.op && frame.op.length > 0) {
      this._version = frame.v + 1;
      this.emit("remoteOp", frame.op, this._version);
    }
  }

  private failAllPending(err: Error): void {
    if (this.subscribePending) {
      this.subscribePending.reject(err);
      this.subscribePending = undefined;
    }
    for (const [seq, pending] of this.pendingOps) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingOps.delete(seq);
    }
  }

  private scheduleReconnect(resubscribe: boolean): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      if (this.closedByUser) return;
      this.doConnect()
        .then(() => {
          if (resubscribe) {
            void this.subscribe().then(() => this.emit("reconnected"));
          } else {
            this.emit("reconnected");
          }
        })
        .catch(() => this.scheduleReconnect(resubscribe));
    }, delay);
  }

  private send(obj: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new WanderlogError(
        "WebSocket is not open — cannot send frame",
        "ws_not_open",
      );
    }
    this.ws.send(JSON.stringify(obj));
  }

  async subscribe(): Promise<TripPlan> {
    await this.connect();

    if (this.subscribed && this.snapshot) return this.snapshot;

    const ack = await new Promise<SubscribeAckFrame>((resolve, reject) => {
      this.subscribePending = { resolve, reject };
      this.send({ a: "s", c: "TripPlans", d: this.tripKey });
      setTimeout(() => {
        if (this.subscribePending) {
          this.subscribePending = undefined;
          reject(new WanderlogError("Subscribe timeout", "subscribe_timeout"));
        }
      }, 10_000);
    });

    if (!ack.data) {
      throw new WanderlogError("Subscribe ack missing snapshot", "subscribe_failed");
    }

    this.snapshot = ack.data.data;
    this._version = ack.data.v;
    this.subscribed = true;
    return this.snapshot;
  }

  /**
   * Submit a JSON0 op array to the server. Resolves when the server acks.
   * Throws if not subscribed, if the WebSocket is closed, or on ack timeout.
   *
   * On successful ack, the local version is bumped to `frame.v + 1`.
   */
  async submit(ops: Json0Op[]): Promise<void> {
    if (!this.subscribed) {
      throw new WanderlogError(
        "Cannot submit op before subscribing to the trip",
        "not_subscribed",
      );
    }
    if (ops.length === 0) {
      throw new WanderlogError("Cannot submit an empty op array", "empty_op");
    }

    this.seqCounter += 1;
    const seq = this.seqCounter;
    const frame = {
      a: "op",
      c: "TripPlans",
      d: this.tripKey,
      v: this._version,
      seq,
      x: {},
      op: ops,
    };

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingOps.has(seq)) {
          this.pendingOps.delete(seq);
          reject(new WanderlogError("Submit op timeout", "submit_timeout"));
        }
      }, 10_000);
      this.pendingOps.set(seq, { resolve, reject, timer });
      try {
        this.send(frame);
      } catch (err) {
        // Send failed (e.g. WS closed between the isSubscribed check and now).
        // Clean up the pending entry and propagate immediately rather than
        // waiting 10s for the timeout to fire.
        this.pendingOps.delete(seq);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  close(): void {
    this.closedByUser = true;
    this.subscribed = false;
    this.failAllPending(new WanderlogError("Client closed", "ws_closed"));
    this.ws?.close();
  }
}

/**
 * Pool of ShareDBClient instances keyed by trip key. A single MCP server
 * session may subscribe to multiple trips concurrently; each gets its own
 * WebSocket (required, since the URL embeds the trip key).
 */
export class ShareDBPool {
  private readonly clients = new Map<string, ShareDBClient>();

  constructor(private readonly config: Config) {}

  get(tripKey: string): ShareDBClient {
    let client = this.clients.get(tripKey);
    if (!client) {
      client = new ShareDBClient(this.config, tripKey);
      this.clients.set(tripKey, client);
    }
    return client;
  }

  has(tripKey: string): boolean {
    return this.clients.has(tripKey);
  }

  closeAll(): void {
    for (const client of this.clients.values()) {
      client.close();
    }
    this.clients.clear();
  }
}
