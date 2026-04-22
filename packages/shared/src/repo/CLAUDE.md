# packages/shared/src/repo

Query helpers, one file per table. Pure SQL through postgres.js; no ORM. Tests skipped under `LYY_SKIP_DB=1`.

## Files

| File                 | What                                                                                                          | When to read                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `peers.ts`           | CRUD + lookup: `insertPeer`, `findPeerById`, `findPeerByName`, `findPeersByIds`                               | Adding a peer attribute, debugging invite redemption                         |
| `peers.test.ts`      | DB round-trips for peers                                                                                      | Adding a new peer query                                                      |
| `threads.ts`         | Thread creation, participant binding, `findThreadsForPeer`, `findThreadBetween` (dedupe 1:1 threads)          | Fixing thread routing, adding group-chat support                             |
| `threads.test.ts`    | Thread queries                                                                                                | Adjusting thread schema                                                      |
| `messages.ts`        | `insertMessage`, `listMessagesSince`, `listMessagesInThread` with pagination + seq ordering                   | Changing message schema, tuning pagination                                   |
| `messages.test.ts`   | Message queries                                                                                               | Message schema changes                                                       |
| `reads.ts`           | Per-peer read markers (`upsertRead`, `listUnreadCounts`)                                                      | Fixing unread-count drift                                                    |
| `reads.test.ts`      | Read-marker queries                                                                                           | Touching read semantics                                                      |
| `archives.ts`        | Thread archive toggle, per-peer                                                                               | Debugging archive UX                                                         |
| `archives.test.ts`   | Archive queries                                                                                               | Archive schema changes                                                       |
| `_test-utils.ts`     | Shared fixture helpers: tmp schema, cleanup, seed peers                                                       | Writing a new DB-backed test                                                 |
