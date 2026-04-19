import { randomBytes } from "node:crypto";
import { createDb } from "@lyy/shared";

export interface InviteOptions {
  email: string;
  days?: number;
  /** Optional explicit code; auto-generated if omitted. */
  code?: string;
  /** DB URL override; falls back to DATABASE_URL env. */
  dbUrl?: string;
  /** Relay URL printed in the join command (env: LYY_RELAY_URL). */
  relayUrl?: string;
}

const DEFAULT_DAYS = 7;
const DEFAULT_RELAY = "https://lyy-relay.uneeland.com";

export async function runAdminInvite(opts: InviteOptions): Promise<void> {
  const dbUrl = opts.dbUrl ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL required (set in env or pass --db-url)");
  }
  if (!opts.email.includes("@")) {
    throw new Error(`'${opts.email}' is not a valid email`);
  }

  const days = opts.days ?? DEFAULT_DAYS;
  if (days <= 0 || days > 90) {
    throw new Error("--days must be between 1 and 90");
  }

  const code = opts.code ?? generateCode();
  const relayUrl = opts.relayUrl ?? process.env.LYY_RELAY_URL ?? DEFAULT_RELAY;

  const db = createDb(dbUrl);
  try {
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await db`
      INSERT INTO invites (code, for_email, expires_at)
      VALUES (${code}, ${opts.email.toLowerCase()}, ${expiresAt})
    `;

    console.log("✓ invite created");
    console.log(`  code:    ${code}`);
    console.log(`  email:   ${opts.email}`);
    console.log(
      `  expires: ${expiresAt.toISOString().slice(0, 10)} (${days} days)`,
    );
    console.log("");
    console.log(`Share with ${opts.email}:`);
    console.log(`  lyy init --invite=${code} --relay-url=${relayUrl}`);
  } finally {
    await db.end();
  }
}

export function generateCode(): string {
  return `lyy-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`;
}
