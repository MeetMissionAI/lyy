import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./db.js";

const url = process.env.DATABASE_URL;
const skip = !url || !!process.env.LYY_SKIP_DB;
const db = url ? createDb(url) : (null as never);

afterAll(async () => {
  if (!skip) await db.end();
});

describe.skipIf(skip)("db", () => {
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
