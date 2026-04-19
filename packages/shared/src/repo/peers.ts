import type { Queryable } from "../db.js";
import type { Peer } from "../types.js";

interface PeerRow {
  id: string;
  name: string;
  email: string;
  display_name: string | null;
  created_at: Date;
}

function mapRow(r: PeerRow): Peer {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    displayName: r.display_name ?? undefined,
    createdAt: r.created_at.toISOString(),
  };
}

export interface CreatePeerInput {
  name: string;
  email: string;
  displayName?: string;
}

export async function createPeer(db: Queryable, p: CreatePeerInput): Promise<Peer> {
  const [row] = await db<PeerRow[]>`
    INSERT INTO peers (name, email, display_name)
    VALUES (${p.name}, ${p.email}, ${p.displayName ?? null})
    RETURNING id, name, email, display_name, created_at
  `;
  return mapRow(row);
}

export async function findPeerByName(db: Queryable, name: string): Promise<Peer | null> {
  const [row] = await db<PeerRow[]>`
    SELECT id, name, email, display_name, created_at
    FROM peers WHERE name = ${name} AND disabled = false
  `;
  return row ? mapRow(row) : null;
}

export async function findPeerByEmail(db: Queryable, email: string): Promise<Peer | null> {
  const [row] = await db<PeerRow[]>`
    SELECT id, name, email, display_name, created_at
    FROM peers WHERE email = ${email} AND disabled = false
  `;
  return row ? mapRow(row) : null;
}

export async function listPeers(db: Queryable): Promise<Peer[]> {
  const rows = await db<PeerRow[]>`
    SELECT id, name, email, display_name, created_at
    FROM peers WHERE disabled = false ORDER BY created_at ASC
  `;
  return rows.map(mapRow);
}
