import { McpIpcClient } from "@lyy/daemon";
import { detectMode } from "./mode.js";
import { startStdio } from "./server.js";

/** Called by bin/lyy-mcp — registers pane if in thread mode, then stdio loop. */
export async function run(): Promise<void> {
  const ipc = new McpIpcClient();
  const mode = detectMode();

  // In thread mode, register this pane with the daemon so incoming messages
  // for the bound thread are injected into our pane inbox.
  if (mode.kind === "thread") {
    try {
      await ipc.call("register_pane", {
        threadShortId: mode.threadShortId,
        paneId: process.env.ZELLIJ_PANE_ID ?? `pid-${process.pid}`,
      });
      const cleanup = async () => {
        try {
          await ipc.call("unregister_pane", {
            threadShortId: mode.threadShortId,
          });
        } catch {
          // best-effort
        }
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    } catch (err) {
      console.error(
        `[lyy-mcp] register_pane failed: ${(err as Error).message}`,
      );
    }
  }

  await startStdio({ ipcClient: ipc, mode });
}
