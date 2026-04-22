# packages/cli/src

## Files

| File               | What                                                                                                   | When to read                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `bin.ts`           | Entry — parses `--profile` before any import (sets `LYY_HOME`), then dynamically imports `./index.js`  | Changing profile-scoping semantics                            |
| `index.ts`         | Commander setup: defines subcommands + fallthrough default action → `runDefault()`                     | Adding / removing a subcommand                                |
| `upgrade.ts`       | Auto-upgrade pipeline: `fetchLatestTag` (ETag), `downloadAndExtract` (parallel, sha-verified), `swapRuntime` (atomic), `autoUpgrade` orchestrator | Tuning upgrade behavior, timeout, failure semantics           |
| `upgrade.test.ts`  | Pure-function + no-op-branch coverage for auto-upgrade                                                  | Adding an auto-upgrade test                                   |

## Subdirectories

| Directory   | What                                                                  | When to read                                        |
| ----------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `commands/` | Subcommand handlers (one file per command)                            | Changing a subcommand's behavior                    |
| `util/`     | Shared CLI helpers (`which` PATH lookup, etc.)                        | Adding a generic CLI utility                        |
