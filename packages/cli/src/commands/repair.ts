import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  installSlashCommands,
  mergeClaudeSettings,
  registerMcpWithClaude,
} from "./init.js";

const IDENTITY_PATH = resolve(homedir(), ".lyy", "identity.json");
const CLAUDE_SETTINGS_PATH = resolve(homedir(), ".claude", "settings.json");

/**
 * Re-apply Claude Code wiring without consuming a new invite code. Use this
 * after upgrading lyy or when MCP/hooks/statusLine stopped working (e.g.
 * claude GUI can't find `lyy-mcp` on PATH — init now writes absolute paths).
 */
export async function runRepair(): Promise<void> {
  if (!existsSync(IDENTITY_PATH)) {
    throw new Error(
      `no identity found at ${IDENTITY_PATH}. Run \`lyy init\` first.`,
    );
  }

  mergeClaudeSettings(CLAUDE_SETTINGS_PATH);
  console.log(
    `[repair] refreshed statusLine + hooks in ${CLAUDE_SETTINGS_PATH}`,
  );

  registerMcpWithClaude();

  const installed = installSlashCommands();
  console.log(
    `[repair] refreshed ${installed} slash command(s) in ~/.claude/commands/`,
  );

  console.log("");
  console.log("✓ lyy repaired. Restart Claude Code to pick up new MCP config.");
}
