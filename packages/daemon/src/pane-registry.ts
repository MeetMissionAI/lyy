import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import {
  type Server,
  type Socket,
  createConnection,
  createServer,
} from "node:net";
import { dirname } from "node:path";
import { lyyPath } from "./paths.js";

export const DEFAULT_PANE_REGISTRY_SOCK = lyyPath("pane-registry.sock");

interface RegisterOp {
  op: "register";
  threadShortId: number;
  paneId: string;
}
interface UnregisterOp {
  op: "unregister";
  threadShortId: number;
}
interface QueryOp {
  op: "query";
  threadShortId: number;
}
type Op = RegisterOp | UnregisterOp | QueryOp;

/**
 * In-memory map of `threadShortId -> paneId`, served over a Unix domain
 * socket. The MCP process inside a thread pane registers itself on
 * SessionStart; the daemon reads the registry to decide whether incoming
 * messages should be injected into a pane vs. queued in the unread state.
 */
export class PaneRegistry {
  private server: Server | null = null;
  private readonly map = new Map<number, string>();

  constructor(private readonly sockPath: string = DEFAULT_PANE_REGISTRY_SOCK) {
    const dir = dirname(this.sockPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  async start(): Promise<void> {
    if (existsSync(this.sockPath)) {
      try {
        unlinkSync(this.sockPath);
      } catch {
        // ignore — listen() will surface a real error
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

  /** For tests / direct use without going over the socket. */
  findPane(threadShortId: number): string | null {
    return this.map.get(threadShortId) ?? null;
  }

  /**
   * Register `threadShortId -> paneId`. First-write wins: if the thread
   * already has a pane bound, returns `{ ok: false, existingPaneId }`
   * without overwriting. Callers (IPC / MCP tool) surface this conflict
   * back to the user so a second `/pickup` from another lyy window fails
   * loudly instead of silently stealing the binding.
   */
  register(
    threadShortId: number,
    paneId: string,
  ): { ok: true } | { ok: false; existingPaneId: string } {
    const existing = this.map.get(threadShortId);
    if (existing !== undefined) {
      return { ok: false, existingPaneId: existing };
    }
    this.map.set(threadShortId, paneId);
    return { ok: true };
  }

  unregister(threadShortId: number): void {
    this.map.delete(threadShortId);
  }

  size(): number {
    return this.map.size;
  }

  private handleConnection(socket: Socket): void {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) this.handleLine(line, socket);
        nl = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => {
      // Client errors should not crash the registry
    });
  }

  private handleLine(line: string, socket: Socket): void {
    let op: Op;
    try {
      op = JSON.parse(line) as Op;
    } catch {
      socket.write(`${JSON.stringify({ error: "invalid json" })}\n`);
      return;
    }
    let response: unknown;
    switch (op.op) {
      case "register":
        response = this.register(op.threadShortId, op.paneId);
        break;
      case "unregister":
        this.unregister(op.threadShortId);
        response = { ok: true };
        break;
      case "query":
        response = { paneId: this.map.get(op.threadShortId) ?? null };
        break;
      default:
        response = { error: `unknown op: ${(op as { op: string }).op}` };
    }
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

/** Tiny client for talking to the registry over its Unix socket. */
export class PaneRegistryClient {
  constructor(private readonly sockPath: string = DEFAULT_PANE_REGISTRY_SOCK) {}

  /**
   * Returns `{ ok: true }` when the binding was created, or
   * `{ ok: false, existingPaneId }` when another pane already owns the
   * thread. Callers should surface the conflict as a user-visible error.
   */
  async register(
    threadShortId: number,
    paneId: string,
  ): Promise<{ ok: true } | { ok: false; existingPaneId: string }> {
    const r = (await this.call({ op: "register", threadShortId, paneId })) as
      | { ok: true }
      | { ok: false; existingPaneId: string };
    return r;
  }

  async unregister(threadShortId: number): Promise<void> {
    await this.call({ op: "unregister", threadShortId });
  }

  async query(threadShortId: number): Promise<string | null> {
    const r = (await this.call({ op: "query", threadShortId })) as {
      paneId: string | null;
    };
    return r.paneId;
  }

  private call(op: Op): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.sockPath, () => {
        socket.write(`${JSON.stringify(op)}\n`);
      });
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
          const line = buffer.slice(0, nl);
          socket.end();
          try {
            resolve(JSON.parse(line));
          } catch (err) {
            reject(err);
          }
        }
      });
      socket.on("error", reject);
    });
  }
}
