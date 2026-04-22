# packages/cli

`lyy` launcher. Parses `--profile` early, routes to a subcommand (init / doctor / admin / statusline / hook / repair), and on the default path runs auto-upgrade → ensures daemon → spawns zellij with the Claude + TUI layout.

## Files

| File            | What                  | When to read           |
| --------------- | --------------------- | ---------------------- |
| `package.json`  | commander + deps      | Adding a runtime dep   |
| `tsconfig.json` | Build config          | Adjusting build output |

## Subdirectories

| Directory | What                                                  | When to read                    |
| --------- | ----------------------------------------------------- | ------------------------------- |
| `src/`    | Entry, subcommand handlers, auto-upgrade, utilities   | Any CLI change                  |
| `bin/`    | Shell shims (`lyy-dev` for dev, built bin for prod)   | Changing invocation wrapper     |
