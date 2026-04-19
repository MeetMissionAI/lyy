import {
  installLaunchAgent,
  type Identity,
} from "@lyy/daemon";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
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
    console.log(`[init] merged lyy MCP + statusLine + hooks into ${CLAUDE_SETTINGS_PATH}`);

    const installed = installSlashCommands();
    console.log(`[init] installed ${installed} slash command(s) into ~/.claude/commands/`);

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

interface HookSpec {
  hooks: { type: string; command: string }[];
}
interface ClaudeSettings {
  mcpServers?: Record<string, { command: string; args?: string[] }>;
  statusLine?: { type: string; command: string; refreshInterval?: number };
  hooks?: Record<string, HookSpec[]>;
  [k: string]: unknown;
}

const LYY_MCP_BIN = "lyy-mcp";
const LYY_STATUSLINE_CMD = "lyy statusline";
const LYY_HOOK_COMMANDS: Record<string, string> = {
  SessionStart: "lyy hook session-start",
  UserPromptSubmit: "lyy hook prompt-submit",
  Stop: "lyy hook stop",
};

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

  const statusLine = current.statusLine ?? {
    type: "command",
    command: LYY_STATUSLINE_CMD,
    refreshInterval: 5000,
  };
  // Force statusLine to lyy if user hasn't customized away from a default-ish command
  if (!current.statusLine) statusLine.command = LYY_STATUSLINE_CMD;

  const hooks = mergeHooks(current.hooks ?? {});

  const next: ClaudeSettings = { ...current, mcpServers, statusLine, hooks };
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
}

/**
 * Add the lyy hook entry under each event without disturbing existing hooks.
 * Idempotent — re-running init won't add duplicates.
 */
function mergeHooks(existing: Record<string, HookSpec[]>): Record<string, HookSpec[]> {
  const next = { ...existing };
  for (const [event, command] of Object.entries(LYY_HOOK_COMMANDS)) {
    const groups = [...(next[event] ?? [])];
    const lyyHook = { type: "command", command };
    const alreadyHasLyy = groups.some((g) =>
      g.hooks.some((h) => h.command === command),
    );
    if (!alreadyHasLyy) groups.push({ hooks: [lyyHook] });
    next[event] = groups;
  }
  return next;
}

/** Copy claude-assets/commands/*.md into ~/.claude/commands/. Returns count. */
export function installSlashCommands(targetDir?: string, sourceDir?: string): number {
  const target = targetDir ?? resolve(homedir(), ".claude", "commands");
  if (!existsSync(target)) mkdirSync(target, { recursive: true });

  const source = sourceDir ?? defaultSlashCommandsDir();
  if (!existsSync(source)) return 0;

  const files = readdirSync(source).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    copyFileSync(resolve(source, file), resolve(target, file));
  }
  return files.length;
}

function defaultSlashCommandsDir(): string {
  // Resolves relative to the built output location.
  // packages/cli/dist/commands/init.js → ../../../../claude-assets/commands
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), "..", "..", "..", "..", "claude-assets", "commands");
}
