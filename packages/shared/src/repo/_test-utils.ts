import type { Queryable } from "../db.js";

export const TEST_PREFIX = "lyytest-";

/**
 * Wipe everything created by integration tests. Order matters because
 * messages.from_peer is RESTRICT (no CASCADE).
 */
export async function cleanupTestData(db: Queryable): Promise<void> {
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
