import type { LyyTool } from "./index.js";

export const searchTool: LyyTool = {
  name: "search",
  description:
    "Full-text search across messages in threads the caller participates in. Returns up to `limit` matches.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", default: 50 },
    },
    required: ["query"],
  },
  async execute(args, ctx) {
    return ctx.ipc.call("search", {
      q: String(args.query),
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  },
};
