# packages/relay/src/routes

HTTP route handlers, one file per resource. Each module exports a Fastify plugin (`async function route(app, deps)`).

## Files

| File                 | What                                                                                                        | When to read                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pair.ts`            | `POST /pair` — consume invite code, provision peer row, mint JWT                                            | Changing invite flow, rotating JWT claims                               |
| `pair.test.ts`       | Invite-redemption scenarios (happy, expired, used, wrong email)                                             | Adjusting pair semantics                                                |
| `peers.ts`           | `GET /peers` — list team directory                                                                          | Changing what fields peers see about each other                         |
| `peers.test.ts`      | Peer listing                                                                                                | Peer-directory changes                                                  |
| `messages.ts`        | `POST /messages` — send (create thread on first send), `GET /messages/:threadId` — history                  | Send flow, history pagination, envelope shape                           |
| `messages.test.ts`   | Send/list scenarios                                                                                         | Message API changes                                                     |
| `inbox.ts`           | `GET /inbox` — unread summary per thread, `POST /inbox/read`                                                | Tuning unread semantics or inbox payload                                |
| `inbox.test.ts`      | Inbox queries                                                                                                | Inbox API changes                                                       |
| `presence.ts`        | `GET /presence` — dump current in-memory online set (diagnostic for auto-upgrade / doctor)                  | Debugging stuck online markers                                          |
