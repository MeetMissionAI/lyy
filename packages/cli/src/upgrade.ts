import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join as pathJoin, sep } from "node:path";
import { LYY_VERSION } from "@lyy/shared";

/** Parse `vX.Y.Z` or `X.Y.Z` (any suffix ignored) into [major, minor, patch]. */
export function parseVersion(tag: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  if (!m) throw new Error(`bad version tag: ${tag}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Returns -1/0/1 like strcmp. Only major.minor.patch is compared. */
export function compareVersion(a: string, b: string): number {
  const [a1, a2, a3] = parseVersion(a);
  const [b1, b2, b3] = parseVersion(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * A "dev install" is any lyy invocation whose CLI binary does NOT live under
 * `<LYY_HOME>/runtime/`. That matches both the in-repo tsx shim and any hand-
 * rolled symlink pointing at a checkout. Dev installs always skip auto-upgrade
 * so we don't fight the developer's own working tree.
 */
export function isDevInstall(argv0: string, lyyHome: string): boolean {
  const runtimeMarker = `${lyyHome}${sep}runtime${sep}`;
  return !argv0.startsWith(runtimeMarker);
}

export interface TagResult {
  /** null means "no newer tag" (either 304 or a failure). */
  tag: string | null;
  /** ETag to persist for the next If-None-Match request. */
  etag: string | null;
}

export async function fetchLatestTag(
  repo: string,
  prevEtag: string | null,
  timeoutMs = 3000,
): Promise<TagResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
    };
    if (prevEtag) headers["if-none-match"] = prevEtag;
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { signal: ac.signal, headers },
    );
    if (res.status === 304) return { tag: null, etag: prevEtag };
    if (!res.ok) return { tag: null, etag: null };
    const data = (await res.json().catch(() => null)) as {
      tag_name?: string;
    } | null;
    if (!data?.tag_name) return { tag: null, etag: null };
    return { tag: data.tag_name, etag: res.headers.get("etag") };
  } catch {
    return { tag: null, etag: null };
  } finally {
    clearTimeout(timer);
  }
}

export function readEtag(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function writeEtag(path: string, etag: string): void {
  try {
    writeFileSync(path, `${etag}\n`, "utf8");
  } catch {
    // ignore — we'd rather skip the cache than crash a session
  }
}

/**
 * The release workflow writes `SHA256SUMS.txt` as `<sha>  <filename>\n` per
 * `sha256sum` convention. Parse into a filename→sha map.
 */
export function parseSha256Manifest(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^([0-9a-fA-F]{64})\s+(.+)$/.exec(trimmed);
    if (!m) continue;
    out.set(m[2].trim(), m[1].toLowerCase());
  }
  return out;
}

export function verifySha256(data: Buffer, expectedHex: string): boolean {
  const actual = createHash("sha256").update(data).digest("hex");
  return actual.toLowerCase() === expectedHex.toLowerCase();
}

/**
 * Atomic promotion: `<runtime>-old ← <runtime>`, `<runtime> ← staging`, then
 * remove the backup. Both `rename`s are atomic on the same filesystem
 * (Mac/Linux). If the second rename fails, we still have the old runtime at
 * `<runtime>-old` so the caller can manually recover.
 */
export function swapRuntime(staging: string, runtime: string): void {
  const backup = `${runtime}-old`;
  if (existsSync(backup)) {
    rmSync(backup, { recursive: true, force: true });
  }
  if (existsSync(runtime)) {
    renameSync(runtime, backup);
  }
  renameSync(staging, runtime);
  rmSync(backup, { recursive: true, force: true });
}

/** Pin a bin's shebang to the absolute node path (mirrors bootstrap.sh). */
function pinShebang(binPath: string, nodeBin: string): void {
  const lines = readFileSync(binPath, "utf8").split("\n");
  lines[0] = `#!${nodeBin}`;
  writeFileSync(binPath, lines.join("\n"), "utf8");
}

/**
 * Download each package tarball, check its sha256 against the manifest, and
 * `tar -xzf` into `<staging>/<pkg>/`. Rewrites the shebang of the package's
 * `bin/*` to the absolute path of the current `node` so Claude Code (which
 * launches MCP servers with a trimmed PATH) can still spawn them. Throws on
 * any failure so the caller can abort the upgrade and keep the old runtime.
 */
export async function downloadAndExtract(args: {
  baseUrl: string;
  pkgs: string[]; // e.g. ["cli", "daemon", "mcp", "tui"]
  manifest: Map<string, string>;
  stagingDir: string;
  nodeBin: string;
}): Promise<void> {
  mkdirSync(args.stagingDir, { recursive: true });
  for (const pkg of args.pkgs) {
    const filename = `lyy-${pkg}.tgz`;
    const expected = args.manifest.get(filename);
    if (!expected) throw new Error(`missing sha for ${filename} in manifest`);

    const res = await fetch(`${args.baseUrl}/${filename}`);
    if (!res.ok) throw new Error(`fetch ${filename}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!verifySha256(buf, expected)) {
      throw new Error(`sha256 mismatch for ${filename}`);
    }

    const pkgDir = pathJoin(args.stagingDir, pkg);
    mkdirSync(pkgDir, { recursive: true });
    const tarPath = pathJoin(args.stagingDir, filename);
    writeFileSync(tarPath, buf);
    execFileSync("tar", ["-xzf", tarPath, "-C", pkgDir]);
    rmSync(tarPath);
  }

  // Pin shebangs for the four known binaries.
  for (const [pkg, rel] of REQUIRED_BINS) {
    const p = pathJoin(args.stagingDir, pkg, rel);
    if (existsSync(p)) pinShebang(p, args.nodeBin);
  }
}

const REPO = "MeetMissionAI/lyy";
const PKGS = ["cli", "daemon", "mcp", "tui"];

/**
 * The bins every release tarball must ship. Used both to pin shebangs after
 * extract and to validate the staging layout before we swap the runtime. If a
 * tarball is malformed (missing a bin), we abort the upgrade and keep the old
 * runtime rather than promote a broken one and die on re-exec with ENOENT.
 */
const REQUIRED_BINS = [
  ["cli", "bin/lyy"],
  ["daemon", "bin/lyy-daemon"],
  ["mcp", "bin/lyy-mcp"],
  ["tui", "bin/lyy-tui"],
] as const;

export interface AutoUpgradeDeps {
  /**
   * Machine-wide LYY root (~/.lyy), NOT a per-profile LYY_HOME. runtime/,
   * upgrade-etag, and staging dirs all live under this path and are shared
   * across profiles on the same machine.
   */
  lyyHome: string;
  argv0: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** Injected for tests; default: real GitHub. */
  fetchTag?: typeof fetchLatestTag;
}

/**
 * Orchestrate a best-effort auto-upgrade on CLI launch.
 *
 * Design invariants:
 * - Never upgrade when re-exec'd after a successful upgrade (LYY_JUST_UPGRADED)
 *   or from a dev checkout. Both are fast short-circuits.
 * - Fail soft: any network, checksum, or extraction error logs a warning and
 *   falls back to the current version.
 * - Stage under `<lyyHome>/upgrade-staging-*` (NOT `os.tmpdir()`) so the
 *   subsequent rename in `swapRuntime` lands on the same filesystem. On Linux,
 *   `/tmp` is commonly a separate mount and would EXDEV the swap.
 * - Validate staging layout (REQUIRED_BINS) before promoting. A malformed
 *   tarball that made it past sha256 check would otherwise promote a broken
 *   runtime that then fails to re-exec with ENOENT.
 * - If `swapRuntime` throws after the first rename but before the second, the
 *   old runtime sits at `<runtime>-old` and `<runtime>` is missing. Attempt a
 *   best-effort restore in the catch block so we don't leave the install
 *   unusable.
 */
export async function autoUpgrade(deps: AutoUpgradeDeps): Promise<void> {
  if (deps.env.LYY_JUST_UPGRADED === "1") return;
  if (isDevInstall(deps.argv0, deps.lyyHome)) return;

  // Clean any upgrade-staging-* orphans from previous crashed runs. If the
  // process was killed between mkdtempSync and the catch's rmSync, the
  // directory would otherwise accumulate under lyyHome indefinitely.
  try {
    for (const entry of readdirSync(deps.lyyHome)) {
      if (entry.startsWith("upgrade-staging-")) {
        rmSync(pathJoin(deps.lyyHome, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // lyyHome might not exist yet on fresh installs; the caller's mkdtempSync
    // will throw with a clearer message.
  }

  const etagPath = pathJoin(deps.lyyHome, "upgrade-etag");
  const runtimeDir = pathJoin(deps.lyyHome, "runtime");
  const prevEtag = readEtag(etagPath);

  const fetchTag = deps.fetchTag ?? fetchLatestTag;
  const { tag, etag } = await fetchTag(REPO, prevEtag);
  if (!tag || compareVersion(tag, LYY_VERSION) <= 0) {
    // No upgrade to attempt — safe to persist etag for the next 304.
    if (etag && etag !== prevEtag) writeEtag(etagPath, etag);
    return;
  }
  // Upgrade path — defer the etag write until after swap succeeds. If we
  // persist it up front and any step below fails, the next launch gets 304
  // from GitHub and never retries; the user is wedged on the old version.

  console.log(`[lyy] upgrading v${LYY_VERSION} → ${tag}…`);

  // Stage inside lyyHome (not os.tmpdir()) to guarantee same-filesystem
  // rename in swapRuntime. On Linux, /tmp is commonly a separate mount.
  const staging = mkdtempSync(pathJoin(deps.lyyHome, "upgrade-staging-"));
  let swapped = false;
  try {
    const baseUrl = `https://github.com/${REPO}/releases/download/${tag}`;
    const manifestRes = await fetch(`${baseUrl}/SHA256SUMS.txt`);
    if (!manifestRes.ok) {
      throw new Error(`SHA256SUMS.txt: ${manifestRes.status}`);
    }
    const manifest = parseSha256Manifest(await manifestRes.text());
    // Use the same node that's running us, rather than whatever `node` is on
    // PATH. Avoids a subprocess and is safer when PATH is trimmed (e.g. when
    // Claude Code spawns MCP servers).
    const nodeBin = process.execPath;
    await downloadAndExtract({
      baseUrl,
      pkgs: PKGS,
      manifest,
      stagingDir: staging,
      nodeBin,
    });

    // Post-extract layout validation: catch malformed tarballs before promote.
    for (const [pkg, rel] of REQUIRED_BINS) {
      const p = pathJoin(staging, pkg, rel);
      if (!existsSync(p)) {
        throw new Error(`missing ${pkg}/${rel} after extract`);
      }
    }

    // Write VERSION inside the staging dir BEFORE the swap so the rename
    // promotes a fully-formed runtime atomically. Doing it after swap risks
    // leaving the promoted runtime with a stale VERSION if the write fails.
    writeFileSync(pathJoin(staging, "VERSION"), `${tag}\n`);
    swapRuntime(staging, runtimeDir);
    swapped = true;
    // Only now is it safe to persist the etag: the new runtime is live, so
    // next launch will see {new version, cached etag} — a consistent pair.
    if (etag && etag !== prevEtag) writeEtag(etagPath, etag);
  } catch (err) {
    console.warn(
      `[lyy] upgrade to ${tag} failed; continuing on current version: ${
        (err as Error).message
      }`,
    );
    // Defensive rollback: if swapRuntime threw between rename#1 and rename#2,
    // `<runtime>-old` holds the old tree and `<runtime>` is missing. Restore
    // so we don't leave the install in an unusable state. Safe no-op when
    // swap never ran or completed fully.
    const backup = `${runtimeDir}-old`;
    if (!swapped && existsSync(backup) && !existsSync(runtimeDir)) {
      try {
        renameSync(backup, runtimeDir);
      } catch {
        // best effort — we already logged the upgrade failure
      }
    }
    rmSync(staging, { recursive: true, force: true });
    return;
  }

  const newBin = pathJoin(deps.lyyHome, "bin", "lyy");
  const result = spawnSync(newBin, deps.argv.slice(2), {
    stdio: "inherit",
    env: { ...deps.env, LYY_JUST_UPGRADED: "1" },
  });
  process.exit(result.status ?? 0);
}
