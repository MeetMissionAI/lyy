import type { LyyTool } from "./index.js";

export const replyTool: LyyTool = {
  name: "reply",
  description:
    "Reply within the current peer thread (only available inside a thread pane). Posts to the bound thread; the other participant receives it via Socket.IO push.",
  availableIn: "thread-only",
  inputSchema: {
    type: "object",
    properties: { body: { type: "string" } },
    required: ["body"],
  },
  async execute(args, ctx) {
    if (ctx.mode.kind !== "thread") {
      throw new Error("reply is only available inside a thread pane");
    }
    return ctx.ipc.call("send_message", {
      threadId: ctx.mode.threadId,
      body: String(args.body),
    });
  },
};
