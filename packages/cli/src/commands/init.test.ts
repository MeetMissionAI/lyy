import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeClaudeSettings, writeIdentity } from "./init.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-cli-init-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeIdentity", () => {
  it("writes JSON file with mode 0600", () => {
    const path = join(dir, ".lyy", "identity.json");
    writeIdentity(path, {
      peerId: "550e8400-e29b-41d4-a716-446655440000",
      jwt: "tok",
      relayUrl: "https://r",
    });
    const content = JSON.parse(readFileSync(path, "utf8"));
    expect(content.peerId).toBe("550e8400-e29b-41d4-a716-446655440000");
    const fs = require("node:fs") as typeof import("node:fs");
    const stat = fs.statSync(path);
    expect((stat.mode & 0o777).toString(8)).toBe("600");
  });
});

describe("mergeClaudeSettings", () => {
  it("creates the file with lyy MCP entry when missing", () => {
    const path = join(dir, "settings.json");
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.mcpServers.lyy).toEqual({ command: "lyy-mcp", args: [] });
  });

  it("preserves existing settings + other MCP servers", () => {
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        theme: "dark",
        mcpServers: { other: { command: "other-mcp" } },
      }),
    );
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.theme).toBe("dark");
    expect(result.mcpServers.other).toEqual({ command: "other-mcp" });
    expect(result.mcpServers.lyy).toEqual({ command: "lyy-mcp", args: [] });
  });

  it("overwrites existing lyy MCP entry (no stale config)", () => {
    const path = join(dir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { lyy: { command: "old-path" } } }),
    );
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.mcpServers.lyy.command).toBe("lyy-mcp");
  });

  it("throws when existing file is invalid JSON (don't clobber)", () => {
    const path = join(dir, "settings.json");
    writeFileSync(path, "{not json");
    expect(() => mergeClaudeSettings(path)).toThrow(/not valid JSON/);
  });
});
