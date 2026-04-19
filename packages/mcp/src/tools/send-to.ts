import type { LyyTool } from "./index.js";

export const sendToTool: LyyTool = {
  name: "send_to",
  description:
    "Send a message to another peer. Defaults to the most recent thread with that peer (within 24h); set new_thread=true to force a new thread. Use only in main mode — thread panes use 'reply' instead.",
  availableIn: "main-only",
  inputSchema: {
    type: "object",
    properties: {
      peer: { type: "string", description: "Peer's @name (e.g. 'leo')" },
      body: { type: "string", description: "Message body" },
      new_thread: {
        type: "boolean",
        description: "Force creation of a new thread instead of reusing recent",
        default: false,
      },
    },
    required: ["peer", "body"],
  },
  async execute(args, ctx) {
    const peer = String(args.peer);
    const body = String(args.body);
    const forceNew = args.new_thread === true;
    const result = await ctx.ipc.call("send_message", {
      toPeer: peer,
      body,
      forceNew,
    });
    return result;
  },
};
