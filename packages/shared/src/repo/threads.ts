import type { Db } from "../db.js";
import type { Thread } from "../types.js";

interface ThreadRow {
  id: string;
  short_id: string | number;
  title: string | null;
  created_at: Date;
  last_message_at: Date;
}

async function loadParticipants(db: Db, threadId: string): Promise<string[]> {
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

export async function createThread(db: Db, input: CreateThreadInput): Promise<Thread> {
  if (input.participants.length < 2) {
    throw new Error("Thread requires at least 2 participants");
  }
  return await db.begin(async (tx) => {
    const [row] = await tx<ThreadRow[]>`
      INSERT INTO threads (title)
      VALUES (${input.title ?? null})
      RETURNING id, short_id, title, created_at, last_message_at
    `;
    for (const pid of input.participants) {
      await tx`INSERT INTO thread_participants (thread_id, peer_id) VALUES (${row.id}, ${pid})`;
    }
    return mapRow(row, input.participants);
  });
}

export async function getThreadById(db: Db, id: string): Promise<Thread | null> {
  const [row] = await db<ThreadRow[]>`
    SELECT id, short_id, title, created_at, last_message_at
    FROM threads WHERE id = ${id}
  `;
  if (!row) return null;
  return mapRow(row, await loadParticipants(db, row.id));
}

export async function getThreadByShortId(db: Db, shortId: number): Promise<Thread | null> {
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
  db: Db,
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
}

/**
 * List all threads where peerId is a participant. archived flag is
 * computed per-peer (against thread_archives).
 */
export async function listThreadsForPeer(
  db: Db,
  peerId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ThreadListItem[]> {
  const includeArchived = opts.includeArchived ?? false;
  const rows = includeArchived
    ? await db<(ThreadRow & { archived: boolean })[]>`
        SELECT t.id, t.short_id, t.title, t.created_at, t.last_message_at,
               EXISTS (SELECT 1 FROM thread_archives WHERE thread_id = t.id AND peer_id = ${peerId}) AS archived
        FROM threads t
        JOIN thread_participants tp ON tp.thread_id = t.id
        WHERE tp.peer_id = ${peerId}
        ORDER BY t.last_message_at DESC
      `
    : await db<(ThreadRow & { archived: boolean })[]>`
        SELECT t.id, t.short_id, t.title, t.created_at, t.last_message_at,
               false AS archived
        FROM threads t
        JOIN thread_participants tp ON tp.thread_id = t.id
        WHERE tp.peer_id = ${peerId}
          AND NOT EXISTS (SELECT 1 FROM thread_archives WHERE thread_id = t.id AND peer_id = ${peerId})
        ORDER BY t.last_message_at DESC
      `;
  const out: ThreadListItem[] = [];
  for (const r of rows) {
    const participants = await loadParticipants(db, r.id);
    out.push({ ...mapRow(r, participants), archived: r.archived });
  }
  return out;
}
