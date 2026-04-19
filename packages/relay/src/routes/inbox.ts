import {
  archiveThread,
  getThreadById,
  listMessages,
  listThreadsForPeer,
  markRead,
  searchMessages,
  unarchiveThread,
  unreadCountForPeer,
  unreadCountForThread,
} from "@lyy/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";

const ReadsBody = z.object({
  messageIds: z.array(z.uuid()).min(1).max(500),
});

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const MessagesQuery = z.object({
  threadId: z.uuid(),
  sinceSeq: z.coerce.number().int().nonnegative().optional(),
});

export async function inboxRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  // ── Mark messages read ────────────────────────────────────────────────
  app.post("/reads", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = ReadsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid payload", details: parsed.error.issues });
    }
    await markRead(deps.db, parsed.data.messageIds, peerId);
    return reply.code(204).send();
  });

  // ── Archive / unarchive thread (per-peer) ────────────────────────────
  app.post<{ Params: { id: string } }>("/threads/:id/archive", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });

    const thread = await getThreadById(deps.db, req.params.id);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    if (!thread.participants.includes(peerId)) {
      return reply.code(403).send({ error: "not a participant" });
    }
    await archiveThread(deps.db, req.params.id, peerId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/threads/:id/archive", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });
    await unarchiveThread(deps.db, req.params.id, peerId);
    return reply.code(204).send();
  });

  // ── List threads (inbox summary) ─────────────────────────────────────
  app.get("/threads", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });

    const includeArchived = (req.query as { includeArchived?: string })?.includeArchived === "true";
    const threads = await listThreadsForPeer(deps.db, peerId, { includeArchived });
    const unreadCount = await unreadCountForPeer(deps.db, peerId);

    const enriched = await Promise.all(
      threads.map(async (t) => ({
        threadId: t.id,
        shortId: t.shortId,
        title: t.title,
        participants: t.participants,
        lastMessageAt: t.lastMessageAt,
        archived: t.archived,
        unread: await unreadCountForThread(deps.db, t.id, peerId),
      })),
    );

    return reply.send({ unreadCount, threads: enriched });
  });

  // ── Pull thread messages (diff sync) ─────────────────────────────────
  app.get("/messages", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = MessagesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query", details: parsed.error.issues });
    }
    const thread = await getThreadById(deps.db, parsed.data.threadId);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    if (!thread.participants.includes(peerId)) {
      return reply.code(403).send({ error: "not a participant" });
    }
    const messages = await listMessages(deps.db, parsed.data.threadId, parsed.data.sinceSeq);
    return reply.send({ messages });
  });

  // ── Full-text search scoped to caller's threads ──────────────────────
  app.get("/search", async (req, reply) => {
    const peerId = req.peerId;
    if (!peerId) return reply.code(401).send({ error: "unauthenticated" });

    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query", details: parsed.error.issues });
    }
    const hits = await searchMessages(deps.db, parsed.data.q, {
      peer: peerId,
      limit: parsed.data.limit,
    });
    return reply.send({ messages: hits });
  });
}
