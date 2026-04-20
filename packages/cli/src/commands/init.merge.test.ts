import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSlashCommands, mergeClaudeSettings } from "./init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-cli-init-merge-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("mergeClaudeSettings (Phase 6 extensions)", () => {
  it("adds statusLine with `lyy statusline` command", () => {
    const path = join(dir, "settings.json");
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.statusLine.type).toBe("command");
    expect(result.statusLine.refreshInterval).toBe(5000);
    // Command may be bare `lyy statusline` or absolute `/path/to/lyy statusline`
    // depending on whether lyy is on PATH during test.
    expect(result.statusLine.command).toMatch(/(^|\/)lyy statusline$/);
  });

  it("preserves existing statusLine if user customized", () => {
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({ statusLine: { type: "command", command: "my-status" } }),
    );
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.statusLine.command).toBe("my-status");
  });

  it("registers SessionStart / UserPromptSubmit / Stop hooks for lyy", () => {
    const path = join(dir, "settings.json");
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.hooks.SessionStart[0].hooks[0].command).toMatch(
      /(^|\/)lyy hook session-start$/,
    );
    expect(result.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(
      /(^|\/)lyy hook prompt-submit$/,
    );
    expect(result.hooks.Stop[0].hooks[0].command).toMatch(
      /(^|\/)lyy hook stop$/,
    );
  });

  it("hook merge is idempotent (no duplicates on re-run)", () => {
    const path = join(dir, "settings.json");
    mergeClaudeSettings(path);
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.hooks.SessionStart.length).toBe(1);
  });

  it("preserves existing user hook entries on the same event", () => {
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "my-hook" }] }],
        },
      }),
    );
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    const commands = result.hooks.SessionStart.flatMap(
      (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
    );
    expect(commands).toContain("my-hook");
    expect(
      commands.some((c: string) => /(^|\/)lyy hook session-start$/.test(c)),
    ).toBe(true);
  });
});

describe("installSlashCommands", () => {
  it("copies markdown templates into the target dir", () => {
    const sourceDir = join(dir, "src");
    const targetDir = join(dir, "target");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(join(sourceDir, "inbox.md"), "test");
    fs.writeFileSync(join(sourceDir, "pickup.md"), "test");
    fs.writeFileSync(join(sourceDir, "ignore.txt"), "test");

    const count = installSlashCommands(targetDir, sourceDir);
    expect(count).toBe(2);
    expect(fs.existsSync(join(targetDir, "inbox.md"))).toBe(true);
    expect(fs.existsSync(join(targetDir, "pickup.md"))).toBe(true);
    expect(fs.existsSync(join(targetDir, "ignore.txt"))).toBe(false);
  });

  it("creates the target dir if missing", () => {
    const sourceDir = join(dir, "src");
    const targetDir = join(dir, "deep", "nested", "target");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(join(sourceDir, "x.md"), "test");

    installSlashCommands(targetDir, sourceDir);
    expect(fs.existsSync(targetDir)).toBe(true);
  });
});
