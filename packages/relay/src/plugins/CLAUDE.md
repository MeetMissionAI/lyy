# packages/relay/src/plugins

Fastify plugins.

## Files

| File             | What                                                                                                   | When to read                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `auth.ts`        | JWT verification for authenticated routes; stamps `req.peerId` for downstream handlers                 | Rotating the signing key, tightening auth, adding a claim     |
| `auth.test.ts`   | Happy + unauthenticated + malformed token paths                                                        | Changing auth behavior                                        |
