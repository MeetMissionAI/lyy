import {
  type Db,
  type Peer,
  createDb,
  createPeer,
  createThread,
  insertMessage,
} from "@lyy/shared";
import jwt from "jsonwebtoken";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db: Db = url ? createDb(url) : (null as never);

const SECRET = "test-secret";
const TEST_PREFIX = "lyytest-inbox-";

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

interface Scenario {
  alice: Peer;
  bob: Peer;
  threadId: string;
  shortId: number;
  msgIds: string[];
}

async function seed(): Promise<Scenario> {
  const alice = await createPeer(db, {
    name: `${TEST_PREFIX}alice`,
    email: `${TEST_PREFIX}alice@x.com`,
  });
  const bob = await createPeer(db, {
    name: `${TEST_PREFIX}bob`,
    email: `${TEST_PREFIX}bob@x.com`,
  });
  const t = await createThread(db, {
    participants: [alice.id, bob.id],
    title: "test",
  });
  const m1 = await insertMessage(db, {
    threadId: t.id,
    fromPeer: alice.id,
    body: "hello bob lottie",
  });
  const m2 = await insertMessage(db, {
    threadId: t.id,
    fromPeer: alice.id,
    body: "follow up",
  });
  return {
    alice,
    bob,
    threadId: t.id,
    shortId: t.shortId,
    msgIds: [m1.id, m2.id],
  };
}

describe.skipIf(skip)("inbox routes", () => {
  describe("POST /reads", () => {
    it("marks messages as read for the caller", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/reads",
          headers: authHeader(s.bob.id),
          payload: { messageIds: s.msgIds },
        });
        expect(res.statusCode).toBe(204);

        const tres = await app.inject({
          method: "GET",
          url: "/threads",
          headers: authHeader(s.bob.id),
        });
        expect(tres.json().unreadCount).toBe(0);
      } finally {
        await app.close();
      }
    });

    it("400 on empty messageIds", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "POST",
          url: "/reads",
          headers: authHeader(s.bob.id),
          payload: { messageIds: [] },
        });
        expect(res.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe("POST /threads/:id/archive", () => {
    it("archives for the caller only, returns 204", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "POST",
          url: `/threads/${s.threadId}/archive`,
          headers: authHeader(s.bob.id),
        });
        expect(res.statusCode).toBe(204);

        // Bob's inbox no longer shows it (default excludes archived)
        const list = await app.inject({
          method: "GET",
          url: "/threads",
          headers: authHeader(s.bob.id),
        });
        expect(
          list
            .json()
            .threads.find(
              (t: { threadId: string }) => t.threadId === s.threadId,
            ),
        ).toBeUndefined();

        // Alice still sees it
        const aliceList = await app.inject({
          method: "GET",
          url: "/threads",
          headers: authHeader(s.alice.id),
        });
        expect(
          aliceList
            .json()
            .threads.find(
              (t: { threadId: string }) => t.threadId === s.threadId,
            ),
        ).toBeDefined();
      } finally {
        await app.close();
      }
    });

    it("403 when caller is not a participant", async () => {
      const s = await seed();
      const c = await createPeer(db, {
        name: `${TEST_PREFIX}carol`,
        email: `${TEST_PREFIX}carol@x.com`,
      });
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "POST",
          url: `/threads/${s.threadId}/archive`,
          headers: authHeader(c.id),
        });
        expect(res.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });
  });

  describe("DELETE /threads/:id/archive (unarchive)", () => {
    it("removes archive for the caller", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        await app.inject({
          method: "POST",
          url: `/threads/${s.threadId}/archive`,
          headers: authHeader(s.bob.id),
        });
        const res = await app.inject({
          method: "DELETE",
          url: `/threads/${s.threadId}/archive`,
          headers: authHeader(s.bob.id),
        });
        expect(res.statusCode).toBe(204);

        const list = await app.inject({
          method: "GET",
          url: "/threads",
          headers: authHeader(s.bob.id),
        });
        expect(
          list
            .json()
            .threads.find(
              (t: { threadId: string }) => t.threadId === s.threadId,
            ),
        ).toBeDefined();
      } finally {
        await app.close();
      }
    });
  });

  describe("GET /threads", () => {
    it("returns unreadCount + threads with per-thread unread", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "GET",
          url: "/threads",
          headers: authHeader(s.bob.id),
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.unreadCount).toBe(2);
        const t = body.threads.find(
          (x: { threadId: string }) => x.threadId === s.threadId,
        );
        expect(t.shortId).toBe(s.shortId);
        expect(t.unread).toBe(2);
        expect(t.archived).toBe(false);
      } finally {
        await app.close();
      }
    });

    it("includeArchived=true shows archived threads", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        await app.inject({
          method: "POST",
          url: `/threads/${s.threadId}/archive`,
          headers: authHeader(s.bob.id),
        });
        const res = await app.inject({
          method: "GET",
          url: "/threads?includeArchived=true",
          headers: authHeader(s.bob.id),
        });
        const t = res
          .json()
          .threads.find((x: { threadId: string }) => x.threadId === s.threadId);
        expect(t).toBeDefined();
        expect(t.archived).toBe(true);
      } finally {
        await app.close();
      }
    });
  });

  describe("GET /messages", () => {
    it("returns thread messages in seq order, filtered by sinceSeq", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "GET",
          url: `/messages?threadId=${s.threadId}`,
          headers: authHeader(s.bob.id),
        });
        expect(res.statusCode).toBe(200);
        const msgs: Array<{ body: string; seq: number }> = res.json().messages;
        expect(msgs.length).toBe(2);
        expect(msgs[0].seq).toBeLessThan(msgs[1].seq);

        const since = await app.inject({
          method: "GET",
          url: `/messages?threadId=${s.threadId}&sinceSeq=${msgs[0].seq}`,
          headers: authHeader(s.bob.id),
        });
        expect(since.json().messages.length).toBe(1);
      } finally {
        await app.close();
      }
    });

    it("403 when caller is not a participant", async () => {
      const s = await seed();
      const c = await createPeer(db, {
        name: `${TEST_PREFIX}carol2`,
        email: `${TEST_PREFIX}carol2@x.com`,
      });
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "GET",
          url: `/messages?threadId=${s.threadId}`,
          headers: authHeader(c.id),
        });
        expect(res.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });
  });

  describe("GET /search", () => {
    it("finds messages by FTS keyword scoped to caller's threads", async () => {
      const s = await seed();
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "GET",
          url: "/search?q=lottie",
          headers: authHeader(s.bob.id),
        });
        expect(res.statusCode).toBe(200);
        const msgs = res.json().messages;
        expect(
          msgs.some((m: { body: string }) => m.body.includes("lottie")),
        ).toBe(true);
      } finally {
        await app.close();
      }
    });

    it("does not return messages from threads caller is not in", async () => {
      const s = await seed();
      const c = await createPeer(db, {
        name: `${TEST_PREFIX}carol3`,
        email: `${TEST_PREFIX}carol3@x.com`,
      });
      const app = await buildServer({ db, jwtSecret: SECRET });
      try {
        const res = await app.inject({
          method: "GET",
          url: "/search?q=lottie",
          headers: authHeader(c.id),
        });
        expect(res.json().messages.length).toBe(0);
      } finally {
        await app.close();
      }
    });
  });
});
