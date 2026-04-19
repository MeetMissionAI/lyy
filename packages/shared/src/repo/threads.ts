import type { Queryable } from "../db.js";
import type { Thread } from "../types.js";

interface ThreadRow {
  id: string;
  short_id: string | number;
  title: string | null;
  created_at: Date;
  last_message_at: Date;
}

async function loadParticipants(db: Queryable, threadId: string): Promise<string[]> {
  const rows = await db<{ peer_id: string }[]>`
    SELECT peer_id FROM thread_participants WHERE thread_id = ${threadId}
  `;
  return rows.map((r) => r.peer_id);
}

function mapRow(r: ThreadRow, participants: string[]): Thread {
  return {
    id: r.id,
    shortId: typeof r.short_id === "string" ? Number(r.short_id) : r.short_id,
    title: r.title ?? undefined,
    createdAt: r.created_at.toISOString(),
    lastMessageAt: r.last_message_at.toISOString(),
    participants,
  };
}

export interface CreateThreadInput {
  participants: string[]; // peer ids, must include >= 2
  title?: string;
}

export async function createThread(db: Queryable, input: CreateThreadInput): Promise<Thread> {
  if (input.participants.length < 2) {
    throw new Error("Thread requires at least 2 participants");
  }
  // NB: not atomic on its own. Caller wraps in db.begin() when needed
  // (e.g. pair route, send_to). Standalone use risks orphan thread on
  // crash between the two statements; acceptable for tests.
  const [row] = await db<ThreadRow[]>`
    INSERT INTO threads (title)
    VALUES (${input.title ?? null})
    RETURNING id, short_id, title, created_at, last_message_at
  `;
  for (const pid of input.participants) {
    await db`INSERT INTO thread_participants (thread_id, peer_id) VALUES (${row.id}, ${pid})`;
  }
  return mapRow(row, input.participants);
}

export async function getThreadById(db: Queryable, id: string): Promise<Thread | null> {
  const [row] = await db<ThreadRow[]>`
    SELECT id, short_id, title, created_at, last_message_at
    FROM threads WHERE id = ${id}
  `;
  if (!row) return null;
  return mapRow(row, await loadParticipants(db, row.id));
}

export async function getThreadByShortId(db: Queryable, shortId: number): Promise<Thread | null> {
  const [row] = await db<ThreadRow[]>`
    SELECT id, short_id, title, created_at, last_message_at
    FROM threads WHERE short_id = ${shortId}
  `;
  if (!row) return null;
  return mapRow(row, await loadParticipants(db, row.id));
}

/**
 * Find the most recent thread between exactly two peers whose last message
 * was within `withinHours` hours. Returns null if none. Used for the
 * "default to existing thread" routing in send_to.
 */
export async function findActiveThread(
  db: Queryable,
  peerA: string,
  peerB: string,
  withinHours = 24,
): Promise<Thread | null> {
  const [row] = await db<ThreadRow[]>`
    SELECT t.id, t.short_id, t.title, t.created_at, t.last_message_at
    FROM threads t
    WHERE t.last_message_at > now() - (${withinHours} || ' hours')::interval
      AND EXISTS (SELECT 1 FROM thread_participants WHERE thread_id = t.id AND peer_id = ${peerA})
      AND EXISTS (SELECT 1 FROM thread_participants WHERE thread_id = t.id AND peer_id = ${peerB})
      AND (SELECT count(*) FROM thread_participants WHERE thread_id = t.id) = 2
    ORDER BY t.last_message_at DESC
    LIMIT 1
  `;
  if (!row) return null;
  return mapRow(row, await loadParticipants(db, row.id));
}

export interface ThreadListItem extends Thread {
  archived: boolean;
  unread: number;
}

interface ThreadListRow extends ThreadRow {
  archived: boolean;
  participants: string[];
  unread: string | number;
}

/**
 * List all threads where peerId is a participant. Includes archived flag
 * and per-thread unread count for that peer in a single query (no N+1).
 */
export async function listThreadsForPeer(
  db: Queryable,
  peerId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ThreadListItem[]> {
  const includeArchived = opts.includeArchived ?? false;
  const rows = includeArchived
    ? await db<ThreadListRow[]>`
        SELECT
          t.id, t.short_id, t.title, t.created_at, t.last_message_at,
          ARRAY(SELECT peer_id FROM thread_participants WHERE thread_id = t.id) AS participants,
          EXISTS (SELECT 1 FROM thread_archives WHERE thread_id = t.id AND peer_id = ${peerId}) AS archived,
          (SELECT count(*)::int FROM messages m
             WHERE m.thread_id = t.id
               AND m.from_peer != ${peerId}
               AND NOT EXISTS (SELECT 1 FROM message_reads mr
                                 WHERE mr.message_id = m.id AND mr.peer_id = ${peerId})
          ) AS unread
        FROM threads t
        JOIN thread_participants tp ON tp.thread_id = t.id AND tp.peer_id = ${peerId}
        ORDER BY t.last_message_at DESC
      `
    : await db<ThreadListRow[]>`
        SELECT
          t.id, t.short_id, t.title, t.created_at, t.last_message_at,
          ARRAY(SELECT peer_id FROM thread_participants WHERE thread_id = t.id) AS participants,
          false AS archived,
          (SELECT count(*)::int FROM messages m
             WHERE m.thread_id = t.id
               AND m.from_peer != ${peerId}
               AND NOT EXISTS (SELECT 1 FROM message_reads mr
                                 WHERE mr.message_id = m.id AND mr.peer_id = ${peerId})
          ) AS unread
        FROM threads t
        JOIN thread_participants tp ON tp.thread_id = t.id AND tp.peer_id = ${peerId}
        WHERE NOT EXISTS (SELECT 1 FROM thread_archives WHERE thread_id = t.id AND peer_id = ${peerId})
        ORDER BY t.last_message_at DESC
      `;
  return rows.map((r) => ({
    ...mapRow(r, r.participants),
    archived: r.archived,
    unread: typeof r.unread === "string" ? Number(r.unread) : r.unread,
  }));
}
