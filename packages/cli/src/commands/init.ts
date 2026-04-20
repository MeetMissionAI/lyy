import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { Identity } from "@lyy/daemon";
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

const IDENTITY_PATH = resolve(
  process.env.LYY_HOME ?? resolve(homedir(), ".lyy"),
  "identity.json",
);
const CLAUDE_SETTINGS_PATH = resolve(homedir(), ".claude", "settings.json");

export async function runInit(opts: InitOptions): Promise<void> {
  const relayUrl = opts.relayUrl ?? process.env.LYY_RELAY_URL;
  if (!relayUrl)
    throw new Error("relay URL required: --relay-url or LYY_RELAY_URL env");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const code = opts.invite ?? (await rl.question("Invite code: "));
    const name = opts.name ?? (await rl.question("Your @name (e.g. leo): "));
    const email = opts.email ?? (await rl.question("Your email: "));
    if (!code || !name || !email)
      throw new Error("invite, name, email all required");

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
    console.log(
      `[init] merged statusLine + hooks into ${CLAUDE_SETTINGS_PATH}`,
    );

    registerMcpWithClaude();

    const installed = installSlashCommands();
    console.log(
      `[init] installed ${installed} slash command(s) into ~/.claude/commands/`,
    );

    // LaunchAgent removed — daemon auto-starts when user runs `lyy`.

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

const LYY_MCP_BIN_NAME = "lyy-mcp";
const LYY_CLI_BIN_NAME = "lyy";

/**
 * Resolve absolute path for a lyy-family binary. Claude Code (GUI on macOS)
 * spawns MCP servers + hooks + statusLine commands without the user's shell
 * PATH — ~/.lyy/bin isn't visible, so bare names fail with ENOENT.
 */
function resolveLyyBin(name: string): string {
  const found = which(name);
  if (found) return found;
  const candidates = [
    resolve(homedir(), ".lyy", "bin", name),
    resolve(
      homedir(),
      ".lyy",
      "runtime",
      name.replace(/^lyy-?/, ""),
      "bin",
      name,
    ),
    `/usr/local/bin/${name}`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return name; // fallback — will still fail but surfaces clearer error
}

/**
 * Claude Code reads MCP servers from ~/.claude.json (not ~/.claude/settings.json).
 * Use the `claude` CLI so Claude Code owns its own config format.
 */
export function registerMcpWithClaude(): void {
  const claude = which("claude");
  const mcpBin = resolveLyyBin(LYY_MCP_BIN_NAME);
  if (!claude) {
    console.warn(
      `[init] claude CLI not on PATH — MCP not registered. Run manually:\n       claude mcp add lyy --scope user -- ${mcpBin}`,
    );
    return;
  }
  // Remove any stale entry first (idempotent re-init).
  spawnSync(claude, ["mcp", "remove", "lyy", "--scope", "user"], {
    stdio: "ignore",
  });
  const result = spawnSync(
    claude,
    ["mcp", "add", "lyy", "--scope", "user", "--", mcpBin],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.warn(
      `[init] \`claude mcp add lyy\` exited ${result.status}. Register manually if needed.`,
    );
    return;
  }
  console.log(`[init] registered lyy MCP server with Claude Code (${mcpBin})`);
}

const LYY_HOOK_SUBCOMMANDS: Record<string, string> = {
  SessionStart: "hook session-start",
  UserPromptSubmit: "hook prompt-submit",
  Stop: "hook stop",
};

function buildHookCommands(lyyBin: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [event, sub] of Object.entries(LYY_HOOK_SUBCOMMANDS)) {
    out[event] = `${lyyBin} ${sub}`;
  }
  return out;
}

export function mergeClaudeSettings(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let current: ClaudeSettings = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
    } catch {
      throw new Error(
        `existing ${path} is not valid JSON; refusing to clobber`,
      );
    }
  }

  const lyyBin = resolveLyyBin(LYY_CLI_BIN_NAME);
  const statuslineCmd = `${lyyBin} statusline`;

  const statusLine = current.statusLine ?? {
    type: "command",
    command: statuslineCmd,
    refreshInterval: 5000,
  };
  // Force statusLine to lyy if user hasn't customized away from a default-ish command
  if (!current.statusLine) statusLine.command = statuslineCmd;

  const hooks = mergeHooks(current.hooks ?? {}, lyyBin);

  const next: ClaudeSettings = { ...current, statusLine, hooks };
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
}

/**
 * Add the lyy hook entry under each event without disturbing existing hooks.
 * Idempotent — re-running init won't add duplicates.
 */
function mergeHooks(
  existing: Record<string, HookSpec[]>,
  lyyBin: string,
): Record<string, HookSpec[]> {
  const next = { ...existing };
  const commands = buildHookCommands(lyyBin);
  for (const [event, command] of Object.entries(commands)) {
    const groups = [...(next[event] ?? [])];
    // Strip any stale lyy hook entry (bare `lyy hook ...` from older installs,
    // or a different absolute path) before appending the current one.
    const sub = LYY_HOOK_SUBCOMMANDS[event];
    const filtered = groups
      .map((g) => ({
        hooks: g.hooks.filter(
          (h) => !(h.type === "command" && isLyyHookCommand(h.command, sub)),
        ),
      }))
      .filter((g) => g.hooks.length > 0);
    filtered.push({ hooks: [{ type: "command", command }] });
    next[event] = filtered;
  }
  return next;
}

function isLyyHookCommand(cmd: string, sub: string): boolean {
  // match bare "lyy <sub>" or "<abspath>/lyy <sub>"
  return /(^|\/)lyy\s/.test(cmd) && cmd.includes(sub);
}

/** Copy claude-assets/commands/*.md into ~/.claude/commands/. Returns count. */
export function installSlashCommands(
  targetDir?: string,
  sourceDir?: string,
): number {
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
  // Two supported layouts:
  //   dev (monorepo):   packages/cli/dist/commands/init.js
  //                   → ../../../../claude-assets/commands
  //   release tarball:  <pkg>/dist/commands/init.js
  //                   → ../../claude-assets/commands (copied in by CI)
  const here = fileURLToPath(import.meta.url);
  const hereDir = dirname(here);
  const candidates = [
    resolve(hereDir, "..", "..", "claude-assets", "commands"), // release
    resolve(hereDir, "..", "..", "..", "..", "claude-assets", "commands"), // dev
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // doesn't exist; installSlashCommands no-ops
}
