import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./db.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set; check .env at monorepo root");

const db = createDb(url);

afterAll(async () => {
  await db.end();
});

describe("db", () => {
  it("connects and runs SELECT 1", async () => {
    const [row] = await db<[{ one: number }]>`SELECT 1 AS one`;
    expect(row.one).toBe(1);
  });

  it("can see the peers table from migration 0001", async () => {
    const [row] = await db<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'peers'
      ) AS exists
    `;
    expect(row.exists).toBe(true);
  });
});
