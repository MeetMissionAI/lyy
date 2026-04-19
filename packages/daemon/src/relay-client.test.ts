import { type Server as HttpServer, createServer } from "node:http";
import { Server as IOServer } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayClient } from "./relay-client.js";

interface Stack {
  http: HttpServer;
  io: IOServer;
  port: number;
}

let stack: Stack;

beforeEach(async () => {
  const http = createServer();
  const io = new IOServer(http, { cors: { origin: "*" } });
  await new Promise<void>((res) => http.listen(0, "127.0.0.1", res));
  const addr = http.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  stack = { http, io, port: addr.port };
});

afterEach(async () => {
  await new Promise<void>((res) => stack.io.close(() => res()));
  await new Promise<void>((res) => stack.http.close(() => res()));
});

describe("RelayClient", () => {
  it("connects and emits 'connected' event", async () => {
    const client = new RelayClient({
      url: `http://127.0.0.1:${stack.port}`,
      token: "any",
      reconnection: false,
    });
    const opened = new Promise<void>((res) =>
      client.on("connected", () => res()),
    );
    client.connect();
    await opened;
    expect(client.isConnected()).toBe(true);
    client.disconnect();
  });

  it("queues sends while offline, flushes on (re)connect", async () => {
    const received: unknown[] = [];
    stack.io.on("connection", (s) => {
      s.on("ping", (p) => received.push(p));
    });

    const client = new RelayClient({
      url: `http://127.0.0.1:${stack.port}`,
      token: "any",
      reconnection: false,
    });

    // Send BEFORE connecting → goes to outbox
    client.send("ping", { n: 1 });
    client.send("ping", { n: 2 });
    expect(client.outboxSize()).toBe(2);

    const opened = new Promise<void>((res) =>
      client.on("connected", () => res()),
    );
    client.connect();
    await opened;

    // Give server a moment to receive the flushed events
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(client.outboxSize()).toBe(0);

    client.disconnect();
  });

  it("re-emits message:new from server to subscribers", async () => {
    stack.io.on("connection", (s) => {
      s.emit("message:new", { id: "m1", body: "hello" });
    });

    const client = new RelayClient({
      url: `http://127.0.0.1:${stack.port}`,
      token: "any",
      reconnection: false,
    });
    const got = new Promise<{ id: string; body: string }>((res) =>
      client.on("message:new", (m) => res(m as { id: string; body: string })),
    );
    client.connect();
    const msg = await got;
    expect(msg.body).toBe("hello");
    client.disconnect();
  });

  it("emits 'disconnected' on remote disconnect", async () => {
    const client = new RelayClient({
      url: `http://127.0.0.1:${stack.port}`,
      token: "any",
      reconnection: false,
    });

    const disconnected = new Promise<void>((res) =>
      client.on("disconnected", () => res()),
    );
    const opened = new Promise<void>((res) =>
      client.on("connected", () => res()),
    );
    client.connect();
    await opened;
    stack.io.disconnectSockets(true);
    await disconnected;
    client.disconnect();
  });
});
