import type { Db, Message } from "@lyy/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "./plugins/auth.js";
import { inboxRoutes } from "./routes/inbox.js";
import { messagesRoute } from "./routes/messages.js";
import { pairRoute } from "./routes/pair.js";
import { peersRoute } from "./routes/peers.js";

// NOTE: keep in sync with packages/daemon/src/router.ts EnvelopePeer/Thread/MessageEnvelope
export interface EnvelopePeer {
  id: string;
  name: string;
  displayName?: string;
}

export interface EnvelopeThread {
  id: string;
  shortId: number;
  title: string | null;
  participants: string[];
}

/** Wire-format payload pushed to recipients on `message:new`. */
export interface MessageEnvelope {
  message: Message;
  threadShortId: number; // backward compat — keep
  thread?: EnvelopeThread;
  peers?: EnvelopePeer[];
}

/** Notifier called after a message is persisted; Socket.IO wiring uses it. */
export type MessageBroadcaster = (
  envelope: MessageEnvelope,
  recipientPeerIds: string[],
) => void | Promise<void>;

export interface ServerDeps {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
  /** Called after each successful POST /messages. Default: no-op. */
  broadcaster?: MessageBroadcaster;
}

/**
 * Build the relay HTTP server. Routes are registered here; Socket.IO
 * is attached separately via attachSocket().
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false });

  await app.register(authPlugin, { secret: deps.jwtSecret });

  app.get("/health", async () => ({ ok: true }));

  app.get("/me", async (req) => ({ peerId: req.peerId }));

  await pairRoute(app, deps);
  await messagesRoute(app, deps);
  await inboxRoutes(app, deps);
  await peersRoute(app, deps);

  return app;
}
