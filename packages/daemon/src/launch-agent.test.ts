import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL,
  buildLaunchAgentPlist,
  installLaunchAgent,
  uninstallLaunchAgent,
} from "./launch-agent.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-launchagent-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildLaunchAgentPlist", () => {
  it("emits XML with the daemon path in ProgramArguments", () => {
    const xml = buildLaunchAgentPlist({ daemonPath: "/opt/lyy/lyy-daemon" });
    expect(xml).toContain(`<string>${DEFAULT_LABEL}</string>`);
    expect(xml).toContain("<string>/opt/lyy/lyy-daemon</string>");
    expect(xml).toContain("<key>RunAtLoad</key>");
    expect(xml).toContain("<true/>");
  });

  it("escapes XML-special characters in paths", () => {
    const xml = buildLaunchAgentPlist({ daemonPath: "/a&b/<lyy>" });
    expect(xml).toContain("/a&amp;b/&lt;lyy&gt;");
    expect(xml).not.toContain("/a&b/<lyy>");
  });

  it("includes extra args after daemon path", () => {
    const xml = buildLaunchAgentPlist({
      daemonPath: "/opt/lyy/d",
      args: ["--verbose", "--no-color"],
    });
    expect(xml).toMatch(
      /<string>\/opt\/lyy\/d<\/string>[\s\S]*<string>--verbose<\/string>[\s\S]*<string>--no-color<\/string>/,
    );
  });

  it("uses custom label and log path when provided", () => {
    const xml = buildLaunchAgentPlist({
      daemonPath: "/d",
      label: "com.example.foo",
      logPath: "/var/log/foo.log",
    });
    expect(xml).toContain("<string>com.example.foo</string>");
    expect(xml).toContain("<string>/var/log/foo.log</string>");
  });
});

describe("installLaunchAgent (no launchctl load)", () => {
  it("writes the plist into the configured dir", async () => {
    const { plistPath } = await installLaunchAgent({
      daemonPath: "/opt/lyy/d",
      launchAgentDir: dir,
      loadAfterWrite: false,
    });
    expect(plistPath).toBe(join(dir, `${DEFAULT_LABEL}.plist`));
    expect(existsSync(plistPath)).toBe(true);
    const content = readFileSync(plistPath, "utf8");
    expect(content).toContain("<string>/opt/lyy/d</string>");
  });

  it("creates the LaunchAgents dir if missing", async () => {
    const nested = join(dir, "Library", "LaunchAgents");
    expect(existsSync(nested)).toBe(false);
    await installLaunchAgent({
      daemonPath: "/d",
      launchAgentDir: nested,
      loadAfterWrite: false,
    });
    expect(existsSync(nested)).toBe(true);
  });

  it("uninstall removes the plist file", async () => {
    const { plistPath } = await installLaunchAgent({
      daemonPath: "/d",
      launchAgentDir: dir,
      loadAfterWrite: false,
    });
    expect(existsSync(plistPath)).toBe(true);
    await uninstallLaunchAgent({ launchAgentDir: dir, unloadFirst: false });
    expect(existsSync(plistPath)).toBe(false);
  });
});
