import { createDb, createPeer, type Db } from "@lyy/shared";
import jwt from "jsonwebtoken";
import { type Socket, io as ioClient } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { attachSocket } from "./socket.js";

const url = process.env.DATABASE_URL;
const skip = !url;
const db: Db = url ? createDb(url) : (null as never);

const SECRET = "test-secret";
const TEST_PREFIX = "lyytest-sock-";

interface Started {
  app: Awaited<ReturnType<typeof buildServer>>;
  port: number;
  ioClose: () => Promise<void>;
}

async function startStack(): Promise<Started> {
  const deps = { db, jwtSecret: SECRET };
  const app = await buildServer(deps);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("listen address unexpected");
  const io = attachSocket(app.server, deps);
  return {
    app,
    port: addr.port,
    ioClose: () => new Promise<void>((res) => io.close(() => res())),
  };
}

async function cleanup() {
  await db`
    DELETE FROM messages WHERE from_peer IN (
      SELECT id FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}
    )
  `;
  await db`
    DELETE FROM threads WHERE id IN (
      SELECT thread_id FROM thread_participants WHERE peer_id IN (
        SELECT id FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}
      )
    )
  `;
  await db`DELETE FROM peers WHERE name LIKE ${`${TEST_PREFIX}%`}`;
}

let stack: Started;
const sockets: Socket[] = [];

if (!skip) {
  beforeAll(async () => {
    await cleanup();
    stack = await startStack();
  });
  afterEach(() => {
    while (sockets.length) sockets.pop()?.disconnect();
  });
  afterAll(async () => {
    await cleanup();
    await stack.ioClose();
    await stack.app.close();
    await db.end();
  });
}

interface Connected {
  socket: Socket;
  ack: Promise<{ peerId: string }>;
}

function connect(peerId: string): Promise<Connected> {
  const s = ioClient(`http://127.0.0.1:${stack.port}`, {
    auth: { token: jwt.sign({ peerId }, SECRET) },
    reconnection: false,
    transports: ["websocket", "polling"],
  });
  sockets.push(s);
  // IMPORTANT: subscribe to "connected" BEFORE awaiting transport connect,
  // otherwise the server's emit can land before our listener is attached.
  const ack = new Promise<{ peerId: string }>((res) => s.on("connected", res));
  return new Promise<Connected>((resolve, reject) => {
    s.once("connect", () => resolve({ socket: s, ack }));
    s.once("connect_error", (err) => reject(err));
  });
}

describe.skipIf(skip)("Socket.IO", () => {
  it("authenticated client connects and receives 'connected' event", async () => {
    const peer = await createPeer(db, {
      name: `${TEST_PREFIX}solo`,
      email: `${TEST_PREFIX}solo@x.com`,
    });
    const { ack } = await connect(peer.id);
    const ackVal = await ack;
    expect(ackVal.peerId).toBe(peer.id);
  });

  it("rejects connection with missing token", async () => {
    const s = ioClient(`http://127.0.0.1:${stack.port}`, {
      reconnection: false,
      transports: ["websocket", "polling"],
    });
    sockets.push(s);
    await expect(
      new Promise<void>((resolve, reject) => {
        s.once("connect", () => resolve());
        s.once("connect_error", (err) => reject(err));
      }),
    ).rejects.toThrow();
  });

  it("rejects connection with invalid token", async () => {
    const s = ioClient(`http://127.0.0.1:${stack.port}`, {
      auth: { token: "garbage" },
      reconnection: false,
      transports: ["websocket", "polling"],
    });
    sockets.push(s);
    await expect(
      new Promise<void>((_, reject) => {
        s.once("connect", () => reject(new Error("should not connect")));
        s.once("connect_error", (err) => reject(err));
      }),
    ).rejects.toThrow();
  });

  it("recipient socket receives message:new after sender POSTs /messages", async () => {
    const alice = await createPeer(db, {
      name: `${TEST_PREFIX}alice`,
      email: `${TEST_PREFIX}alice@x.com`,
    });
    const bob = await createPeer(db, {
      name: `${TEST_PREFIX}bob`,
      email: `${TEST_PREFIX}bob@x.com`,
    });

    const { socket: bobSock, ack } = await connect(bob.id);
    await ack;

    const received = new Promise<{
      message: { body: string; threadId: string };
      threadShortId: number;
    }>((res) => {
      bobSock.once("message:new", (m) => res(m));
    });

    const aliceJwt = jwt.sign({ peerId: alice.id }, SECRET);
    const res = await fetch(`http://127.0.0.1:${stack.port}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${aliceJwt}`,
      },
      body: JSON.stringify({ toPeer: bob.name, body: "ping" }),
    });
    expect(res.status).toBe(201);

    const env = await received;
    expect(env.message.body).toBe("ping");
    expect(env.message.threadId).toBeTypeOf("string");
    expect(typeof env.threadShortId).toBe("number");
  });

  it("sender does NOT receive their own message:new", async () => {
    const a = await createPeer(db, {
      name: `${TEST_PREFIX}solo-a`,
      email: `${TEST_PREFIX}solo-a@x.com`,
    });
    const b = await createPeer(db, {
      name: `${TEST_PREFIX}solo-b`,
      email: `${TEST_PREFIX}solo-b@x.com`,
    });

    const { socket: aSock, ack } = await connect(a.id);
    await ack;

    let aReceived = false;
    aSock.once("message:new", () => {
      aReceived = true;
    });

    const aJwt = jwt.sign({ peerId: a.id }, SECRET);
    await fetch(`http://127.0.0.1:${stack.port}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${aJwt}`,
      },
      body: JSON.stringify({ toPeer: b.name, body: "no-loopback" }),
    });

    // Give socket layer 200ms to potentially deliver
    await new Promise((r) => setTimeout(r, 200));
    expect(aReceived).toBe(false);
  });
});
