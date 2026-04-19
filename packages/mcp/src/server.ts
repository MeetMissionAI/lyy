import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { McpIpcClient } from "@lyy/daemon";
import { allTools, type LyyTool, type ToolContext } from "./tools/index.js";
import { detectMode, type Mode } from "./mode.js";

export interface McpServerOptions {
  ipcClient?: McpIpcClient;
  mode?: Mode;
}

/**
 * Build (don't start) the LYY MCP server. Pure factory so tests can
 * connect their own transport instead of stdio.
 */
export function buildMcpServer(opts: McpServerOptions = {}): {
  server: Server;
  context: ToolContext;
} {
  const ipc = opts.ipcClient ?? new McpIpcClient();
  const mode = opts.mode ?? detectMode();
  const context: ToolContext = { ipc, mode };

  const server = new Server(
    { name: "lyy-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const enabledTools = allTools.filter((t) => isToolEnabled(t, mode));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: enabledTools.map<Tool>((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = enabledTools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await tool.execute(
      (req.params.arguments ?? {}) as Record<string, unknown>,
      context,
    );
    return {
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
    };
  });

  return { server, context };
}

function isToolEnabled(tool: LyyTool, mode: Mode): boolean {
  if (mode.kind === "main") return tool.availableIn !== "thread-only";
  return tool.availableIn !== "main-only";
}

/** Start the server bound to stdio. Used by the bin entry. */
export async function startStdio(opts: McpServerOptions = {}): Promise<void> {
  const { server } = buildMcpServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
