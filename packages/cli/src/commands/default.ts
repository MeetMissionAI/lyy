import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// Disable session persistence so a dead "lyy" session doesn't block next launch.
const ZELLIJ_CONFIG = `session_serialization false
`;

/**
 * Default `lyy` command: launch Claude Code inside a zellij session.
 * If already in zellij, just exec claude in the current pane.
 * If zellij not installed, fall back to plain claude.
 */
export async function runDefault(): Promise<void> {
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

  // Kill any stale dead session from a previous crash. Silent on no-match.
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

  // Ensure session is removed after exit (belt + suspenders; config flag
  // covers the clean case, this handles edge cases where it sticks).
  spawnSync(zellij, ["delete-session", SESSION_NAME, "--force"], {
    stdio: "ignore",
  });
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
