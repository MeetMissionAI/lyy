import type { McpIpcClient } from "@lyy/daemon";
import type { Mode } from "../mode.js";
import { archiveThreadTool, unarchiveThreadTool } from "./archive.js";
import { listInboxTool, listThreadsTool } from "./inbox.js";
import { listPeersTool } from "./list-peers.js";
import { readThreadTool } from "./read-thread.js";
import { searchTool } from "./search.js";
import { sendToTool } from "./send-to.js";
import { suggestReplyTool } from "./suggest-reply.js";

export interface ToolContext {
  ipc: McpIpcClient;
  mode: Mode;
}

export type ToolInputSchema = {
  [x: string]: unknown;
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
};

export interface LyyTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Where the tool is exposed. Defaults to "anywhere". */
  availableIn?: "main-only" | "thread-only" | "anywhere";
  execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

export const allTools: LyyTool[] = [
  sendToTool,
  listInboxTool,
  listThreadsTool,
  listPeersTool,
  readThreadTool,
  archiveThreadTool,
  unarchiveThreadTool,
  searchTool,
  suggestReplyTool,
];
