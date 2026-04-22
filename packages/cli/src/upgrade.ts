import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { sep } from "node:path";

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
