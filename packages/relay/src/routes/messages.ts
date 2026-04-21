import {
  type Message,
  type Thread,
  createThread,
  findActiveThread,
  findPeerByName,
  findPeersByIds,
  getThreadById,
  insertMessage,
} from "@lyy/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ServerDeps } from "../server.js";

const PostBody = z
  .object({
    threadId: z.uuid().optional(),
    toPeer: z.string().min(1).optional(),
    body: z.string().min(1).max(10_000),
    forceNew: z.boolean().optional(),
  })
  .refine((v) => v.threadId || v.toPeer, {
    message: "Provide either threadId or toPeer",
  });

type TxResult =
  | { error: string; status: number }
  | { thread: Thread; message: Message; recipients: string[] };

export async function messagesRoute(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  app.post("/messages", async (req, reply) => {
    const peerId = req.peerId;

    const parsed = PostBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid payload", details: parsed.error.issues });
    }
    const input = parsed.data;

    try {
      const result = await deps.db.begin<TxResult>(async (tx) => {
        let thread: Thread | null;

        if (input.threadId) {
          thread = await getThreadById(tx, input.threadId);
          if (!thread) return { error: "thread not found", status: 404 };
          if (!thread.participants.includes(peerId)) {
            return { error: "not a participant", status: 403 };
          }
        } else {
          const otherName = input.toPeer as string;
          const other = await findPeerByName(tx, otherName);
          if (!other) return { error: "peer not found", status: 404 };
          if (other.id === peerId) {
            return { error: "cannot send to self", status: 400 };
          }

          thread = input.forceNew
            ? null
            : await findActiveThread(tx, peerId, other.id, 24);
          if (!thread) {
            thread = await createThread(tx, {
              participants: [peerId, other.id],
            });
          }
        }

        const message = await insertMessage(tx, {
          threadId: thread.id,
          fromPeer: peerId,
          body: input.body,
        });

        const recipients = thread.participants.filter((p) => p !== peerId);
        return { thread, message, recipients };
      });

      if ("error" in result) {
        return reply.code(result.status).send({ error: result.error });
      }

      if (deps.broadcaster) {
        // Enrich envelope with thread + peer metadata so receivers can upsert their
        // local state cache for unknown threads (avoid a separate /threads round-trip).
        const broadcast = deps.broadcaster;
        const broadcastPromise = (async () => {
          const peers = await findPeersByIds(
            deps.db,
            result.thread.participants,
          );
          return broadcast(
            {
              message: result.message,
              threadShortId: result.thread.shortId,
              thread: {
                id: result.thread.id,
                shortId: result.thread.shortId,
                title: result.thread.title ?? null,
                participants: result.thread.participants,
              },
              peers: peers.map((p) => ({
                id: p.id,
                name: p.name,
                ...(p.displayName ? { displayName: p.displayName } : {}),
              })),
            },
            result.recipients,
          );
        })();
        broadcastPromise.catch((err) =>
          req.log.error({ err }, "broadcaster failed"),
        );
      }

      return reply.code(201).send({
        messageId: result.message.id,
        threadId: result.thread.id,
        threadShortId: result.thread.shortId,
        seq: result.message.seq,
        sentAt: result.message.sentAt,
      });
    } catch (err) {
      req.log.error({ err }, "POST /messages failed");
      return reply.code(500).send({ error: "internal error" });
    }
  });
}
