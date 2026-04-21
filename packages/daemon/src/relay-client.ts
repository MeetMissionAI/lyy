import { EventEmitter } from "node:events";
import { type Socket, io as ioClient } from "socket.io-client";

export interface RelayClientOptions {
  url: string;
  token: string;
  /** Disable reconnection — used in tests. */
  reconnection?: boolean;
}

interface OutboxEntry {
  event: string;
  payload: unknown;
}

/**
 * Persistent client connection from a daemon to the relay.
 *
 * - Auto-reconnects on disconnect (delegated to socket.io-client)
 * - Queues outbound sends while offline; flushes on (re)connect
 * - Re-emits inbound 'message:new' / 'message:read' / 'thread:archived'
 *   events to subscribers, plus its own 'connected' / 'disconnected' lifecycle
 */
export class RelayClient extends EventEmitter {
  private socket: Socket | null = null;
  private outbox: OutboxEntry[] = [];

  constructor(private readonly opts: RelayClientOptions) {
    super();
  }

  connect(): void {
    if (this.socket) return;
    this.socket = ioClient(this.opts.url, {
      auth: { token: this.opts.token },
      reconnection: this.opts.reconnection ?? true,
      transports: ["websocket", "polling"],
    });

    this.socket.on("connect", () => {
      this.emit("connected");
      this.flushOutbox();
    });
    this.socket.on("disconnect", (reason) => this.emit("disconnected", reason));
    this.socket.on("connect_error", (err) => this.emit("connect_error", err));

    for (const event of [
      "connected",
      "message:new",
      "message:read",
      "thread:archived",
      "presence:snapshot",
      "presence:change",
    ]) {
      this.socket.on(event, (payload: unknown) => this.emit(event, payload));
    }
  }

  send(event: string, payload: unknown): void {
    if (this.socket?.connected) {
      this.socket.emit(event, payload);
      return;
    }
    this.outbox.push({ event, payload });
  }

  /** For tests / introspection. */
  outboxSize(): number {
    return this.outbox.length;
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Tear down the socket.io connection and wait for the transport to fully
   * close, bounded by `timeoutMs` (default 500). The old sync disconnect()
   * would return before the underlying WebSocket actually finished closing,
   * leaving the relay to rely on pingTimeout (~45s) to notice — and, worse,
   * allowing the daemon to `process.exit(0)` before the disconnect packet
   * flushed so the relay session count leaked.
   */
  async disconnect(timeoutMs = 500): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    const closed = new Promise<void>((res) => {
      let done = false;
      const settle = (): void => {
        if (done) return;
        done = true;
        res();
      };
      socket.once("disconnect", settle);
      // engine.io's 'close' fires when the underlying transport is fully torn down.
      // Cast through `unknown` because socket.io-client's typed emitter doesn't
      // advertise the low-level event name.
      (socket as unknown as EventEmitter).once("close", settle);
      setTimeout(settle, timeoutMs);
    });
    socket.disconnect();
    await closed;
  }

  private flushOutbox(): void {
    if (!this.socket?.connected) return;
    while (this.outbox.length > 0) {
      const entry = this.outbox.shift();
      if (entry) this.socket.emit(entry.event, entry.payload);
    }
  }
}
