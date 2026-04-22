# packages/relay/src

## Files

| File              | What                                                                                           | When to read                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `index.ts`        | Public entry re-exports for tests                                                              | Exporting something new for tests                                             |
| `main.ts`         | Process entry: reads `DATABASE_URL` + `JWT_SIGNING_KEY`, builds Fastify, attaches Socket.IO    | Adding a startup env var, changing boot order                                 |
| `server.ts`       | `buildServer()` composes Fastify, registers auth plugin + all routes                           | Adding a new route, changing CORS / error handling                            |
| `server.test.ts`  | High-level server boot + route 200/401 smoke                                                   | Adding a route-level smoke assertion                                          |
| `socket.ts`       | Socket.IO wiring: JWT handshake, per-peer room join, presence counter + events                 | Debugging presence drift, adding a socket event                               |
| `socket.test.ts`  | Socket.IO lifecycle + presence behavior                                                        | Changing socket behavior                                                      |

## Subdirectories

| Directory   | What                                                          | When to read                                              |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| `plugins/`  | Fastify plugins (auth / JWT verification)                     | Tuning auth, adding a plugin                              |
| `routes/`   | REST handlers grouped by resource                             | Adding/modifying an HTTP endpoint                         |
