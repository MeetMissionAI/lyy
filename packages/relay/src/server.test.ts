import type { Db } from "@lyy/shared";
import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

describe("relay server", () => {
  it("responds to GET /health", async () => {
    const app = await buildServer({
      db: undefined as unknown as Db,
      jwtSecret: "test",
    });
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
