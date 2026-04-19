import type { Db } from "../db.js";

export async function archiveThread(db: Db, threadId: string, peerId: string): Promise<void> {
  await db`
    INSERT INTO thread_archives (thread_id, peer_id)
    VALUES (${threadId}, ${peerId})
    ON CONFLICT DO NOTHING
  `;
}

export async function unarchiveThread(db: Db, threadId: string, peerId: string): Promise<void> {
  await db`DELETE FROM thread_archives WHERE thread_id = ${threadId} AND peer_id = ${peerId}`;
}

export async function isArchived(db: Db, threadId: string, peerId: string): Promise<boolean> {
  const [row] = await db<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM thread_archives WHERE thread_id = ${threadId} AND peer_id = ${peerId}
    ) AS exists
  `;
  return row.exists;
}
