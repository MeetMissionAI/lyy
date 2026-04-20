import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { DEFAULT_MCP_SOCK } from "@lyy/daemon";
import { which } from "../util/which.js";

const SESSION_NAME = "lyy";

const ZELLIJ_LAYOUT = `layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    children
  }
  tab name="lyy" {
    pane command="claude"
  }
}
`;

const ZELLIJ_CONFIG = `session_serialization false
`;

/**
 * Default `lyy` command: launch Claude Code inside a zellij session.
 * Ensures lyy-daemon is running first (auto-spawns detached if not).
 */
export async function runDefault(): Promise<void> {
  await ensureDaemonRunning();

  if (process.env.ZELLIJ) {
    return passthroughTo("claude", []);
  }

  const zellij = which("zellij");
  if (!zellij) {
    console.warn(
      "[lyy] zellij not installed (brew install zellij). Falling back to plain claude.",
    );
    return passthroughTo("claude", []);
  }

  spawnSync(zellij, ["delete-session", SESSION_NAME, "--force"], {
    stdio: "ignore",
  });

  const dir = mkdtempSync(join(tmpdir(), "lyy-layout-"));
  writeFileSync(join(dir, "main.kdl"), ZELLIJ_LAYOUT);
  writeFileSync(join(dir, "config.kdl"), ZELLIJ_CONFIG);

  await passthroughTo(zellij, [
    "--config-dir",
    dir,
    "--session",
    SESSION_NAME,
    "--new-session-with-layout",
    join(dir, "main.kdl"),
  ]);

  spawnSync(zellij, ["delete-session", SESSION_NAME, "--force"], {
    stdio: "ignore",
  });
}

/**
 * Start lyy-daemon in background if not already running.
 *
 * Daemon is singleton — first `lyy` spawns it detached + unref'd so it
 * survives Ctrl+C of the originating terminal. Subsequent `lyy` invocations
 * (across terminals) probe the socket and reuse the same daemon.
 *
 * Probe ping() the socket rather than just checking file existence —
 * a crashed daemon can leave a stale socket file that would otherwise
 * trick us into skipping respawn.
 */
async function ensureDaemonRunning(): Promise<void> {
  if (await pingDaemon()) return;

  // Stale socket from a dead daemon? Remove before respawn.
  if (existsSync(DEFAULT_MCP_SOCK)) {
    try {
      unlinkSync(DEFAULT_MCP_SOCK);
    } catch {
      // ignore — listen() will surface real error
    }
  }

  const daemonBin = resolveDaemonBin();
  if (!daemonBin) {
    console.warn(
      "[lyy] lyy-daemon not found; slash commands / MCP will be unavailable.",
    );
    return;
  }

  const logPath = resolvePath(homedir(), ".lyy", "daemon.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(daemonBin, [], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  console.log(`[lyy] started daemon (pid ${child.pid}, log: ${logPath})`);

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await pingDaemon()) return;
    await sleep(100);
  }
  console.warn("[lyy] daemon did not answer within 3s — check daemon.log");
}

/** Quick connect-and-drop to confirm daemon is alive behind the socket. */
function pingDaemon(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(DEFAULT_MCP_SOCK)) return resolve(false);
    const s = createConnection(DEFAULT_MCP_SOCK);
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
    setTimeout(() => done(false), 500);
  });
}

function resolveDaemonBin(): string | null {
  const found = which("lyy-daemon");
  if (found) return found;
  const candidates = [
    resolvePath(homedir(), ".lyy", "bin", "lyy-daemon"),
    resolvePath(homedir(), ".lyy", "runtime", "daemon", "bin", "lyy-daemon"),
    "/usr/local/bin/lyy-daemon",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function passthroughTo(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}
