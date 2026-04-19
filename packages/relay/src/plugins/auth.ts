import fp from "fastify-plugin";
import jwt from "jsonwebtoken";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Guaranteed non-empty inside protected route handlers — the auth
     * plugin's onRequest hook rejects requests without a valid token
     * before they reach a handler. Empty string outside protected scope.
     */
    peerId: string;
  }
}

export interface AuthOptions {
  secret: string;
  /** Routes (URL prefixes) that bypass auth (e.g. /health, /pair) */
  publicPaths?: string[];
}

const DEFAULT_PUBLIC = ["/health", "/pair"];

export const authPlugin = fp<AuthOptions>(
  async (app, opts) => {
    const publicPaths = opts.publicPaths ?? DEFAULT_PUBLIC;

    app.decorateRequest("peerId", "");

    app.addHook("onRequest", async (req, reply) => {
      if (publicPaths.some((p) => req.url === p || req.url.startsWith(`${p}?`))) {
        return;
      }
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "missing bearer token" });
      }
      try {
        const payload = jwt.verify(header.slice(7), opts.secret) as { peerId?: string };
        if (!payload.peerId) {
          return reply.code(401).send({ error: "token missing peerId" });
        }
        req.peerId = payload.peerId;
      } catch {
        return reply.code(401).send({ error: "invalid token" });
      }
    });
  },
  { name: "auth", fastify: "5.x" },
);
