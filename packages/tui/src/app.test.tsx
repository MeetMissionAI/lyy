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
});
