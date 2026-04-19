import { DEFAULT_IDENTITY_PATH, DEFAULT_MCP_SOCK, McpIpcClient } from "@lyy/daemon";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { which } from "../util/which.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];

  checks.push(checkIdentity());
  checks.push(checkClaudeSettings());
  checks.push(toolCheck("claude"));
  checks.push(toolCheck("zellij"));
  checks.push(toolCheck("lyy-daemon"));
  checks.push(toolCheck("lyy-mcp"));
  checks.push(await checkDaemon());
  checks.push(await checkRelay());

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

function checkIdentity(): Check {
  if (!existsSync(DEFAULT_IDENTITY_PATH)) {
    return { name: "identity", ok: false, detail: `${DEFAULT_IDENTITY_PATH} not found — run \`lyy init\`` };
  }
  try {
    const id = JSON.parse(readFileSync(DEFAULT_IDENTITY_PATH, "utf8"));
    return { name: "identity", ok: true, detail: `peerId=${id.peerId} relay=${id.relayUrl}` };
  } catch (err) {
    return { name: "identity", ok: false, detail: `parse error: ${(err as Error).message}` };
  }
}

function checkClaudeSettings(): Check {
  const path = resolve(homedir(), ".claude", "settings.json");
  if (!existsSync(path)) return { name: "claude settings", ok: false, detail: `${path} missing` };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: Record<string, unknown> };
    const ok = !!raw.mcpServers?.lyy;
    return {
      name: "claude settings",
      ok,
      detail: ok ? "lyy MCP server registered" : "lyy MCP server NOT registered (re-run lyy init)",
    };
  } catch (err) {
    return { name: "claude settings", ok: false, detail: `parse error: ${(err as Error).message}` };
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
    return { name: "daemon", ok: false, detail: `${DEFAULT_MCP_SOCK} missing — daemon not running?` };
  }
  try {
    const ipc = new McpIpcClient();
    await ipc.call("list_inbox");
    return { name: "daemon", ok: true, detail: "MCP IPC responding" };
  } catch (err) {
    return { name: "daemon", ok: false, detail: `IPC error: ${(err as Error).message}` };
  }
}

async function checkRelay(): Promise<Check> {
  if (!existsSync(DEFAULT_IDENTITY_PATH)) {
    return { name: "relay", ok: false, detail: "skipped (no identity)" };
  }
  let relayUrl: string;
  try {
    relayUrl = (JSON.parse(readFileSync(DEFAULT_IDENTITY_PATH, "utf8")) as { relayUrl: string })
      .relayUrl;
  } catch {
    return { name: "relay", ok: false, detail: "skipped (bad identity)" };
  }
  try {
    const res = await fetch(`${relayUrl.replace(/\/$/, "")}/health`);
    if (!res.ok) return { name: "relay", ok: false, detail: `${res.status} from /health` };
    return { name: "relay", ok: true, detail: `${relayUrl} healthy` };
  } catch (err) {
    return { name: "relay", ok: false, detail: `unreachable: ${(err as Error).message}` };
  }
}
