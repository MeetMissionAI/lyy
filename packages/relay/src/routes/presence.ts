import type { FastifyInstance } from "fastify";
import { onlinePeerIds, onlinePeerSessions } from "../socket.js";

/**
 * GET /presence — dumps the current in-memory online set. Auth-gated like
 * the rest of the relay API. Primarily a diagnostic to debug the TUI's
 * in-socket `presence:*` events when they disagree with reality.
 */
export async function presenceRoute(app: FastifyInstance): Promise<void> {
  app.get("/presence", async () => ({
    online: onlinePeerIds(),
    sessions: Object.fromEntries(onlinePeerSessions),
  }));
}
