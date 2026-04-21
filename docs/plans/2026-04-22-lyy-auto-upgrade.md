# LYY Silent Auto-Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `lyy --profile X` checks GitHub Releases on every launch, downloads any new tarball, atomically replaces `~/.lyy/runtime/*`, and re-execs so users always run latest code without manually re-running `bootstrap.sh`.

**Architecture:** A new `autoUpgrade()` step runs at the top of `runDefault()`. It skips in dev installs, hits `GET /repos/MeetMissionAI/lyy/releases/latest` with an `If-None-Match` ETag cache (so the common "no change" path returns 304 and costs zero GitHub rate-limit quota), and only on a real upgrade downloads the four tarballs, verifies `SHA256SUMS.txt`, unpacks into a staging dir, atomically renames into place, and re-execs the same `lyy` invocation with `LYY_JUST_UPGRADED=1` to short-circuit a second upgrade cycle.

**Tech Stack:** Node 20+ `fetch`, `crypto.createHash('sha256')`, `node:fs/promises`, system `tar`, `node:child_process` (`spawnSync` for re-exec), `vitest` for unit tests.

---

## Task 1: Pure version parsing + compare

**Files:**
- Create: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Write the failing test**

```ts
// packages/cli/src/upgrade.test.ts
import { describe, expect, it } from "vitest";
import { compareVersion, parseVersion } from "./upgrade.js";

describe("parseVersion", () => {
  it("accepts v-prefixed and plain tags", () => {
    expect(parseVersion("v0.2.7")).toEqual([0, 2, 7]);
    expect(parseVersion("0.2.7")).toEqual([0, 2, 7]);
  });
  it("ignores pre-release suffix after patch", () => {
    expect(parseVersion("v1.2.3-beta")).toEqual([1, 2, 3]);
  });
  it("throws on garbage", () => {
    expect(() => parseVersion("banana")).toThrow();
  });
});

describe("compareVersion", () => {
  it("orders major > minor > patch", () => {
    expect(compareVersion("v1.0.0", "v0.9.9")).toBeGreaterThan(0);
    expect(compareVersion("v0.2.8", "v0.2.7")).toBeGreaterThan(0);
    expect(compareVersion("v0.2.7", "v0.2.7")).toBe(0);
    expect(compareVersion("0.2.7", "0.2.8")).toBeLessThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

```
cd packages/cli && LYY_SKIP_DB=1 pnpm exec vitest run src/upgrade.test.ts
```
Expected: FAIL — `./upgrade.js` doesn't exist.

**Step 3: Write minimal implementation**

```ts
// packages/cli/src/upgrade.ts

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
```

**Step 4: Verify it passes**

Expected: PASS on all 4 cases.

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): version parse/compare helpers for auto-upgrade"
```

---

## Task 2: Dev-install detection

**Files:**
- Modify: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Add failing test**

Append to `upgrade.test.ts`:

```ts
import { isDevInstall } from "./upgrade.js";

describe("isDevInstall", () => {
  it("returns true when binary sits under a source checkout", () => {
    expect(
      isDevInstall("/Users/me/code/lyy/packages/cli/bin/lyy-dev", "/Users/me/.lyy"),
    ).toBe(true);
  });

  it("returns false for a bootstrap install under runtime", () => {
    expect(
      isDevInstall("/Users/me/.lyy/runtime/cli/bin/lyy", "/Users/me/.lyy"),
    ).toBe(false);
  });
});
```

**Step 2: Verify it fails**
```
LYY_SKIP_DB=1 pnpm exec vitest run src/upgrade.test.ts -t "isDevInstall"
```
Expected: FAIL — `isDevInstall not exported`.

**Step 3: Implement**

```ts
// packages/cli/src/upgrade.ts (add at end)
import { sep } from "node:path";

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
```

**Step 4: Verify passes.**

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): dev-install detector (auto-upgrade short-circuit)"
```

---

## Task 3: fetchLatestTag with ETag support

**Files:**
- Modify: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Add failing test**

```ts
// upgrade.test.ts — append
import { fetchLatestTag } from "./upgrade.js";

describe("fetchLatestTag", () => {
  const repo = "org/repo";

  function mockFetch(impl: (url: string, init: RequestInit) => Response) {
    const spy = vi.fn(async (url, init) => impl(String(url), init ?? {}));
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("returns {tag, etag} on 200", async () => {
    mockFetch(() =>
      new Response(JSON.stringify({ tag_name: "v0.2.7" }), {
        status: 200,
        headers: { etag: 'W/"abc"' },
      }),
    );
    expect(await fetchLatestTag(repo, null)).toEqual({
      tag: "v0.2.7",
      etag: 'W/"abc"',
    });
  });

  it("returns {null, prevEtag} on 304", async () => {
    mockFetch(() => new Response(null, { status: 304 }));
    expect(await fetchLatestTag(repo, 'W/"abc"')).toEqual({
      tag: null,
      etag: 'W/"abc"',
    });
  });

  it("returns {null, null} on error / timeout / bad body", async () => {
    mockFetch(() => new Response("not json", { status: 200 }));
    expect(await fetchLatestTag(repo, null)).toEqual({ tag: null, etag: null });
  });

  it("sends If-None-Match when prevEtag is provided", async () => {
    const spy = mockFetch(() => new Response(null, { status: 304 }));
    await fetchLatestTag(repo, 'W/"xyz"');
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["if-none-match"]).toBe('W/"xyz"');
  });
});
```

Don't forget the imports at the top of the test file:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
```

**Step 2: Verify it fails** — no `fetchLatestTag` export yet.

**Step 3: Implement**

```ts
// packages/cli/src/upgrade.ts — append

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
    const data = (await res.json().catch(() => null)) as
      | { tag_name?: string }
      | null;
    if (!data?.tag_name) return { tag: null, etag: null };
    return { tag: data.tag_name, etag: res.headers.get("etag") };
  } catch {
    return { tag: null, etag: null };
  } finally {
    clearTimeout(timer);
  }
}
```

**Step 4: Verify all 4 cases pass.**

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): GitHub latest-release fetcher with ETag"
```

---

## Task 4: ETag persistence helpers

**Files:**
- Modify: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Add failing test**

```ts
// upgrade.test.ts — append
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEtag, writeEtag } from "./upgrade.js";

describe("etag cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lyy-upgrade-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads null when file missing", () => {
    expect(readEtag(join(dir, "etag"))).toBeNull();
  });

  it("round-trips through write/read", () => {
    const path = join(dir, "etag");
    writeEtag(path, 'W/"abc"');
    expect(readEtag(path)).toBe('W/"abc"');
  });

  it("trims trailing whitespace/newlines", () => {
    const path = join(dir, "etag");
    writeFileSync(path, 'W/"abc"\n\n', "utf8");
    expect(readEtag(path)).toBe('W/"abc"');
  });
});
```

Top imports: `import { beforeEach } from "vitest";` added to the existing vitest import.

**Step 2: Verify it fails.**

**Step 3: Implement**

```ts
// packages/cli/src/upgrade.ts — append
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
```

**Step 4: Verify passes.**

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): etag cache read/write"
```

---

## Task 5: Download + SHA256 verification

**Files:**
- Modify: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Add failing test**

```ts
// upgrade.test.ts — append
import { createHash } from "node:crypto";
import { parseSha256Manifest, verifySha256 } from "./upgrade.js";

describe("parseSha256Manifest", () => {
  it("parses `<hex>  <filename>` lines", () => {
    const manifest = [
      "aaaa  lyy-cli.tgz",
      "bbbb  lyy-daemon.tgz",
      "",
      "cccc  lyy-mcp.tgz",
    ].join("\n");
    expect(parseSha256Manifest(manifest)).toEqual(
      new Map([
        ["lyy-cli.tgz", "aaaa"],
        ["lyy-daemon.tgz", "bbbb"],
        ["lyy-mcp.tgz", "cccc"],
      ]),
    );
  });
});

describe("verifySha256", () => {
  it("accepts matching hash", () => {
    const buf = Buffer.from("hello");
    const hex = createHash("sha256").update(buf).digest("hex");
    expect(verifySha256(buf, hex)).toBe(true);
  });
  it("rejects mismatch", () => {
    expect(verifySha256(Buffer.from("hello"), "0".repeat(64))).toBe(false);
  });
});
```

**Step 2: Verify fails.**

**Step 3: Implement**

```ts
// packages/cli/src/upgrade.ts — append
import { createHash } from "node:crypto";

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
```

**Step 4: Verify passes.**

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): SHA256SUMS parser + verifier"
```

---

## Task 6: Atomic swap of runtime directory

**Files:**
- Modify: `packages/cli/src/upgrade.ts`
- Test: `packages/cli/src/upgrade.test.ts`

**Step 1: Add failing test**

```ts
// upgrade.test.ts — append
import { mkdirSync } from "node:fs";
import { swapRuntime } from "./upgrade.js";

describe("swapRuntime", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lyy-swap-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("promotes staging → runtime, deletes old", () => {
    const runtime = join(dir, "runtime");
    const staging = join(dir, "runtime-staging");
    mkdirSync(runtime);
    writeFileSync(join(runtime, "VERSION"), "v0.0.1");
    mkdirSync(staging);
    writeFileSync(join(staging, "VERSION"), "v0.0.2");

    swapRuntime(staging, runtime);

    expect(readFileSync(join(runtime, "VERSION"), "utf8")).toBe("v0.0.2");
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(`${runtime}-old`)).toBe(false);
  });

  it("works when runtime doesn't exist yet", () => {
    const runtime = join(dir, "runtime");
    const staging = join(dir, "runtime-staging");
    mkdirSync(staging);
    writeFileSync(join(staging, "VERSION"), "v0.0.2");

    swapRuntime(staging, runtime);

    expect(readFileSync(join(runtime, "VERSION"), "utf8")).toBe("v0.0.2");
  });
});
```

Top imports: add `import { existsSync } from "node:fs";` to the test file.

**Step 2: Verify fails.**

**Step 3: Implement**

```ts
// packages/cli/src/upgrade.ts — append
import { renameSync, rmSync } from "node:fs";

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
```

**Step 4: Verify passes.**

**Step 5: Commit**

```bash
git add packages/cli/src/upgrade.ts packages/cli/src/upgrade.test.ts
git commit -m "feat(cli): atomic runtime directory swap"
```

---

## Task 7: Download + extract one tarball

**Files:**
- Modify: `packages/cli/src/upgrade.ts`

**Step 1: Implement (no new test — side-effect integration happens in task 9)**

```ts
// packages/cli/src/upgrade.ts — append
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync as writeFileSyncFs } from "node:fs";
import { dirname, join as pathJoin } from "node:path";

/** Pin a bin's shebang to the absolute node path (mirrors bootstrap.sh). */
function pinShebang(binPath: string, nodeBin: string): void {
  const lines = readFileSync(binPath, "utf8").split("\n");
  lines[0] = `#!${nodeBin}`;
  writeFileSyncFs(binPath, lines.join("\n"), "utf8");
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
    writeFileSyncFs(tarPath, buf);
    execFileSync("tar", ["-xzf", tarPath, "-C", pkgDir]);
    rmSync(tarPath);
  }

  // Pin shebangs for the four known binaries.
  const bins = [
    ["cli", "bin/lyy"],
    ["daemon", "bin/lyy-daemon"],
    ["mcp", "bin/lyy-mcp"],
    ["tui", "bin/lyy-tui"],
  ] as const;
  for (const [pkg, rel] of bins) {
    const p = pathJoin(args.stagingDir, pkg, rel);
    if (existsSync(p)) pinShebang(p, args.nodeBin);
  }
}
```

**Step 2: Typecheck**

```
pnpm -r build
```
Expected: no TS errors.

**Step 3: Commit**

```bash
git add packages/cli/src/upgrade.ts
git commit -m "feat(cli): tarball download + sha verify + tar extract"
```

---

## Task 8: autoUpgrade orchestrator

**Files:**
- Modify: `packages/cli/src/upgrade.ts`

**Step 1: Implement**

Append to `upgrade.ts`:

```ts
// packages/cli/src/upgrade.ts — append
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { LYY_VERSION } from "@lyy/shared";

const REPO = "MeetMissionAI/lyy";
const PKGS = ["cli", "daemon", "mcp", "tui"];

export interface AutoUpgradeDeps {
  lyyHome: string;
  argv0: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** Injected for tests; default: real GitHub. */
  fetchTag?: typeof fetchLatestTag;
}

/**
 * Check for a newer GitHub release, and if found, download, verify, swap
 * into `<lyy_home>/runtime/`, then re-exec this CLI. Re-exec exits the
 * current process; returns normally only when no upgrade happened or we
 * silently skipped (dev install / no network / already up to date).
 *
 * Prereqs (all already true for bootstrap installs):
 *   - `<lyy_home>/runtime/cli/bin/lyy` exists and the `<lyy_home>/bin/lyy`
 *     symlink targets it.
 *   - `node` is on PATH.
 */
export async function autoUpgrade(deps: AutoUpgradeDeps): Promise<void> {
  if (deps.env.LYY_JUST_UPGRADED === "1") return;
  if (isDevInstall(deps.argv0, deps.lyyHome)) return;

  const etagPath = pathJoin(deps.lyyHome, "upgrade-etag");
  const runtimeDir = pathJoin(deps.lyyHome, "runtime");
  const prevEtag = readEtag(etagPath);

  const fetchTag = deps.fetchTag ?? fetchLatestTag;
  const { tag, etag } = await fetchTag(REPO, prevEtag);
  if (etag && etag !== prevEtag) writeEtag(etagPath, etag);
  if (!tag) return; // 304, offline, or API failure — nothing to do.
  if (compareVersion(tag, LYY_VERSION) <= 0) return;

  console.log(`[lyy] upgrading v${LYY_VERSION} → ${tag}…`);

  const staging = mkdtempSync(pathJoin(tmpdir(), "lyy-upgrade-"));
  try {
    const baseUrl = `https://github.com/${REPO}/releases/download/${tag}`;
    const manifestRes = await fetch(`${baseUrl}/SHA256SUMS.txt`);
    if (!manifestRes.ok) {
      throw new Error(`SHA256SUMS.txt: ${manifestRes.status}`);
    }
    const manifest = parseSha256Manifest(await manifestRes.text());
    const nodeBin = spawnSync("node", ["-p", "process.execPath"], {
      encoding: "utf8",
    }).stdout.trim();
    await downloadAndExtract({
      baseUrl,
      pkgs: PKGS,
      manifest,
      stagingDir: staging,
      nodeBin,
    });

    swapRuntime(staging, runtimeDir);
    writeFileSync(pathJoin(runtimeDir, "VERSION"), `${tag}\n`);
  } catch (err) {
    // Leave old runtime intact — any partial staging disappears with tmpdir.
    console.warn(
      `[lyy] upgrade to ${tag} failed; continuing on current version: ${
        (err as Error).message
      }`,
    );
    rmSync(staging, { recursive: true, force: true });
    return;
  }

  // Re-exec the (now-upgraded) CLI with the same argv. Child inherits stdio
  // so the user sees no seam; we exit with its code.
  const newBin = pathJoin(deps.lyyHome, "bin", "lyy");
  const result = spawnSync(newBin, deps.argv.slice(2), {
    stdio: "inherit",
    env: { ...deps.env, LYY_JUST_UPGRADED: "1" },
  });
  process.exit(result.status ?? 0);
}
```

**Step 2: Typecheck**

```
pnpm -r build
```
Expected: pass.

**Step 3: Commit**

```bash
git add packages/cli/src/upgrade.ts
git commit -m "feat(cli): autoUpgrade orchestrator"
```

---

## Task 9: Wire autoUpgrade into `runDefault`

**Files:**
- Modify: `packages/cli/src/commands/default.ts:58-91`

**Step 1: Edit**

At the top of `default.ts`, add:

```ts
import { autoUpgrade } from "../upgrade.js";
```

Replace the first line of `runDefault`:

```ts
export async function runDefault(): Promise<void> {
  await autoUpgrade({
    lyyHome: getLyyHome(),
    argv0: process.argv[1] ?? "",
    argv: process.argv,
    env: process.env,
  });
  await ensureDaemonRunning();
  // ... rest unchanged
}
```

**Step 2: Typecheck + existing tests**

```
pnpm -r build && LYY_SKIP_DB=1 pnpm -r exec vitest run --reporter=basic
```
Expected: all tests still green.

**Step 3: Commit**

```bash
git add packages/cli/src/commands/default.ts
git commit -m "feat(cli): runDefault checks for upgrades before launching zellij"
```

---

## Task 10: Integration test for autoUpgrade no-op paths

**Files:**
- Modify: `packages/cli/src/upgrade.test.ts`

Covers three paths that should NOT mutate the filesystem:
- `LYY_JUST_UPGRADED=1`
- dev install
- API returned null tag

**Step 1: Add failing test**

```ts
// upgrade.test.ts — append
import { autoUpgrade } from "./upgrade.js";

describe("autoUpgrade", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lyy-home-"));
    mkdirSync(join(home, "runtime"), { recursive: true });
    mkdirSync(join(home, "bin"), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("short-circuits when LYY_JUST_UPGRADED=1", async () => {
    const fetchTag = vi.fn(async () => ({ tag: "v999.0.0", etag: null }));
    await autoUpgrade({
      lyyHome: home,
      argv0: `${home}/runtime/cli/bin/lyy`,
      argv: ["node", "lyy"],
      env: { LYY_JUST_UPGRADED: "1" },
      fetchTag,
    });
    expect(fetchTag).not.toHaveBeenCalled();
  });

  it("short-circuits dev installs", async () => {
    const fetchTag = vi.fn(async () => ({ tag: "v999.0.0", etag: null }));
    await autoUpgrade({
      lyyHome: home,
      argv0: "/Users/me/code/lyy/packages/cli/bin/lyy-dev",
      argv: ["node", "lyy"],
      env: {},
      fetchTag,
    });
    expect(fetchTag).not.toHaveBeenCalled();
  });

  it("no-ops when API returns no tag (304 / offline)", async () => {
    const fetchTag = vi.fn(async () => ({ tag: null, etag: 'W/"abc"' }));
    await autoUpgrade({
      lyyHome: home,
      argv0: `${home}/runtime/cli/bin/lyy`,
      argv: ["node", "lyy"],
      env: {},
      fetchTag,
    });
    // Etag was refreshed; no runtime dir changes.
    expect(readEtag(join(home, "upgrade-etag"))).toBe('W/"abc"');
  });
});
```

Top imports (add if missing): `import { mkdirSync } from "node:fs";`.

**Step 2: Verify passes**

```
LYY_SKIP_DB=1 pnpm exec vitest run src/upgrade.test.ts
```

**Step 3: Commit**

```bash
git add packages/cli/src/upgrade.test.ts
git commit -m "test(cli): autoUpgrade no-op branches"
```

---

## Task 11: Version bump + release

**Files:**
- Modify: `packages/shared/src/version.ts`

**Step 1: Bump**

Change `"0.2.6"` → `"0.2.7"`:

```ts
export const LYY_VERSION = "0.2.7";
```

**Step 2: Full build + test**

```
pnpm -r build
LYY_SKIP_DB=1 pnpm -r exec vitest run --reporter=basic
```
Expected: all green.

**Step 3: Commit + tag + push**

```bash
git add packages/shared/src/version.ts
git commit -m "chore: bump to v0.2.7 — autoUpgrade available"
git push origin main
git tag v0.2.7
git push origin v0.2.7
```

This fires the Release workflow (`.github/workflows/release.yml`) which builds the 4 tarballs + `SHA256SUMS.txt` and uploads to the `v0.2.7` GitHub Release. The first `lyy --profile X` on any team member's machine afterwards will auto-upgrade.

---

## Task 12: End-to-end smoke test (manual)

On a clean bootstrap install:

```bash
# 1. Reinstall from the previous release to simulate an "old" user.
LYY_VERSION=v0.2.6 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
cat ~/.lyy/runtime/VERSION  # → v0.2.6

# 2. Run lyy — expect the upgrade banner.
lyy --profile alice
# Expected stderr/stdout during startup:
#   [lyy] upgrading v0.2.6 → v0.2.7…
# After ~3-5 seconds, zellij comes up normally, running v0.2.7 binaries.

# 3. Verify.
cat ~/.lyy/runtime/VERSION    # → v0.2.7
cat ~/.lyy/upgrade-etag       # non-empty
lyy --version                 # → 0.2.7

# 4. Re-run lyy — no banner, near-instant startup (304 on API, cached ETag).
lyy --profile alice

# 5. Airplane mode — lyy still works on cached binaries.
# Toggle wifi off, rerun lyy. Expect no banner, no crash.

# 6. Poisoned SHA fallback — point bootstrap at a broken release (or
# monkey-patch runtime/cli to intercept fetch). Expect:
#   [lyy] upgrade to v0.2.8 failed; continuing on current version: sha256 mismatch for lyy-cli.tgz
# Old binary still launches zellij.
```

If anything in steps 2/3 breaks, revert the tag (`git push origin :v0.2.7`) and debug.

---

## Notes on scope

- No `lyy doctor` changes; rogue-daemon scan is unaffected.
- No TUI changes.
- No daemon changes. The daemon version-handshake path (v0.2.4) already handles a mismatched daemon post-upgrade by SIGTERMing + respawning.
- The `scripts/bootstrap.sh` one-liner is unchanged. It remains the first-install path; upgrades go through `autoUpgrade`.
- 6h cooldown explicitly **not** added. GitHub's `If-None-Match` on `releases/latest` returns 304 and does **not** count against the unauthenticated 60 req/hour rate limit, so we can check on every launch cheaply.
