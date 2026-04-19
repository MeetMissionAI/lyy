import type { Db } from "@lyy/shared";
import Fastify, { type FastifyInstance } from "fastify";

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

  app.get("/health", async () => ({ ok: true }));

  return app;
}
