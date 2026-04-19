import type { Db } from "@lyy/shared";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const SECRET = "test-secret";
let app: Awaited<ReturnType<typeof buildServer>>;

beforeEach(async () => {
  app = await buildServer({
    db: undefined as unknown as Db,
    jwtSecret: SECRET,
  });
});

afterEach(async () => {
  await app.close();
});

describe("auth plugin", () => {
  it("allows /health without token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 on protected route without token", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "missing bearer token" });
  });

  it("returns 401 on invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid token" });
  });

  it("returns 401 on token without peerId", async () => {
    const token = jwt.sign({ foo: "bar" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with valid JWT and exposes peerId on request", async () => {
    const token = jwt.sign({ peerId: "uuid-1" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ peerId: "uuid-1" });
  });

  it("rejects token signed with wrong secret", async () => {
    const token = jwt.sign({ peerId: "uuid-1" }, "different-secret");
    const res = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
