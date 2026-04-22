# packages/mcp/src

## Files

| File             | What                                                                                              | When to read                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `bin.ts`         | Process entry — calls `run()` from `main.ts`                                                       | Rarely; edit `main.ts`                                        |
| `index.ts`       | Public barrel                                                                                      | Changing exports                                              |
| `main.ts`        | Builds the MCP server, picks transport (stdio / http) via `mode.ts`, registers all tools          | Changing server lifecycle, adding auth                        |
| `mode.ts`        | Decide transport from argv / env                                                                   | Adding a new transport option                                 |
| `mode.test.ts`   | Mode detection                                                                                      | Changing detection rules                                      |
| `server.ts`      | `createServer(ipc)` — wires tool list into an MCP server instance                                  | Adding / removing a tool                                      |
| `server.test.ts` | Server smoke                                                                                        | Smoke coverage tweaks                                         |

## Subdirectories

| Directory | What                                           | When to read                               |
| --------- | ---------------------------------------------- | ------------------------------------------ |
| `tools/`  | One file per MCP tool, each exports a handler | Adding / modifying a tool                  |
