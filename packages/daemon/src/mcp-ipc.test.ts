import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpIpcClient, McpIpcServer } from "./mcp-ipc.js";
import { PaneInbox } from "./pane-inbox.js";
import { PaneRegistry } from "./pane-registry.js";
import type { RelayHttp } from "./relay-http.js";
import { StateStore } from "./state.js";

let dir: string;
let server: McpIpcServer;
let client: McpIpcClient;
let registry: PaneRegistry;
let state: StateStore;
let inbox: PaneInbox;
let relayHttp: RelayHttp;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "lyy-mcpipc-"));
  const sock = join(dir, "mcp.sock");
  registry = new PaneRegistry(join(dir, "reg.sock"));
  await registry.start();
  state = new StateStore(join(dir, "state.json"));
  inbox = new PaneInbox(join(dir, "inbox"));
  relayHttp = {
    sendMessage: vi.fn(async () => ({
      messageId: "550e8400-e29b-41d4-a716-446655440010",
      threadId: "550e8400-e29b-41d4-a716-446655440000",
      threadShortId: 12,
      seq: 1,
      sentAt: "2026-04-19T10:00:00.000Z",
    })),
    markRead: vi.fn(async () => undefined),
    archiveThread: vi.fn(async () => undefined),
    unarchiveThread: vi.fn(async () => undefined),
    listThreads: vi.fn(async () => ({ unreadCount: 0, threads: [] })),
    readThread: vi.fn(async () => ({ messages: [] })),
    search: vi.fn(async () => ({ messages: [] })),
  } as unknown as RelayHttp;

  server = new McpIpcServer(
    { relayHttp, state, paneRegistry: registry, paneInbox: inbox },
    sock,
  );
  await server.start();
  client = new McpIpcClient(sock);
});

afterEach(async () => {
  await server.stop();
  await registry.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("McpIpcServer", () => {
  it("send_message proxies to relayHttp.sendMessage", async () => {
    const result = await client.call("send_message", {
      toPeer: "leo",
      body: "hi",
    });
    expect(relayHttp.sendMessage).toHaveBeenCalledWith({
      toPeer: "leo",
      threadId: undefined,
      body: "hi",
      forceNew: undefined,
    });
    expect((result as { threadShortId: number }).threadShortId).toBe(12);
  });

  it("list_inbox returns state.json contents", async () => {
    await state.write({ unreadCount: 1, threads: [], lastSeenSeq: {} });
    const result = await client.call<{ unreadCount: number }>("list_inbox");
    expect(result.unreadCount).toBe(1);
  });

  it("register_pane / unregister_pane updates the registry", async () => {
    await client.call("register_pane", { threadShortId: 12, paneId: "p1" });
    expect(registry.findPane(12)).toBe("p1");
    await client.call("unregister_pane", { threadShortId: 12 });
    expect(registry.findPane(12)).toBeNull();
  });

  it("drain_pane_inbox returns and clears entries", async () => {
    await inbox.append(12, {
      id: "550e8400-e29b-41d4-a716-446655440011",
      threadId: "550e8400-e29b-41d4-a716-446655440000",
      fromPeer: "550e8400-e29b-41d4-a716-446655440002",
      body: "ping",
      sentAt: "2026-04-19T10:00:00.000Z",
      seq: 1,
    });
    const result = await client.call<unknown[]>("drain_pane_inbox", {
      threadShortId: 12,
    });
    expect(result.length).toBe(1);
    expect(await inbox.drain(12)).toEqual([]);
  });

  it("ack_read proxies to relayHttp.markRead", async () => {
    const ids = ["550e8400-e29b-41d4-a716-446655440011"];
    await client.call("ack_read", { messageIds: ids });
    expect(relayHttp.markRead).toHaveBeenCalledWith(ids);
  });

  it("archive_thread / unarchive_thread proxy to relayHttp", async () => {
    const tid = "550e8400-e29b-41d4-a716-446655440000";
    await client.call("archive_thread", { threadId: tid });
    expect(relayHttp.archiveThread).toHaveBeenCalledWith(tid);
    await client.call("unarchive_thread", { threadId: tid });
    expect(relayHttp.unarchiveThread).toHaveBeenCalledWith(tid);
  });

  it("returns error on unknown method", async () => {
    await expect(client.call("nope")).rejects.toThrow(/unknown method/);
  });

  it("returns error on relayHttp throw", async () => {
    (relayHttp.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("relay 500"),
    );
    await expect(
      client.call("send_message", { toPeer: "x", body: "y" }),
    ).rejects.toThrow(/relay 500/);
  });
});
