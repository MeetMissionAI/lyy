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

/**
 * Open a long-lived subscribe socket to the daemon. onEvent fires for each
 * {type:"event",event,payload} frame. Returns a dispose() that closes the
 * socket.
 */
export function subscribe(
  onEvent: EventHandler,
  sockPath: string = DEFAULT_MCP_SOCK,
): () => void {
  const socket = createConnection(sockPath, () => {
    socket.write(`${JSON.stringify({ id: 1, method: "subscribe" })}\n`);
  });
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
            onEvent(frame.event, frame.payload);
          }
        } catch {
          // ignore malformed line
        }
      }
      nl = buffer.indexOf("\n");
    }
  });
  socket.on("error", () => {
    // swallow — TUI shouldn't crash if daemon restarts
  });
  return () => socket.destroy();
}
