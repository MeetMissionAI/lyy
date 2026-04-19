import { createPeer, findPeerByEmail } from "@lyy/shared";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { ServerDeps } from "../server.js";

const PairBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1).max(64),
  email: z.email(),
  displayName: z.string().max(128).optional(),
});

interface InviteRow {
  code: string;
  for_email: string;
  expires_at: Date;
  consumed_at: Date | null;
}

export async function pairRoute(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.post("/pair", async (req, reply) => {
    const parsed = PairBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid payload", details: parsed.error.issues });
    }
    const { code, name, email, displayName } = parsed.data;

    // Atomic invite consumption + peer creation
    try {
      const result = await deps.db.begin(async (tx) => {
        const [invite] = await tx<InviteRow[]>`
          SELECT code, for_email, expires_at, consumed_at
          FROM invites
          WHERE code = ${code}
          FOR UPDATE
        `;
        if (!invite) return { error: "invite not found" as const };
        if (invite.consumed_at) return { error: "invite already consumed" as const };
        if (invite.expires_at <= new Date()) return { error: "invite expired" as const };
        if (invite.for_email.toLowerCase() !== email.toLowerCase()) {
          return { error: "invite email mismatch" as const };
        }

        // Reject if peer with same email already exists
        const existing = await findPeerByEmail(tx, email);
        if (existing) return { error: "peer already exists for this email" as const };

        const peer = await createPeer(tx, { name, email, displayName });
        await tx`UPDATE invites SET consumed_at = now() WHERE code = ${code}`;
        return { peer };
      });

      if ("error" in result) {
        return reply.code(410).send({ error: result.error });
      }

      const token = jwt.sign({ peerId: result.peer.id }, deps.jwtSecret);
      return reply.code(201).send({ peerId: result.peer.id, jwt: token });
    } catch (err) {
      req.log.error({ err }, "pair endpoint failed");
      return reply.code(500).send({ error: "internal error" });
    }
  });
}
