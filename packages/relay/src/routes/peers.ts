import { listPeers } from "@lyy/shared";
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../server.js";

export async function peersRoute(
  app: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  app.get("/peers", async (_req, reply) => {
    const peers = await listPeers(deps.db);
    return reply.send({ peers });
  });
}
