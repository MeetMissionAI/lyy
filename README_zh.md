# LYY — Link Your Yarn

Claude Code 会话之间的点对点聊天通道。问同事问题不用占用你自己的会话，让他那边的
Claude 在独立 thread 里起草回复。对话跨天保持，不污染任何一方的主会话上下文。

*English version: see [README.md](./README.md).*

---

## 目录

- [安装](#安装)
- [配对到 relay](#配对到-relay)
- [日常使用](#日常使用)
  - [启动](#启动)
  - [读 inbox](#读-inbox)
  - [打开 thread](#打开-thread)
  - [写消息](#写消息)
  - [在 thread 里 @Claude](#在-thread-里-claude)
  - [从 Claude 的提示词里发消息](#从-claude-的提示词里发消息)
  - [多 profile](#多-profile)
- [升级](#升级)
- [故障排查](#故障排查)
- [管理员：发放邀请](#管理员发放邀请)
- [自部署 relay](#自部署-relay)
- [架构概览](#架构概览)
- [开发](#开发)

---

## 安装

macOS 和 Linux 一行命令安装，不需要 sudo（装到 `~/.lyy/bin`）。

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
```

做什么：

1. 从 GitHub Releases 拉最新的四个 tarball（`lyy-cli`、`lyy-daemon`、`lyy-mcp`、
   `lyy-tui`）。
2. 解压到 `~/.lyy/runtime/`。
3. 把每个 bin 的 shebang 固定到当前的 `node` 绝对路径（避免 Claude Code 用精简
   PATH spawn MCP 时找不到 node）。
4. 在 `~/.lyy/bin/` 下建 `lyy`、`lyy-daemon`、`lyy-mcp`、`lyy-tui` 的符号链接。
5. 把 `~/.lyy/bin` 加到你的 shell rc（`.zshrc` / `.bashrc` / fish）。
6. 如果 [`zellij`](https://zellij.dev) 没装，macOS 下用 `brew` 自动装 —— LYY 靠
   zellij 把 Claude 和 TUI 并排放两栏。

**前置**：`node >= 20`、`curl`、`tar`。macOS 自动装 zellij 需要 `brew`；没装就打印
手动提示继续。

验证：

```bash
lyy --version       # 0.2.7 或更新
lyy doctor          # identity / daemon / relay / zellij / rogue-daemon 检查
```

Shell 还没生效就开新终端或 `source ~/.zshrc`。

---

## 配对到 relay

每个新用户需要管理员发的一次性邀请码（见下方
[管理员：发放邀请](#管理员发放邀请)）。

```bash
lyy init \
  --invite <INVITE_CODE> \
  --name <你的短名> \
  --email <you@your-team.com>
```

这一步会：

- 在 relay 消费掉邀请。
- 生成你的 peer 身份（`~/.lyy/identity.json`），只存本地。relay 侧只保存 peer
  ID、名字和它给你签的 JWT。
- 在 `~/.claude/settings.json` 里注册 `lyy` MCP server，让 Claude Code 能调
  `send_to`、`list_inbox`、`suggest_reply` 等工具。
- 装 statusline hook 让你的 Claude 提示符里显示未读 peer 消息。

`--relay-url` 默认指向团队 relay；自部署传 `--relay-url <url>`。

---

## 日常使用

### 启动

```bash
lyy
```

打开 `zellij` session，两栏并排：

- **左**：Claude Code，就像直接跑 `claude`。
- **右**：`lyy-tui`，peer 列表 + thread 视图。

两栏共享后台同一个 `lyy-daemon`。关掉 zellij session **不** 杀 daemon —— 它继续连
着 relay，新消息仍然会写进 `state.json`，下次启动能看到。用 `Ctrl+q` 或 `exit`
退出 zellij。

### 读 inbox

TUI 分两栏：

- **Peers**：relay 上所有人（绿色 ● = 当前在线，灰色 ○ = 离线）。
- **Threads**：进行中的对话，最近活跃优先。未读行黄色闪烁。每行显示
  `#<id>  @<peer>  <最后一条预览>`。

底部状态栏 `v<LYY_VERSION> · daemon ● · relay ●`。

列表视图快捷键：

| 键      | 动作                          |
| ------- | ---------------------------- |
| `Tab`   | 焦点 Peers ↔ Threads 切换    |
| `↑ ↓`   | 在当前焦点栏里移动            |
| `Enter` | 打开选中行                    |
| `Esc`   | 返回（thread → 列表）         |

### 打开 thread

- **从 Threads 栏**：Enter 打开该 thread 的历史。
- **从 Peers 栏**：Enter 复用该 peer 已有的 thread，没有就新开一个。

Thread 视图时间戳+消息，最新在底部，下方是单行输入框。

### 写消息

在 thread 里：

- 正常打字。
- `Enter` 发送。
- `\` 再 `Enter` 插入换行（不发送，方便多行）。
- `Backspace`、方向键、`Ctrl+A` / `Ctrl+E`（行首/行尾）、`Ctrl+U` / `Ctrl+K`（删
  到行首/行尾）、`Ctrl+W`（删单词）、`Ctrl+Z` / `Ctrl+Y`（撤销/重做）都支持。
- 支持粘贴多行文本（会自动剥掉 bracketed-paste 标记）。
- 发送失败会把 draft 还原回输入框让你重试。

### 在 thread 里 @Claude

消息开头写 `@Claude `（或别名 `@CC`，大小写不敏感，标点可带可不带）：

```
@Claude, 这里用什么 schema 比较好?
```

按 `Enter` 后：

1. 把当前 thread 的全部历史 + 你的问题。
2. 通过 `zellij action write-chars` 灌进左边 Claude 窗口，Claude 看到：
   `You are in LYY thread #7 with @alice. Help me craft a reply. History: [...] My question: 这里用什么 schema 比较好?`
3. Claude 用自己的上下文来处理 —— 想好了调 `lyy.suggest_reply` MCP 工具回传 draft。
4. TUI 在你的 thread 里弹一张青色卡片：`💡 Claude: <draft>`，
   `[Tab: accept · Esc: dismiss]`。
5. `Tab` 把 draft 放进输入框；正常编辑 + 发送。

### 从 Claude 的提示词里发消息

在 Claude Code 里直接说你想说的：

```
> 问一下 Leo 这个功能能不能做。
```

Claude 用 `lyy.send_to` 工具开 / 续一个 thread 给 Leo。TUI 里能看到刚发出的消息。

Claude 可用的相关 MCP 工具（`lyy init` 自动配好）：

- `list_peers` —— 列出 relay 上所有人。
- `list_inbox` —— 读自己的未读摘要。
- `read_thread` —— 拉 thread 最近的消息。
- `send_to` / `reply` / `archive_thread` —— 标准操作。
- `search` —— 对自己的 thread 做全文搜索。

### 多 profile

同一台机器要两个不同身份（个人 + bot，或 demo 用的 alice-test + bob-test 等），
加 `--profile`：

```bash
lyy --profile alice
lyy --profile bob        # 另一个终端
```

每个 profile 独立 identity、state、daemon PID 锁、zellij session。两者可以通过
relay 互发消息。profile 根目录是 `~/.lyy/profiles/<名字>/`。runtime binary 共享。

---

## 升级

不用你操心。每次非 dev 启动时，`lyy` 打一次 GitHub Releases（用
`If-None-Match` 缓存，304 响应不消耗 rate-limit 配额）。有新版本就并发下载四个
tarball + `SHA256SUMS.txt` 校验，原子 swap `~/.lyy/runtime/`，再 re-exec 进新的
`lyy` —— 全程在 `zellij` 打开之前完成。升级一次 2-5 秒，空查 ~100 毫秒。

失败场景（网挂、checksum 不对、tar 坏）fail-soft：打警告、清 staging 目录、继续
用旧版。

临时跳过一次：`LYY_JUST_UPGRADED=1 lyy ...`。

降级 / 钉版本，重跑安装脚本：

```bash
LYY_VERSION=v0.2.5 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
```

---

## 故障排查

先跑：

```bash
lyy doctor
```

常见问题：

- **`daemon: ... missing`** —— daemon 挂了（崩溃或 SIGKILL）。下次 `lyy` 会自动
  拉起。
- **`rogue daemons: N rogue pid(s)...`** —— 之前遗留的 `lyy-daemon` 进程没被
  profile 的 `daemon.pid` 认领。`lyy doctor --fix-daemons` SIGKILL 这些游离进程。
- **`zellij: ... not on PATH`** —— 手动装：`brew install zellij`，或看
  <https://zellij.dev/documentation/installation>。没 zellij 时 `lyy` 退化到裸
  `claude`，TUI 栏不会开。
- **TUI 底部显示 `relay ○`（红）** —— daemon 连不到 relay。检查网络 +
  `~/.lyy/profiles/<名字>/daemon.log`。
- **消息收不到** —— 先确认两边都是 v0.2.5 或更新（`lyy --version`）。daemon 启动
  时会版本握手 SIGTERM 不匹配的老 daemon；非常老的部署要再手动跑一次
  `bootstrap.sh` 启动 auto-upgrade 路径。

完整卸载 + 重装：

```bash
pkill -f lyy-daemon 2>/dev/null; pkill -f lyy-tui 2>/dev/null
rm -rf ~/.lyy
sudo rm -f /usr/local/bin/lyy /usr/local/bin/lyy-daemon /usr/local/bin/lyy-mcp /usr/local/bin/lyy-tui
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
lyy init --invite <新邀请码> --name <短名> --email <邮箱>
```

---

## 管理员：发放邀请

新用户需要一次性邀请码。有 DB 访问权限的管理员发放：

```bash
# 在 repo 根目录，确保 env 里（或 .env 里）有 DATABASE_URL：
lyy admin invite teammate@your-team.com
```

可选参数：

- `--days <n>` —— 邀请码有效期天数（默认 7，最大 90）。
- `--code <code>` —— 覆盖自动生成的邀请码。适合脚本化 / 可预测码。
- `--db-url <url>` —— 覆盖 `DATABASE_URL`。
- `--relay-url <url>` —— 覆盖 join 命令里打印的 URL（默认团队 relay）。

输出是邀请码 + 可以直接复制给新同事的 `lyy init` 一行。

---

## 自部署 relay

LYY 的 CLI 侧（daemon、TUI、MCP）通过 bootstrap 和 auto-upgrade 完全跑在用户本地。
唯一需要自部署的是 **relay** —— 一个无状态 Node 服务，负责 WebSocket 接入、JWT
校验、把消息通过 Postgres 中转。

### 基础设施要求

| 组件            | 最小配置                                                | 说明                                                                                        |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Postgres 14+    | 1 个小实例                                             | Supabase、RDS、Neon、自托管都行。daemon 层不碰 Postgres，只有 relay 碰。                    |
| 容器主机        | 1 pod / 1 VM / 1 台 Fly，256 MiB RAM、100m CPU         | K8s、Fly.io、Render、ECS —— 能跑 Docker 镜像就行。                                          |
| 镜像仓库        | 你主机能 pull 的任何 OCI registry                      | CI workflow（`.github/workflows/ci.yml`）在 tag 推送时自动 build + push，默认 ECR。改 GHCR / Docker Hub 改 workflow 即可。 |
| TLS + 域名      | 一个支持 HTTPS + WSS 的主机名                          | Socket.IO 会 upgrade 到 WebSocket，你的 ingress 必须允许 WS。单副本 relay 不需要 sticky session（团队级够用）。 |
| GitHub Actions  | tag-push 触发 + 镜像仓库凭证                           | 可选。也可手动 `docker build -f packages/relay/Dockerfile .`。                              |

扩展性：relay 除了内存里的 socket.io session 没别的状态。想多副本就在 LB 后面开，
前提是 LB 支持 WebSocket sticky session（或者你上 Socket.IO Redis adapter）。团队
规模（< 50 并发）单副本就够。

### relay 环境变量

| 名称              | 必填 | 默认值         | 说明                                                                |
| ----------------- | ---- | -------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`    | 是   | —              | 完整 Postgres URL（`postgres://user:pass@host:5432/dbname`）。      |
| `JWT_SIGNING_KEY` | 是   | —              | 给 peer JWT 签名的密钥。≥ 32 随机字节（如 `openssl rand -base64 48`）。|
| `PORT`            | 否   | `3000`         | 监听端口。                                                          |
| `HOST`            | 否   | `0.0.0.0`      | 监听地址。                                                          |

### 数据库初始化

`migrations/` 下两个 SQL 文件按序执行。最简单：

```bash
psql "$DATABASE_URL" < migrations/0001_init.sql
psql "$DATABASE_URL" < migrations/0002_thread_participants_peer_idx.sql
```

会建 `peers`、`threads`、`thread_participants`、`messages`、`reads`、
`archives`、`invites` 这几张表。没接 migration runner —— 保持文件幂等手动应用新
的即可，或者上 `dbmate` / `sqitch` / `prisma migrate` 跑裸 SQL。

### 构建 relay 镜像

在 repo 根目录：

```bash
docker build -f packages/relay/Dockerfile -t lyy-relay:<tag> .
```

Dockerfile 多阶段，只打 `@lyy/shared` + `@lyy/relay`（CLI 不进 runtime 镜像），产物
~80 MB node:20-alpine。

CI 自动走这条：推一个 `v*` tag 触发 `.github/workflows/ci.yml`，按你配的 secret
build + push 到镜像仓库。自 fork 的做法：改登录步骤、改 `ECR_REPOSITORY` env、加
自己的 `AWS_GITHUB_ROLE_ARN`（或等价）secret。

### 部署

任何容器主机都行。注意：

- 把 `PORT`（默认 3000）暴露给 ingress。
- ingress 必须终结 TLS 并透传 `Upgrade: websocket` —— 客户端用
  `io(url, { transports: ["websocket"] })` 连，从 HTTP polling 升级到 WS。
- liveness：`GET /health` 返回 `{ ok: true }` 200，探针指这里。
- 日志：stdout 结构化 JSON。grep `[presence]` 看 socket connect/disconnect 追踪。

本 repo 里没有共享的部署 manifest（Kubernetes 的 `deploy/` 按团队规则 git-ignore，
不把集群名 + ECR 路径公开）。起步参考：

- **K8s**：1 副本 `Deployment`，`Service` ClusterIP 3000，`Ingress`（或 Gateway
  HTTPRoute）走 TLS + WS。`envFrom` 一个 sealed-secret 装
  `DATABASE_URL` + `JWT_SIGNING_KEY`。
- **Fly.io**：直接 `fly launch` 用 Dockerfile，`fly secrets set` 设两个密钥。Fly
  免费处理 TLS + WS。
- **Render / Railway**：从 Dockerfile 建 Web Service，UI 里填 env vars。都默认
  支持 WS。

### 第一个队员

指向你的新 relay：

```bash
LYY_RELAY_URL=https://your-relay.example.com lyy admin invite admin@your-team.com
```

然后管理员自己机器：

```bash
lyy init \
  --invite <code> \
  --name admin \
  --email admin@your-team.com \
  --relay-url https://your-relay.example.com
```

之后 `lyy admin invite ...` 给其他人发。每个新用户 `lyy init` 带 `--relay-url`
把地址写进他自己的 identity，后续运行就不需要再传 flag。

### 自部署的 auto-upgrade

CLI 的 auto-upgrader 从 `MeetMissionAI/lyy` 的 GitHub Releases 拉 tarball
（写死的 —— 见 `packages/cli/src/upgrade.ts`）。如果你 fork 这个 repo 自己搞，改那
里的 `REPO` 常量 + `scripts/bootstrap.sh` 的 `REPO=` 行，在自己的 fork 里发
release。只 fork relay 端，客户端还能持续吃上游的更新（只要线上协议兼容）。

---

## 架构概览

```
  你的机器                                      同事的机器
  ────────                                      ──────────
  zellij                                        zellij
  ├── Claude Code  ──┐                     ┌── Claude Code
  │   └─ lyy-mcp    │                     │   └─ lyy-mcp
  └── lyy-tui       │                     └── lyy-tui
                    │                                │
                    ▼                                ▼
              lyy-daemon ── socket.io ──────── lyy-daemon
                    │                                │
                    └──────── HTTPS / WSS ───────────┘
                                    │
                                    ▼
                             relay 服务（K8s）
                             ├─ Socket.IO（实时推送）
                             ├─ Fastify（REST）
                             └─ Supabase Postgres
                                （peers、threads、messages）
```

- **relay 服务**：K8s 部署，Node + Socket.IO 推送，Fastify 起 REST。Supabase
  Postgres 存 peers、threads、messages、archives。持久化消息让 daemon 重连后能
  resync。
- **`lyy` CLI**：薄 launcher。auto-upgrade runtime、确保 daemon 在跑、写 zellij
  layout，`exec` 到 `zellij`。
- **`lyy-daemon`**：per-profile 的常驻 sidecar。维持到 relay 的 WebSocket、维护
  `state.json`，通过 `~/.lyy/profiles/<name>/` 下的 Unix socket 跟本机其它进程
  （TUI + MCP）通讯。
- **`lyy-mcp`**：Claude Code 启动时 spawn 的 MCP server。暴露 peer 操作工具
  （`send_to`、`read_thread`、`suggest_reply`、…）。本质是 daemon IPC 的薄代理。
- **`lyy-tui`**：Ink TUI（peers + threads 列表 + thread 详情 + 输入）。订阅
  daemon 实时更新。

`docs/plans/` 下有详细的设计文档（数据模型、迁移、流程、思路）。

---

## 开发

Monorepo 布局：

```
packages/
  shared/   共享类型、Postgres 客户端、repo 层
  relay/    relay 服务（Node + Fastify + Socket.IO）
  daemon/   本地 sidecar
  mcp/      MCP server
  cli/      lyy CLI + auto-upgrade
  tui/      React Ink TUI
```

工具链：pnpm workspaces、TypeScript、vitest、biome、Node 20+。

```bash
pnpm install     # 装所有依赖
pnpm build       # 所有 package 的 tsc -b
pnpm test        # vitest run（LYY_SKIP_DB=1 跳过 Postgres 测试）
pnpm lint        # biome check
pnpm format      # biome format --write
```

迭代开发时把仓库源码链到全局 `lyy`：

```bash
sudo ./scripts/link-local.sh
```

这会把 `~/.lyy/bin/{lyy,lyy-daemon,lyy-mcp,lyy-tui}` 换成
`packages/*/bin/*-dev` 的 shim，直接用 `tsx` 跑 repo 里的 `src/bin.ts`。dev 安装
会跳过 auto-upgrade。`./scripts/link-local.sh --unlink` 恢复 bootstrap 安装的
runtime。

设计文档和实施计划都在 `docs/plans/`。
