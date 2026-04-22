# packages/shared

Common types, `LYY_VERSION` constant, Postgres client factory, and a thin repo layer (peers, threads, messages, reads, archives). Every other package depends on this one.

## Files

| File                | What                                            | When to read                                                   |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `package.json`      | Runtime deps (postgres.js), no devDep on vitest | Adding/removing a runtime dep                                  |
| `tsconfig.json`     | Build config (composite, emits `dist/`)         | Adjusting build output                                         |

## Subdirectories

| Directory | What                                                                | When to read                                                          |
| --------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/`    | All source. Re-exports via `src/index.ts`                           | Editing shared code                                                   |
