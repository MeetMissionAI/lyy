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

  io.on("connection", (s) => {
    s.emit("connected", { peerId: s.data.peerId as string });
  });

  deps.broadcaster = (envelope: MessageEnvelope, recipients: string[]) => {
    for (const peerId of recipients) {
      io.to(PEER_ROOM(peerId)).emit("message:new", envelope);
    }
  };

  return io;
}
