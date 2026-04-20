import { type Db, createDb, createPeer, createThread } from "@lyy/shared";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageEnvelope } from "../server.js";
import { buildServer } from "../server.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db: Db = url ? createDb(url) : (null as never);

const SECRET = "test-secret";
const TEST_PREFIX = "lyytest-msg-";

function authHeader(peerId: string) {
  return { authorization: `Bearer ${jwt.sign({ peerId }, SECRET)}` };
}

async function cleanup() {
  await db`
    DELETE FROM messages WHERE from_peer IN (
      SELECT id FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}
    )
  `;
  await db`
    DELETE FROM threads WHERE id IN (
      SELECT thread_id FROM thread_participants WHERE peer_id IN (
        SELECT id FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}
      )
    )
  `;
  await db`DELETE FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}`;
}

if (!skip) {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.end();
  });
}

async function seedPeers() {
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

describe.skipIf(skip)("POST /messages", () => {
  it("creates a new thread when toPeer given and no active thread exists", async () => {
    const { a, b } = await seedPeers();
    const broadcaster = vi.fn();
    const app = await buildServer({ db, jwtSecret: SECRET, broadcaster });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { toPeer: b.name, body: "hi bob" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.threadId).toBeTypeOf("string");
      expect(typeof body.threadShortId).toBe("number");
      // seq is a global BIGSERIAL; only its monotonicity per thread matters
      expect(body.seq).toBeGreaterThan(0);

      // Broadcaster fires after handler returns; give it a tick
      await new Promise((r) => setTimeout(r, 20));
      expect(broadcaster).toHaveBeenCalledOnce();
      const [envelope, recipients] = broadcaster.mock.calls[0] as [
        MessageEnvelope,
        string[],
      ];
      expect(envelope.message.body).toBe("hi bob");
      expect(typeof envelope.threadShortId).toBe("number");
      expect(recipients).toEqual([b.id]);

      expect(envelope.thread).toEqual({
        id: expect.any(String),
        shortId: expect.any(Number),
        title: null,
        participants: expect.arrayContaining([a.id, b.id]),
      });
      expect(
        (envelope.peers ?? []).map((p: { id: string }) => p.id).sort(),
      ).toEqual([a.id, b.id].sort());
      expect(
        (envelope.peers ?? []).find((p: { id: string }) => p.id === a.id),
      ).toMatchObject({ name: a.name });
    } finally {
      await app.close();
    }
  });

  it("reuses recent active thread between same two peers", async () => {
    const { a, b } = await seedPeers();
    const t = await createThread(db, { participants: [a.id, b.id] });
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { toPeer: b.name, body: "follow-up" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().threadId).toBe(t.id);
    } finally {
      await app.close();
    }
  });

  it("forceNew creates a separate thread even with active one", async () => {
    const { a, b } = await seedPeers();
    const existing = await createThread(db, { participants: [a.id, b.id] });
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { toPeer: b.name, body: "new topic", forceNew: true },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().threadId).not.toBe(existing.id);
    } finally {
      await app.close();
    }
  });

  it("threadId path: 403 when not a participant", async () => {
    const { a, b } = await seedPeers();
    const c = await createPeer(db, {
      name: `${TEST_PREFIX}carol`,
      email: `${TEST_PREFIX}carol@x.com`,
    });
    const t = await createThread(db, { participants: [a.id, b.id] });
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(c.id),
        payload: { threadId: t.id, body: "intruder" },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("404 when toPeer name does not exist", async () => {
    const { a } = await seedPeers();
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { toPeer: `${TEST_PREFIX}ghost`, body: "boo" },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("400 when sending to self", async () => {
    const { a } = await seedPeers();
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { toPeer: a.name, body: "self" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("400 when neither threadId nor toPeer is provided", async () => {
    const { a } = await seedPeers();
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        headers: authHeader(a.id),
        payload: { body: "orphan" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("401 when no JWT", async () => {
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/messages",
        payload: { toPeer: "x", body: "y" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
