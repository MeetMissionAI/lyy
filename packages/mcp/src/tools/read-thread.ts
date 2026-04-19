import type { LyyTool } from "./index.js";

export const readThreadTool: LyyTool = {
  name: "read_thread",
  description:
    "Pull messages of a specific thread from the relay. Pass since_seq to fetch only newer messages (diff sync).",
  inputSchema: {
    type: "object",
    properties: {
      thread_id: { type: "string", description: "UUID of the thread" },
      since_seq: { type: "number", description: "Only messages with seq > this" },
    },
    required: ["thread_id"],
  },
  async execute(args, ctx) {
    return ctx.ipc.call("read_thread", {
      threadId: String(args.thread_id),
      sinceSeq: typeof args.since_seq === "number" ? args.since_seq : undefined,
    });
  },
};
