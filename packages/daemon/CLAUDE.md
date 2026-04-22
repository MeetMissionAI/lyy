# packages/daemon

Per-profile long-lived local sidecar. Holds the WebSocket to the relay, maintains `state.json`, pushes events to subscribers (TUI) + serves one-shot calls (MCP) over a Unix socket under the profile's LYY_HOME.

## Files

| File            | What                            | When to read                         |
| --------------- | ------------------------------- | ------------------------------------ |
| `package.json`  | socket.io-client, postgres.js   | Adding a runtime dep                 |
| `tsconfig.json` | Build config                    | Adjusting build output               |

## Subdirectories

| Directory | What                                                     | When to read                                 |
| --------- | -------------------------------------------------------- | -------------------------------------------- |
| `src/`    | All source (entry, lifecycle, relay client, state, IPC)  | Any daemon code change                       |
| `bin/`    | Shell shims (`lyy-daemon-dev` for dev, compiled prod)    | Changing invocation wrapper                  |
