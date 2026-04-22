# packages/

pnpm workspace root. Six packages; `shared` is the only dependency every other one pulls in. CLI-side packages (daemon, mcp, cli, tui) ship in release tarballs. Server-side (relay) ships as a Docker image.

## Subdirectories

| Directory    | What                                                                                       | When to read                                                                           |
| ------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `shared/`    | Types, Postgres client, repo layer, `LYY_VERSION` constant                                 | Adding a shared type, touching DB SQL, bumping the version                             |
| `relay/`     | Server: Fastify REST + Socket.IO, JWT validation, presence tracking                        | Changing relay routes, socket events, or image build                                   |
| `daemon/`    | Per-profile local sidecar: relay WebSocket client, state store, IPC for TUI + MCP          | Debugging message routing, state.json drift, daemon lifecycle (pid lock, watchdog)     |
| `mcp/`       | MCP server that Claude Code loads; thin proxy over daemon IPC                              | Adding a new MCP tool, debugging `send_to` / `suggest_reply` flow                      |
| `cli/`       | `lyy` launcher + subcommands (init, doctor, admin, statusline); auto-upgrade pipeline      | Changing the CLI UX, adjusting auto-upgrade, adding a subcommand                       |
| `tui/`       | React Ink TUI (peer + thread list, thread detail, input, Claude inject, suggestion card)   | UI bugs, key handling, subscribe reconnect, status-bar rendering                       |
