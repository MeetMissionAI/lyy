# packages/cli/src/commands

One file per `lyy` subcommand. Wire-up lives in `../index.ts`; each handler exports a `run*(opts)` function.

## Files

| File                     | What                                                                                                                                    | When to read                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `default.ts`             | Fallthrough `lyy` (no subcommand): auto-upgrade → `ensureDaemonRunning` (version handshake + SIGKILL escalation) → zellij layout spawn  | Changing launch flow, daemon handshake, zellij pane layout                        |
| `init.ts`                | `lyy init` — pair with relay, write identity, merge MCP server + statusline into `~/.claude/settings.json`                              | Onboarding flow, settings.json merge semantics                                    |
| `init.test.ts`           | Init unit tests                                                                                                                         | Changing init behavior                                                            |
| `init.merge.test.ts`     | Exhaustive settings.json merge scenarios                                                                                                | Changing merge rules                                                              |
| `doctor.ts`              | `lyy doctor` health check — identity / daemon / relay / zellij / rogue daemons; `--fix-daemons` SIGKILL orphans                          | Adding a health check, rogue-daemon detection                                     |
| `doctor.test.ts`         | `findRogueDaemons` unit tests                                                                                                           | Changing rogue detection                                                          |
| `admin.ts`               | `lyy admin invite <email>` — write an invite row, print join command                                                                    | Invite-issuance flow                                                              |
| `admin.test.ts`          | Admin unit tests                                                                                                                        | Changing admin behavior                                                           |
| `statusline.ts`          | `lyy statusline` — print inline unread summary for Claude Code's statusLine hook (fast read from `state.json`)                           | Changing status-line format                                                       |
| `statusline.test.ts`     | Rendering scenarios                                                                                                                     | Statusline changes                                                                |
| `hook.ts`                | Stub for Claude Code hooks (SessionStart etc.)                                                                                           | Adding a hook                                                                     |
| `hook.test.ts`           | Hook unit tests                                                                                                                         | Hook behavior changes                                                             |
| `repair.ts`              | `lyy repair` — recover from broken symlinks / stale runtime state without a full re-bootstrap                                            | Adding a repair action                                                            |
