# migrations/

Supabase Postgres schema migrations. Numeric prefix = apply order. No migration runner; apply manually with `psql "$DATABASE_URL" < migrations/<file>`. Keep each file idempotent.

## Files

| File                                         | What                                                                                             | When to read                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `0001_init.sql`                              | Initial schema: `peers`, `threads`, `thread_participants`, `messages`, `reads`, `archives`, `invites` | Bootstrapping a fresh DB, reviewing base schema                      |
| `0002_thread_participants_peer_idx.sql`      | Index to speed up `findThreadsForPeer`                                                           | Query-perf work on thread listing                                    |
