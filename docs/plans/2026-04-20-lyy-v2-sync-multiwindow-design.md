# LYY v2: envelope 元数据 + 离线 backfill + 多窗口

**日期**：2026-04-20
**状态**：design approved，待 implementation plan

## 背景

冒烟测试（alice ↔ bob 两 profile 自测）暴露三个问题：

1. **router 状态不更新**：bob 给 alice 发消息 → relay 推到 alice daemon ✓ → 但 alice 的 `state.threads` 是空的（从未拉过 thread 列表）→ router 看 thread 不在本地，**静默吞掉**，unread 不 bump，statusline 不亮，`/inbox` 报空。
2. **离线积压不可见**：bob 离线一周，alice 发了 50 条 → bob 重启 daemon 后只订阅 socket 接新消息，旧的全丢。
3. **多窗口不支持**：用户想同 profile 开 5 个 lyy 实例并行干活，但 `lyy` 启动会 `delete-session NAME --force` 把同名兄弟 session 杀掉。

群聊基础设施（`thread_participants` M:N + relay 路由 `participants - sender`）已经具备，本轮不动。

## 三块改动

### 1. Envelope 携带 thread + peer 元数据

**relay 侧**：`MessageEnvelope` 扩展（旧字段保留向后兼容）：

```ts
interface MessageEnvelope {
  message: Message;
  threadShortId: number; // 保留
  thread: {
    id: string;
    shortId: number;
    title: string | null;
    participants: string[]; // peer IDs
  };
  peers: { id: string; name: string; displayName?: string }[];
}
```

`POST /messages` 完成 insert 后，已经持有 `thread`（事务结果）和 `recipients`，多调一次 `findPeersByIds(db, thread.participants)` 拼好 envelope 传给 broadcaster。

**daemon router 侧**：`handleIncoming` 收到 envelope，看 `state.threads` 有无对应 thread：
- 没有 → 用 envelope.thread + envelope.peers 拼 `ThreadSummary`，append。peerName 取 `participants - selfPeerId` 那个 peer 的 name，fallback `"?"`。
- 有 → 走原 update 逻辑。

兼容：envelope 没带 `thread`/`peers`（老 relay）时回退到当前"跳过 update"行为，记 stderr 一行。

### 2. 启动 sync + 离线 backfill

**触发**：`relayClient.on('connected', ...)` —— 首次连上 + 每次重连都跑。失败只 log，不崩。

**步骤**：
1. `GET /threads?include_archived=true` —— 拿用户 participate 的所有 thread（含 unread / lastMessageAt / participants）
2. `GET /peers` —— 拿 peerId → name 映射
3. 对每个 `thread.unread > 0` 的 thread：`GET /messages?threadId=X&sinceSeq=state.lastSeenSeq[X] ?? 0`
4. 拉到的消息逐条 append 到 `~/.lyy/inbox/thread-N.jsonl`
5. 更新 state.threads：upsert 每个 thread 的 summary（peerName, unread, lastBody, lastMessageAt）
6. lastSeenSeq 推进到最新

**关键变化**：router 不再按 `paneOpen` 决定是否写 paneInbox。**始终 append**。pane 没开时文件累积、pane 开时 SessionStart hook drain 文件即清空。这统一了"在线收到"和"离线积压"两条路径，/pickup 后 thread 历史一次性入上下文。state.json 不需要膨胀去存正文。

### 3. 多窗口（同 profile 5 个 lyy 实例）

**zellij session 命名**：当前 `SESSION_NAME = basename(LYY_HOME)`（如 `alice`），同 profile 多开冲突。改为 `<profile>-<process.pid>`（如 `alice-12345`）。

**生命周期**：
- 启动：**移除** `delete-session NAME --force`（曾经清自己上次的残留，现在每次新建唯一 session，老的不动）
- 退出：仍 `delete-session <my-session-id> --force` 清自己

**daemon 共享**：daemon 是 profile 单例。5 个 lyy 实例的 ensureDaemonRunning 都看到同一个 mcp.sock（pingDaemon 探活），不重复 spawn。已经是这样。

**state.json 多读单写**：
- 读：5 窗口的 statusline / list_inbox 都 IPC 走 daemon 内存 → 安全
- 写：只 daemon atomic tmp+rename → 安全

**paneInbox 多窗口冲突处理**：
- 窗口 A `/pickup #5` → daemon `register_pane(threadId=5, paneId=A_pane_id)` → A 的 zellij 起 thread pane
- 窗口 B 也 `/pickup #5` → daemon 看 paneRegistry 已有 #5 binding → **拒绝**，返回错误信息含 A 的 zellij session 名（提示用户去 A 看）
- 窗口 B 仍想回复：直接用 main 模式的 `send_to` 工具 + `threadId` 字段，不开 pane

## 数据流

```
┌─ Send 侧 (alice) ──────┐
│ POST /messages         │
│  + findPeersByIds      │
│  → enrich envelope     │ ──ws──>
└────────────────────────┘
                                ┌─ Recv 侧 (bob) ──────────────────┐
                                │ daemon (profile singleton)        │
                                │  router.handleIncoming(envelope)  │
                                │   ├ state.threads[i] upsert       │
                                │   └ paneInbox.append (always)     │
                                └───────────────────────────────────┘
                                        ▲
                                        │ shared via mcp.sock
                                        │
                       ┌──────────────────────────┐
                       │ 5 个 lyy 实例 / zellij sess│
                       │ 各自 statusline+claude+MCP│
                       └──────────────────────────┘

启动 / 重连时:
  daemon connected → syncFromRelay():
    GET /threads + /peers
    每 thread GET /messages?sinceSeq → append paneInbox + 更新 state
```

## 涉及文件

**新增**：
- `packages/daemon/src/state-sync.ts`
- `packages/daemon/src/state-sync.test.ts`

**修改**：
- `packages/relay/src/server.ts` — `MessageEnvelope` 类型扩展
- `packages/relay/src/routes/messages.ts` — 拼 envelope，调 `findPeersByIds`
- `packages/shared/src/repo/peers.ts` — 加 `findPeersByIds`
- `packages/shared/src/index.ts` — export
- `packages/daemon/src/router.ts` — handleIncoming 用 envelope 元数据 upsert + 始终写 paneInbox
- `packages/daemon/src/main.ts` — connected handler 触发 sync
- `packages/daemon/src/relay-http.ts` — 已有 listThreads/listPeers/readThread，无需新方法
- `packages/cli/src/commands/default.ts` — session name 加 PID 后缀，移除 pre-delete
- `packages/daemon/src/pane-registry.ts` — `register_pane` 失败时返回 conflict info

**测试**：
- `packages/shared/src/repo/peers.test.ts` — `findPeersByIds`
- `packages/relay/src/routes/messages.test.ts` — broadcaster envelope 含 `thread/peers`
- `packages/daemon/src/router.test.ts` — 未知 thread 走 upsert 路径
- `packages/daemon/src/state-sync.test.ts` — 给 fake relayHttp 喂结果，verify state + paneInbox

## 验收

1. `LYY_SKIP_DB=1 pnpm test` 全绿
2. tag `v0.1.10`，Release workflow 出包
3. 本地 alice/bob 冒烟（详见 `lyy --profile`）：
   - 删 alice state.json，起 alice daemon → 看 `state sync complete`
   - bob 给 alice 发新 thread → alice statusline 立刻亮 📬，`/inbox` 显示
   - alice 杀 daemon → bob 发若干消息 → alice 重启 → /inbox 显示所有未读
   - 同时跑 `lyy --profile alice` 两次（不同 terminal）→ 两个 zellij session 共存（alice-PID1, alice-PID2）
   - 任一 session /pickup #5 → 另一 session /pickup #5 收到 conflict 提示

## 不做（YAGNI）

- 不引入群聊语义（基础设施已支持，UX 暂时延后）
- 不引入 SQLite 替代 state.json + paneInbox
- 不持久化 thread metadata 反向 push（peer rename / archive 状态走下次 sync 自然带过来）
- 不改 send_to 大小写匹配（已有 list_peers 给 Claude 解析）
