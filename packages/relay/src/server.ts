import type { Db } from "@lyy/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { authPlugin } from "./plugins/auth.js";

export interface ServerDeps {
  db: Db;
  jwtSecret: string;
  logger?: boolean;
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

  return app;
}
