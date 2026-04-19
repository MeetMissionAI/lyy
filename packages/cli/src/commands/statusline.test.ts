import type { State, ThreadSummary } from "@lyy/daemon";
import { describe, expect, it } from "vitest";
import { renderStatusLine } from "./statusline.js";

const baseThread = (overrides: Partial<ThreadSummary>): ThreadSummary => ({
  threadId: "550e8400-e29b-41d4-a716-446655440000",
  shortId: 1,
  peerName: "x",
  lastBody: "",
  unread: 0,
  lastMessageAt: "2026-04-19T10:00:00.000Z",
  archived: false,
  paneOpen: false,
  ...overrides,
});

const state = (threads: ThreadSummary[]): State => ({
  unreadCount: threads.reduce((s, t) => s + (t.archived ? 0 : t.unread), 0),
  threads,
  lastSeenSeq: {},
});

describe("renderStatusLine", () => {
  it("returns empty when no unread and no active", () => {
    expect(renderStatusLine(state([baseThread({ unread: 0 })]))).toBe("");
  });

  it("renders single unread thread", () => {
    expect(
      renderStatusLine(
        state([baseThread({ shortId: 12, peerName: "jianfeng", unread: 1 })]),
      ),
    ).toBe("📬 #12 @jianfeng");
  });

  it("joins multiple unread with · separator", () => {
    expect(
      renderStatusLine(
        state([
          baseThread({ shortId: 12, peerName: "jianfeng", unread: 1 }),
          baseThread({ shortId: 18, peerName: "sarah", unread: 3 }),
        ]),
      ),
    ).toBe("📬 #12 @jianfeng · #18 @sarah");
  });

  it("appends '+N more' beyond maxShown", () => {
    expect(
      renderStatusLine(
        state([
          baseThread({ shortId: 1, peerName: "a", unread: 1 }),
          baseThread({ shortId: 2, peerName: "b", unread: 1 }),
          baseThread({ shortId: 3, peerName: "c", unread: 1 }),
          baseThread({ shortId: 4, peerName: "d", unread: 1 }),
        ]),
      ),
    ).toBe("📬 #1 @a · #2 @b +2 more");
  });

  it("appends active pane indicator", () => {
    expect(
      renderStatusLine(
        state([
          baseThread({ shortId: 12, peerName: "j", unread: 1 }),
          baseThread({ shortId: 8, peerName: "leo", paneOpen: true }),
        ]),
      ),
    ).toBe("📬 #12 @j · 🧵 #8 active");
  });

  it("excludes archived threads from unread group", () => {
    expect(
      renderStatusLine(
        state([
          baseThread({ shortId: 1, peerName: "a", unread: 5, archived: true }),
          baseThread({ shortId: 2, peerName: "b", unread: 1 }),
        ]),
      ),
    ).toBe("📬 #2 @b");
  });

  it("returns empty when only archived threads have unread", () => {
    expect(
      renderStatusLine(
        state([
          baseThread({ shortId: 1, peerName: "a", unread: 5, archived: true }),
        ]),
      ),
    ).toBe("");
  });

  it("active pane alone (no unread) still renders", () => {
    expect(
      renderStatusLine(
        state([baseThread({ shortId: 8, peerName: "leo", paneOpen: true })]),
      ),
    ).toBe("🧵 #8 active");
  });
});
