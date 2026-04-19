import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const IdentitySchema = z.object({
  peerId: z.uuid(),
  jwt: z.string().min(1),
  relayUrl: z.url(),
});

export type Identity = z.infer<typeof IdentitySchema>;

export const DEFAULT_IDENTITY_PATH = resolve(
  homedir(),
  ".lyy",
  "identity.json",
);

export function loadIdentity(path: string = DEFAULT_IDENTITY_PATH): Identity {
  const raw = readFileSync(path, "utf8");
  const parsed = IdentitySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `Invalid identity at ${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}
