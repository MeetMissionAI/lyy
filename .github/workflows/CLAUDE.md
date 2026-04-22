# .github/workflows

GitHub Actions pipelines.

## Files

| File            | What                                                                                                                                      | When to read                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `ci.yml`        | On push: run `pnpm test` (with `LYY_SKIP_DB=1`) + `pnpm lint`; on tag push: build + push relay Docker image to ECR                        | Adding a test step, rotating AWS creds, swapping registry, debugging CI flake |
| `release.yml`   | On tag push `v*`: `pnpm build` → `pnpm deploy --prod` for cli/daemon/mcp/tui → tar each → sha256 → upload to GitHub Release                | Changing release artifacts, adjusting the bundle shape                       |
