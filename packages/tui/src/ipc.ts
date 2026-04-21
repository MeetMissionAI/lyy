import type { State } from "@lyy/daemon";
import { McpIpcClient } from "@lyy/daemon";
import type { Message } from "@lyy/shared";

export function makeIpc(): McpIpcClient {
  return new McpIpcClient();
}

export async function fetchState(ipc: McpIpcClient): Promise<State> {
  return ipc.call<State>("list_inbox");
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
