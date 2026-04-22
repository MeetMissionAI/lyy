# docs/plans

Dated design + implementation plan pairs. Names: `YYYY-MM-DD-<topic>-design.md` (brainstorm / design) + `YYYY-MM-DD-<topic>.md` (implementation plan, subagent-driven-development compatible).

## Files

| File                                                | What                                                                                             | When to read                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `2026-04-19-lyy-design.md`                          | Original design: goals, data model, wire protocol, K8s relay shape                               | Foundational context for anyone new to the system                          |
| `2026-04-19-lyy-implementation.md`                  | Initial build plan (pre-v0.2.0): packages scaffold, relay, daemon, CLI, MCP                      | History of initial implementation                                          |
| `2026-04-20-lyy-v2-sync-multiwindow-design.md`      | Design for multi-profile + cross-window sync                                                     | Touching profile handling or state sync                                    |
| `2026-04-20-lyy-v2-sync-multiwindow.md`             | Implementation plan for above                                                                    | Same                                                                       |
| `2026-04-21-daemon-version-handshake.md`            | Plan for daemon version handshake + SIGKILL escalation                                            | Lifecycle bugs (zombie daemons)                                            |
| `2026-04-21-lyy-tui-design.md`                      | Design for standalone TUI + `@Claude` bridge + `suggest_reply`                                   | TUI architecture                                                           |
| `2026-04-21-lyy-tui.md`                             | TUI implementation plan                                                                          | TUI implementation history                                                 |
| `2026-04-22-lyy-auto-upgrade.md`                    | Auto-upgrade plan: ETag GitHub check, sha-verified download, atomic swap, re-exec                | Changing auto-upgrade; cross-ref with `packages/cli/src/upgrade.ts`        |
