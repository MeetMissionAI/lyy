import { McpIpcClient } from "@lyy/daemon";
import { detectMode } from "./mode.js";
import { startStdio } from "./server.js";

/** Called by bin/lyy-mcp — registers pane if in thread mode, then stdio loop. */
export async function run(): Promise<void> {
  const ipc = new McpIpcClient();
  const mode = detectMode();

  // In thread mode, register this pane with the daemon so incoming messages
  // for the bound thread are injected into our pane inbox. The registry is
  // first-write-wins: if another pane in another lyy window already owns
  // this thread, we log a loud error and exit so Claude Code surfaces it
  // to the user instead of racing to reply on the same thread.
  if (mode.kind === "thread") {
    try {
      const result = await ipc.call<
        { ok: true } | { ok: false; existingPaneId: string }
      >("register_pane", {
        threadShortId: mode.threadShortId,
        paneId: process.env.ZELLIJ_PANE_ID ?? `pid-${process.pid}`,
      });
      if (result.ok === false) {
        console.error(
          `[lyy-mcp] Thread #${mode.threadShortId} already has an open pane (${result.existingPaneId}). Close the other pane first, or /pickup a different thread.`,
        );
        process.exit(1);
      }
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
