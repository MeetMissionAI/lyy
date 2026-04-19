import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { TEST_PREFIX, cleanupTestData } from "./_test-utils.ts";
import { archiveThread, isArchived, unarchiveThread } from "./archives.js";
import { createPeer } from "./peers.js";
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

async function seedThread() {
  const a = await createPeer(db, {
    name: `${TEST_PREFIX}arch-a`,
    email: `${TEST_PREFIX}arch-a@x.com`,
  });
  const b = await createPeer(db, {
    name: `${TEST_PREFIX}arch-b`,
    email: `${TEST_PREFIX}arch-b@x.com`,
  });
  const t = await createThread(db, { participants: [a.id, b.id] });
  return { a, b, t };
}

describe.skipIf(skip)("archives repo", () => {
  it("isArchived returns false initially", async () => {
    const { a, t } = await seedThread();
    expect(await isArchived(db, t.id, a.id)).toBe(false);
  });

  it("archiveThread sets archived=true for that peer only", async () => {
    const { a, b, t } = await seedThread();
    await archiveThread(db, t.id, a.id);
    expect(await isArchived(db, t.id, a.id)).toBe(true);
    expect(await isArchived(db, t.id, b.id)).toBe(false); // per-peer
  });

  it("archiveThread is idempotent", async () => {
    const { a, t } = await seedThread();
    await archiveThread(db, t.id, a.id);
    await archiveThread(db, t.id, a.id); // again — should not throw
    expect(await isArchived(db, t.id, a.id)).toBe(true);
  });

  it("unarchiveThread reverses archive", async () => {
    const { a, t } = await seedThread();
    await archiveThread(db, t.id, a.id);
    await unarchiveThread(db, t.id, a.id);
    expect(await isArchived(db, t.id, a.id)).toBe(false);
  });
});
