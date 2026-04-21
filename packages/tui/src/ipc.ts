import type { State } from "@lyy/daemon";
import { McpIpcClient } from "@lyy/daemon";

export function makeIpc(): McpIpcClient {
  return new McpIpcClient();
}

export async function fetchState(ipc: McpIpcClient): Promise<State> {
  return ipc.call<State>("list_inbox");
}
