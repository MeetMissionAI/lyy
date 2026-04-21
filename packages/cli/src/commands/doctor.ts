import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  DEFAULT_IDENTITY_PATH,
  DEFAULT_MCP_SOCK,
  McpIpcClient,
} from "@lyy/daemon";
import { which } from "../util/which.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  /** If true, SIGKILL any lyy-daemon processes not recorded in a profile's daemon.pid. */
  fixDaemons?: boolean;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<void> {
  const checks: Check[] = [];

  checks.push(checkIdentity());
  checks.push(checkClaudeSettings());
  checks.push(toolCheck("claude"));
  checks.push(toolCheck("zellij"));
  checks.push(toolCheck("lyy-daemon"));
  checks.push(toolCheck("lyy-mcp"));
  checks.push(await checkDaemon());
  checks.push(await checkRelay());
  checks.push(checkRogueDaemons(opts.fixDaemons ?? false));

  for (const c of checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  if (failed > 0) {
    console.log(`\n${failed} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll checks passed.");
  }
}

/**
 * Parse `ps -A -o pid=,command=` output and filter to lyy-daemon processes
 * that aren't in `legitPids`. Exported for unit testing — the live doctor
 * check collects `legitPids` from each profile's `daemon.pid` file under
 * `~/.lyy/profiles/<name>/` and runs `ps` itself.
 */
export function findRogueDaemons(
  psOut: string,
  legitPids: Set<number>,
): number[] {
  const rogue: number[] = [];
  for (const line of psOut.split("\n")) {
    const m = line.trimStart().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number.parseInt(m[1] ?? "", 10);
    const cmd = m[2] ?? "";
    if (!Number.isFinite(pid)) continue;
    // Require a path separator (or start of string) immediately before
    // `lyy-daemon` so partial matches like `/path/not-lyy-daemon` don't
    // trip the check.
    const isDaemonProc =
      /packages\/daemon\/bin\/lyy-daemon/.test(cmd) ||
      /packages\/daemon\/.+\/src\/bin\.ts/.test(cmd) ||
      /(^|\/)lyy-daemon(-dev)?(\s|$)/.test(cmd);
    if (!isDaemonProc) continue;
    if (legitPids.has(pid)) continue;
    rogue.push(pid);
  }
  return rogue;
}

/**
 * Collect every profile's legitimate daemon PID (from each `daemon.pid`
 * file) and cross-check against running `lyy-daemon` processes. Any
 * lyy-daemon process not listed in some profile's daemon.pid is considered
 * rogue — leftover from a shutdown that hung or a CLI handshake that
 * didn't escalate to SIGKILL. If `fix` is true, SIGKILL them.
 */
function checkRogueDaemons(fix: boolean): Check {
  const profilesRoot = resolve(homedir(), ".lyy", "profiles");
  const legitPids = new Set<number>();
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot)) {
      const pidFile = resolve(profilesRoot, entry, "daemon.pid");
      if (!existsSync(pidFile)) continue;
      try {
        const pid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
        if (Number.isFinite(pid) && pid > 0) legitPids.add(pid);
      } catch {
        // ignore
      }
    }
  }
  // Also treat the current process as legitimate (running `lyy doctor` itself).
  legitPids.add(process.pid);

  let psOut: string;
  try {
    psOut = execFileSync("ps", ["-A", "-o", "pid=,command="], {
      encoding: "utf8",
    });
  } catch (err) {
    return {
      name: "rogue daemons",
      ok: false,
      detail: `ps failed: ${(err as Error).message}`,
    };
  }
  const rogue = findRogueDaemons(psOut, legitPids);

  if (rogue.length === 0) {
    return {
      name: "rogue daemons",
      ok: true,
      detail: `0 found (${legitPids.size - 1} profile(s) owned)`,
    };
  }

  if (!fix) {
    return {
      name: "rogue daemons",
      ok: false,
      detail: `${rogue.length} rogue pid(s): ${rogue.join(", ")} — rerun with --fix-daemons to SIGKILL`,
    };
  }

  let killed = 0;
  for (const pid of rogue) {
    try {
      process.kill(pid, "SIGKILL");
      killed++;
    } catch {
      // ignore — already dead / insufficient perms
    }
  }
  return {
    name: "rogue daemons",
    ok: true,
    detail: `SIGKILLed ${killed}/${rogue.length} rogue pid(s): ${rogue.join(", ")}`,
  };
}

function checkIdentity(): Check {
  if (!existsSync(DEFAULT_IDENTITY_PATH)) {
    return {
      name: "identity",
      ok: false,
      detail: `${DEFAULT_IDENTITY_PATH} not found — run \`lyy init\``,
    };
  }
  try {
    const id = JSON.parse(readFileSync(DEFAULT_IDENTITY_PATH, "utf8"));
    return {
      name: "identity",
      ok: true,
      detail: `peerId=${id.peerId} relay=${id.relayUrl}`,
    };
  } catch (err) {
    return {
      name: "identity",
      ok: false,
      detail: `parse error: ${(err as Error).message}`,
    };
  }
}

function checkClaudeSettings(): Check {
  const path = resolve(homedir(), ".claude", "settings.json");
  if (!existsSync(path))
    return { name: "claude settings", ok: false, detail: `${path} missing` };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    const ok = !!raw.mcpServers?.lyy;
    return {
      name: "claude settings",
      ok,
      detail: ok
        ? "lyy MCP server registered"
        : "lyy MCP server NOT registered (re-run lyy init)",
    };
  } catch (err) {
    return {
      name: "claude settings",
      ok: false,
      detail: `parse error: ${(err as Error).message}`,
    };
  }
}

function toolCheck(bin: string): Check {
  const found = which(bin);
  return {
    name: bin,
    ok: !!found,
    detail: found ?? `${bin} not on PATH`,
  };
}

async function checkDaemon(): Promise<Check> {
  if (!existsSync(DEFAULT_MCP_SOCK)) {
    return {
      name: "daemon",
      ok: false,
      detail: `${DEFAULT_MCP_SOCK} missing — daemon not running?`,
    };
  }
  try {
    const ipc = new McpIpcClient();
    await ipc.call("list_inbox");
    return { name: "daemon", ok: true, detail: "MCP IPC responding" };
  } catch (err) {
    return {
      name: "daemon",
      ok: false,
      detail: `IPC error: ${(err as Error).message}`,
    };
  }
}

async function checkRelay(): Promise<Check> {
  if (!existsSync(DEFAULT_IDENTITY_PATH)) {
    return { name: "relay", ok: false, detail: "skipped (no identity)" };
  }
  let relayUrl: string;
  try {
    relayUrl = (
      JSON.parse(readFileSync(DEFAULT_IDENTITY_PATH, "utf8")) as {
        relayUrl: string;
      }
    ).relayUrl;
  } catch {
    return { name: "relay", ok: false, detail: "skipped (bad identity)" };
  }
  try {
    const res = await fetch(`${relayUrl.replace(/\/$/, "")}/health`);
    if (!res.ok)
      return { name: "relay", ok: false, detail: `${res.status} from /health` };
    return { name: "relay", ok: true, detail: `${relayUrl} healthy` };
  } catch (err) {
    return {
      name: "relay",
      ok: false,
      detail: `unreachable: ${(err as Error).message}`,
    };
  }
}
