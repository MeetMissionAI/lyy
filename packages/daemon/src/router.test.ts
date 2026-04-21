import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@lyy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaneInbox } from "./pane-inbox.js";
import { PaneRegistry } from "./pane-registry.js";
import type { RelayClient } from "./relay-client.js";
import { MessageRouter } from "./router.js";
import { StateStore, type ThreadSummary } from "./state.js";

const SELF_PEER = "550e8400-e29b-41d4-a716-446655440aaa";
const OTHER_PEER = "550e8400-e29b-41d4-a716-446655440bbb";
const THREAD_ID = "550e8400-e29b-41d4-a716-446655440000";
const SHORT_ID = 12;

let dir: string;
let inbox: PaneInbox;
let state: StateStore;
let registry: PaneRegistry;
let relay: EventEmitter;
let router: MessageRouter;

function newMessage(
  opts: Partial<Message> & Pick<Message, "fromPeer" | "seq">,
): Message {
  return {
    id: `id-${opts.seq}`,
    threadId: THREAD_ID,
    body: "hello",
    sentAt: "2026-04-19T10:00:00.000Z",
    ...opts,
  };
}

async function seedThreadSummary(
  overrides: Partial<ThreadSummary> = {},
): Promise<void> {
  await state.write({
    unreadCount: 0,
    threads: [
      {
        threadId: THREAD_ID,
        shortId: SHORT_ID,
        peerName: "leo",
        lastBody: "",
        unread: 0,
        lastMessageAt: "2026-04-19T09:00:00.000Z",
        archived: false,
        paneOpen: false,
        ...overrides,
      },
    ],
    lastSeenSeq: {},
  });
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyy-router-"));
  inbox = new PaneInbox(join(dir, "inbox"));
  state = new StateStore(join(dir, "state.json"));
  registry = new PaneRegistry(join(dir, "reg.sock"));
  await registry.start();
  relay = new EventEmitter();
  router = new MessageRouter({
    relay: relay as unknown as RelayClient,
    paneRegistry: registry,
    paneInbox: inbox,
    state,
    selfPeerId: SELF_PEER,
  });
  router.start();
});

afterEach(async () => {
  await registry.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function emit(env: {
  message: Message;
  threadShortId: number;
  thread?: {
    id: string;
    shortId: number;
    title: string | null;
    participants: string[];
  };
  peers?: { id: string; name: string; displayName?: string }[];
}): Promise<void> {
  relay.emit("message:new", env);
  // give async update time to settle
  await new Promise((r) => setTimeout(r, 10));
}

describe("MessageRouter", () => {
  it("from self: bumps lastSeenSeq, no unread, no inbox write", async () => {
    await seedThreadSummary();
    await emit({
      message: newMessage({ fromPeer: SELF_PEER, seq: 5, body: "self-sent" }),
      threadShortId: SHORT_ID,
    });

    const s = await state.read();
    expect(s.lastSeenSeq[THREAD_ID]).toBe(5);
    expect(s.threads[0].unread).toBe(0);
    expect(s.unreadCount).toBe(0);
    expect(await inbox.drain(SHORT_ID)).toEqual([]);
  });

  it("from other, pane closed: bumps unread AND writes to paneInbox", async () => {
    await seedThreadSummary();
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 7, body: "ping" }),
      threadShortId: SHORT_ID,
    });

    const s = await state.read();
    expect(s.lastSeenSeq[THREAD_ID]).toBe(7);
    expect(s.threads[0].unread).toBe(1);
    expect(s.threads[0].lastBody).toBe("ping");
    expect(s.unreadCount).toBe(1);
    const entries = await inbox.drain(SHORT_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0].message.body).toBe("ping");
  });

  it("from other, pane open: appends to inbox, no unread bump", async () => {
    await seedThreadSummary();
    // Register pane via in-memory map (skip the socket roundtrip for unit test)
    (registry as unknown as { map: Map<number, string> }).map.set(
      SHORT_ID,
      "pane-xyz",
    );

    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 9, body: "live ping" }),
      threadShortId: SHORT_ID,
    });

    const s = await state.read();
    expect(s.threads[0].unread).toBe(0);
    expect(s.threads[0].paneOpen).toBe(true);
    expect(s.unreadCount).toBe(0);

    const entries = await inbox.drain(SHORT_ID);
    expect(entries.length).toBe(1);
    expect(entries[0].message.body).toBe("live ping");
  });

  it("multiple unread accumulate; lastSeenSeq always increasing", async () => {
    await seedThreadSummary();
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 1 }),
      threadShortId: SHORT_ID,
    });
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 5 }),
      threadShortId: SHORT_ID,
    });
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 3 }), // out-of-order arrival
      threadShortId: SHORT_ID,
    });

    const s = await state.read();
    expect(s.threads[0].unread).toBe(3);
    expect(s.lastSeenSeq[THREAD_ID]).toBe(5); // max wins
    expect(s.unreadCount).toBe(3);
  });

  it("archived thread doesn't contribute to unreadCount", async () => {
    await seedThreadSummary({ archived: true });
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 1 }),
      threadShortId: SHORT_ID,
    });
    const s = await state.read();
    expect(s.threads[0].unread).toBe(1); // still counted on the thread itself
    expect(s.unreadCount).toBe(0); // but excluded from the global badge
  });

  it("unknown thread with envelope.thread + envelope.peers: upserts summary", async () => {
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
      lastMessageAt: "2026-04-19T10:00:00.000Z",
      archived: false,
      paneOpen: false,
    });
    expect(s.lastSeenSeq[THREAD_ID]).toBe(1);
    expect(s.unreadCount).toBe(1);
  });

  it("unknown thread without envelope metadata (legacy relay): leaves threads empty, still bumps lastSeenSeq", async () => {
    await state.write({ unreadCount: 0, threads: [], lastSeenSeq: {} });
    await emit({
      message: newMessage({ fromPeer: OTHER_PEER, seq: 1 }),
      threadShortId: SHORT_ID,
    });
    const s = await state.read();
    expect(s.threads).toEqual([]);
    expect(s.lastSeenSeq[THREAD_ID]).toBe(1);
  });
});
