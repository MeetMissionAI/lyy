import type { McpIpcClient } from "@lyy/daemon";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { buildMcpServer } from "./server.js";

function fakeIpc(
  impl: Partial<Record<string, ReturnType<typeof vi.fn>>> = {},
): McpIpcClient {
  const call = vi.fn(
    async (method: string, params?: Record<string, unknown>) => {
      const fn = impl[method];
      if (fn) return fn(params);
      return { ok: true, method, params };
    },
  );
  return { call } as unknown as McpIpcClient;
}

async function listTools(server: ReturnType<typeof buildMcpServer>["server"]) {
  const handlers = (
    server as unknown as {
      _requestHandlers: Map<
        string,
        (
          req: { method: string; params: unknown },
          ctx: unknown,
        ) => Promise<unknown>
      >;
    }
  )._requestHandlers;
  const handler = handlers.get(ListToolsRequestSchema.shape.method.value);
  if (!handler) throw new Error("ListTools handler not registered");
  return await handler({ method: "tools/list", params: {} }, {});
}

async function callTool(
  server: ReturnType<typeof buildMcpServer>["server"],
  name: string,
  args: Record<string, unknown> = {},
) {
  const handlers = (
    server as unknown as {
      _requestHandlers: Map<
        string,
        (
          req: { method: string; params: unknown },
          ctx: unknown,
        ) => Promise<unknown>
      >;
    }
  )._requestHandlers;
  const handler = handlers.get(CallToolRequestSchema.shape.method.value);
  if (!handler) throw new Error("CallTool handler not registered");
  return await handler(
    { method: "tools/call", params: { name, arguments: args } },
    {},
  );
}

describe("buildMcpServer (main mode)", () => {
  it("lists main-mode tools (excludes thread-only 'reply')", async () => {
    const { server } = buildMcpServer({
      ipcClient: fakeIpc(),
      mode: { kind: "main" },
    });
    const result = (await listTools(server)) as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("send_to");
    expect(names).toContain("list_inbox");
    expect(names).toContain("list_threads");
    expect(names).toContain("list_peers");
    expect(names).toContain("read_thread");
    expect(names).toContain("archive_thread");
    expect(names).toContain("unarchive_thread");
    expect(names).toContain("search");
    expect(names).toContain("spawn_thread");
    expect(names).not.toContain("reply");
  });

  it("send_to → ipc.call('send_message', ...)", async () => {
    const ipc = fakeIpc({
      send_message: vi.fn(async () => ({
        messageId: "mid",
        threadShortId: 7,
        seq: 1,
      })),
    });
    const { server } = buildMcpServer({
      ipcClient: ipc,
      mode: { kind: "main" },
    });
    const res = (await callTool(server, "send_to", {
      peer: "leo",
      body: "hi",
    })) as {
      content: { text: string }[];
    };
    expect(ipc.call).toHaveBeenCalledWith("send_message", {
      toPeer: "leo",
      body: "hi",
      forceNew: false,
    });
    expect(JSON.parse(res.content[0].text)).toEqual({
      messageId: "mid",
      threadShortId: 7,
      seq: 1,
    });
  });

  it("list_inbox → ipc.call('list_inbox')", async () => {
    const ipc = fakeIpc({
      list_inbox: vi.fn(async () => ({ unreadCount: 3, threads: [] })),
    });
    const { server } = buildMcpServer({
      ipcClient: ipc,
      mode: { kind: "main" },
    });
    const res = (await callTool(server, "list_inbox")) as {
      content: { text: string }[];
    };
    expect(ipc.call).toHaveBeenCalledWith("list_inbox");
    expect(JSON.parse(res.content[0].text).unreadCount).toBe(3);
  });

  it("list_peers → ipc.call('list_peers')", async () => {
    const ipc = fakeIpc({
      list_peers: vi.fn(async () => ({
        peers: [{ id: "p1", name: "Alice", email: "a@x.com" }],
      })),
    });
    const { server } = buildMcpServer({
      ipcClient: ipc,
      mode: { kind: "main" },
    });
    const res = (await callTool(server, "list_peers")) as {
      content: { text: string }[];
    };
    expect(ipc.call).toHaveBeenCalledWith("list_peers");
    const parsed = JSON.parse(res.content[0].text) as {
      peers: { name: string }[];
    };
    expect(parsed.peers[0].name).toBe("Alice");
  });

  it("calling 'reply' in main mode throws (tool not enabled)", async () => {
    const { server } = buildMcpServer({
      ipcClient: fakeIpc(),
      mode: { kind: "main" },
    });
    await expect(callTool(server, "reply", { body: "no" })).rejects.toThrow(
      /unknown tool/,
    );
  });
});

describe("buildMcpServer (thread mode)", () => {
  const threadMode = {
    kind: "thread" as const,
    threadId: "550e8400-e29b-41d4-a716-446655440000",
    threadShortId: 12,
  };

  it("exposes 'reply' but hides main-only tools (send_to, spawn_thread)", async () => {
    const { server } = buildMcpServer({
      ipcClient: fakeIpc(),
      mode: threadMode,
    });
    const result = (await listTools(server)) as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("reply");
    expect(names).toContain("read_thread");
    expect(names).toContain("archive_thread");
    expect(names).not.toContain("send_to");
    expect(names).not.toContain("spawn_thread");
  });

  it("reply → ipc.call('send_message') with bound threadId", async () => {
    const ipc = fakeIpc({
      send_message: vi.fn(async () => ({ messageId: "rmid", seq: 9 })),
    });
    const { server } = buildMcpServer({ ipcClient: ipc, mode: threadMode });
    await callTool(server, "reply", { body: "got it" });
    expect(ipc.call).toHaveBeenCalledWith("send_message", {
      threadId: threadMode.threadId,
      body: "got it",
    });
  });
});
