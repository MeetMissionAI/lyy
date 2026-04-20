# LYY v2: Sync + Multi-window Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make LYY usable end-to-end across two profiles by fixing message routing for unknown threads, adding offline backfill on daemon (re)connect, and supporting multiple concurrent `lyy` sessions per profile.

**Architecture:** Sender-side enrichment of the relay's `MessageEnvelope` with thread + peer metadata so receivers never need an out-of-band lookup. On daemon `connected` event, sync state from relay (`/threads`, `/peers`, per-thread `/messages?sinceSeq`) and append all missed messages to the per-thread `~/.lyy/inbox/thread-N.jsonl` so `/pickup` drains them into Claude's context. Per-instance zellij session names (`<profile>-<pid>`) eliminate session collisions; daemon stays profile-singleton.

**Tech Stack:** Node 20 ESM, TypeScript, Fastify + socket.io (relay), socket.io-client (daemon), Vitest, Biome, postgres.js, zellij.

**Design doc:** `docs/plans/2026-04-20-lyy-v2-sync-multiwindow-design.md`

---

## Section A: Envelope enrichment (sender pushes thread + peer metadata)

### Task A1: `findPeersByIds` repo function

**Files:**
- Modify: `packages/shared/src/repo/peers.ts` — append new function
- Modify: `packages/shared/src/index.ts` — re-export
- Test: `packages/shared/src/repo/peers.test.ts` — new test case (DB-guarded)

**Step 1: Write failing test**

In `packages/shared/src/repo/peers.test.ts` append:

```ts
describe.skipIf(skip)("findPeersByIds", () => {
  it("returns matching non-disabled peers in input order", async () => {
    const a = await createPeer(db, { name: `${TEST_PREFIX}a`, email: `${TEST_PREFIX}a@x.com` });
    const b = await createPeer(db, { name: `${TEST_PREFIX}b`, email: `${TEST_PREFIX}b@x.com` });
    await createPeer(db, { name: `${TEST_PREFIX}c`, email: `${TEST_PREFIX}c@x.com` });

    const found = await findPeersByIds(db, [a.id, b.id]);
    const names = found.map((p) => p.name).sort();
    expect(names).toEqual([a.name, b.name].sort());
  });

  it("returns empty array for empty input", async () => {
    const found = await findPeersByIds(db, []);
    expect(found).toEqual([]);
  });
});
```

(Adjust `TEST_PREFIX` to match the file's existing one; reuse existing `cleanup`.)

**Step 2: Run test, expect fail**

Run: `pnpm --filter @lyy/shared test -- peers`
Expected: FAIL — `findPeersByIds is not a function`

**Step 3: Implement**

In `packages/shared/src/repo/peers.ts` after `listPeers` add:

```ts
export async function findPeersByIds(
  db: Queryable,
  ids: string[],
): Promise<Peer[]> {
  if (ids.length === 0) return [];
  const rows = await db<PeerRow[]>`
    SELECT id, name, email, display_name, created_at
    FROM peers
    WHERE id = ANY(${db.array(ids, "uuid")}) AND disabled = false
  `;
  return rows.map(mapRow);
}
```

In `packages/shared/src/index.ts` add `findPeersByIds` to the re-export list (alongside `listPeers`).

**Step 4: Run test, expect pass**

Run: `pnpm --filter @lyy/shared test -- peers`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared/src/repo/peers.ts packages/shared/src/repo/peers.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): findPeersByIds for batch peer lookup"
```

---

### Task A2: Extend `MessageEnvelope` type

**Files:**
- Modify: `packages/relay/src/server.ts:9-13`
- Modify: `packages/daemon/src/router.ts:7-10`

**Step 1: Edit `packages/relay/src/server.ts`**

Replace the `MessageEnvelope` interface (lines 9-13) with:

```ts
export interface EnvelopePeer {
  id: string;
  name: string;
  displayName?: string;
}

export interface EnvelopeThread {
  id: string;
  shortId: number;
  title: string | null;
  participants: string[];
}

export interface MessageEnvelope {
  message: Message;
  threadShortId: number; // backward compat — keep
  thread: EnvelopeThread;
  peers: EnvelopePeer[];
}
```

**Step 2: Edit `packages/daemon/src/router.ts`**

Replace `MessageEnvelope` interface (lines 7-10) with the same shape (copy from above; only `threadShortId` was there before).

**Step 3: Build, expect type errors in messages.ts (we'll fix in A3)**

Run: `pnpm build 2>&1 | tail -10`
Expected: tsc errors in `packages/relay/src/routes/messages.ts` referring to `EnvelopeThread`/`peers` missing in broadcaster call. (No commit yet — A3 makes it whole.)

---

### Task A3: Enrich envelope in `POST /messages`

**Files:**
- Modify: `packages/relay/src/routes/messages.ts:78-93`
- Test: `packages/relay/src/routes/messages.test.ts` — append assertion in existing broadcaster test

**Step 1: Write failing test (extend existing test)**

Find the test in `messages.test.ts` that captures the broadcaster call. Add assertions:

```ts
expect(envelope.thread).toEqual({
  id: thread.id,
  shortId: thread.shortId,
  title: thread.title,
  participants: expect.arrayContaining([alice.id, bob.id]),
});
expect(envelope.peers.map((p) => p.id).sort()).toEqual(
  [alice.id, bob.id].sort(),
);
```

**Step 2: Run test, expect fail**

Run: `pnpm --filter @lyy/relay test -- messages`
Expected: FAIL — `envelope.thread` undefined.

**Step 3: Implement**

In `packages/relay/src/routes/messages.ts`:

1. Add import: `import { findPeersByIds } from "@lyy/shared";`
2. Replace lines 86-93 (the `if (deps.broadcaster) { ... }` block) with:

```ts
if (deps.broadcaster) {
  const peers = await findPeersByIds(deps.db, result.thread.participants);
  Promise.resolve(
    deps.broadcaster(
      {
        message: result.message,
        threadShortId: result.thread.shortId,
        thread: {
          id: result.thread.id,
          shortId: result.thread.shortId,
          title: result.thread.title,
          participants: result.thread.participants,
        },
        peers: peers.map((p) => ({
          id: p.id,
          name: p.name,
          ...(p.displayName ? { displayName: p.displayName } : {}),
        })),
      },
      result.recipients,
    ),
  ).catch((err) => req.log.error({ err }, "broadcaster failed"));
}
```

**Step 4: Build + run test, expect pass**

Run: `pnpm build && pnpm --filter @lyy/relay test -- messages`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/relay packages/daemon/src/router.ts
git commit -m "feat(relay): enrich MessageEnvelope with thread + peer metadata"
```

---

### Task A4: Router upserts unknown thread from envelope

**Files:**
- Modify: `packages/daemon/src/router.ts` — replace `handleIncoming` upsert branch
- Test: `packages/daemon/src/router.test.ts:175-184` — replace last test case

**Step 1: Update the test**

In `router.test.ts` replace the `"unknown thread: state.lastSeenSeq still updates, no thread summary added"` test (lines 175-184) with:

```ts
it("unknown thread: upserts summary from envelope.thread + envelope.peers", async () => {
  await state.write({ unreadCount: 0, threads: [], lastSeenSeq: {} });
  await emit({
    message: newMessage({ fromPeer: OTHER_PEER, seq: 1, body: "hello new" }),
    threadShortId: SHORT_ID,
    thread: {
      id: THREAD_ID,
      shortId: SHORT_ID,
      title: null,
      participants: [SELF_PEER, OTHER_PEER],
    },
    peers: [
      { id: SELF_PEER, name: "leo" },
      { id: OTHER_PEER, name: "bob" },
    ],
  });
  const s = await state.read();
  expect(s.threads).toHaveLength(1);
  expect(s.threads[0]).toMatchObject({
    threadId: THREAD_ID,
    shortId: SHORT_ID,
    peerName: "bob",
    unread: 1,
    lastBody: "hello new",
  });
  expect(s.unreadCount).toBe(1);
});
```

Update the `emit` helper signature to accept the new fields (or add an `as any` if you prefer to keep helper minimal — TS will scream but runtime OK; better to widen the type).

**Step 2: Run test, expect fail**

Run: `pnpm --filter @lyy/daemon test -- router`
Expected: FAIL — `s.threads` is `[]`.

**Step 3: Implement**

In `packages/daemon/src/router.ts`, modify `handleIncoming`. Replace the body of the `state.update` callback to:

```ts
await this.deps.state.update((s) => {
  const lastSeenSeq = {
    ...s.lastSeenSeq,
    [message.threadId]: Math.max(
      s.lastSeenSeq[message.threadId] ?? 0,
      message.seq,
    ),
  };

  let threads = s.threads;
  const idx = threads.findIndex((t) => t.threadId === message.threadId);
  const previewLen = this.deps.previewLen ?? DEFAULT_PREVIEW_LEN;

  if (idx >= 0) {
    const existing = threads[idx];
    threads = [...threads];
    threads[idx] = {
      ...existing,
      paneOpen,
      lastBody: message.body.slice(0, previewLen),
      lastMessageAt: message.sentAt,
      unread: isFromSelf || paneOpen ? existing.unread : existing.unread + 1,
    };
  } else if (env.thread && env.peers) {
    const otherId = env.thread.participants.find((p) => p !== this.deps.selfPeerId);
    const peerName = otherId
      ? (env.peers.find((p) => p.id === otherId)?.name ?? "?")
      : "?";
    threads = [
      ...threads,
      {
        threadId: env.thread.id,
        shortId: env.thread.shortId,
        peerName,
        lastBody: message.body.slice(0, previewLen),
        lastMessageAt: message.sentAt,
        unread: isFromSelf || paneOpen ? 0 : 1,
        archived: false,
        paneOpen,
      },
    ];
  }
  // else: legacy envelope without thread/peers — leave threads alone (logged below)

  const unreadCount = threads.reduce(
    (sum, t) => sum + (t.archived ? 0 : t.unread),
    0,
  );

  return { ...s, threads, lastSeenSeq, unreadCount };
});
```

Add a stderr warning above the state.update for the legacy case:

```ts
if (idx < 0 && (!env.thread || !env.peers)) {
  console.error(
    `[lyy-daemon] message:new for unknown thread ${message.threadId}; relay envelope missing thread/peers (old relay?)`,
  );
}
```

(idx isn't in scope here yet — restructure to compute existence flag before update, or just inline check using `s.threads.find` — pick whatever stays clean.)

**Step 4: Run test, expect pass**

Run: `pnpm --filter @lyy/daemon test -- router`
Expected: PASS for new case; existing 5 cases still pass.

**Step 5: Commit**

```bash
git add packages/daemon/src/router.ts packages/daemon/src/router.test.ts
git commit -m "feat(daemon): upsert thread summary from envelope on first message"
```

---

### Task A5: Always-write paneInbox in router

**Files:**
- Modify: `packages/daemon/src/router.ts:55-60`
- Test: `packages/daemon/src/router.test.ts` — add new case

**Step 1: Add failing test**

Append to `router.test.ts`:

```ts
it("from other, pane closed: still appends to paneInbox (offline accumulate)", async () => {
  await seedThreadSummary();
  await emit({
    message: newMessage({ fromPeer: OTHER_PEER, seq: 11, body: "buffered" }),
    threadShortId: SHORT_ID,
    thread: {
      id: THREAD_ID,
      shortId: SHORT_ID,
      title: null,
      participants: [SELF_PEER, OTHER_PEER],
    },
    peers: [
      { id: SELF_PEER, name: "leo" },
      { id: OTHER_PEER, name: "bob" },
    ],
  });
  const entries = await inbox.drain(SHORT_ID);
  expect(entries).toHaveLength(1);
  expect(entries[0].message.body).toBe("buffered");
});
```

The existing test "from other, pane closed: bumps unread, no inbox write" at lines 105-118 must be updated — change `expect(await inbox.drain(SHORT_ID)).toEqual([])` to `expect(await inbox.drain(SHORT_ID)).toHaveLength(1)`. Then assert the entry body is `"ping"`.

**Step 2: Run, expect fail**

Run: `pnpm --filter @lyy/daemon test -- router`
Expected: FAIL — drain returns empty.

**Step 3: Implement**

In `packages/daemon/src/router.ts:55-60` change:

```ts
if (paneOpen) {
  await this.deps.paneInbox.append(threadShortId, message);
}
```

to:

```ts
// Always append: offline-accumulate when no pane; SessionStart hook drains on /pickup.
// Suppress only for messages we sent ourselves.
if (!isFromSelf) {
  await this.deps.paneInbox.append(threadShortId, message);
}
```

**Step 4: Run, expect pass**

Run: `pnpm --filter @lyy/daemon test -- router`
Expected: PASS all cases.

**Step 5: Commit**

```bash
git add packages/daemon/src/router.ts packages/daemon/src/router.test.ts
git commit -m "feat(daemon): always append paneInbox so offline messages survive"
```

---

## Section B: Startup sync + offline backfill

### Task B1: New `state-sync` module + test

**Files:**
- Create: `packages/daemon/src/state-sync.ts`
- Test: `packages/daemon/src/state-sync.test.ts`

**Step 1: Write failing test**

Create `packages/daemon/src/state-sync.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, Peer } from "@lyy/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneInbox } from "./pane-inbox.js";
import type { RelayHttp, InboxResponse, InboxThreadShape } from "./relay-http.js";
import { StateStore } from "./state.js";
import { syncStateFromRelay } from "./state-sync.js";

const SELF = "00000000-0000-0000-0000-000000000aaa";
const PEER = "00000000-0000-0000-0000-000000000bbb";
const THREAD = "00000000-0000-0000-0000-000000000ccc";

let dir: string;
let state: StateStore;
let inbox: PaneInbox;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-sync-"));
  state = new StateStore(join(dir, "state.json"));
  inbox = new PaneInbox(join(dir, "inbox"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fakeRelay(opts: {
  threads: InboxThreadShape[];
  peers: Peer[];
  messages: Record<string, Message[]>; // threadId → messages
}): RelayHttp {
  return {
    listThreads: vi.fn(async () => ({ unreadCount: 0, threads: opts.threads }) satisfies InboxResponse),
    listPeers: vi.fn(async () => ({ peers: opts.peers })),
    readThread: vi.fn(async (threadId: string) => ({ messages: opts.messages[threadId] ?? [] })),
  } as unknown as RelayHttp;
}

describe("syncStateFromRelay", () => {
  it("populates state.threads from /threads + /peers and resolves peerName", async () => {
    const relay = fakeRelay({
      threads: [
        { threadId: THREAD, shortId: 7, title: null, participants: [SELF, PEER], lastMessageAt: "2026-04-20T10:00:00Z", archived: false, unread: 0 },
      ],
      peers: [
        { id: SELF, name: "leo", email: "leo@x", createdAt: "2026-01-01T00:00:00Z" },
        { id: PEER, name: "bob", email: "bob@x", createdAt: "2026-01-01T00:00:00Z" },
      ],
      messages: {},
    });
    await syncStateFromRelay({ relayHttp: relay, state, paneInbox: inbox, selfPeerId: SELF });
    const s = await state.read();
    expect(s.threads[0]).toMatchObject({ threadId: THREAD, shortId: 7, peerName: "bob", unread: 0 });
  });

  it("appends backfill messages to paneInbox for threads with unread > 0", async () => {
    const relay = fakeRelay({
      threads: [
        { threadId: THREAD, shortId: 7, title: null, participants: [SELF, PEER], lastMessageAt: "2026-04-20T10:00:00Z", archived: false, unread: 2 },
      ],
      peers: [
        { id: PEER, name: "bob", email: "bob@x", createdAt: "2026-01-01T00:00:00Z" },
      ],
      messages: {
        [THREAD]: [
          { id: "m1", threadId: THREAD, fromPeer: PEER, body: "hi", sentAt: "2026-04-20T09:00:00Z", seq: 1 },
          { id: "m2", threadId: THREAD, fromPeer: PEER, body: "you there", sentAt: "2026-04-20T09:30:00Z", seq: 2 },
        ],
      },
    });
    await syncStateFromRelay({ relayHttp: relay, state, paneInbox: inbox, selfPeerId: SELF });
    const drained = await inbox.drain(7);
    expect(drained.map((e) => e.message.body)).toEqual(["hi", "you there"]);
    const s = await state.read();
    expect(s.threads[0].unread).toBe(2);
    expect(s.lastSeenSeq[THREAD]).toBe(2);
  });

  it("uses sinceSeq from existing lastSeenSeq", async () => {
    await state.write({ unreadCount: 0, threads: [], lastSeenSeq: { [THREAD]: 5 } });
    const relay = fakeRelay({
      threads: [{ threadId: THREAD, shortId: 7, title: null, participants: [SELF, PEER], lastMessageAt: "z", archived: false, unread: 1 }],
      peers: [{ id: PEER, name: "bob", email: "x", createdAt: "x" }],
      messages: { [THREAD]: [{ id: "m6", threadId: THREAD, fromPeer: PEER, body: "after-5", sentAt: "z", seq: 6 }] },
    });
    await syncStateFromRelay({ relayHttp: relay, state, paneInbox: inbox, selfPeerId: SELF });
    expect(relay.readThread).toHaveBeenCalledWith(THREAD, 5);
  });
});
```

**Step 2: Run, expect fail (module not found)**

Run: `pnpm --filter @lyy/daemon test -- state-sync`
Expected: FAIL — Cannot find module.

**Step 3: Implement `state-sync.ts`**

Create `packages/daemon/src/state-sync.ts`:

```ts
import type { PaneInbox } from "./pane-inbox.js";
import type { RelayHttp } from "./relay-http.js";
import type { StateStore, ThreadSummary } from "./state.js";

export interface SyncDeps {
  relayHttp: RelayHttp;
  state: StateStore;
  paneInbox: PaneInbox;
  selfPeerId: string;
  previewLen?: number;
}

const DEFAULT_PREVIEW_LEN = 80;

export async function syncStateFromRelay(deps: SyncDeps): Promise<void> {
  const previewLen = deps.previewLen ?? DEFAULT_PREVIEW_LEN;

  const [threadsRes, peersRes, prevState] = await Promise.all([
    deps.relayHttp.listThreads(true),
    deps.relayHttp.listPeers(),
    deps.state.read(),
  ]);

  const peerById = new Map(peersRes.peers.map((p) => [p.id, p]));

  // Backfill messages for threads with unread > 0 (or new threads we've never seen).
  const backfillUpdates: Record<string, number> = {};
  for (const t of threadsRes.threads) {
    if (t.unread <= 0) continue;
    const sinceSeq = prevState.lastSeenSeq[t.threadId] ?? 0;
    const { messages } = await deps.relayHttp.readThread(t.threadId, sinceSeq);
    let maxSeq = sinceSeq;
    for (const m of messages) {
      if (m.fromPeer === deps.selfPeerId) {
        maxSeq = Math.max(maxSeq, m.seq);
        continue;
      }
      await deps.paneInbox.append(t.shortId, m);
      maxSeq = Math.max(maxSeq, m.seq);
    }
    backfillUpdates[t.threadId] = maxSeq;
  }

  // Build new state.threads (relay = source of truth for unread/lastMessageAt/archived).
  const existingByThread = new Map(prevState.threads.map((t) => [t.threadId, t]));
  const merged: ThreadSummary[] = threadsRes.threads.map((t) => {
    const existing = existingByThread.get(t.threadId);
    const otherId = t.participants.find((p) => p !== deps.selfPeerId);
    const peerName = otherId ? (peerById.get(otherId)?.name ?? "?") : "?";
    return {
      threadId: t.threadId,
      shortId: t.shortId,
      peerName,
      lastBody: existing?.lastBody ?? "",
      lastMessageAt: t.lastMessageAt,
      unread: t.unread,
      archived: t.archived,
      paneOpen: existing?.paneOpen ?? false,
    };
  });

  const unreadCount = merged.reduce(
    (sum, t) => sum + (t.archived ? 0 : t.unread),
    0,
  );

  await deps.state.update((s) => ({
    ...s,
    threads: merged,
    unreadCount,
    lastSeenSeq: { ...s.lastSeenSeq, ...backfillUpdates },
  }));
}
```

**Step 4: Run tests, expect pass**

Run: `pnpm --filter @lyy/daemon test -- state-sync`
Expected: PASS all 3 cases.

**Step 5: Commit**

```bash
git add packages/daemon/src/state-sync.ts packages/daemon/src/state-sync.test.ts
git commit -m "feat(daemon): syncStateFromRelay pulls threads/peers/messages on (re)connect"
```

---

### Task B2: Wire sync to `connected` event

**Files:**
- Modify: `packages/daemon/src/main.ts`

**Step 1: Implement**

In `packages/daemon/src/main.ts`:

1. Add import: `import { syncStateFromRelay } from "./state-sync.js";`
2. Replace the existing `relayClient.on("connected", ...)` handler with:

```ts
relayClient.on("connected", async () => {
  console.log("[lyy-daemon] relay connected");
  try {
    await syncStateFromRelay({
      relayHttp,
      state,
      paneInbox,
      selfPeerId: identity.peerId,
    });
    console.log("[lyy-daemon] state sync complete");
  } catch (err) {
    console.log(
      `[lyy-daemon] state sync failed: ${(err as Error).message}`,
    );
  }
});
```

**Step 2: Build + test**

Run: `pnpm build && LYY_SKIP_DB=1 pnpm test`
Expected: ALL PASS.

**Step 3: Commit**

```bash
git add packages/daemon/src/main.ts
git commit -m "feat(daemon): trigger state sync on relay connect"
```

---

## Section C: Multi-window (per-instance zellij sessions)

### Task C1: Per-PID zellij session names + drop pre-delete

**Files:**
- Modify: `packages/cli/src/commands/default.ts`

**Step 1: Implement**

In `packages/cli/src/commands/default.ts`, change `sessionName()` to suffix with PID:

```ts
function sessionName(): string {
  const home = process.env.LYY_HOME ?? resolvePath(homedir(), ".lyy");
  const base = basename(home).replace(/^\./, "") || "lyy";
  return `${base}-${process.pid}`;
}
```

In `runDefault()`, **remove** the first `spawnSync(zellij, ["delete-session", session, "--force"], ...)` call (the pre-create cleanup). Keep the post-exit one.

**Step 2: Smoke test (manual, no automated test)**

Run two terminals:

```bash
# Terminal 1
lyy --profile alice
# Note the session name printed by zellij — should be alice-<pid1>

# Terminal 2 (concurrent, same profile)
lyy --profile alice
# Should NOT kill Terminal 1's session. Should be alice-<pid2>.

# Verify
zellij list-sessions
# Expect both alice-<pid1> and alice-<pid2>
```

**Step 3: Commit**

```bash
git add packages/cli/src/commands/default.ts
git commit -m "feat(cli): per-PID zellij session names so multiple lyy instances coexist"
```

---

### Task C2: PaneRegistry returns conflict info on duplicate register

**Files:**
- Modify: `packages/daemon/src/pane-registry.ts`
- Modify: `packages/daemon/src/mcp-ipc.ts` (if `register_pane` is exposed via IPC — check first)
- Modify: `packages/mcp/src/tools/spawn-thread.ts` (where /pickup creates the pane and registers)

**Step 1: Inspect current behavior**

Run: `grep -n "register_pane\|registerPane" packages/daemon/src/*.ts packages/mcp/src/tools/*.ts`

Find the path. The MCP /pickup tool calls `register_pane` via IPC. Currently it overwrites the binding silently.

**Step 2: Write failing test in `pane-registry.test.ts`**

Append:

```ts
it("registering a thread twice returns the existing paneId", async () => {
  await registry.register(7, "pane-A");
  const result = await registry.register(7, "pane-B");
  expect(result).toEqual({ ok: false, existingPaneId: "pane-A" });
  expect(registry.findPane(7)).toBe("pane-A"); // first one wins
});
```

(Tweak shape of `register()` return per your existing API — currently it likely returns void. We'll widen it.)

**Step 3: Run, expect fail**

Run: `pnpm --filter @lyy/daemon test -- pane-registry`
Expected: FAIL.

**Step 4: Implement**

In `pane-registry.ts`, change `register` to return `{ ok: true } | { ok: false; existingPaneId: string }`. Update IPC server (`mcp-ipc.ts`) to forward the result. Update `spawn-thread.ts` to surface the conflict to the MCP caller as a tool-result error: `"Thread #N already open in another lyy session"`.

**Step 5: Run tests, expect pass**

Run: `pnpm --filter @lyy/daemon test`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/daemon/src/pane-registry.ts packages/daemon/src/pane-registry.test.ts packages/daemon/src/mcp-ipc.ts packages/mcp/src/tools/spawn-thread.ts
git commit -m "feat(daemon): pane-registry rejects duplicate /pickup, surfaces conflict"
```

---

## Section D: Release

### Task D1: Tag and push v0.1.10

**Step 1: Verify CI on `main` is green**

Run: `gh run list --limit 1`
Expected: success on latest main commit.

**Step 2: Tag**

```bash
git tag v0.1.10
git push origin main
git push origin v0.1.10
```

**Step 3: Watch Release workflow**

Run: `gh run list --workflow=release.yml --limit 1`
Wait until success. Tarballs will be on GitHub Releases.

**Step 4: Manual end-to-end smoke**

In order, verify:
1. `rm ~/.lyy/profiles/alice/state.json && lyy --profile alice` → daemon log shows `state sync complete`; `cat ~/.lyy/profiles/alice/state.json` shows thread list.
2. From bob (other terminal): use Claude to send_to alice with new thread → alice statusline lights up within 5s; `/inbox` lists thread.
3. Kill alice daemon: `pkill -f 'profiles/alice/.*lyy-daemon'`. From bob send 3 messages. Restart alice: `lyy --profile alice`. `/inbox` should show 3 unread.
4. Two terminals both `lyy --profile alice` → two zellij sessions `alice-PID1` / `alice-PID2`. From session 1 `/pickup #N`. From session 2 `/pickup #N` → MCP error mentioning conflict.

**Step 5: Tell colleagues to bootstrap to v0.1.10**

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)" && lyy repair
```

---

## Out of scope (explicit YAGNI)

- Group chat UX changes (DB schema already supports M:N; UX deferred)
- SQLite replacement of `state.json` + paneInbox files
- Real-time peer-rename / archive push (handled by next sync naturally)
- Case-insensitive `findPeerByName` (Claude uses `list_peers` to resolve casing)
