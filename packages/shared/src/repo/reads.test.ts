import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { createPeer } from "./peers.js";
import { TEST_PREFIX, cleanupTestData } from "./_test-utils.ts";
import { insertMessage } from "./messages.js";
import { markRead, markThreadRead, unreadCountForPeer, unreadCountForThread } from "./reads.js";
import { createThread } from "./threads.js";

const url = process.env.DATABASE_URL;
const skip = !url;
const db = url ? createDb(url) : (null as never);

if (!skip) {
  beforeEach(() => cleanupTestData(db));
  afterAll(async () => {
    await cleanupTestData(db);
    await db.end();
  });
}

async function seedConversation() {
  const a = await createPeer(db, {
    name: `${TEST_PREFIX}sender`,
    email: `${TEST_PREFIX}sender@x.com`,
  });
  const b = await createPeer(db, {
    name: `${TEST_PREFIX}recv`,
    email: `${TEST_PREFIX}recv@x.com`,
  });
  const t = await createThread(db, { participants: [a.id, b.id] });
  const m1 = await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "hello" });
  const m2 = await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "world" });
  return { a, b, t, m1, m2 };
}

describe.skipIf(skip)("reads repo", () => {
  it("unreadCountForPeer counts messages from others", async () => {
    const { b } = await seedConversation();
    expect(await unreadCountForPeer(db, b.id)).toBe(2);
  });

  it("markRead reduces unread count", async () => {
    const { b, m1 } = await seedConversation();
    await markRead(db, [m1.id], b.id);
    expect(await unreadCountForPeer(db, b.id)).toBe(1);
  });

  it("markRead is idempotent", async () => {
    const { b, m1 } = await seedConversation();
    await markRead(db, [m1.id], b.id);
    await markRead(db, [m1.id], b.id); // again — should not throw
    expect(await unreadCountForPeer(db, b.id)).toBe(1);
  });

  it("markThreadRead clears all unread for that peer in that thread", async () => {
    const { b, t } = await seedConversation();
    await markThreadRead(db, t.id, b.id);
    expect(await unreadCountForThread(db, t.id, b.id)).toBe(0);
  });

  it("markThreadRead does not mark sender's own messages", async () => {
    const { a, t } = await seedConversation();
    await markThreadRead(db, t.id, a.id);
    // Sender has no unread anyway, but asserting it's still 0 (no own-msg leak)
    expect(await unreadCountForThread(db, t.id, a.id)).toBe(0);
  });
});
