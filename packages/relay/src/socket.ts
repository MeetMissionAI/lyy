import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server as IOServer } from "socket.io";
import type { MessageEnvelope, ServerDeps } from "./server.js";

export const PEER_ROOM = (peerId: string) => `peer:${peerId}`;

/**
 * Attach Socket.IO to a Fastify HTTP server. Mutates deps.broadcaster
 * so that POST /messages pushes "message:new" events to recipients'
 * peer rooms. Returns the IOServer for lifecycle control (close).
 */
export function attachSocket(
  httpServer: HttpServer,
  deps: ServerDeps,
): IOServer {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("missing token"));
    try {
      const payload = jwt.verify(token, deps.jwtSecret) as { peerId?: string };
      if (!payload.peerId) return next(new Error("token missing peerId"));
      socket.data.peerId = payload.peerId;
      socket.join(PEER_ROOM(payload.peerId));
      next();
    } catch {
      next(new Error("invalid token"));
    }
  });

  // Presence: per-peer active-socket count. A peer with 2 open sessions
  // counts once. On connect: increment (broadcast if first); on disconnect:
  // decrement (broadcast if last). Newly-connected sockets also receive the
  // full online snapshot so they can render state before any deltas arrive.
  const sessionCounts = new Map<string, number>();
  const onlinePeers = () => [...sessionCounts.keys()];

  io.on("connection", (s) => {
    const peerId = s.data.peerId as string;
    s.emit("connected", { peerId });
    const prev = sessionCounts.get(peerId) ?? 0;
    sessionCounts.set(peerId, prev + 1);
    s.emit("presence:snapshot", { online: onlinePeers() });
    if (prev === 0) {
      s.broadcast.emit("presence:change", { peerId, online: true });
    }
    s.on("disconnect", () => {
      const cur = sessionCounts.get(peerId) ?? 1;
      if (cur <= 1) {
        sessionCounts.delete(peerId);
        io.emit("presence:change", { peerId, online: false });
      } else {
        sessionCounts.set(peerId, cur - 1);
      }
    });
  });

  deps.broadcaster = (envelope: MessageEnvelope, recipients: string[]) => {
    for (const peerId of recipients) {
      io.to(PEER_ROOM(peerId)).emit("message:new", envelope);
    }
  };

  return io;
}
