import { createConnection } from "node:net";
import type { SendMessageResult, State } from "@lyy/daemon";
import { DEFAULT_MCP_SOCK, McpIpcClient } from "@lyy/daemon";
import type { Message, Peer } from "@lyy/shared";

export function makeIpc(): McpIpcClient {
  return new McpIpcClient();
}

export async function fetchState(ipc: McpIpcClient): Promise<State> {
  return ipc.call<State>("list_inbox");
}

export async function fetchPeers(ipc: McpIpcClient): Promise<Peer[]> {
  const { peers } = await ipc.call<{ peers: Peer[] }>("list_peers");
  return peers;
}

export async function fetchThread(
  ipc: McpIpcClient,
  threadId: string,
): Promise<Message[]> {
  const { messages } = await ipc.call<{ messages: Message[] }>("read_thread", {
    threadId,
  });
  return messages;
}

export async function ackThreadRead(
  ipc: McpIpcClient,
  threadId: string,
): Promise<void> {
  await ipc.call<{ ok: true }>("ack_thread_read", { threadId });
}

export async function sendMessage(
  ipc: McpIpcClient,
  threadId: string,
  body: string,
): Promise<SendMessageResult> {
  return ipc.call<SendMessageResult>("send_message", { threadId, body });
}

export async function sendToPeer(
  ipc: McpIpcClient,
  toPeer: string,
  body: string,
): Promise<SendMessageResult> {
  return ipc.call<SendMessageResult>("send_message", { toPeer, body });
}

export type EventHandler = (event: string, payload: unknown) => void;

export interface SubscribeCallbacks {
  onEvent: EventHandler;
  /** Fires when the daemon IPC socket opens; emits synthetic daemon:status up. */
  onDaemonUp?: () => void;
  /** Fires on any socket error/close; emits synthetic daemon:status down. */
  onDaemonDown?: () => void;
}

/**
 * Open a long-lived subscribe socket to the daemon. Auto-reconnects with
 * backoff so a daemon restart transparently re-attaches the TUI. `onEvent`
 * fires for each {type,event,payload} frame; `onDaemonUp`/`Down` expose
 * connection lifecycle for the status bar.
 *
 * Returns a dispose() that tears down the current socket + cancels any
 * pending reconnect timer.
 */
export function subscribe(
  cb: SubscribeCallbacks,
  sockPath: string = DEFAULT_MCP_SOCK,
): () => void {
  let cancelled = false;
  let currentSocket: ReturnType<typeof createConnection> | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const connect = (): void => {
    if (cancelled) return;
    const socket = createConnection(sockPath, () => {
      socket.write(`${JSON.stringify({ id: 1, method: "subscribe" })}\n`);
      cb.onDaemonUp?.();
    });
    currentSocket = socket;
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) {
          try {
            const frame = JSON.parse(line) as {
              type?: string;
              event?: string;
              payload?: unknown;
            };
            if (frame.type === "event" && typeof frame.event === "string") {
              cb.onEvent(frame.event, frame.payload);
            }
          } catch {
            // ignore malformed line
          }
        }
        nl = buffer.indexOf("\n");
      }
    });
    const drop = (): void => {
      currentSocket = null;
      cb.onDaemonDown?.();
      if (cancelled) return;
      reconnectTimer = setTimeout(connect, 1000);
    };
    socket.on("error", drop);
    socket.on("close", drop);
  };

  connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    currentSocket?.destroy();
  };
}
