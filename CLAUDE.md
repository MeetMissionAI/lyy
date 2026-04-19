# LYY — Link Your Yarn

MissionAI 内部工具：在两个 Claude Code session 之间建立持久化双向对话通道。解决两个痛点——(1) 同仓多人开发时不敢动别人代码、缺乏轻量确认通道；(2) 非技术同事的 Claude Code 遇到技术判断题只能瞎猜或打断同事。接收方处理 peer 对话时主 session 上下文不被污染。v1 单团队 self-hosted，走自家 relay + Supabase。

## Monorepo layout

| Path             | What                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `packages/shared/` | 共享类型、Supabase client、repo 层（peers/threads/messages/reads/archives） |
| `packages/relay/`  | Relay Server（Node + Socket.IO + HTTP API，K8s 部署）                  |
| `packages/daemon/` | 本地常驻 sidecar：连 relay、写 `~/.lyy/state.json`、spawn thread pane、注入消息 |
| `packages/mcp/`    | Claude Code MCP server：暴露 send_to / list_inbox / reply 等工具        |
| `packages/cli/`    | `lyy` CLI：init / send / inbox / 启动 zellij 布局                        |
| `claude-assets/`   | settings.json 片段、hooks、slash commands（安装到 `~/.claude/`）         |
| `deploy/`          | K8s manifests（relay-deployment / service / ingress）                  |
| `docs/`            | 设计文档与实施计划（`plans/2026-04-19-lyy-*.md`）                        |
| `migrations/`      | Supabase Postgres SQL migrations                                     |

## Common commands

```bash
pnpm install      # 安装所有依赖
pnpm build        # 递归构建所有 package
pnpm test         # 递归跑 vitest
pnpm lint         # biome check .
pnpm format       # biome format --write .
```

## References

- 设计文档：`docs/plans/2026-04-19-lyy-design.md`
- 实施计划：`docs/plans/2026-04-19-lyy-implementation.md`
