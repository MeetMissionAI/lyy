import type { LyyTool } from "./index.js";

export const suggestReplyTool: LyyTool = {
  name: "suggest_reply",
  description:
    "Push a draft reply into the LYY TUI for the user to review and send. Use after the user asked you to help reply to a thread (e.g. via @Claude) and you've drafted the text. The TUI shows the draft as a card; the user accepts (Tab), edits, and sends — nothing is sent automatically.",
  availableIn: "main-only",
  inputSchema: {
    type: "object",
    properties: {
      thread_id: { type: "string", description: "Thread UUID" },
      body: { type: "string", description: "Draft reply text" },
    },
    required: ["thread_id", "body"],
  },
  async execute(args, ctx) {
    return ctx.ipc.call("suggest_reply", {
      threadId: String(args.thread_id),
      body: String(args.body),
    });
  },
};
