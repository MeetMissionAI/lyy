# LYY — Link Your Yarn

**Status**: Design approved, pending implementation plan
**Date**: 2026-04-19
**Author**: Jianfeng Liu (@jianfeng) + Claude
**Stakeholders**: MissionAI engineering team

---

## 1. 问题陈述

MissionAI 全员使用 Claude Code 开发。当前两个痛点长期存在：

1. **开发者之间不敢动别人代码**：同仓库多人开发，A 想改一段 B 写的代码，但不知道 B 是否正在同一块做事，也没有轻量通道确认。
2. **非技术同事的 Claude Code 卡在技术决策**：PM / 设计师用 brainstorming skill 推进自己的 app，但遇到"iOS 老机型能撑 60fps 吗"这类判断题只能自己瞎猜或打断同事问。

现有的 Linear / 飞书 / 邮件全是人类工具，Claude Code session 之间没有原生通道。两个 session 之间的上下文传递全靠人肉复制粘贴。

## 2. 产品目标 & 非目标

### 目标（v1）

- 两个 Claude Code session 之间建立持久化双向对话通道
- 消息有已读 / 未读 / archive 状态，跨 session resume 不丢
- 接收方处理 peer 对话时，**主 session 上下文不被污染**
- CLI 触发自然：`lyy send @leo "能不能做 X?"` / Claude 自动触发 via MCP

### 非目标（v1）

- 不做看板（团队约定：做任何事先到 Linear 开 issue，由 Cloud Guideline 规范）
- 不做 Lark / iMessage 等外部通道推送（v2 再加）
- 不做 Agent SDK headless daemon 代答（v2）
- 不做多团队 / 外部协作方支持（v2）
- 不做端到端加密（v1 单团队 self-hosted，信任服务端）
- 不做右侧常驻 pane 的 TUI shell（v2 可能做，v1 用 zellij 分屏）

## 3. 架构总览

```
┌───────────────────────────────────────────────────────┐
│  Relay Server (K8s Deployment, 1 replica)              │
│  - Node + Socket.IO + HTTP API                         │
│  - JWT 验签                                             │
│  - 消息路由 by peerId                                    │
│  - Thread 持久化 (Supabase Postgres)                    │
│  - Attachments 存储 (Supabase Storage)                  │
└────────────────────────▲──────────────────────────────┘
                         │ wss://
                         │
┌────────────────────────┴──────────────────────────────┐
│  每人本地 Mac:                                          │
│  ┌─────────────────┐    ┌────────────────────────┐    │
│  │ lyy CLI         │    │ lyy-daemon              │    │
│  │ (zellij 启动)   │    │ (sidecar, 常驻)         │    │
│  └────────┬────────┘    │ - 连 relay (socket.io)   │    │
│           │             │ - 写 ~/.lyy/state.json   │    │
│           ▼             │ - spawn thread pane     │    │
│  ┌─────────────────┐    │ - 注入消息到 pane stdin │    │
│  │ claude (主)     │◄───┤                         │    │
│  │ + lyy-mcp       │    └─────────────┬──────────┘    │
│  └─────────────────┘                  │                │
│  ┌─────────────────┐                  │                │
│  │ claude (thread) │◄─────────────────┘                │
│  │  pane N         │   独立 session, 独立 context     │
│  │ + lyy-mcp       │                                   │
│  └─────────────────┘                                   │
└───────────────────────────────────────────────────────┘
```

## 4. 组件设计

### 4.1 Relay Server

- **部署**：K8s Deployment (1 replica)，Service 走 Ingress (wss + tls)
- **语言 / 栈**：Node + TypeScript + Socket.IO
- **职责**：
  - JWT 验证每个 daemon 的身份
  - 路由消息（按 peerId 投递到目标 daemon）
  - 接受消息、写入 Supabase Postgres、给 sender 返回 seq ack
  - 推送新消息 / 状态变化到目标 daemon
  - HTTP API 处理非实时动作（archive, 历史搜索, thread 列表）
- **容器镜像**：发布到公司现有镜像仓库
- **Secret**：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`JWT_SIGNING_KEY`
- **监控 / 日志**：走公司现有 stack

### 4.2 数据库（Supabase Postgres）

表结构：

```sql
-- 用户目录
peers (
  id UUID PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,       -- "leo", "jianfeng", ...
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 邀请码（首次 pair 用，一次性）
invites (
  code TEXT PRIMARY KEY,
  for_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- Thread
threads (
  id UUID PRIMARY KEY,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ DEFAULT now()
);

-- Thread 参与者（多对多）
thread_participants (
  thread_id UUID REFERENCES threads(id),
  peer_id UUID REFERENCES peers(id),
  PRIMARY KEY (thread_id, peer_id)
);

-- 消息
messages (
  id UUID PRIMARY KEY,
  thread_id UUID REFERENCES threads(id),
  from_peer UUID REFERENCES peers(id),
  body TEXT NOT NULL,
  body_tsv TSVECTOR,               -- 全文搜索
  sent_at TIMESTAMPTZ DEFAULT now(),
  seq BIGSERIAL                    -- thread 内单调递增
);

CREATE INDEX messages_thread_seq ON messages(thread_id, seq);
CREATE INDEX messages_tsv ON messages USING GIN(body_tsv);

-- 已读状态（per-peer）
message_reads (
  message_id UUID REFERENCES messages(id),
  peer_id UUID REFERENCES peers(id),
  read_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (message_id, peer_id)
);

-- Archive 状态（per-peer）
thread_archives (
  thread_id UUID REFERENCES threads(id),
  peer_id UUID REFERENCES peers(id),
  archived_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (thread_id, peer_id)
);

-- 附件
attachments (
  id UUID PRIMARY KEY,
  message_id UUID REFERENCES messages(id),
  storage_path TEXT NOT NULL,      -- Supabase Storage path
  mime TEXT,
  size BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.3 lyy-daemon（本地 sidecar）

- **语言**：Node + TypeScript
- **启动**：`lyy init` 时注册为 LaunchAgent（macOS），开机自启
- **职责**：
  - 启动后用 `~/.lyy/identity.json` 里的 JWT 连 relay
  - 监听 Socket.IO push：新消息、状态变化
  - 收到消息后：
    - 判断 thread 对应 pane 是否在本机开着（通过 IPC Unix domain socket 问 MCP 服务集合）
    - 开着 → 把消息注入到对应 pane 的 claude stdin（作为 `<peer-msg from=@jianfeng>...</peer-msg>` 的 user message）
    - 关着 → 更新 `~/.lyy/state.json` 的未读计数，statusLine 下次刷新读取
  - 处理 daemon ↔ MCP 的 IPC 请求：spawn_thread、send_to、pickup、archive 等
- **状态文件**：
  - `~/.lyy/identity.json` — peerId, JWT
  - `~/.lyy/state.json` — 未读计数、最近 50 thread 摘要、各 thread `lastSeenSeq`
  - `~/.lyy/cache/threads/<id>.jsonl` — 可选本地历史缓存
  - `~/.lyy/pane-registry.sock` — Unix socket 让 MCP 通告"我开在哪个 session-id 的 pane 里"

### 4.4 lyy-mcp（MCP Server）

Claude 从这里拿到 peer 协作工具。

暴露的工具：

| Tool | 作用 |
|---|---|
| `send_to(peer, body, attach_files?)` | 新建 thread 或延续最近活跃 thread，发一条消息 |
| `send_to_new(peer, body, attach_files?)` | 强制新 thread |
| `list_inbox(limit?, include_archived?)` | 列未读 / 活跃 thread |
| `read_thread(thread_id)` | 拉 thread 完整历史 |
| `reply(body, attach_files?)` | 在当前 thread pane 内回复（thread 模式才能用） |
| `attach(file_paths)` | 给下一条 reply 附件 |
| `spawn_thread(thread_id)` | 请 daemon 在 zellij 新 pane 开这个 thread |
| `archive_thread(thread_id)` | 自己视角 archive |
| `search(query, peer?, since?)` | 全文搜索（Postgres FTS） |
| `who_is(peer_name)` | 从目录解析 peer |

主 session 和 thread session 加载同一份 lyy-mcp，但 thread 模式下 Claude 的 system prompt 会提示它"你当前在回复 peer，主用 reply / attach / close"。

### 4.5 lyy CLI

- `lyy init` — 首次 pair，换 JWT，装 LaunchAgent
- `lyy` — 启动 zellij session（如未 attach），进入主 Claude Code pane。wrapper 内部用 `node-pty` 包真 `claude`
- `lyy thread <id>` — 直接开指定 thread 的 pane
- `lyy doctor` — 检查 daemon / zellij / claude 状态
- `lyy resume` — 恢复上次 layout（多个 thread pane 都恢复）

### 4.6 终端多路复用：zellij

- 用 zellij 做 multi-pane（屏幕底部 keybind 提示对非技术同事友好）
- 如果用户没装 zellij 且配置 `threadWindow: "terminal"`，daemon 用 AppleScript 开 iTerm2/Terminal 新窗口代替
- 默认 layout：主 pane 占满，peer thread 开启时水平切上一条

## 5. 核心流程

### 5.1 首次配对

```
管理员:     在 relay DB 插一条 invite（CLI 工具或 Supabase UI）
           → invite code 发给 Leo

Leo:       brew install lyy && brew install zellij
           lyy init --invite <code>
           → CLI 生成 keypair（或纯 token 模式）
           → POST /pair  { code, email, name }
           → relay 返回 { peerId, jwt }
           → 写入 ~/.lyy/identity.json
           → 装 LaunchAgent 启动 daemon
           → 装 Claude Code 的 ~/.claude/settings.json 配置（statusLine、hooks、MCP）
           → 装 ~/.claude/commands/{inbox,pickup,reply,send-to}.md
```

### 5.2 发消息（主 session）

```
Jianfeng:  在他的主 session 里说 "问一下 Leo 能不能做 X"
Claude:    理解意图 → 调 send_to("leo", "能不能做 X?")
lyy-mcp:   IPC 到 daemon → HTTP POST relay /messages
relay:     写 Postgres（新 thread + msg1），分配 seq
           → Socket.IO push 到 Leo 的 daemon
Leo daemon:判断 Leo 当前没开 thread #12 的 pane
           → 更新 ~/.lyy/state.json: unread=1, thread=#12
           → statusLine 下次刷新（最多 5 秒后）显示 "📬 #12 @jianfeng"
           （thread 编号在最前，用户直接知道 /pickup 12）
```

### 5.3 接收 + 首次 pickup

```
Leo:       看到 statusLine 提示
           → 在主 session 敲 "/pickup 12" 或说 "接一下 jianfeng"
Claude:    调 spawn_thread(thread_id)
lyy-mcp:   IPC 到 daemon, 带 thread_id
daemon:    zellij run "claude --session-id=lyy-thread-12"（新 pane）
           → 新 pane 的 SessionStart hook 检测 session-id 匹配 lyy-thread-*
              → 从 daemon 拉 thread 历史 + system prompt 注入
daemon:    通过 pane-registry.sock 登记"#12 在 pane X 开了"
Leo (新 pane): 看到 jianfeng 的问题 + 附带上下文
           → "帮我问他用啥库"
Claude:    调 reply("你用啥库?")
lyy-mcp:   daemon → relay POST /messages（含 thread_id, in_reply_to）
           → mark_read #12 的所有 msg（Leo 看到了）
           → relay push 给 jianfeng daemon
```

### 5.4 多轮往返 + pane 复用

```
Jianfeng daemon 收到 reply:
  查 pane-registry: Jianfeng 也已开 thread #12 的 pane
  → 直接把消息注入那个 pane 的 claude stdin
  → Jianfeng 的 Claude 看到 "<peer-msg from=@leo>你用啥库?</peer-msg>"
  → "Lottie, 1.2MB"
  → Claude 自动（或 Jianfeng 引导）调 reply(...)
  → 往返继续

如果 Jianfeng 没开 thread pane:
  → 进 inbox, statusLine 刷新
  → Jianfeng /pickup 后恢复（claude --resume lyy-thread-12）
```

### 5.5 Archive / close

- `/close` 在 thread pane 里 = 关闭 pane（thread 还活着，relay 里保留）
- `/close --archive` = 关闭 pane + 自己视角 archive thread
- `/archive N` 在主 session 也能调
- Archive 后此 thread 从 inbox / statusLine 消失；对方仍看得到
- 对方再发新消息 → 自动 un-archive（重回 inbox）

## 6. 主 session 上下文不污染的保证

| 层 | 机制 |
|---|---|
| 消息体 | 永远不注入主 session；只 thread pane 才看得到 |
| 主 session 看到的只有 | `send_to` / `spawn_thread` 的 tool 调用结果（几十 tokens） |
| Thread pane 的 context | 独立 claude session，独立 `.claude/projects/*.jsonl`，独立 token 预算 |
| Thread pane 关闭 | 不影响主 session；下次 `--resume` 完整恢复 |

## 7. 安全 / 身份（v1 极简）

- **认证**：JWT 签发一次，长期有效。存 `~/.lyy/identity.json` 权限 `600`
- **授权**：relay 侧校验 JWT → 识别 peerId → 仅允许发消息给同团队成员
- **传输加密**：wss (TLS) 由 Ingress 提供
- **无 E2E**：v1 服务端明文存储，简化搜索 / 备份 / 调试。用户文档明确告知
- **撤销**：管理员在 DB 里把 peer 置 `disabled`，relay 拒收该 JWT

## 8. 状态管理细节

| 状态 | 存放 | 更新时机 |
|---|---|---|
| 消息本体 | Supabase Postgres `messages` | POST /messages |
| 已读 | `message_reads`（per-peer） | pane 显示时 / resume thread 时 |
| Archive | `thread_archives`（per-peer） | 用户主动 archive |
| 附件 | Supabase Storage | 随消息上传 |
| 本地未读计数 | `~/.lyy/state.json` | daemon 收到 push 时更新 |
| statusLine 显示 | 读 `~/.lyy/state.json` | Claude Code statusLine 轮询（默认 5s） |

## 9. MVP 范围 & 交付计划

### v1 Must-have

- Relay server（K8s 部署）
- Supabase schema + FTS
- lyy CLI（`init`, bare, `thread`, `doctor`）
- lyy-daemon（连接、路由、pane 注入、状态同步）
- lyy-mcp（核心工具 9 个）
- Claude Code 集成（statusLine、SessionStart/Stop/UserPromptSubmit hook、4 个 slash commands）
- zellij 集成（auto-bootstrap，配置 inject）
- 入门文档（README + 非技术同事 onboarding 指南）

### v1 Non-goal（挪到 v2+）

- 飞书 / Lark 通知（调 Stella MCP）
- Agent SDK headless daemon（Leo 不在时代答）
- 右侧常驻 pane TUI shell（OpenTUI 或 Ink）
- 端到端加密
- 多团队 / 外部合作方
- Linear 集成（团队约定即可）

### 工程量估算

- Week 1: Relay + schema + JWT auth + 最小 send/receive 闭环（Jianfeng 能发消息给 Leo 写进 DB）
- Week 2: Daemon + MCP + pane 注入 + zellij 集成 + slash commands
- Week 3: statusLine + hooks + archive / state / search + 文档

**2-3 周出 dogfoodable demo**（Jianfeng ↔ Leo 两人先跑）

## 10. 开放问题 / 后续

- **多设备同步**：v1 假设每人一台 Mac。公司配双机（比如台式 + 笔记本）时需要处理同 peerId 多 JWT 或多设备 session。v2 处理。
- **消息订正 / 撤回**：v1 不做，如需要 v2 加 `edit` / `retract`。
- **Mention in body**：body 里 `@leo` 是否自动识别为 peer 引用？v1 先不做语法糖。
- **Thread 标题**：v1 自动用首条消息前 40 字，不允许改。v2 可支持改标题。
- **Thread 归并 / 拆分**：v2 再议。
- **权限 / 可见性**：v1 全团队透明。将来要"私聊"或"项目可见域"再加权限模型。

## 11. Cloud Guideline（团队配套约定，非代码交付）

团队单独维护的 `CLAUDE-guidelines.md`（或类似位置），规定：

- 做任何实质性开发前，先在 Linear 开 issue（即使 1 分钟的事）
- 改别人主要负责的模块前，先 `lyy send @原作者 "想改 X，可以吗"` 确认
- 有技术决策卡壳时，用 `lyy send @开发者 "xxx"` 转交
- 非技术同事遇到 Claude Code 问技术问题，直接"问一下 @xxx" 走 LYY

---

## Appendix A: Claude Code 扩展点清单（v1 用到的）

- `statusLine`（配 shell 命令读 `~/.lyy/state.json`）
  - **格式约定：thread 编号永远在最前**，方便用户直接 `/pickup <N>`
  - 单条：`📬 #12 @jianfeng` （thread 12，来自 jianfeng）
  - 多条：`📬 #12 @jianfeng · #18 @sarah` （用 `·` 分隔）
  - 未读 > 5 条时：`📬 #12 @jianfeng +4 more` （只显示最新）
  - 有自己正在开的 thread pane 时附加：`📬 #12 @jianfeng · 🧵 #8 active`
  - 全部已读时 statusLine 隐藏 LYY 段（或显示灰色 `✓ 0 inbox`）
- `SessionStart` hook（thread 模式时注入 thread 上下文 + 系统提示）
- `UserPromptSubmit` hook（主 session 模式下，若有新消息 append 一行提示）
- `Stop` hook（主 session 每轮末尾，若有新消息补一句"顺便：...")
- `.claude/commands/inbox.md` / `pickup.md` / `reply.md` / `send-to.md`
- MCP server（lyy-mcp）自动加载

## Appendix B: happy-cli 借鉴点

- SDK-driven `query(AsyncIterable)` 常驻循环（日后做代答 daemon 时用）
- Socket.IO 云中继拓扑
- MCP-based permission handshake（v2 做 peer consent UI 时复用）
- daemon spawn / detached process 模式
- session-id 持久化（不等于 Claude sessionId）

## Appendix C: 为什么不用 OpenTUI / TUI shell

- OpenTUI / Ink / blessed 都没有现成 pty-terminal widget，嵌入 claude 都要自己写 3-5 天
- v1 的 UX 核心是"能看到有新消息 + 一键接手"，statusLine + slash 命令 90% 覆盖
- 右侧常驻 pane 是 nicer-to-have，等 v1 跑起来发现确实高频再升级

## Appendix D: 不用 E2E 的取舍记录

- v1 单团队 self-hosted，relay server 你们自己的 K8s，攻击面已闭合
- 明文服务端 → Postgres FTS 原生可用、备份直接是 DB dump、调试时可读
- 将来加外部合作方 / 合规要求 E2E，抄 happy-cli 的 TweetNaCl pairwise key 模式
