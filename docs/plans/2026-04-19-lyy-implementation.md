# LYY — Link Your Yarn · Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship a dogfoodable v1 of LYY — a peer-to-peer conversation channel between Claude Code sessions — in 2-3 weeks.

**Architecture:** Node/TypeScript monorepo with four packages (relay, daemon, mcp, cli) + Claude Code integration assets. Relay runs in K8s with Supabase Postgres. Each user's Mac runs a daemon + MCP + CLI wrapper. Peer threads open in zellij panes as isolated Claude Code sessions.

**Tech Stack:**
- TypeScript, Node 20 LTS, pnpm workspaces
- Fastify + socket.io (relay HTTP / WS)
- Supabase Postgres + `postgres.js` client
- `@modelcontextprotocol/sdk` for MCP
- `node-pty` for Claude wrapping
- `commander` for CLI
- vitest for tests, biome for lint+format

**Design doc:** [`./2026-04-19-lyy-design.md`](./2026-04-19-lyy-design.md)

---

## Prerequisites (one-time, per dev)

Install on dev Mac:

```bash
brew install node@20 pnpm zellij postgresql@16
npm install -g supabase
# For K8s deploy:
brew install kubectl helm
```

Accounts / access:
- Supabase project created (admin creates, shares URL + service key)
- K8s cluster kubeconfig
- GitHub repo created at `missionai/lyy` (private)

---

## Repository Layout

```
code/lyy/
├── package.json                  # root, pnpm workspaces
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── .github/workflows/ci.yml
├── packages/
│   ├── shared/                   # shared types + utils
│   ├── relay/                    # HTTP + Socket.IO server
│   ├── daemon/                   # local sidecar process
│   ├── mcp/                      # MCP server
│   └── cli/                      # `lyy` CLI wrapper
├── claude-assets/                # settings.json snippets, hooks, slash commands
│   ├── settings.snippet.json
│   ├── hooks/
│   └── commands/
├── migrations/                   # Supabase SQL migrations
├── deploy/
│   └── k8s/                      # manifests
├── docs/
│   └── plans/
├── README.md
└── CLAUDE.md                     # project guidance
```

---

## Phase 0: Scaffolding & Setup (Day 1)

### Task 0.1: Initialize monorepo

**Files:**
- Create: `code/lyy/package.json`
- Create: `code/lyy/pnpm-workspace.yaml`
- Create: `code/lyy/tsconfig.base.json`
- Create: `code/lyy/biome.json`
- Create: `code/lyy/.gitignore`
- Create: `code/lyy/CLAUDE.md`

**Step 1: Create root package.json**

```json
{
  "name": "lyy-monorepo",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
```

**Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true,
    "incremental": true,
    "outDir": "dist"
  }
}
```

**Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "organizeImports": { "enabled": true }
}
```

**Step 5: Create .gitignore**

```
node_modules
dist
*.log
.env
.env.local
.lyy/
```

**Step 6: `git init` + initial commit**

```bash
cd /Users/jianfengliu/Documents/MissionAI/code/lyy
git init -b main
git add .
git commit -m "chore: initialize LYY monorepo"
```

### Task 0.2: Scaffold four packages

Create each package with a thin `package.json` + `tsconfig.json` extending base.

**Files (create all):**
- `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- `packages/relay/package.json`, `packages/relay/tsconfig.json`, `packages/relay/src/index.ts`
- `packages/daemon/package.json`, `packages/daemon/tsconfig.json`, `packages/daemon/src/index.ts`
- `packages/mcp/package.json`, `packages/mcp/tsconfig.json`, `packages/mcp/src/index.ts`
- `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/src/index.ts`, `packages/cli/bin/lyy`

Each package.json pattern (example for relay):

```json
{
  "name": "@lyy/relay",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@lyy/shared": "workspace:*"
  }
}
```

Commit: `chore: scaffold 5 packages`

### Task 0.3: CI workflow

**Files:** `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm test
```

Commit: `ci: add pnpm build/lint/test workflow`

---

## Phase 1: Shared Types + Supabase Schema (Day 2)

### Task 1.1: Shared types

**Files:** `packages/shared/src/types.ts`

**Step 1: Write failing test**

`packages/shared/src/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Peer, Thread, Message } from "./types.js";

describe("shared types", () => {
  it("Peer has required fields", () => {
    const p: Peer = {
      id: "uuid-1",
      name: "leo",
      email: "leo@missionai.com",
      displayName: "Leo",
      createdAt: new Date().toISOString(),
    };
    expect(p.name).toBe("leo");
  });

  it("Message has thread + seq ordering fields", () => {
    const m: Message = {
      id: "uuid-m1",
      threadId: "uuid-t1",
      fromPeer: "uuid-1",
      body: "hello",
      sentAt: new Date().toISOString(),
      seq: 1,
    };
    expect(m.seq).toBe(1);
  });
});
```

**Step 2: Run and verify failure**

```bash
cd packages/shared && pnpm test
```

Expected: FAIL — `types.ts` doesn't exist yet.

**Step 3: Implement types**

`packages/shared/src/types.ts`:

```typescript
export interface Peer {
  id: string;
  name: string;
  email: string;
  displayName?: string;
  createdAt: string;
}

export interface Thread {
  id: string;
  shortId: number; // displayable: #42
  title?: string;
  createdAt: string;
  lastMessageAt: string;
  participants: string[]; // peer ids
}

export interface Message {
  id: string;
  threadId: string;
  fromPeer: string;
  body: string;
  sentAt: string;
  seq: number;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  messageId: string;
  storagePath: string;
  mime: string;
  size: number;
}

export interface InboxSummary {
  unreadCount: number;
  threads: Array<{
    threadId: string;
    shortId: number;
    peerName: string;
    lastBody: string;
    unread: number;
    lastMessageAt: string;
    archived: boolean;
  }>;
}
```

Re-export from `index.ts`.

**Step 4: Test pass**

```bash
pnpm test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add Peer/Thread/Message types"
```

### Task 1.2: Supabase migration

**Files:** `migrations/0001_init.sql`

**Step 1: Write migration SQL**

Full schema from design doc (section 4.2). Key additions for short display IDs:

```sql
CREATE TABLE peers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  disabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  for_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE SEQUENCE thread_short_id_seq;

CREATE TABLE threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id BIGINT UNIQUE DEFAULT nextval('thread_short_id_seq'),
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE thread_participants (
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, peer_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  from_peer UUID REFERENCES peers(id),
  body TEXT NOT NULL,
  body_tsv TSVECTOR,
  sent_at TIMESTAMPTZ DEFAULT now(),
  seq BIGSERIAL
);

CREATE INDEX messages_thread_seq ON messages(thread_id, seq);
CREATE INDEX messages_tsv_idx ON messages USING GIN(body_tsv);

CREATE FUNCTION update_message_tsv() RETURNS trigger AS $$
BEGIN
  NEW.body_tsv := to_tsvector('simple', coalesce(NEW.body, ''));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER messages_tsv_trigger
  BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_message_tsv();

CREATE TABLE message_reads (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, peer_id)
);

CREATE TABLE thread_archives (
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  peer_id UUID REFERENCES peers(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (thread_id, peer_id)
);

CREATE TABLE attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  mime TEXT,
  size BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Step 2: Apply migration**

Via Supabase CLI against the project:

```bash
supabase link --project-ref <ref>
supabase db push migrations/0001_init.sql
```

Expected: migration succeeds, tables visible in Supabase Studio.

**Step 3: Verify schema manually**

```bash
psql $SUPABASE_DB_URL -c "\dt"
```

Should list all 8 tables.

**Step 4: Commit**

```bash
git add migrations
git commit -m "feat(db): initial schema (peers/threads/messages/reads/archives)"
```

### Task 1.3: DB client helper

**Files:** `packages/shared/src/db.ts`, `.test.ts`

**Step 1: Failing test** (integration, requires local or Supabase Postgres)

```typescript
// packages/shared/src/db.test.ts
import { describe, it, expect } from "vitest";
import { createDb } from "./db.js";

describe("db", () => {
  it("connects and runs SELECT 1", async () => {
    const db = createDb(process.env.DATABASE_URL!);
    const [row] = await db`SELECT 1 AS one`;
    expect(row.one).toBe(1);
    await db.end();
  });
});
```

**Step 2: Install deps + impl**

```bash
pnpm -F @lyy/shared add postgres
```

```typescript
// packages/shared/src/db.ts
import postgres from "postgres";
export function createDb(connectionString: string) {
  return postgres(connectionString, { prepare: false });
}
export type Db = ReturnType<typeof createDb>;
```

**Step 3: Run test**

```bash
DATABASE_URL=<local-supabase> pnpm -F @lyy/shared test
```

Expected: PASS.

**Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add postgres db helper"
```

### Task 1.4: Repository layer (peers)

**Files:** `packages/shared/src/repo/peers.ts`, `.test.ts`

TDD cycle:

**Step 1: Test**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createDb } from "../db.js";
import { createPeer, findPeerByName } from "./peers.js";

const db = createDb(process.env.DATABASE_URL!);

describe("peers repo", () => {
  it("creates and finds a peer", async () => {
    const p = await createPeer(db, { name: "test-leo", email: "t-leo@x.com" });
    expect(p.name).toBe("test-leo");
    const f = await findPeerByName(db, "test-leo");
    expect(f?.id).toBe(p.id);
  });
});
```

**Step 2: Implement**

```typescript
// packages/shared/src/repo/peers.ts
import type { Db } from "../db.js";
import type { Peer } from "../types.js";

export async function createPeer(
  db: Db,
  p: { name: string; email: string; displayName?: string }
): Promise<Peer> {
  const [row] = await db`
    INSERT INTO peers (name, email, display_name)
    VALUES (${p.name}, ${p.email}, ${p.displayName ?? null})
    RETURNING id, name, email, display_name, created_at
  `;
  return mapRow(row);
}

export async function findPeerByName(db: Db, name: string) {
  const [row] = await db`SELECT * FROM peers WHERE name = ${name}`;
  return row ? mapRow(row) : null;
}

function mapRow(r: any): Peer {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    displayName: r.display_name,
    createdAt: r.created_at.toISOString(),
  };
}
```

**Step 3: Pass test, commit.**

### Task 1.5: Repos for threads, messages, reads, archives

Same TDD pattern as 1.4 for each. Files:

- `packages/shared/src/repo/threads.ts` — `createThread(participants)`, `findActiveThread(peerA, peerB)`, `listThreadsForPeer(peerId, { includeArchived })`
- `packages/shared/src/repo/messages.ts` — `insertMessage(threadId, fromPeer, body)`, `listMessages(threadId, sinceSeq?)`, `searchMessages(query, peer?)`
- `packages/shared/src/repo/reads.ts` — `markRead(messageIds, peerId)`, `unreadCount(peerId)`
- `packages/shared/src/repo/archives.ts` — `archive(threadId, peerId)`, `unarchive(threadId, peerId)`

Commit one per repo.

---

## Phase 2: Relay Server (Days 3-5)

### Task 2.1: Scaffold Fastify server

**Files:** `packages/relay/src/server.ts`, `.test.ts`

**Step 1: Install deps**

```bash
pnpm -F @lyy/relay add fastify socket.io jsonwebtoken
pnpm -F @lyy/relay add -D @types/jsonwebtoken supertest
```

**Step 2: Failing test**

```typescript
// packages/relay/src/server.test.ts
import { describe, it, expect } from "vitest";
import { buildServer } from "./server.js";

describe("relay server", () => {
  it("responds to GET /health", async () => {
    const app = await buildServer({
      db: undefined as any,
      jwtSecret: "test",
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
```

**Step 3: Implement**

```typescript
// packages/relay/src/server.ts
import Fastify from "fastify";
import type { Db } from "@lyy/shared";

export interface ServerDeps {
  db: Db;
  jwtSecret: string;
}

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  app.get("/health", async () => ({ ok: true }));
  return app;
}
```

**Step 4: Pass, commit.**

### Task 2.2: JWT auth plugin

**Files:** `packages/relay/src/plugins/auth.ts`, `.test.ts`

**Step 1: Test — unauthorized request returns 401**

```typescript
it("returns 401 without JWT on protected route", async () => {
  const app = await buildServer({ db: mockDb, jwtSecret: "test" });
  const res = await app.inject({ method: "GET", url: "/me" });
  expect(res.statusCode).toBe(401);
});

it("returns 200 with valid JWT", async () => {
  const token = jwt.sign({ peerId: "uuid-1" }, "test");
  const res = await app.inject({
    method: "GET",
    url: "/me",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
});
```

**Step 2: Implement `auth` plugin + `/me` route**

```typescript
// packages/relay/src/plugins/auth.ts
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";

declare module "fastify" {
  interface FastifyRequest {
    peerId?: string;
  }
}

export const authPlugin = fp(async (app, opts: { secret: string }) => {
  app.decorateRequest("peerId", undefined);
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url.startsWith("/pair")) return;
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return reply.code(401).send({ error: "no token" });
    try {
      const payload = jwt.verify(h.slice(7), opts.secret) as { peerId: string };
      req.peerId = payload.peerId;
    } catch {
      return reply.code(401).send({ error: "invalid token" });
    }
  });
});
```

Register in `buildServer`. Add `/me` route returning `{ peerId }`.

**Step 3: Pass tests, commit.**

### Task 2.3: POST /pair endpoint (invite consumption)

**Files:** `packages/relay/src/routes/pair.ts`, `.test.ts`

**Step 1: Test**

Using a pre-seeded invite row, POST `/pair { code, name, email }` returns `{ peerId, jwt }`. Consuming same code twice returns 410.

**Step 2: Implement**

```typescript
export const pairRoute = async (app: FastifyInstance, deps: ServerDeps) => {
  app.post("/pair", async (req, reply) => {
    const { code, name, email } = req.body as any;
    const [invite] = await deps.db`
      SELECT * FROM invites WHERE code = ${code} AND consumed_at IS NULL
      AND expires_at > now() FOR UPDATE
    `;
    if (!invite) return reply.code(410).send({ error: "invite expired or used" });
    const peer = await createPeer(deps.db, { name, email });
    await deps.db`UPDATE invites SET consumed_at = now() WHERE code = ${code}`;
    const token = jwt.sign({ peerId: peer.id }, deps.jwtSecret);
    return { peerId: peer.id, jwt: token };
  });
};
```

**Step 3: Pass, commit.**

### Task 2.4: POST /messages endpoint

**Files:** `packages/relay/src/routes/messages.ts`, `.test.ts`

**Step 1: Test**

```typescript
it("inserts a message and returns seq", async () => {
  // seed two peers + a thread
  const res = await app.inject({
    method: "POST",
    url: "/messages",
    headers: authHeaderFor(peerA),
    payload: { threadId, body: "hi" },
  });
  expect(res.statusCode).toBe(201);
  const { id, seq } = res.json();
  expect(typeof id).toBe("string");
  expect(seq).toBe(1);
});

it("rejects sending to a thread you're not a participant of", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/messages",
    headers: authHeaderFor(peerC),
    payload: { threadId, body: "intruder" },
  });
  expect(res.statusCode).toBe(403);
});
```

**Step 2: Implement — check participation, insert, update thread's last_message_at, emit Socket.IO push to other participants.**

Handle "new thread" case: if `threadId` is absent but `toPeer` given, create thread + participants atomically.

**Step 3: Commit.**

### Task 2.5: Socket.IO setup

**Files:** `packages/relay/src/socket.ts`, `.test.ts`

**Step 1: Test — client connects with JWT, receives `connected` ack**

Use `socket.io-client` in-process.

**Step 2: Implement**

```typescript
import { Server as IOServer } from "socket.io";
export function attachSocket(httpServer: HttpServer, deps: ServerDeps) {
  const io = new IOServer(httpServer, { cors: { origin: "*" } });
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    try {
      const { peerId } = jwt.verify(token, deps.jwtSecret) as any;
      socket.data.peerId = peerId;
      socket.join(`peer:${peerId}`);
      next();
    } catch (e) {
      next(new Error("unauthorized"));
    }
  });
  io.on("connection", (s) => s.emit("connected", { peerId: s.data.peerId }));
  return io;
}
```

Wire into `/messages` route to `io.to('peer:<id>').emit('message:new', payload)` for each recipient.

**Step 3: Commit.**

### Task 2.6: Endpoints for reads / archives / threads list / search

One task per endpoint, TDD each.

- `POST /reads { messageIds }` — marks read for `req.peerId`
- `POST /threads/:id/archive` / `DELETE /threads/:id/archive`
- `GET /threads?since=<lastSeq>&includeArchived=false` — returns inbox summary
- `GET /messages?threadId=X&sinceSeq=Y` — pull thread diff
- `GET /search?q=...&peer=...`

Each: test → impl → commit.

### Task 2.7: Containerize relay

**Files:** `packages/relay/Dockerfile`, `deploy/k8s/relay-deployment.yaml`, `deploy/k8s/relay-service.yaml`, `deploy/k8s/relay-ingress.yaml`

**Step 1: Dockerfile**

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/relay packages/relay
RUN pnpm install --frozen-lockfile
RUN pnpm -F @lyy/relay build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "packages/relay/dist/index.js"]
```

**Step 2: K8s manifests**

Deployment (1 replica), Service (ClusterIP), Ingress (wss), Secret (SUPABASE_URL, JWT_SIGNING_KEY, etc.).

**Step 3: Smoke deploy**

```bash
docker build -t ghcr.io/missionai/lyy-relay:0.1.0 -f packages/relay/Dockerfile .
docker push ...
kubectl apply -f deploy/k8s/
kubectl rollout status deploy/lyy-relay
curl https://lyy-relay.missionai.com/health
```

Expected: `{"ok": true}`.

**Step 4: Commit manifests.**

---

## Phase 3: Daemon (Days 6-8)

### Task 3.1: Daemon scaffold + identity loading

**Files:** `packages/daemon/src/index.ts`, `identity.ts`, `.test.ts`

**Step 1: Test — loads `~/.lyy/identity.json` or errors**

```typescript
it("loads identity from path", () => {
  const id = loadIdentity("/tmp/test-identity.json");
  expect(id.peerId).toBeDefined();
});
```

**Step 2: Implement `loadIdentity(path)` with schema validation (use zod).**

**Step 3: Commit.**

### Task 3.2: Relay client (Socket.IO)

**Files:** `packages/daemon/src/relay-client.ts`, `.test.ts`

**Step 1: Test — connects, reconnects on disconnect, queues sends while offline**

Mock relay with a local socket.io server.

**Step 2: Implement**

```typescript
export class RelayClient extends EventEmitter {
  private socket: Socket;
  private outbox: Array<{ event: string; payload: any }> = [];
  constructor(private url: string, private token: string) { super(); }
  connect() {
    this.socket = io(this.url, { auth: { token: this.token }, reconnection: true });
    this.socket.on("connect", () => this.flushOutbox());
    this.socket.on("message:new", (m) => this.emit("message:new", m));
    this.socket.on("message:read", (m) => this.emit("message:read", m));
  }
  send(event: string, payload: any) {
    if (this.socket.connected) this.socket.emit(event, payload);
    else this.outbox.push({ event, payload });
  }
  private flushOutbox() { /* drain queue */ }
}
```

**Step 3: Commit.**

### Task 3.3: Local state writer

**Files:** `packages/daemon/src/state.ts`, `.test.ts`

State model: `{ unreadCount, threads: [{ shortId, peerName, lastBody, unread, lastMessageAt, paneOpen }], lastSeenSeq: {threadId: seq} }`

Write atomically (tmp file + rename).

TDD cycle: test file-level CRUD, then implement.

### Task 3.4: Pane registry (Unix socket IPC server)

**Files:** `packages/daemon/src/pane-registry.ts`, `.test.ts`

**Purpose:** MCP servers running in different panes register "I am pane for thread #N". Daemon consults registry before routing incoming messages.

**Step 1: Test — register, query, unregister**

```typescript
it("tracks pane registrations", async () => {
  const reg = new PaneRegistry("/tmp/test.sock");
  await reg.start();
  const client = new PaneRegistryClient("/tmp/test.sock");
  await client.register({ threadShortId: 12, paneId: "zellij-pane-xyz" });
  expect(await reg.findPane(12)).toBe("zellij-pane-xyz");
});
```

**Step 2: Implement**

- Server: `net.createServer` on `~/.lyy/pane-registry.sock`, simple JSON-line protocol
- Client: connect, send `{op: "register"|"unregister"|"query", ...}`

**Step 3: Commit.**

### Task 3.5: Incoming message routing

**Files:** `packages/daemon/src/router.ts`, `.test.ts`

Logic:
```
on message:new payload:
  if paneRegistry.findPane(payload.thread.shortId):
    injectToPane(paneId, payload)  // via pane-registry IPC
  else:
    state.addUnread(payload)
  persistLastSeq(threadId, payload.seq)
```

TDD: mock registry + state, assert correct branch.

### Task 3.6: Pane injection

**Files:** `packages/daemon/src/pane-injector.ts`

Inject via writing to the MCP IPC socket for that pane — MCP then calls a special hook to prepend to the next assistant turn (we inject as a simulated `<peer-msg>` note).

Mechanics: MCP in the thread pane subscribes to "injected messages for me". When an item arrives, MCP schedules it to be returned as the next tool result or as a system-level notification that the SessionStart-style hook consumes.

**Simpler v1 approach:** instead of injecting mid-turn, daemon appends to a per-pane file `~/.lyy/pane-<id>/inbox.jsonl`. The pane's `UserPromptSubmit` hook reads+clears this file and prepends the content to the user's next prompt. "Soft" injection — at next user turn, Claude sees the peer msg as a system-reminder.

Document this clearly — trade real-time for robustness in v1.

### Task 3.7: MCP IPC server (inside daemon)

**Files:** `packages/daemon/src/mcp-ipc.ts`, `.test.ts`

Handles requests from `lyy-mcp`:
- `send_message({ peerName, body, threadId?, attachFiles? })` → calls relay
- `list_inbox()` → returns from state
- `read_thread(threadId, sinceSeq)` → pulls from relay
- `spawn_thread(threadId)` → spawns zellij pane
- `register_pane(paneId, threadShortId)` → pane registry
- `ack_read(threadId, messageIds)` → relay /reads
- `archive(threadId)` → relay archive

Unix socket at `~/.lyy/mcp.sock`.

TDD each handler.

### Task 3.8: macOS LaunchAgent installer

**Files:** `packages/daemon/src/install-launchagent.ts`, template `packages/daemon/assets/com.missionai.lyy-daemon.plist`

**Step 1: Generate plist at `~/Library/LaunchAgents/com.missionai.lyy-daemon.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "...">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.missionai.lyy-daemon</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/lyy-daemon</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/lyy-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/lyy-daemon.log</string>
</dict>
</plist>
```

**Step 2: `launchctl load -w ~/Library/LaunchAgents/com.missionai.lyy-daemon.plist`**

**Step 3: `launchctl list | grep lyy` → expect line with pid.**

**Step 4: Commit.**

---

## Phase 4: MCP Server (Days 9-10)

### Task 4.1: MCP scaffold with stdio transport

**Files:** `packages/mcp/src/server.ts`, `.test.ts`

**Step 1: Install SDK**

```bash
pnpm -F @lyy/mcp add @modelcontextprotocol/sdk
```

**Step 2: Test — server responds to `initialize` handshake**

**Step 3: Implement**

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export async function runMcp() {
  const server = new Server(
    { name: "lyy-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  // register tools below
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**Step 4: Commit.**

### Task 4.2: Implement each tool

Each tool = separate file + TDD cycle. Tools are thin wrappers around IPC to daemon.

**Files:** `packages/mcp/src/tools/{send_to,list_inbox,read_thread,reply,spawn_thread,archive_thread,search,who_is,attach}.ts`

Pattern (example for `send_to`):

```typescript
export const sendToTool = {
  name: "send_to",
  description: "Send a message to another peer. Continues most recent thread if active within 24h, else creates new.",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string", description: "peer name, e.g. 'leo'" },
      body: { type: "string" },
      new_thread: { type: "boolean", default: false },
      attach_files: { type: "array", items: { type: "string" } }
    },
    required: ["peer", "body"]
  },
  async execute(args, ctx) {
    const result = await ctx.ipc.send_message({
      peerName: args.peer,
      body: args.body,
      forceNew: args.new_thread,
      attachFiles: args.attach_files
    });
    return { threadShortId: result.shortId, messageId: result.id };
  }
};
```

Register all tools in `server.ts` setRequestHandler for `tools/list` and `tools/call`.

TDD each: test + impl + commit.

### Task 4.3: Thread-mode detection

**Files:** `packages/mcp/src/mode.ts`

When spawned with env `LYY_MODE=thread LYY_THREAD_ID=<id>`, MCP:
- Limits allowed tools to `reply`, `attach`, `close`, `list_inbox`, `read_thread`, `archive_thread` (nothing destructive to unrelated threads)
- Passes mode to prompt via a `get_context` tool that the SessionStart hook queries
- Registers pane ID with daemon on startup via `register_pane`

TDD: mode detection test, allowed-tools test.

---

## Phase 5: CLI (Days 11-12)

### Task 5.1: Scaffold commander

**Files:** `packages/cli/src/index.ts`, `packages/cli/bin/lyy`

**Step 1: Install**

```bash
pnpm -F @lyy/cli add commander chalk
```

**Step 2: Structure**

```typescript
// packages/cli/src/index.ts
import { Command } from "commander";
const program = new Command().name("lyy").version("0.1.0");
program.command("init").action(initCmd);
program.command("thread <id>").action(threadCmd);
program.command("doctor").action(doctorCmd);
program.action(defaultCmd); // launch main
program.parseAsync();
```

**Step 3: bin/lyy shebang `#!/usr/bin/env node` → `require("../dist/index.js")`.**

**Step 4: Commit.**

### Task 5.2: `lyy init` — full onboarding

**Files:** `packages/cli/src/commands/init.ts`

**Steps:**

1. Prompt for invite code (or `--invite`)
2. Prompt for name, email
3. POST `/pair` to relay (URL from env or default)
4. Write `~/.lyy/identity.json` with `{ peerId, jwt, relayUrl }` (perms 600)
5. Install LaunchAgent (daemon binary)
6. Merge Claude Code settings:
   - Read `~/.claude/settings.json` (create if missing)
   - Merge statusLine config
   - Merge hooks config
   - Merge MCP server registration (`lyy-mcp` with stdio command)
7. Install slash commands: copy `claude-assets/commands/*.md` to `~/.claude/commands/`
8. Check zellij: if missing, print install instructions
9. Print "done, try `lyy`"

TDD: harder — integration test with a fake HOME dir.

Commit.

### Task 5.3: `lyy` (default) — launch zellij + claude

**Files:** `packages/cli/src/commands/default.ts`

**Logic:**

```typescript
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.ZELLIJ) {
  // already in zellij, just run claude
  spawn("claude", [], { stdio: "inherit" });
} else {
  // bootstrap zellij session "lyy"
  const layoutPath = writeTempLayout(); // KDL layout with main claude pane
  spawn("zellij", ["--session", "lyy", "--new-session-with-layout", layoutPath], {
    stdio: "inherit",
  });
}
```

Where layout template (`packages/cli/assets/layouts/main.kdl`):

```kdl
layout {
  tab name="main" {
    pane command="claude"
  }
}
```

Test: spawn detection via ZELLIJ env; commit.

### Task 5.4: `lyy thread <id>` and `lyy doctor`

- `lyy thread <id>` — opens a pane for given thread (IPC to daemon → `spawn_thread`)
- `lyy doctor` — checks: daemon running? relay reachable? zellij installed? claude on PATH? settings.json has LYY bits?

TDD each; commit.

---

## Phase 6: Claude Code Integration Assets (Days 13-14)

### Task 6.1: statusLine script

**Files:** `claude-assets/hooks/statusline.sh`

```bash
#!/usr/bin/env bash
STATE_FILE="$HOME/.lyy/state.json"
if [[ ! -f "$STATE_FILE" ]]; then exit 0; fi
node -e "
  const s = require('$STATE_FILE');
  if (!s.threads?.length) { process.stdout.write('✓ 0 inbox'); process.exit(0); }
  const unread = s.threads.filter(t => t.unread > 0 && !t.archived);
  if (!unread.length) { process.stdout.write('✓ 0 inbox'); process.exit(0); }
  const active = s.threads.find(t => t.paneOpen);
  const head = unread.slice(0,2).map(t => \`#\${t.shortId} @\${t.peerName}\`).join(' · ');
  const more = unread.length > 2 ? \` +\${unread.length-2} more\` : '';
  const activeStr = active ? \` · 🧵 #\${active.shortId} active\` : '';
  process.stdout.write(\`📬 \${head}\${more}\${activeStr}\`);
"
```

Unit test: feed a mock state.json, assert stdout matches expected format.

### Task 6.2: SessionStart hook — thread mode context injection

**Files:** `claude-assets/hooks/session-start.sh`

Reads current session-id (from Claude Code env `CLAUDE_SESSION_ID`). If matches `lyy-thread-<N>`:
1. IPC to daemon: `read_thread N`
2. Format thread history + system prompt
3. Output as `<system-reminder>` to stdin (per Claude Code hook contract)

```bash
#!/usr/bin/env bash
SID="${CLAUDE_SESSION_ID:-}"
if [[ "$SID" =~ ^lyy-thread-([0-9]+)$ ]]; then
  TID="${BASH_REMATCH[1]}"
  node -e "require('@lyy/cli/dist/hooks/thread-start.js')($TID)"
fi
```

Implementation file `packages/cli/src/hooks/thread-start.ts` that uses IPC + prints the system-reminder.

### Task 6.3: UserPromptSubmit + Stop hooks

- UserPromptSubmit: read state.json, if new unread since last prompt, prepend `<system-reminder>LYY: New message #N from @X</system-reminder>`
- Stop hook: same but at end of turn

Both are small shell scripts that delegate to a Node helper in `packages/cli/src/hooks/`.

### Task 6.4: Slash commands

**Files:** `claude-assets/commands/inbox.md`, `pickup.md`, `reply.md`, `send-to.md`

Example `inbox.md`:

```markdown
---
description: Show LYY inbox
---

Use the `list_inbox` tool to fetch unread threads. Format as a numbered list:

- For each thread: "#<shortId> @<peerName> · <lastBody> · <timeAgo>"
- At the end, hint: "Type /pickup <N> to open a thread, or /archive <N> to hide it."

If inbox is empty, say "Inbox is empty."
```

Example `pickup.md`:

```markdown
---
description: Open a peer thread in a new zellij pane
argument-hint: <thread-id>
---

Call the `spawn_thread` tool with thread_id=$ARGUMENTS.

After it succeeds, tell the user: "Thread #$ARGUMENTS opened in a new pane. Switch with Alt+arrow."
```

Commit each.

### Task 6.5: settings.json snippet

**Files:** `claude-assets/settings.snippet.json`

```json
{
  "mcpServers": {
    "lyy": { "command": "lyy-mcp", "args": [] }
  },
  "statusLine": {
    "type": "command",
    "command": "bash ~/.lyy/hooks/statusline.sh",
    "refreshInterval": 5000
  },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash ~/.lyy/hooks/session-start.sh" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "bash ~/.lyy/hooks/prompt-submit.sh" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "bash ~/.lyy/hooks/stop.sh" }] }]
  }
}
```

`lyy init` merges this into `~/.claude/settings.json` respecting existing user config.

Commit.

---

## Phase 7: End-to-end Dogfooding (Day 15+)

### Task 7.1: Local E2E smoke test

**Files:** `tests/e2e/two-peer-happy-path.ts`

**Scenario:**

1. Start relay in Docker locally with local Postgres
2. Create two invites via SQL
3. Two temp HOME dirs: `/tmp/lyy-alice`, `/tmp/lyy-bob`
4. `HOME=/tmp/lyy-alice lyy init --invite=INV1`
5. `HOME=/tmp/lyy-bob lyy init --invite=INV2`
6. Simulate alice calling MCP `send_to` with peer=bob
7. Assert bob's state.json shows unread=1, thread shortId assigned
8. Simulate bob `spawn_thread` → zellij pane command issued
9. Bob replies via `reply` tool
10. Alice's state.json sees the reply

Run as a single script / test.

### Task 7.2: Two-human dogfood

Deploy relay to real K8s. You + Leo each:
1. `lyy init --invite=...`
2. `lyy` opens zellij + Claude Code
3. Try the flows from the design doc Section 5
4. Log issues in a running `DOGFOOD.md` at repo root

Iterate for 2-3 days.

### Task 7.3: Onboarding docs

**Files:**
- `docs/onboarding/developer.md` — dev flow, advanced usage
- `docs/onboarding/non-technical.md` — screenshots, simple walkthrough
- `docs/operations/admin.md` — how to issue invites, manage users, monitor relay
- `docs/operations/deployment.md` — K8s rollout, Supabase migration workflow

Commit.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude Code's hook system changes format in a minor update | Pin Claude Code version in team; keep hooks thin (delegate to Node helpers) |
| Pane injection via UserPromptSubmit file is not as real-time as needed | v1 is "next-turn" delivery; upgrade to true interrupt via MCP tool return trick in v2 |
| node-pty native module flaky on Apple Silicon | CI on both arm64 and x64; ship prebuilds |
| Relay single-replica fails during dogfood | Socket.IO reconnect + daemon outbox queue handles short outages; monitor uptime |
| Supabase cold connections slow | Use connection pooler (supavisor) + keep relay warm |

---

## Open Follow-ups (post-v1)

- Lark notification via Stella MCP (when daemon offline)
- Agent SDK headless "auto-answer" mode
- TUI shell with right-side pane (OpenTUI + node-pty claude embed)
- E2E encryption for external collaborators
- Multi-device per-peer support
- Edit / retract messages
- Thread merge / split / retitle

---

## Definition of Done (v1)

- [ ] `lyy init` works from a clean Mac
- [ ] Jianfeng and Leo can run the full Section 5 flow (send → inbox → pickup → reply → resume)
- [ ] Main session context is measurably not polluted (token count before/after a thread round trip ≈ 100 tokens for tool call overhead)
- [ ] statusLine format shows `📬 #<N> @<peer>` per spec
- [ ] Archive works per-peer
- [ ] Full-text search via `search` tool returns sensible results across two weeks of messages
- [ ] Relay stays up for 7 continuous days during internal dogfood
- [ ] Docs cover developer, non-technical user, and admin onboarding
