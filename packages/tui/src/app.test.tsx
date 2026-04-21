import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
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
});
