import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, Peer } from "@lyy/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneInbox } from "./pane-inbox.js";
import type {
  InboxResponse,
  InboxThreadShape,
  RelayHttp,
} from "./relay-http.js";
import { syncStateFromRelay } from "./state-sync.js";
import { StateStore } from "./state.js";

const SELF = "11111111-1111-4111-8111-111111111aaa";
const PEER = "22222222-2222-4222-8222-222222222bbb";
const THREAD = "33333333-3333-4333-8333-333333333ccc";

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
  messages: Record<string, Message[]>;
}): RelayHttp {
  return {
    listThreads: vi.fn(
      async () =>
        ({ unreadCount: 0, threads: opts.threads }) satisfies InboxResponse,
    ),
    listPeers: vi.fn(async () => ({ peers: opts.peers })),
    readThread: vi.fn(async (threadId: string) => ({
      messages: opts.messages[threadId] ?? [],
    })),
  } as unknown as RelayHttp;
}

describe("syncStateFromRelay", () => {
  it("populates state.threads from /threads + /peers; resolves peerName", async () => {
    const relay = fakeRelay({
      threads: [
        {
          threadId: THREAD,
          shortId: 7,
          title: null,
          participants: [SELF, PEER],
          lastMessageAt: "2026-04-20T10:00:00Z",
          archived: false,
          unread: 0,
        },
      ],
      peers: [
        {
          id: SELF,
          name: "leo",
          email: "leo@x",
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: PEER,
          name: "bob",
          email: "bob@x",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      messages: {},
    });

    await syncStateFromRelay({
      relayHttp: relay,
      state,
      paneInbox: inbox,
      selfPeerId: SELF,
    });

    const s = await state.read();
    expect(s.threads).toHaveLength(1);
    expect(s.threads[0]).toMatchObject({
      threadId: THREAD,
      shortId: 7,
      peerName: "bob",
      unread: 0,
    });
  });

  it("backfills unread messages to paneInbox (except self-sent)", async () => {
    const relay = fakeRelay({
      threads: [
        {
          threadId: THREAD,
          shortId: 7,
          title: null,
          participants: [SELF, PEER],
          lastMessageAt: "2026-04-20T10:00:00Z",
          archived: false,
          unread: 2,
        },
      ],
      peers: [
        {
          id: PEER,
          name: "bob",
          email: "bob@x",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
      messages: {
        [THREAD]: [
          {
            id: "m1",
            threadId: THREAD,
            fromPeer: PEER,
            body: "hi",
            sentAt: "2026-04-20T09:00:00Z",
            seq: 1,
          },
          {
            id: "m-self",
            threadId: THREAD,
            fromPeer: SELF,
            body: "my-echo",
            sentAt: "2026-04-20T09:15:00Z",
            seq: 2,
          },
          {
            id: "m2",
            threadId: THREAD,
            fromPeer: PEER,
            body: "you there",
            sentAt: "2026-04-20T09:30:00Z",
            seq: 3,
          },
        ],
      },
    });

    await syncStateFromRelay({
      relayHttp: relay,
      state,
      paneInbox: inbox,
      selfPeerId: SELF,
    });

    const drained = await inbox.drain(7);
    expect(drained.map((e) => e.message.body)).toEqual(["hi", "you there"]);
    const s = await state.read();
    expect(s.threads[0].unread).toBe(2);
    expect(s.lastSeenSeq[THREAD]).toBe(3);
  });

  it("uses sinceSeq from existing lastSeenSeq", async () => {
    await state.write({
      unreadCount: 0,
      threads: [],
      lastSeenSeq: { [THREAD]: 5 },
    });
    const relay = fakeRelay({
      threads: [
        {
          threadId: THREAD,
          shortId: 7,
          title: null,
          participants: [SELF, PEER],
          lastMessageAt: "2026-04-20T10:00:00Z",
          archived: false,
          unread: 1,
        },
      ],
      peers: [{ id: PEER, name: "bob", email: "x", createdAt: "x" }],
      messages: {
        [THREAD]: [
          {
            id: "m6",
            threadId: THREAD,
            fromPeer: PEER,
            body: "after-5",
            sentAt: "2026-04-20T09:00:00Z",
            seq: 6,
          },
        ],
      },
    });
    await syncStateFromRelay({
      relayHttp: relay,
      state,
      paneInbox: inbox,
      selfPeerId: SELF,
    });
    expect(relay.readThread).toHaveBeenCalledWith(THREAD, 5);
  });

  it("preserves existing paneOpen + lastBody when threads already present", async () => {
    await state.write({
      unreadCount: 0,
      threads: [
        {
          threadId: THREAD,
          shortId: 7,
          peerName: "bob",
          lastBody: "prev-body",
          lastMessageAt: "2026-04-20T08:00:00Z",
          unread: 0,
          archived: false,
          paneOpen: true,
        },
      ],
      lastSeenSeq: {},
    });
    const relay = fakeRelay({
      threads: [
        {
          threadId: THREAD,
          shortId: 7,
          title: null,
          participants: [SELF, PEER],
          lastMessageAt: "2026-04-20T10:00:00Z",
          archived: false,
          unread: 3,
        },
      ],
      peers: [{ id: PEER, name: "bob", email: "x", createdAt: "x" }],
      messages: {},
    });
    await syncStateFromRelay({
      relayHttp: relay,
      state,
      paneInbox: inbox,
      selfPeerId: SELF,
    });
    const s = await state.read();
    expect(s.threads[0].paneOpen).toBe(true); // preserved
    expect(s.threads[0].lastBody).toBe("prev-body"); // preserved
    expect(s.threads[0].unread).toBe(3); // from relay
    expect(s.threads[0].lastMessageAt).toBe("2026-04-20T10:00:00Z"); // from relay
  });
});
