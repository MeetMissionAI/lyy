import type { LyyTool } from "./index.js";

export const listInboxTool: LyyTool = {
  name: "list_inbox",
  description:
    "Fast local read of unread state from ~/.lyy/state.json (no relay roundtrip). Returns unreadCount + thread summaries with shortId, peerName, lastBody, unread, archived flag.",
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    return ctx.ipc.call("list_inbox");
  },
};

export const listThreadsTool: LyyTool = {
  name: "list_threads",
  description:
    "Authoritative thread list from the relay (use for refresh / when local cache may be stale). Set include_archived=true to include archived threads.",
  inputSchema: {
    type: "object",
    properties: {
      include_archived: { type: "boolean", default: false },
    },
  },
  async execute(args, ctx) {
    return ctx.ipc.call("list_threads", {
      includeArchived: args.include_archived === true,
    });
  },
};
