import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./app.js";

const fakeState = {
  unreadCount: 1,
  threads: [
    {
      threadId: "11111111-1111-4111-8111-111111111111",
      shortId: 7,
      peerName: "alice",
      lastBody: "hi",
      lastMessageAt: "2026-04-21T10:00:00Z",
      unread: 1,
      archived: false,
      paneOpen: false,
    },
  ],
  lastSeenSeq: {},
};

describe("App list view", () => {
  it("renders unread thread row with peer + shortId + lastBody", () => {
    const { lastFrame } = render(<App initialState={fakeState} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@alice");
    expect(frame).toContain("#7");
    expect(frame).toContain("hi");
  });

  it("shows unreadCount in header", () => {
    const { lastFrame } = render(<App initialState={fakeState} />);
    expect(lastFrame()).toContain("1 unread");
  });

  it("renders empty state when no threads", () => {
    const empty = { unreadCount: 0, threads: [], lastSeenSeq: {} };
    const { lastFrame } = render(<App initialState={empty} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("0 unread");
  });

  const twoThreadState = {
    unreadCount: 1,
    threads: [
      {
        threadId: "11111111-1111-4111-8111-111111111111",
        shortId: 7,
        peerName: "alice",
        lastBody: "hi",
        lastMessageAt: "2026-04-21T10:00:00Z",
        unread: 1,
        archived: false,
        paneOpen: false,
      },
      {
        threadId: "22222222-2222-4222-8222-222222222222",
        shortId: 12,
        peerName: "bob",
        lastBody: "ok",
        lastMessageAt: "2026-04-21T11:00:00Z",
        unread: 0,
        archived: false,
        paneOpen: false,
      },
    ],
    lastSeenSeq: {},
  };

  it("highlights first thread by default", () => {
    const { lastFrame } = render(<App initialState={twoThreadState} />);
    const lines = (lastFrame() ?? "").split("\n");
    const aliceLine = lines.find((l) => l.includes("@alice"));
    const bobLine = lines.find((l) => l.includes("@bob"));
    expect(aliceLine).toMatch(/▶/);
    expect(bobLine).not.toMatch(/▶/);
  });

  it("↓ moves highlight to second thread", async () => {
    const { stdin, lastFrame } = render(<App initialState={twoThreadState} />);
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("[B"); // down arrow escape sequence
    await new Promise((r) => setTimeout(r, 30));
    const lines = (lastFrame() ?? "").split("\n");
    expect(lines.find((l) => l.includes("@bob"))).toMatch(/▶/);
    expect(lines.find((l) => l.includes("@alice"))).not.toMatch(/▶/);
  });

  it("↓ clamps at last thread; ↑ clamps at first", async () => {
    const { stdin, lastFrame } = render(<App initialState={twoThreadState} />);
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("[B");
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("[B"); // past end
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (lastFrame() ?? "").split("\n").find((l) => l.includes("@bob")),
    ).toMatch(/▶/);
    stdin.write("[A");
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("[A"); // past start
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (lastFrame() ?? "").split("\n").find((l) => l.includes("@alice")),
    ).toMatch(/▶/);
  });

  it("Enter on selected thread opens detail view", async () => {
    const fetchMessages = vi.fn(async () => [
      {
        id: "m1",
        threadId: "11111111-1111-4111-8111-111111111111",
        fromPeer: "peer-alice",
        body: "hi",
        sentAt: "2026-04-21T10:00:00Z",
        seq: 1,
      },
    ]);
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        fetchMessages={fetchMessages}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\r"); // Enter
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMessages).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(lastFrame()).toContain("← #7 @alice");
    const frame = lastFrame() ?? "";
    expect(frame).toContain("alice");
    expect(frame).toContain("hi");
  });

  it("Enter on thread fires onAckThreadRead with that threadId", async () => {
    const onAckThreadRead = vi.fn(async () => {});
    const { stdin } = render(
      <App
        initialState={fakeState}
        fetchMessages={async () => []}
        onAckThreadRead={onAckThreadRead}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(onAckThreadRead).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("refetches state on message:new event", async () => {
    let capturedHandler: ((event: string, payload: unknown) => void) | null =
      null;
    const subscribeEvents = (cb: {
      onEvent: (event: string, payload: unknown) => void;
    }) => {
      capturedHandler = cb.onEvent;
      return () => {};
    };
    const updatedState = {
      ...fakeState,
      unreadCount: 5,
      threads: fakeState.threads.map((t) => ({ ...t, unread: 5 })),
    };
    const fetchState = vi.fn(async () => updatedState);
    const { lastFrame } = render(
      <App
        initialState={fakeState}
        fetchState={fetchState}
        subscribeEvents={subscribeEvents}
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedHandler).not.toBeNull();
    capturedHandler?.("message:new", { seq: 99 });
    await new Promise((r) => setTimeout(r, 30));
    expect(lastFrame()).toContain("5 unread");
  });

  it("Esc in detail returns to list", async () => {
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        fetchMessages={async () => []}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write(""); // Esc (U+001B)
    await new Promise((r) => setTimeout(r, 30));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("📬");
    expect(frame).not.toContain("← #7");
  });
});

describe("App peers column", () => {
  const fakePeers = [
    {
      id: "peer-self",
      name: "me",
      email: "me@x.com",
      createdAt: "2026-04-21T00:00:00Z",
    },
    {
      id: "peer-alice",
      name: "alice",
      email: "alice@x.com",
      createdAt: "2026-04-21T00:00:00Z",
    },
    {
      id: "peer-bob",
      name: "bob",
      email: "bob@x.com",
      createdAt: "2026-04-21T00:00:00Z",
    },
  ];

  it("renders peers section excluding self", () => {
    const { lastFrame } = render(
      <App
        initialState={fakeState}
        initialPeers={fakePeers}
        selfPeerId="peer-self"
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Peers");
    expect(frame).toContain("@alice");
    expect(frame).toContain("@bob");
    // self's @me should not appear as a peer entry (line with "@me" and
    // without a "#" shortId — shortId rules out thread rows).
    const meAsPeer = frame
      .split("\n")
      .some((l) => l.includes("@me") && !l.includes("#"));
    expect(meAsPeer).toBe(false);
  });

  it("Tab switches focus to peers; first peer gets ▶", async () => {
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        initialPeers={fakePeers}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 30));
    const aliceLine = (lastFrame() ?? "")
      .split("\n")
      .find((l) => l.includes("@alice") && !l.includes("#"));
    expect(aliceLine).toMatch(/▶/);
  });

  it("↓ in peers moves highlight to bob", async () => {
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        initialPeers={fakePeers}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 100));
    stdin.write("\x1b[B");
    await new Promise((r) => setTimeout(r, 100));
    const bobLine = (lastFrame() ?? "")
      .split("\n")
      .find((l) => l.includes("@bob") && !l.includes("#"));
    expect(bobLine).toMatch(/▶/);
  });

  it("Enter on peer with existing thread opens that thread", async () => {
    const fetchMessages = vi.fn(async () => []);
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        initialPeers={fakePeers}
        fetchMessages={fetchMessages}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMessages).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(lastFrame()).toContain("← #7 @alice");
  });

  it("Enter on peer without thread enters newThread view", async () => {
    const { stdin, lastFrame } = render(
      <App
        initialState={fakeState}
        initialPeers={fakePeers}
        onSendToPeer={vi.fn(async () => ({
          messageId: "m1",
          threadId: "new-thread-id",
          threadShortId: 42,
          seq: 1,
          sentAt: "2026-04-22T00:00:00Z",
        }))}
        selfPeerId="peer-self"
      />,
    );
    await new Promise((r) => setTimeout(r, 10));
    stdin.write("\t");
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\x1b[B"); // move to bob (no existing thread)
    await new Promise((r) => setTimeout(r, 30));
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 30));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("@bob");
    expect(frame).toContain("←");
  });
});
