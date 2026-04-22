# scripts/

Shell helpers used out-of-repo (by end users) and in-repo (by maintainers).

## Files

| File              | What                                                                                                                | When to read                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `bootstrap.sh`    | End-user one-liner installer: fetches GitHub release tarballs (parallel curls with `--max-time 120`), unpacks into `~/.lyy/runtime/`, symlinks bins, appends to shell rc, `brew install zellij` if missing | Changing install UX, adding a runtime check, adjusting the zellij install flow |
| `link-local.sh`   | Dev shim installer — symlinks `~/.lyy/bin/{lyy,lyy-daemon,lyy-mcp,lyy-tui}` to in-repo `packages/*/bin/*-dev` shims  | Switching between dev and bootstrap-installed runtime                      |
