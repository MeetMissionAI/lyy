import {
  archiveThread,
  getThreadById,
  listMessages,
  listThreadsForPeer,
  markRead,
  searchMessages,
  unarchiveThread,
  unreadCountForPeer,
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
  app.post("/reads", async (req, reply) => {
    const parsed = ReadsBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid payload", details: parsed.error.issues });
    }
    await markRead(deps.db, parsed.data.messageIds, req.peerId);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/threads/:id/archive", async (req, reply) => {
    const thread = await getThreadById(deps.db, req.params.id);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    if (!thread.participants.includes(req.peerId)) {
      return reply.code(403).send({ error: "not a participant" });
    }
    await archiveThread(deps.db, req.params.id, req.peerId);
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>("/threads/:id/archive", async (req, reply) => {
    await unarchiveThread(deps.db, req.params.id, req.peerId);
    return reply.code(204).send();
  });

  app.get("/threads", async (req, reply) => {
    const includeArchived = (req.query as { includeArchived?: string })?.includeArchived === "true";
    const [threads, unreadCount] = await Promise.all([
      listThreadsForPeer(deps.db, req.peerId, { includeArchived }),
      unreadCountForPeer(deps.db, req.peerId),
    ]);

    const enriched = threads.map((t) => ({
      threadId: t.id,
      shortId: t.shortId,
      title: t.title,
      participants: t.participants,
      lastMessageAt: t.lastMessageAt,
      archived: t.archived,
      unread: t.unread,
    }));

    return reply.send({ unreadCount, threads: enriched });
  });

  app.get("/messages", async (req, reply) => {
    const parsed = MessagesQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query", details: parsed.error.issues });
    }
    const thread = await getThreadById(deps.db, parsed.data.threadId);
    if (!thread) return reply.code(404).send({ error: "thread not found" });
    if (!thread.participants.includes(req.peerId)) {
      return reply.code(403).send({ error: "not a participant" });
    }
    const messages = await listMessages(deps.db, parsed.data.threadId, parsed.data.sinceSeq);
    return reply.send({ messages });
  });

  app.get("/search", async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid query", details: parsed.error.issues });
    }
    const hits = await searchMessages(deps.db, parsed.data.q, {
      peer: req.peerId,
      limit: parsed.data.limit,
    });
    return reply.send({ messages: hits });
  });
}
