# Daemon Version Handshake Plan

> **For Claude:** small change, single-session execution.

**Goal:** When `lyy` starts and probes an existing daemon, also query the daemon's version. If it differs from the current `lyy` version, kill the stale daemon and respawn. Stops upgrade from silently running old daemon code.

**Architecture:** Central version constant in `@lyy/shared`, bumped on release. New `version` IPC method returns `{ version, pid }`. CLI checks on `ensureDaemonRunning`.

---

## Step 1: Central version constant

**File:** `packages/shared/src/version.ts` (new)

```ts
/**
 * Single source of truth for the LYY runtime version. Bumped alongside
 * git tags (v0.X.Y). Daemon returns this in the `version` IPC handshake;
 * the CLI compares its own import against the daemon's reply and restarts
 * the daemon on mismatch so users don't get stuck on old code after an
 * upgrade.
 */
export const LYY_VERSION = "0.2.1";
```

**File:** `packages/shared/src/index.ts`

Add `export { LYY_VERSION } from "./version.js";` to existing exports.

## Step 2: Daemon `version` IPC

**File:** `packages/daemon/src/mcp-ipc.ts`

Add import:

```ts
import { LYY_VERSION } from "@lyy/shared";
```

In `invoke()` switch, add case (placement: top of switch):

```ts
case "version":
  return { version: LYY_VERSION, pid: process.pid };
```

## Step 3: CLI version handshake

**File:** `packages/cli/src/commands/default.ts`

Add import:

```ts
import { LYY_VERSION } from "@lyy/shared";
import { McpIpcClient } from "@lyy/daemon";
```

Add helper:

```ts
async function queryDaemonVersion(): Promise<{ version: string; pid: number } | null> {
  try {
    const client = new McpIpcClient();
    return await client.call<{ version: string; pid: number }>("version");
  } catch {
    return null;
  }
}
```

Modify `ensureDaemonRunning`:

```ts
async function ensureDaemonRunning(): Promise<void> {
  if (await pingDaemon()) {
    const running = await queryDaemonVersion();
    if (running && running.version === LYY_VERSION) return; // matched, reuse
    if (running) {
      console.log(
        `[lyy] daemon v${running.version} running; expected v${LYY_VERSION}. Restarting…`,
      );
      try {
        process.kill(running.pid, "SIGTERM");
      } catch {
        // already dead
      }
      // wait for socket cleanup up to 2s
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (!(await pingDaemon())) break;
        await sleep(100);
      }
    }
    // fall through to respawn path
  }
  // existing stale-socket + spawn logic...
}
```

## Step 4: Tests

### `packages/shared/src/version.test.ts` (new)

```ts
import { describe, expect, it } from "vitest";
import { LYY_VERSION } from "./version.js";

describe("LYY_VERSION", () => {
  it("is a semver string", () => {
    expect(LYY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

### `packages/daemon/src/mcp-ipc.test.ts`

Append:

```ts
it("version IPC returns {version, pid}", async () => {
  const client = new McpIpcClient(sockPath);
  const res = await client.call<{ version: string; pid: number }>("version");
  expect(res.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(res.pid).toBe(process.pid);
});
```

(Adapt to existing harness — `sockPath` comes from the test setup.)

## Step 5: Build + test + local commit

```bash
pnpm build
LYY_SKIP_DB=1 pnpm test
pnpm exec biome check --write .
git add -A
git commit -m "feat: daemon version handshake — lyy restarts stale daemon on upgrade"
```

**DO NOT PUSH.** Per CLAUDE.md — user must smoke test locally first.

## Step 6: Smoke

1. Kill any old daemon: `pkill -f lyy-daemon`
2. `lyy --profile alice` — daemon auto-spawn, sync works
3. Bump `LYY_VERSION` to `0.2.2` in version.ts, save (dev-link picks it up)
4. `lyy --profile alice` again — CLI should log "daemon v0.2.1 running; expected v0.2.2. Restarting…" and spawn new daemon
5. Confirm via `cat ~/.lyy/profiles/alice/daemon.log` tail — new "started for peer" line appeared

## Version bump discipline

Every release:
1. Edit `packages/shared/src/version.ts` → bump to new version
2. Commit bump as part of release commit
3. `git tag vX.Y.Z`
4. Push

Optional later: single-file bump script in `scripts/bump-version.sh`.

## Out of scope

- Per-package version alignment (private packages stay at 0.0.1; only `LYY_VERSION` matters)
- Graceful daemon draining (SIGTERM + 2s wait is enough — IPC requests mid-flight may fail, but TUI / MCP retry on reconnect)
- Downgrade path (mismatch triggers restart regardless of direction — that's correct behavior)
