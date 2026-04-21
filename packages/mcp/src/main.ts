import { McpIpcClient } from "@lyy/daemon";
import { detectMode } from "./mode.js";
import { startStdio } from "./server.js";

/**
 * Called by bin/lyy-mcp. LYY TUI replaces per-thread Claude panes, so the
 * MCP runs in a single mode ("main") and simply enters the stdio loop.
 */
export async function run(): Promise<void> {
  const ipc = new McpIpcClient();
  const mode = detectMode();
  await startStdio({ ipcClient: ipc, mode });
}
