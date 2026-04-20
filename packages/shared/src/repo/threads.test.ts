import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { TEST_PREFIX, cleanupTestData } from "./_test-utils.ts";
import { createPeer } from "./peers.js";
import {
  createThread,
  findActiveThread,
  getThreadById,
  getThreadByShortId,
  listThreadsForPeer,
} from "./threads.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db = url ? createDb(url) : (null as never);

if (!skip) {
  beforeEach(() => cleanupTestData(db));
  afterAll(async () => {
    await cleanupTestData(db);
    await db.end();
  });
}

async function seedTwoPeers() {
  const a = await createPeer(db, {
    name: `${TEST_PREFIX}alice`,
    email: `${TEST_PREFIX}alice@x.com`,
  });
  const b = await createPeer(db, {
    name: `${TEST_PREFIX}bob`,
    email: `${TEST_PREFIX}bob@x.com`,
  });
  return { a, b };
}

describe.skipIf(skip)("threads repo", () => {
  it("createThread inserts thread + participants and assigns short_id", async () => {
    const { a, b } = await seedTwoPeers();
    const t = await createThread(db, {
      participants: [a.id, b.id],
      title: "hello",
    });
    expect(t.id).toBeDefined();
    expect(typeof t.shortId).toBe("number");
    expect(t.shortId).toBeGreaterThan(0);
    expect(t.title).toBe("hello");
    expect(t.participants.sort()).toEqual([a.id, b.id].sort());
  });

  it("createThread rejects fewer than 2 participants", async () => {
    const { a } = await seedTwoPeers();
    await expect(createThread(db, { participants: [a.id] })).rejects.toThrow();
  });

  it("getThreadByShortId roundtrips", async () => {
    const { a, b } = await seedTwoPeers();
    const created = await createThread(db, { participants: [a.id, b.id] });
    const found = await getThreadByShortId(db, created.shortId);
    expect(found?.id).toBe(created.id);
  });

  it("getThreadById roundtrips", async () => {
    const { a, b } = await seedTwoPeers();
    const created = await createThread(db, { participants: [a.id, b.id] });
    const found = await getThreadById(db, created.id);
    expect(found?.shortId).toBe(created.shortId);
  });

  it("findActiveThread returns most recent within window", async () => {
    const { a, b } = await seedTwoPeers();
    const t1 = await createThread(db, { participants: [a.id, b.id] });
    // Only t1 exists; should be findable
    const found = await findActiveThread(db, a.id, b.id, 24);
    expect(found?.id).toBe(t1.id);
  });

  it("findActiveThread returns null when last activity is too old", async () => {
    const { a, b } = await seedTwoPeers();
    const t = await createThread(db, { participants: [a.id, b.id] });
    // Manually push last_message_at into the past
    await db`UPDATE threads SET last_message_at = now() - interval '48 hours' WHERE id = ${t.id}`;
    const found = await findActiveThread(db, a.id, b.id, 24);
    expect(found).toBeNull();
  });

  it("listThreadsForPeer returns thread with archived=false by default", async () => {
    const { a, b } = await seedTwoPeers();
    const t = await createThread(db, { participants: [a.id, b.id] });
    const list = await listThreadsForPeer(db, a.id);
    expect(list.find((x) => x.id === t.id)?.archived).toBe(false);
  });
});
