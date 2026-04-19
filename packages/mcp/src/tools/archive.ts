import type { LyyTool } from "./index.js";

export const archiveThreadTool: LyyTool = {
  name: "archive_thread",
  description:
    "Archive a thread for the caller only — hides it from inbox / statusLine. The other participant still sees it. A new message in an archived thread auto-unarchives it.",
  inputSchema: {
    type: "object",
    properties: { thread_id: { type: "string" } },
    required: ["thread_id"],
  },
  async execute(args, ctx) {
    await ctx.ipc.call("archive_thread", { threadId: String(args.thread_id) });
    return { ok: true };
  },
};

export const unarchiveThreadTool: LyyTool = {
  name: "unarchive_thread",
  description:
    "Reverse archive_thread — re-show the thread in inbox / statusLine.",
  inputSchema: {
    type: "object",
    properties: { thread_id: { type: "string" } },
    required: ["thread_id"],
  },
  async execute(args, ctx) {
    await ctx.ipc.call("unarchive_thread", {
      threadId: String(args.thread_id),
    });
    return { ok: true };
  },
};
