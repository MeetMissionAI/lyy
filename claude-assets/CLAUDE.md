# claude-assets/

Templates `lyy init` copies into the user's `~/.claude/settings.json` and `~/.claude/commands/`. Shipped inside the `lyy-cli` tarball at release time.

## Files

| File                      | What                                                                                        | When to read                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `settings.snippet.json`   | MCP server registration + statusline hook; merged (non-destructively) into user's settings  | Changing MCP server name / invocation / statusline command                   |

## Subdirectories

| Directory   | What                                                             | When to read                                                    |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `commands/` | Slash command templates dropped under `~/.claude/commands/`      | Adding / editing a `/lyy-*` slash command                       |
