import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { which } from "../util/which.js";

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

  const dir = mkdtempSync(join(tmpdir(), "lyy-layout-"));
  const layoutPath = join(dir, "main.kdl");
  writeFileSync(layoutPath, ZELLIJ_LAYOUT);

  return passthroughTo(zellij, [
    "--session",
    "lyy",
    "--new-session-with-layout",
    layoutPath,
  ]);
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
