import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type State, StateStore } from "./state.js";

let dir: string;
let store: StateStore;

const VALID_THREAD = {
  threadId: "550e8400-e29b-41d4-a716-446655440000",
  shortId: 12,
  peerName: "leo",
  lastBody: "ping",
  unread: 1,
  lastMessageAt: "2026-04-19T10:00:00.000Z",
  archived: false,
  paneOpen: false,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-state-"));
  store = new StateStore(join(dir, "state.json"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("StateStore", () => {
  it("returns empty state when file does not exist", async () => {
    const s = await store.read();
    expect(s).toEqual({ unreadCount: 0, threads: [], lastSeenSeq: {} });
  });

  it("write then read roundtrips", async () => {
    const state: State = {
      unreadCount: 1,
      threads: [VALID_THREAD],
      lastSeenSeq: { [VALID_THREAD.threadId]: 42 },
    };
    await store.write(state);
    const back = await store.read();
    expect(back).toEqual(state);
  });

  it("write is atomic (tmp file + rename)", async () => {
    await store.write({ unreadCount: 0, threads: [], lastSeenSeq: {} });
    // After write, no .tmp.* file should remain
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(dir);
    expect(entries.some((e) => e.includes(".tmp."))).toBe(false);
    expect(entries).toContain("state.json");
  });

  it("file content is valid JSON", async () => {
    await store.write({
      unreadCount: 1,
      threads: [VALID_THREAD],
      lastSeenSeq: {},
    });
    const raw = readFileSync(join(dir, "state.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("update applies a transform", async () => {
    await store.write({ unreadCount: 0, threads: [], lastSeenSeq: {} });
    const next = await store.update((s) => ({
      ...s,
      unreadCount: s.unreadCount + 1,
    }));
    expect(next.unreadCount).toBe(1);
    expect((await store.read()).unreadCount).toBe(1);
  });

  it("write rejects invalid state shape", async () => {
    await expect(
      store.write({
        unreadCount: -1,
        threads: [],
        lastSeenSeq: {},
      } as unknown as State),
    ).rejects.toThrow();
  });

  it("read throws on schema violation", async () => {
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(dir, "state.json"),
      JSON.stringify({ bogus: true }),
    );
    await expect(store.read()).rejects.toThrow(/Invalid state/);
  });
});
