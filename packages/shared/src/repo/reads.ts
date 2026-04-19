import type { Db } from "../db.js";

/**
 * Mark a set of messages as read for a peer. Idempotent (UPSERT).
 */
export async function markRead(db: Db, messageIds: string[], peerId: string): Promise<void> {
  if (messageIds.length === 0) return;
  await db`
    INSERT INTO message_reads (message_id, peer_id)
    SELECT unnest(${db.array(messageIds)}::uuid[]), ${peerId}
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Mark every message in a thread as read for a peer.
 */
export async function markThreadRead(db: Db, threadId: string, peerId: string): Promise<void> {
  await db`
    INSERT INTO message_reads (message_id, peer_id)
    SELECT id, ${peerId} FROM messages
    WHERE thread_id = ${threadId}
      AND from_peer != ${peerId}
    ON CONFLICT DO NOTHING
  `;
}

/**
 * Count unread messages addressed to peerId across all threads they participate in.
 * "Addressed to" = sent by someone else.
 */
export async function unreadCountForPeer(db: Db, peerId: string): Promise<number> {
  const [row] = await db<{ count: string }[]>`
    SELECT count(*)::text AS count FROM messages m
    WHERE m.from_peer != ${peerId}
      AND EXISTS (
        SELECT 1 FROM thread_participants tp
        WHERE tp.thread_id = m.thread_id AND tp.peer_id = ${peerId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM message_reads mr
        WHERE mr.message_id = m.id AND mr.peer_id = ${peerId}
      )
  `;
  return Number(row.count);
}

/**
 * Per-thread unread count for a specific peer.
 */
export async function unreadCountForThread(
  db: Db,
  threadId: string,
  peerId: string,
): Promise<number> {
  const [row] = await db<{ count: string }[]>`
    SELECT count(*)::text AS count FROM messages m
    WHERE m.thread_id = ${threadId}
      AND m.from_peer != ${peerId}
      AND NOT EXISTS (
        SELECT 1 FROM message_reads mr
        WHERE mr.message_id = m.id AND mr.peer_id = ${peerId}
      )
  `;
  return Number(row.count);
}
