# packages/tui

React Ink TUI. Launches as the right-hand zellij pane next to Claude Code. Subscribes to daemon IPC for live message + presence events; emits sends back through daemon.

## Files

| File            | What                                         | When to read             |
| --------------- | -------------------------------------------- | ------------------------ |
| `package.json`  | ink + react deps, dev-only @types            | Adding a runtime dep     |
| `tsconfig.json` | Build config (jsx: react-jsx)                | Adjusting build output   |

## Subdirectories

| Directory | What                                               | When to read                                |
| --------- | -------------------------------------------------- | ------------------------------------------- |
| `src/`    | Ink components + daemon IPC client + helpers       | Any TUI change                              |
| `bin/`    | Shell shims for launch                             | Changing invocation wrapper                 |
