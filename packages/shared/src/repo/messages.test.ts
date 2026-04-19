import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { TEST_PREFIX, cleanupTestData } from "./_test-utils.ts";
import { insertMessage, listMessages, searchMessages } from "./messages.js";
import { createPeer } from "./peers.js";
import { createThread, getThreadById } from "./threads.js";

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

async function seed() {
  const a = await createPeer(db, {
    name: `${TEST_PREFIX}sender`,
    email: `${TEST_PREFIX}sender@x.com`,
  });
  const b = await createPeer(db, {
    name: `${TEST_PREFIX}recv`,
    email: `${TEST_PREFIX}recv@x.com`,
  });
  const t = await createThread(db, { participants: [a.id, b.id] });
  return { a, b, t };
}

describe.skipIf(skip)("messages repo", () => {
  it("insertMessage assigns monotonic seq within thread", async () => {
    const { a, t } = await seed();
    const m1 = await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "first",
    });
    const m2 = await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "second",
    });
    expect(m2.seq).toBeGreaterThan(m1.seq);
  });

  it("insertMessage updates threads.last_message_at", async () => {
    const { a, t } = await seed();
    const before = await getThreadById(db, t.id);
    await new Promise((r) => setTimeout(r, 50));
    await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "tick" });
    const after = await getThreadById(db, t.id);
    expect(new Date(after?.lastMessageAt).getTime()).toBeGreaterThan(
      new Date(before?.lastMessageAt).getTime(),
    );
  });

  it("listMessages returns in seq order", async () => {
    const { a, t } = await seed();
    await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "one" });
    await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "two" });
    await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "three" });
    const all = await listMessages(db, t.id);
    expect(all.map((m) => m.body)).toEqual(["one", "two", "three"]);
  });

  it("listMessages with sinceSeq returns only newer", async () => {
    const { a, t } = await seed();
    const m1 = await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "old",
    });
    await insertMessage(db, { threadId: t.id, fromPeer: a.id, body: "new" });
    const since = await listMessages(db, t.id, m1.seq);
    expect(since.map((m) => m.body)).toEqual(["new"]);
  });

  it("searchMessages finds by FTS keyword", async () => {
    const { a, t } = await seed();
    await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "lottie animation 60fps",
    });
    await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "unrelated text",
    });
    const hits = await searchMessages(db, "lottie");
    expect(hits.some((m) => m.body.includes("lottie"))).toBe(true);
    expect(hits.every((m) => !m.body.includes("unrelated"))).toBe(true);
  });

  it("searchMessages with peer filter only returns threads peer is in", async () => {
    const { a, b, t } = await seed();
    // Outsider peer with their own thread
    const c = await createPeer(db, {
      name: `${TEST_PREFIX}outsider`,
      email: `${TEST_PREFIX}outsider@x.com`,
    });
    const t2 = await createThread(db, { participants: [a.id, c.id] });
    await insertMessage(db, {
      threadId: t.id,
      fromPeer: a.id,
      body: "kiwi-keyword apples",
    });
    await insertMessage(db, {
      threadId: t2.id,
      fromPeer: a.id,
      body: "kiwi-keyword bananas",
    });

    const hitsForB = await searchMessages(db, "kiwi-keyword", { peer: b.id });
    expect(hitsForB.length).toBe(1);
    expect(hitsForB[0].threadId).toBe(t.id);
  });
});
