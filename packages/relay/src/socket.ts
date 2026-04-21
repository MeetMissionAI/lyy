import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server as IOServer } from "socket.io";
import type { MessageEnvelope, ServerDeps } from "./server.js";

export const PEER_ROOM = (peerId: string) => `peer:${peerId}`;

// Exported so the HTTP layer can expose a /presence route and tests can
// inspect the live set. Populated only after attachSocket runs.
export const onlinePeerSessions = new Map<string, number>();
export const onlinePeerIds = (): string[] => [...onlinePeerSessions.keys()];

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
  io.on("connection", (s) => {
    const peerId = s.data.peerId as string;
    s.emit("connected", { peerId });
    const prev = onlinePeerSessions.get(peerId) ?? 0;
    onlinePeerSessions.set(peerId, prev + 1);
    console.log(
      `[presence] connect peer=${peerId} sid=${s.id} sessions=${prev + 1} total_online=${onlinePeerSessions.size}`,
    );
    s.emit("presence:snapshot", { online: onlinePeerIds() });
    if (prev === 0) {
      s.broadcast.emit("presence:change", { peerId, online: true });
    }
    s.on("disconnect", (reason) => {
      const cur = onlinePeerSessions.get(peerId) ?? 1;
      if (cur <= 1) {
        onlinePeerSessions.delete(peerId);
        io.emit("presence:change", { peerId, online: false });
      } else {
        onlinePeerSessions.set(peerId, cur - 1);
      }
      console.log(
        `[presence] disconnect peer=${peerId} sid=${s.id} reason=${reason} sessions=${Math.max(cur - 1, 0)} total_online=${onlinePeerSessions.size}`,
      );
    });
  });

  deps.broadcaster = (envelope: MessageEnvelope, recipients: string[]) => {
    for (const peerId of recipients) {
      io.to(PEER_ROOM(peerId)).emit("message:new", envelope);
    }
  };

  return io;
}
