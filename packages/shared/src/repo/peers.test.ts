import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  createPeer,
  findPeerByEmail,
  findPeerByName,
  findPeersByIds,
  listPeers,
} from "./peers.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db = url ? createDb(url) : (null as never);

const TEST_PREFIX = "lyytest-";

async function cleanup() {
  await db`DELETE FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}`;
}

if (!skip) {
  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.end();
  });
}

describe.skipIf(skip)("peers repo", () => {
  it("createPeer + findPeerByName roundtrip", async () => {
    const created = await createPeer(db, {
      name: `${TEST_PREFIX}leo`,
      email: `${TEST_PREFIX}leo@x.com`,
      displayName: "Leo",
    });
    expect(created.name).toBe(`${TEST_PREFIX}leo`);
    expect(created.id).toBeDefined();
    expect(created.displayName).toBe("Leo");

    const found = await findPeerByName(db, `${TEST_PREFIX}leo`);
    expect(found?.id).toBe(created.id);
  });

  it("findPeerByEmail returns peer", async () => {
    await createPeer(db, {
      name: `${TEST_PREFIX}sarah`,
      email: `${TEST_PREFIX}sarah@x.com`,
    });
    const found = await findPeerByEmail(db, `${TEST_PREFIX}sarah@x.com`);
    expect(found?.name).toBe(`${TEST_PREFIX}sarah`);
    expect(found?.displayName).toBeUndefined();
  });

  it("findPeerByName returns null for unknown", async () => {
    const found = await findPeerByName(db, `${TEST_PREFIX}nobody`);
    expect(found).toBeNull();
  });

  it("listPeers returns inserted peers in created_at order", async () => {
    await createPeer(db, {
      name: `${TEST_PREFIX}a`,
      email: `${TEST_PREFIX}a@x.com`,
    });
    await createPeer(db, {
      name: `${TEST_PREFIX}b`,
      email: `${TEST_PREFIX}b@x.com`,
    });
    const all = await listPeers(db);
    const testPeers = all.filter((p) => p.name.startsWith(TEST_PREFIX));
    expect(testPeers.map((p) => p.name)).toEqual([
      `${TEST_PREFIX}a`,
      `${TEST_PREFIX}b`,
    ]);
  });

  it("rejects duplicate name (UNIQUE constraint)", async () => {
    await createPeer(db, {
      name: `${TEST_PREFIX}dup`,
      email: `${TEST_PREFIX}dup1@x.com`,
    });
    await expect(
      createPeer(db, {
        name: `${TEST_PREFIX}dup`,
        email: `${TEST_PREFIX}dup2@x.com`,
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(skip)("findPeersByIds", () => {
  it("returns matching non-disabled peers when given multiple IDs", async () => {
    const p1 = await createPeer(db, {
      name: `${TEST_PREFIX}batch1`,
      email: `${TEST_PREFIX}batch1@x.com`,
    });
    const p2 = await createPeer(db, {
      name: `${TEST_PREFIX}batch2`,
      email: `${TEST_PREFIX}batch2@x.com`,
    });
    await createPeer(db, {
      name: `${TEST_PREFIX}batch3`,
      email: `${TEST_PREFIX}batch3@x.com`,
    });

    const found = await findPeersByIds(db, [p1.id, p2.id]);
    const names = found.map((p) => p.name).sort();
    expect(names).toEqual([`${TEST_PREFIX}batch1`, `${TEST_PREFIX}batch2`]);
  });

  it("returns empty array for empty input", async () => {
    const found = await findPeersByIds(db, []);
    expect(found).toEqual([]);
  });
});
