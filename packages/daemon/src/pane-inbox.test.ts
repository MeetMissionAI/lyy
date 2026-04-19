import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@lyy/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaneInbox } from "./pane-inbox.js";

let dir: string;
let inbox: PaneInbox;

const M1: Message = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  threadId: "550e8400-e29b-41d4-a716-446655440000",
  fromPeer: "550e8400-e29b-41d4-a716-446655440002",
  body: "hello",
  sentAt: "2026-04-19T10:00:00.000Z",
  seq: 1,
};

const M2: Message = {
  ...M1,
  id: "550e8400-e29b-41d4-a716-446655440003",
  body: "world",
  seq: 2,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lyy-inbox-"));
  inbox = new PaneInbox(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("PaneInbox", () => {
  it("drain returns [] when no file exists", async () => {
    expect(await inbox.drain(12)).toEqual([]);
  });

  it("append then drain returns one entry", async () => {
    await inbox.append(12, M1);
    const entries = await inbox.drain(12);
    expect(entries.length).toBe(1);
    expect(entries[0].message.body).toBe("hello");
    expect(entries[0].receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("drain truncates the file (second drain returns empty)", async () => {
    await inbox.append(12, M1);
    await inbox.drain(12);
    expect(await inbox.drain(12)).toEqual([]);
  });

  it("multiple appends accumulate in order", async () => {
    await inbox.append(12, M1);
    await inbox.append(12, M2);
    const entries = await inbox.drain(12);
    expect(entries.map((e) => e.message.body)).toEqual(["hello", "world"]);
  });

  it("inboxes for different threads are isolated", async () => {
    await inbox.append(12, M1);
    await inbox.append(34, M2);
    expect((await inbox.drain(12)).map((e) => e.message.body)).toEqual([
      "hello",
    ]);
    expect((await inbox.drain(34)).map((e) => e.message.body)).toEqual([
      "world",
    ]);
  });

  it("malformed line is skipped, valid lines still returned", async () => {
    await inbox.append(12, M1);
    // Inject a bad line
    const fs = await import("node:fs/promises");
    await fs.appendFile(inbox.pathFor(12), "not-json\n");
    await inbox.append(12, M2);
    const entries = await inbox.drain(12);
    expect(entries.map((e) => e.message.body)).toEqual(["hello", "world"]);
  });
});
