import type { Queryable } from "../db.js";
import type { Message } from "../types.js";

interface MessageRow {
  id: string;
  thread_id: string;
  from_peer: string;
  body: string;
  sent_at: Date;
  seq: string | number;
}

function mapRow(r: MessageRow): Message {
  return {
    id: r.id,
    threadId: r.thread_id,
    fromPeer: r.from_peer,
    body: r.body,
    sentAt: r.sent_at.toISOString(),
    seq: typeof r.seq === "string" ? Number(r.seq) : r.seq,
  };
}

export interface InsertMessageInput {
  threadId: string;
  fromPeer: string;
  body: string;
}

export async function insertMessage(db: Queryable, input: InsertMessageInput): Promise<Message> {
  // Not atomic on its own; caller wraps in db.begin() for strict
  // last_message_at consistency. The UPDATE is idempotent on retry.
  const [row] = await db<MessageRow[]>`
    INSERT INTO messages (thread_id, from_peer, body)
    VALUES (${input.threadId}, ${input.fromPeer}, ${input.body})
    RETURNING id, thread_id, from_peer, body, sent_at, seq
  `;
  await db`UPDATE threads SET last_message_at = ${row.sent_at} WHERE id = ${input.threadId}`;
  return mapRow(row);
}

export async function listMessages(
  db: Queryable,
  threadId: string,
  sinceSeq = 0,
): Promise<Message[]> {
  const rows = await db<MessageRow[]>`
    SELECT id, thread_id, from_peer, body, sent_at, seq
    FROM messages
    WHERE thread_id = ${threadId} AND seq > ${sinceSeq}
    ORDER BY seq ASC
  `;
  return rows.map(mapRow);
}

export interface SearchOptions {
  peer?: string; // peer id; only return messages in threads this peer participates in
  limit?: number;
}

export async function searchMessages(
  db: Queryable,
  query: string,
  opts: SearchOptions = {},
): Promise<Message[]> {
  const limit = opts.limit ?? 50;
  if (opts.peer) {
    const rows = await db<MessageRow[]>`
      SELECT m.id, m.thread_id, m.from_peer, m.body, m.sent_at, m.seq
      FROM messages m
      WHERE m.body_tsv @@ plainto_tsquery('simple', ${query})
        AND EXISTS (
          SELECT 1 FROM thread_participants tp
          WHERE tp.thread_id = m.thread_id AND tp.peer_id = ${opts.peer}
        )
      ORDER BY m.sent_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapRow);
  }
  const rows = await db<MessageRow[]>`
    SELECT id, thread_id, from_peer, body, sent_at, seq
    FROM messages
    WHERE body_tsv @@ plainto_tsquery('simple', ${query})
    ORDER BY sent_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapRow);
}
