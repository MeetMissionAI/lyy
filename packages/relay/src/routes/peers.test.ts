import { type Db, createDb, createPeer } from "@lyy/shared";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db: Db = url ? createDb(url) : (null as never);

const SECRET = "test-secret";
const TEST_PREFIX = "lyytest-peers-";

function authHeader(peerId: string) {
  return { authorization: `Bearer ${jwt.sign({ peerId }, SECRET)}` };
}

async function cleanup() {
  await db`DELETE FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}`;
}

if (!skip) {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.end();
  });
}

describe.skipIf(skip)("GET /peers", () => {
  it("returns all non-disabled peers", async () => {
    const alice = await createPeer(db, {
      name: `${TEST_PREFIX}alice`,
      email: `${TEST_PREFIX}alice@x.com`,
      displayName: "Alice",
    });
    const bob = await createPeer(db, {
      name: `${TEST_PREFIX}bob`,
      email: `${TEST_PREFIX}bob@x.com`,
    });

    const app = await buildServer({ db, jwtSecret: SECRET });
    const res = await app.inject({
      method: "GET",
      url: "/peers",
      headers: authHeader(alice.id),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { peers: { id: string; name: string }[] };
    const names = body.peers.map((p) => p.name);
    expect(names).toContain(alice.name);
    expect(names).toContain(bob.name);
    await app.close();
  });

  it("requires auth", async () => {
    const app = await buildServer({ db, jwtSecret: SECRET });
    const res = await app.inject({ method: "GET", url: "/peers" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
