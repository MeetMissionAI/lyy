import { type Db, createDb } from "@lyy/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const url = process.env.DATABASE_URL;
const skip = !url;
const db: Db = url ? createDb(url) : (null as never);

const SECRET = "test-secret";
const TEST_PREFIX = "lyytest-pair-";

async function cleanup() {
  await db`DELETE FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}`;
  await db`DELETE FROM invites WHERE code LIKE ${`${TEST_PREFIX}%`}`;
}

async function seedInvite(opts: {
  code: string;
  email: string;
  expiresInMs?: number;
}) {
  const expires = new Date(Date.now() + (opts.expiresInMs ?? 60_000));
  await db`
    INSERT INTO invites (code, for_email, expires_at)
    VALUES (${opts.code}, ${opts.email}, ${expires})
  `;
}

if (!skip) {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await db.end();
  });
}

describe.skipIf(skip)("POST /pair", () => {
  it("issues JWT for a fresh valid invite", async () => {
    const code = `${TEST_PREFIX}code-1`;
    const email = `${TEST_PREFIX}leo@x.com`;
    await seedInvite({ code, email });

    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/pair",
        payload: { code, name: `${TEST_PREFIX}leo`, email },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.peerId).toBeTypeOf("string");
      expect(body.jwt).toBeTypeOf("string");

      // Invite should now be consumed
      const [invite] = await db<{ consumed_at: Date | null }[]>`
        SELECT consumed_at FROM invites WHERE code = ${code}
      `;
      expect(invite.consumed_at).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("returns 410 on already-consumed invite", async () => {
    const code = `${TEST_PREFIX}code-2`;
    const email = `${TEST_PREFIX}sara@x.com`;
    await seedInvite({ code, email });

    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      // First consumption succeeds
      const r1 = await app.inject({
        method: "POST",
        url: "/pair",
        payload: { code, name: `${TEST_PREFIX}sara`, email },
      });
      expect(r1.statusCode).toBe(201);

      // Second attempt should 410
      const r2 = await app.inject({
        method: "POST",
        url: "/pair",
        payload: {
          code,
          name: `${TEST_PREFIX}sara2`,
          email: `${TEST_PREFIX}sara2@x.com`,
        },
      });
      expect(r2.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });

  it("returns 410 on expired invite", async () => {
    const code = `${TEST_PREFIX}code-3`;
    const email = `${TEST_PREFIX}old@x.com`;
    await seedInvite({ code, email, expiresInMs: -10_000 });

    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/pair",
        payload: { code, name: `${TEST_PREFIX}old`, email },
      });
      expect(res.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });

  it("returns 410 on email mismatch", async () => {
    const code = `${TEST_PREFIX}code-4`;
    await seedInvite({ code, email: `${TEST_PREFIX}alice@x.com` });

    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/pair",
        payload: {
          code,
          name: `${TEST_PREFIX}alice`,
          email: `${TEST_PREFIX}wrong@x.com`,
        },
      });
      expect(res.statusCode).toBe(410);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on invalid payload (missing code)", async () => {
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/pair",
        payload: { name: "x", email: "x@x.com" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on invalid email", async () => {
    const app = await buildServer({ db, jwtSecret: SECRET });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/pair",
        payload: { code: "x", name: "x", email: "not-an-email" },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
