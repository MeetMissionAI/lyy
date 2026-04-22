import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import {
  type Server,
  type Socket,
  createConnection,
  createServer,
} from "node:net";
import { dirname } from "node:path";
import { LYY_VERSION } from "@lyy/shared";
import type { PaneInbox } from "./pane-inbox.js";
import type { PaneRegistry } from "./pane-registry.js";
import { lyyPath } from "./paths.js";
import type { PresenceStore } from "./presence.js";
import type { RelayHttp } from "./relay-http.js";
import type { StateStore } from "./state.js";

export const DEFAULT_MCP_SOCK = lyyPath("mcp.sock");

export interface McpIpcServerDeps {
  relayHttp: RelayHttp;
  state: StateStore;
  paneRegistry: PaneRegistry;
  paneInbox: PaneInbox;
  /** Optional — when provided, list_peers decorates with `online` flag. */
  presence?: PresenceStore;
}

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

type Response = { id: number; result: unknown } | { id: number; error: string };

/**
 * Daemon-side IPC endpoint that the @lyy/mcp server (loaded into a Claude
 * Code session) calls. Newline-delimited JSON over Unix socket.
 *
 * Each request is `{id, method, params?}`. Methods proxy to the relay via
 * RelayHttp, or read/mutate local state via StateStore / PaneRegistry / PaneInbox.
 */
export class McpIpcServer {
  private server: Server | null = null;
  private readonly subscribers = new Set<Socket>();
  // Tracks every open connection (subscribers + in-flight one-shot callers)
  // so stop() can destroy them all instead of waiting — `server.close()`
  // only stops accepting new connections and hangs indefinitely while any
  // client holds its end open. That hang was the root cause of local
  // daemon pile-up: SIGTERM arrived but the process never exited because
  // a TUI subscribe socket was still connected.
  private readonly activeSockets = new Set<Socket>();
  private relayStatusProvider: () => boolean = () => false;

  /** Wired by main.ts so subscribe() can seed the initial relay status. */
  setRelayStatusProvider(fn: () => boolean): void {
    this.relayStatusProvider = fn;
  }

  constructor(
    private readonly deps: McpIpcServerDeps,
    private readonly sockPath: string = DEFAULT_MCP_SOCK,
  ) {
    const dir = dirname(this.sockPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /**
   * Fan out a server-push frame to every subscribed socket. Subscribers
   * are sockets that previously called the `subscribe` IPC method.
   */
  pushToSubscribers(event: string, payload: unknown): void {
    const frame = `${JSON.stringify({ type: "event", event, payload })}\n`;
    for (const s of this.subscribers) {
      try {
        s.write(frame);
      } catch {
        this.subscribers.delete(s);
      }
    }
  }

  async start(): Promise<void> {
    if (existsSync(this.sockPath)) {
      try {
        unlinkSync(this.sockPath);
      } catch {
        // ignore
      }
    }
    this.server = createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolveListen, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.sockPath, () => {
        this.server?.off("error", reject);
        resolveListen();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;

    // Stop accepting new connections immediately.
    const closePromise = new Promise<void>((res) => server.close(() => res()));

    // Force-destroy every live connection. Without this, server.close()
    // waits forever on long-lived subscribe sockets. destroy() is synchronous
    // and guarantees the fd is closed; close callbacks still fire so the
    // subscriber set cleans itself up.
    for (const s of this.activeSockets) {
      s.destroy();
    }
    this.activeSockets.clear();
    this.subscribers.clear();

    // Race the real close against a hard deadline so a buggy socket can't
    // trap shutdown. 500ms is enough for destroy() to fully propagate.
    await Promise.race([
      closePromise,
      new Promise<void>((res) => setTimeout(res, 500)),
    ]);

    if (existsSync(this.sockPath)) {
      try {
        unlinkSync(this.sockPath);
      } catch {
        // ignore
      }
    }
  }

  private handleConnection(socket: Socket): void {
    this.activeSockets.add(socket);
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) {
          const reply = await this.dispatch(line, socket);
          socket.write(`${JSON.stringify(reply)}\n`);
        }
        nl = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.subscribers.delete(socket);
      this.activeSockets.delete(socket);
    });
  }

  private async dispatch(line: string, socket: Socket): Promise<Response> {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      return { id: -1, error: "invalid json" };
    }
    try {
      const result = await this.invoke(req.method, req.params ?? {}, socket);
      return { id: req.id, result };
    } catch (err) {
      return {
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async invoke(
    method: string,
    params: Record<string, unknown>,
    socket: Socket,
  ): Promise<unknown> {
    switch (method) {
      case "version":
        return { version: LYY_VERSION, pid: process.pid };
      case "subscribe": {
        // Register the calling socket as an event listener. The socket is
        // kept open (subscribers don't get cleaned up on reply like normal
        // one-shot clients do — they just don't end their end).
        this.subscribers.add(socket);
        // Seed the new subscriber with the current presence snapshot and
        // relay connection status so it can paint markers / status-bar
        // before the next delta arrives.
        const seed = (event: string, payload: unknown): void => {
          try {
            socket.write(
              `${JSON.stringify({ type: "event", event, payload })}\n`,
            );
          } catch {
            // ignore; subscriber will be GC'd on next push failure
          }
        };
        if (this.deps.presence) {
          seed("presence", { online: this.deps.presence.get() });
        }
        seed("relay:status", { connected: this.relayStatusProvider() });
        return { ok: true };
      }
      case "suggest_reply": {
        const { threadId, body } = params as {
          threadId: string;
          body: string;
        };
        this.pushToSubscribers("suggest_reply", { threadId, body });
        return { ok: true };
      }
      case "send_message": {
        const { toPeer, threadId, body, forceNew } = params as {
          toPeer?: string;
          threadId?: string;
          body: string;
          forceNew?: boolean;
        };
        return this.deps.relayHttp.sendMessage({
          toPeer,
          threadId,
          body,
          forceNew,
        });
      }
      case "list_inbox":
        return this.deps.state.read();
      case "read_thread": {
        const { threadId, sinceSeq } = params as {
          threadId: string;
          sinceSeq?: number;
        };
        return this.deps.relayHttp.readThread(threadId, sinceSeq);
      }
      case "register_pane": {
        const { threadShortId, paneId } = params as {
          threadShortId: number;
          paneId: string;
        };
        // First-write wins. If another pane already owns this thread the
        // registry returns `{ ok: false, existingPaneId }`; we forward the
        // result unchanged so the MCP caller can surface a user-facing
        // error instead of silently stealing the binding.
        return this.deps.paneRegistry.register(threadShortId, paneId);
      }
      case "unregister_pane": {
        const { threadShortId } = params as { threadShortId: number };
        this.deps.paneRegistry.unregister(threadShortId);
        return { ok: true };
      }
      case "drain_pane_inbox": {
        const { threadShortId } = params as { threadShortId: number };
        return this.deps.paneInbox.drain(threadShortId);
      }
      case "ack_read": {
        const { messageIds } = params as { messageIds: string[] };
        await this.deps.relayHttp.markRead(messageIds);
        return { ok: true };
      }
      case "ack_thread_read": {
        const { threadId } = params as { threadId: string };
        // Skip the relay round-trip + state.json rewrite when the thread
        // is already read locally. Reopening a read thread is a common
        // TUI action (one ack per view transition) — no need to burn an
        // HTTP + fs write each time.
        const current = await this.deps.state.read();
        const existing = current.threads.find((t) => t.threadId === threadId);
        if (existing && existing.unread === 0) return { ok: true };
        await this.deps.relayHttp.markThreadRead(threadId);
        await this.deps.state.update((s) => {
          const threads = s.threads.map((t) =>
            t.threadId === threadId ? { ...t, unread: 0 } : t,
          );
          const unreadCount = threads.reduce(
            (sum, t) => sum + (t.archived ? 0 : t.unread),
            0,
          );
          return { ...s, threads, unreadCount };
        });
        return { ok: true };
      }
      case "archive_thread": {
        const { threadId } = params as { threadId: string };
        await this.deps.relayHttp.archiveThread(threadId);
        return { ok: true };
      }
      case "unarchive_thread": {
        const { threadId } = params as { threadId: string };
        await this.deps.relayHttp.unarchiveThread(threadId);
        return { ok: true };
      }
      case "list_threads": {
        const { includeArchived } = params as { includeArchived?: boolean };
        return this.deps.relayHttp.listThreads(includeArchived);
      }
      case "list_peers": {
        const { peers } = await this.deps.relayHttp.listPeers();
        const presence = this.deps.presence;
        if (!presence) return { peers };
        return {
          peers: peers.map((p) => ({ ...p, online: presence.has(p.id) })),
        };
      }
      case "search": {
        const { q, limit } = params as { q: string; limit?: number };
        return this.deps.relayHttp.search(q, limit);
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }
}

/** Thin client used by the @lyy/mcp package (and tests). */
export class McpIpcClient {
  private nextId = 1;
  constructor(private readonly sockPath: string = DEFAULT_MCP_SOCK) {}

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = this.nextId++;
    const reply = await new Promise<Response>((resolve, reject) => {
      const socket = createConnection(this.sockPath, () => {
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
          const line = buffer.slice(0, nl);
          socket.end();
          try {
            resolve(JSON.parse(line) as Response);
          } catch (err) {
            reject(err);
          }
        }
      });
      socket.on("error", reject);
    });
    if ("error" in reply) throw new Error(reply.error);
    return reply.result as T;
  }
}
