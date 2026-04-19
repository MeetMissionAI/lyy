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

describe("mergeClaudeSettings (statusLine + hooks only)", () => {
  // MCP registration moved to `claude mcp add` — no longer lives in settings.json.

  it("throws when existing file is invalid JSON (don't clobber)", () => {
    const path = join(dir, "settings.json");
    writeFileSync(path, "{not json");
    expect(() => mergeClaudeSettings(path)).toThrow(/not valid JSON/);
  });

  it("does not add mcpServers (Claude Code reads those from ~/.claude.json)", () => {
    const path = join(dir, "settings.json");
    mergeClaudeSettings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    expect(result.mcpServers).toBeUndefined();
  });
});
