import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const DEFAULT_LABEL = "com.missionai.lyy-daemon";

export function defaultLaunchAgentDir(home: string = homedir()): string {
  return resolve(home, "Library", "LaunchAgents");
}

export function defaultPlistPath(
  label: string = DEFAULT_LABEL,
  home: string = homedir(),
): string {
  return resolve(defaultLaunchAgentDir(home), `${label}.plist`);
}

export interface PlistOptions {
  label?: string;
  /** Absolute path to the daemon executable. */
  daemonPath: string;
  /** Optional extra args. */
  args?: string[];
  logPath?: string;
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Returns the XML plist string. Pure — easy to unit test. */
export function buildLaunchAgentPlist(opts: PlistOptions): string {
  const label = opts.label ?? DEFAULT_LABEL;
  const log = opts.logPath ?? `/tmp/${label}.log`;
  const args = [opts.daemonPath, ...(opts.args ?? [])];
  const argXml = args
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(log)}</string>
</dict>
</plist>
`;
}

export interface InstallOptions extends PlistOptions {
  /** Override for tests. Defaults to ~/Library/LaunchAgents. */
  launchAgentDir?: string;
  /** When false, only write the plist; skip launchctl load. */
  loadAfterWrite?: boolean;
}

/** Writes the plist and (by default) loads it via launchctl. */
export async function installLaunchAgent(
  opts: InstallOptions,
): Promise<{ plistPath: string }> {
  const dir = opts.launchAgentDir ?? defaultLaunchAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const label = opts.label ?? DEFAULT_LABEL;
  const plistPath = resolve(dir, `${label}.plist`);
  const xml = buildLaunchAgentPlist(opts);
  writeFileSync(plistPath, xml, "utf8");

  if (opts.loadAfterWrite ?? true) {
    await launchctlLoad(plistPath);
  }
  return { plistPath };
}

export async function uninstallLaunchAgent(opts: {
  label?: string;
  launchAgentDir?: string;
  unloadFirst?: boolean;
}): Promise<void> {
  const dir = opts.launchAgentDir ?? defaultLaunchAgentDir();
  const label = opts.label ?? DEFAULT_LABEL;
  const plistPath = resolve(dir, `${label}.plist`);
  if (opts.unloadFirst ?? true) {
    await launchctlUnload(plistPath).catch(() => undefined);
  }
  if (existsSync(plistPath)) {
    const fs = await import("node:fs/promises");
    await fs.unlink(plistPath);
  }
}

async function spawnLaunchctl(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("launchctl", args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`launchctl ${args.join(" ")} exited with code ${code}`),
        );
    });
  });
}

export const launchctlLoad = (plistPath: string): Promise<void> =>
  spawnLaunchctl(["load", "-w", plistPath]);

export const launchctlUnload = (plistPath: string): Promise<void> =>
  spawnLaunchctl(["unload", "-w", plistPath]);

const _ensureDirExists = (path: string): void => {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};
void _ensureDirExists; // silence unused (kept for callers that may need it)
