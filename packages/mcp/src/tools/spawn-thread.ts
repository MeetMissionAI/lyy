import { spawn } from "node:child_process";
import type { LyyTool } from "./index.js";

/**
 * Spawn a new pane (zellij if available, else a new Terminal window via
 * AppleScript on macOS) with `claude --session-id=lyy-thread-N` and
 * required env vars so the new MCP detects thread mode.
 */
export const spawnThreadTool: LyyTool = {
  name: "spawn_thread",
  description:
    "Open a peer thread in a new pane (zellij) or terminal window. Use after /pickup to dive into a thread without polluting your current session.",
  availableIn: "main-only",
  inputSchema: {
    type: "object",
    properties: {
      thread_id: { type: "string", description: "Thread UUID" },
      thread_short_id: {
        type: "number",
        description: "Short numeric id (for the pane name)",
      },
    },
    required: ["thread_id", "thread_short_id"],
  },
  async execute(args) {
    const threadId = String(args.thread_id);
    const shortId = Number(args.thread_short_id);
    const sessionId = `lyy-thread-${shortId}`;
    const env = {
      LYY_MODE: "thread",
      LYY_THREAD_ID: threadId,
      LYY_THREAD_SHORT_ID: String(shortId),
    };

    const inZellij = !!process.env.ZELLIJ;
    if (inZellij) {
      const args = [
        "action",
        "new-pane",
        "--",
        "env",
        ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
        "claude",
        `--session-id=${sessionId}`,
      ];
      await runCommand("zellij", args);
      return { ok: true, via: "zellij", sessionId };
    }

    if (process.platform === "darwin") {
      const cmd = [
        ...Object.entries(env).map(([k, v]) => `export ${k}=${quote(v)}`),
        `claude --session-id=${quote(sessionId)}`,
      ].join("; ");
      const script = `tell app "Terminal" to do script ${quote(cmd)}`;
      await runCommand("osascript", ["-e", script]);
      return { ok: true, via: "terminal", sessionId };
    }

    throw new Error(
      "spawn_thread requires zellij ($ZELLIJ set) or macOS Terminal",
    );
  },
};

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

function quote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}
