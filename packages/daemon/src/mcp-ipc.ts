import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import {
  type Server,
  type Socket,
  createConnection,
  createServer,
} from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { PaneInbox } from "./pane-inbox.js";
import type { PaneRegistry } from "./pane-registry.js";
import type { RelayHttp } from "./relay-http.js";
import type { StateStore } from "./state.js";

export const DEFAULT_MCP_SOCK = resolve(homedir(), ".lyy", "mcp.sock");

export interface McpIpcServerDeps {
  relayHttp: RelayHttp;
  state: StateStore;
  paneRegistry: PaneRegistry;
  paneInbox: PaneInbox;
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

  constructor(
    private readonly deps: McpIpcServerDeps,
    private readonly sockPath: string = DEFAULT_MCP_SOCK,
  ) {
    const dir = dirname(this.sockPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
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
    await new Promise<void>((res) => this.server?.close(() => res()));
    this.server = null;
    if (existsSync(this.sockPath)) {
      try {
        unlinkSync(this.sockPath);
      } catch {
        // ignore
      }
    }
  }

  private handleConnection(socket: Socket): void {
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) {
          const reply = await this.dispatch(line);
          socket.write(`${JSON.stringify(reply)}\n`);
        }
        nl = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => undefined);
  }

  private async dispatch(line: string): Promise<Response> {
    let req: Request;
    try {
      req = JSON.parse(line) as Request;
    } catch {
      return { id: -1, error: "invalid json" };
    }
    try {
      const result = await this.invoke(req.method, req.params ?? {});
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
  ): Promise<unknown> {
    switch (method) {
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
        (
          this.deps.paneRegistry as unknown as { map: Map<number, string> }
        ).map.set(threadShortId, paneId);
        return { ok: true };
      }
      case "unregister_pane": {
        const { threadShortId } = params as { threadShortId: number };
        (
          this.deps.paneRegistry as unknown as { map: Map<number, string> }
        ).map.delete(threadShortId);
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
