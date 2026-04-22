# LYY — Link Your Yarn

Peer-to-peer chat channel between Claude Code sessions; stateless Node relay + Postgres, Claude Code on each client, per-profile daemon holds the socket and drives a TUI pane. Self-hosted per team.

## Release discipline

**Do NOT `git push` or push tags until the user confirms a local smoke test passed.** Local commits (merges, tags) are fine — hold off on any push to GitHub. Build + test + biome green is not enough; the user must exercise the real flow end-to-end first. Ask for explicit "pushed?" / "green?" before `git push origin …` or `git push origin <tag>`.

## Common commands

```bash
pnpm install                                  # install all deps
pnpm build                                    # tsc -b recursively across packages
LYY_SKIP_DB=1 pnpm -r exec vitest run         # run all tests, skip Postgres-backed
pnpm lint                                     # biome check .
pnpm format                                   # biome format --write .
./scripts/link-local.sh                       # dev mode: symlink ~/.lyy/bin → repo source
```

Release lifecycle: bump `packages/shared/src/version.ts` → commit → push → `git tag v0.X.Y` → push tag → CI builds relay image + tarballs → `kubectl rollout restart deployment/lyy-relay` if relay code changed.

## Files

| File                   | What                                          | When to read                                                   |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------------- |
| `README.md`            | User-facing install / usage / deploy guide    | Onboarding a teammate, writing user docs, explaining a flow    |
| `README_zh.md`         | Chinese translation of README.md              | Translating doc updates; keep in lockstep with English         |
| `package.json`         | Workspace root — scripts + pnpm config        | Adding a repo-wide script, changing workspace layout           |
| `pnpm-workspace.yaml`  | pnpm workspace pattern (`packages/*`)         | Adding a new package                                           |
| `tsconfig.base.json`   | TS compiler options all packages extend       | Changing TS target / module resolution                         |
| `biome.json`           | Biome formatter + linter config               | Tweaking lint rules or ignored paths                           |

## Subdirectories

| Directory         | What                                                                         | When to read                                                                    |
| ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/`       | Monorepo workspace (shared / relay / daemon / mcp / cli / tui)               | Working on any runtime code                                                     |
| `migrations/`     | Supabase Postgres schema migrations, applied in order                        | Schema changes, bootstrapping a fresh DB                                        |
| `scripts/`        | Shell helpers (`bootstrap.sh` installer, `link-local.sh` dev shim)           | Changing install flow, setting up local dev symlinks                            |
| `docs/`           | Design + plan documents under `plans/`                                       | Reading design rationale, writing a new plan                                    |
| `claude-assets/`  | Claude Code settings snippet, hooks, slash commands templates                | Editing slash commands or the MCP registration dropped in at `lyy init`         |
| `.github/`        | GitHub Actions CI + release workflows                                        | Modifying CI, debugging a build, tuning release asset upload                    |
