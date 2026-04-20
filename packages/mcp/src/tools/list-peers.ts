import type { LyyTool } from "./index.js";

export const listPeersTool: LyyTool = {
  name: "list_peers",
  description:
    "List all peers in the team (id, name, displayName, email). Call this " +
    "before `send_to` to resolve the exact @name — peer lookup is case-sensitive.",
  inputSchema: { type: "object", properties: {} },
  async execute(_args, ctx) {
    return ctx.ipc.call("list_peers");
  },
};
