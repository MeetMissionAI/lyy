import { spawn } from "node:child_process";
import { McpIpcClient } from "@lyy/daemon";

/**
 * `lyy thread <shortId>` — Open a peer thread in a new pane.
 *
 * Looks up the threadId via the daemon's list_inbox (state.json) so we
 * don't need to ask the user for the UUID. Then mirrors the spawn logic
 * the MCP `spawn_thread` tool uses (zellij action OR osascript Terminal).
 */
export async function runThread(shortId: number): Promise<void> {
  if (!Number.isFinite(shortId) || shortId <= 0) {
    throw new Error(
      `thread short id must be a positive integer, got ${shortId}`,
    );
  }

  const ipc = new McpIpcClient();
  const inbox = await ipc.call<{
    threads: { threadId: string; shortId: number }[];
  }>("list_inbox");
  const target = inbox.threads.find((t) => t.shortId === shortId);
  if (!target)
    throw new Error(`no thread with shortId #${shortId} in local inbox`);

  // Claude CLI requires --session-id to be a UUID; threadId already is one.
  const sessionId = target.threadId;
  const env: Record<string, string> = {
    LYY_MODE: "thread",
    LYY_THREAD_ID: target.threadId,
    LYY_THREAD_SHORT_ID: String(shortId),
  };
  // Propagate LYY_HOME so the new pane resolves the right profile.
  if (process.env.LYY_HOME) env.LYY_HOME = process.env.LYY_HOME;

  if (process.env.ZELLIJ) {
    await runInZellij(sessionId, env);
  } else if (process.platform === "darwin") {
    await runInTerminal(sessionId, env);
  } else {
    throw new Error("requires zellij ($ZELLIJ set) or macOS Terminal");
  }
  console.log(`opened thread #${shortId} in new pane (${sessionId})`);
}

function runInZellij(
  sessionId: string,
  env: Record<string, string>,
): Promise<void> {
  const args = [
    "action",
    "new-pane",
    "--",
    "env",
    ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    "claude",
    `--session-id=${sessionId}`,
  ];
  return spawnP("zellij", args);
}

function runInTerminal(
  sessionId: string,
  env: Record<string, string>,
): Promise<void> {
  const exports = Object.entries(env)
    .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
    .join("; ");
  const cmd = `${exports}; claude --session-id=${shellQuote(sessionId)}`;
  return spawnP("osascript", [
    "-e",
    `tell app "Terminal" to do script ${shellQuote(cmd)}`,
  ]);
}

function spawnP(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

function shellQuote(s: string): string {
  return `"${s.replace(/(["\\$`])/g, "\\$1")}"`;
}
