# packages/shared/src

## Files

| File              | What                                                                                         | When to read                                                              |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `index.ts`        | Barrel re-exports of public API (types, `LYY_VERSION`, repo helpers, db client)              | Exporting a new symbol, auditing what's public                            |
| `types.ts`        | Core domain types: `Peer`, `Thread`, `Message`, `ThreadParticipant`, JWT payload shape       | Adding a domain field; bumping wire schema affects relay + daemon         |
| `types.test.ts`   | Structural invariants tests                                                                  | Changing a type shape                                                     |
| `version.ts`      | `LYY_VERSION` — single source of truth for release version string                            | Bumping version before a release                                          |
| `version.test.ts` | Format sanity test                                                                           | Changing version string format                                            |
| `db.ts`           | `createDb(url)` — postgres.js client factory with shared defaults (prepared stmts, timeouts) | Tuning DB connection opts                                                 |
| `db.test.ts`      | DB round-trip sanity; skipped under `LYY_SKIP_DB=1`                                          | Adding a DB smoke test                                                    |

## Subdirectories

| Directory | What                                                                                            | When to read                                                         |
| --------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `repo/`   | Query helpers grouped by table (peers / threads / messages / reads / archives)                  | Adding or changing a DB query                                        |
