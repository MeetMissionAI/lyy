# packages/relay

Stateless Node service: Fastify REST + Socket.IO real-time, backed by the Postgres schema in `../../migrations/`. Runs as a Docker image (`Dockerfile`). Single-replica by default; multi-replica needs WS sticky sessions or a Socket.IO Redis adapter.

## Files

| File             | What                                                                           | When to read                                                      |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `Dockerfile`     | Multi-stage node:20-alpine build; only ships shared + relay deps (~80 MB)      | Tuning image size, updating node base, adding runtime libs        |
| `package.json`   | Fastify, socket.io, jsonwebtoken, postgres.js                                  | Adding a runtime dep                                              |
| `tsconfig.json`  | Build config                                                                   | Adjusting build output                                            |
| `test-setup.ts`  | vitest global setup (env stubs, DB skip gate)                                  | Writing a new test that touches DB                                |
| `vitest.config.ts` | Test runner config                                                           | Changing test include patterns                                    |

## Subdirectories

| Directory | What                                          | When to read                                  |
| --------- | --------------------------------------------- | --------------------------------------------- |
| `src/`    | Fastify app, routes, plugins, socket wiring   | Any server-side code change                   |
