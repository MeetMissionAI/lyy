# packages/mcp

MCP server loaded by Claude Code. Thin proxy over the daemon's IPC socket: every tool call opens a short-lived connection, sends JSON, gets a reply. No long-lived state here.

## Files

| File            | What                          | When to read             |
| --------------- | ----------------------------- | ------------------------ |
| `package.json`  | @modelcontextprotocol/sdk dep | Adding a runtime dep     |
| `tsconfig.json` | Build config                  | Adjusting build output   |

## Subdirectories

| Directory | What                                                       | When to read                         |
| --------- | ---------------------------------------------------------- | ------------------------------------ |
| `src/`    | Entry, server, transport mode detection, tool handlers     | Any MCP change                       |
| `bin/`    | Shell shims for launch                                     | Changing invocation wrapper          |
