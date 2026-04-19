import {
  installLaunchAgent,
  type Identity,
} from "@lyy/daemon";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { which } from "../util/which.js";

export interface InitOptions {
  invite?: string;
  name?: string;
  email?: string;
  relayUrl?: string;
  launchAgent?: boolean;
}

interface PairResponse {
  peerId: string;
  jwt: string;
}

const IDENTITY_PATH = resolve(homedir(), ".lyy", "identity.json");
const CLAUDE_SETTINGS_PATH = resolve(homedir(), ".claude", "settings.json");

export async function runInit(opts: InitOptions): Promise<void> {
  const relayUrl = opts.relayUrl ?? process.env.LYY_RELAY_URL;
  if (!relayUrl) throw new Error("relay URL required: --relay-url or LYY_RELAY_URL env");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const code = opts.invite ?? (await rl.question("Invite code: "));
    const name = opts.name ?? (await rl.question("Your @name (e.g. leo): "));
    const email = opts.email ?? (await rl.question("Your email: "));
    if (!code || !name || !email) throw new Error("invite, name, email all required");

    console.log(`[init] POST ${relayUrl}/pair ...`);
    const res = await fetch(`${relayUrl.replace(/\/$/, "")}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name, email }),
    });
    if (!res.ok) {
      throw new Error(`pair failed (${res.status}): ${await res.text()}`);
    }
    const { peerId, jwt } = (await res.json()) as PairResponse;

    const identity: Identity = { peerId, jwt, relayUrl };
    writeIdentity(IDENTITY_PATH, identity);
    console.log(`[init] wrote ${IDENTITY_PATH} (mode 0600)`);

    mergeClaudeSettings(CLAUDE_SETTINGS_PATH);
    console.log(`[init] merged lyy-mcp registration into ${CLAUDE_SETTINGS_PATH}`);

    if (opts.launchAgent !== false) {
      const daemonPath = which("lyy-daemon");
      if (!daemonPath) {
        console.warn("[init] lyy-daemon not on PATH; skipping LaunchAgent install");
      } else {
        const { plistPath } = await installLaunchAgent({ daemonPath });
        console.log(`[init] installed LaunchAgent at ${plistPath} (loaded)`);
      }
    }

    console.log("");
    console.log(`✓ paired as @${name} (peerId=${peerId})`);
    console.log("Run `lyy` to launch Claude Code with LYY enabled.");
  } finally {
    rl.close();
  }
}

export function writeIdentity(path: string, identity: Identity): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(identity, null, 2), { mode: 0o600 });
}

interface ClaudeSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  [k: string]: unknown;
}

const LYY_MCP_BIN = "lyy-mcp";

export function mergeClaudeSettings(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let current: ClaudeSettings = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
    } catch {
      throw new Error(`existing ${path} is not valid JSON; refusing to clobber`);
    }
  }

  const mcpServers = { ...(current.mcpServers ?? {}) };
  mcpServers.lyy = { command: LYY_MCP_BIN, args: [] };

  const next: ClaudeSettings = { ...current, mcpServers };
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
}
