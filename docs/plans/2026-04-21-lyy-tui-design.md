# LYY TUI: 专属聊天窗 + @Claude 双向桥

**日期**：2026-04-21
**状态**：design approved，待 implementation plan

## 背景

现有交互把聊天割裂：

- 收到消息只有 statusLine 闪 📬，看内容必须 `/pickup` 起新 pane + 新 claude 实例
- thread-pane 的 claude 另起炉灶，用户工作中的 claude 上下文不能直接用来回信
- 想让 claude 帮忙写回复 → 得自己复制粘贴 thread 历史进去
- OICQ 式"闪头像吸引注意" 体验完全没有

重设：`lyy` 起一个 zellij session，两个 pane——左 claude 跑用户本职工作，右 `lyy-tui` 是专用 chat TUI。三方协作（用户、Claude、同事）走一条显式通道。

## 架构

```
zellij session (lyy-<pid>)                      profile singleton
├── left pane:  claude (用户的工作 Claude)       ~/.lyy/profiles/<name>/
│   └── lyy-mcp (send_to/list_inbox/read_thread/  ├── identity.json
│                suggest_reply new)              ├── state.json
│                                                ├── mcp.sock
└── right pane: lyy-tui (Ink)                    └── inbox/ (保留作离线 buffer)
    └── 视图栈：list ↔ thread 详情 (Esc 回)     lyy-daemon (detached)
                                                 ├ relayClient (socket.io 接消息)
                                                 ├ McpIpcServer (多 client:
                                                 │   lyy-mcp + lyy-tui)
                                                 └ subscribe push → lyy-tui
```

**TUI 栈**：React Ink (`ink`, `ink-text-input`, `ink-select-input`)。新 monorepo package `packages/tui/`。

**daemon 只管后端**（socket.io 桥 + state + IPC）。pane 注入 claude 是 TUI 自己做的事（TUI 在 zellij 内，天然有 `$ZELLIJ_SESSION_NAME`）。

## 数据流

### 1. 收消息 → TUI 实时刷新
```
alice → relay → daemon.relayClient "message:new"
  ├ router 更新 state.json + paneInbox.append（离线 buffer 保留）
  └ subscribe listeners 推 event → TUI
         ├ list 视图：未读 +1，该 thread 闪色（yellow↔white 500ms 循环）
         └ thread 详情视图（若正在该 thread）：新行 append 到历史 scroll
```

### 2. TUI 直接回
```
用户在 thread 详情底部输入框敲消息 → 回车
  → IPC send_message(threadId, body) → daemon → relay POST /messages
  → TUI 乐观渲染（输入框清空 + 本地追加自己的行，不等回波）
```

### 3. @Claude 注入左 pane
```
用户在 TUI 输入框开头打 "@Claude " 前缀 + 问题 → 回车
  → TUI 本地拉 read_thread 全历史（IPC）→ 拼 prompt:
     "You are in LYY thread #363 with @alice. Help me craft a reply.

      History:
      [2026-04-21 10:00] alice: 测试测试
      [2026-04-21 10:05] alice: 收到请回复

      My question: <用户问题>"
  → TUI 调 shell:
     spawn("zellij", ["action", "move-focus", "left"])
     spawn("zellij", ["action", "write-chars", prompt])
  → 左 pane claude 输入框自动填入 prompt，用户看见、编辑、回车提交
```

**多行处理**：write-chars 传 `\n` 很可能被 claude 当 submit。第一步尝试 write-chars 原生；若炸则用 `zellij action write -- <bytes>` 加 bracketed paste 转义（`\x1b[200~...\x1b[201~`）。Phase 5 实测定方案。

### 4. Claude → TUI 建议
```
Claude 根据左 pane 注入上下文生成回复建议 → 调新工具
  lyy.suggest_reply({ threadId, body })
  → lyy-mcp IPC → daemon → subscribe push → TUI
  → TUI 当前 thread 详情视图底部弹卡片：
     💡 Claude 建议:
       <body>
     [Tab: 接收预填 · Esc: 丢弃]
  → 用户 Tab → body 预填输入框 → 用户改完回车发（走流程 2）
```

## TUI 交互细节

**视图 1：Thread 列表**

```
LYY · alice@test.local · 📬 2 unread
─────────────────────────
  #363  📬 @alice              10:05  ping 收到请回复     ← 闪黄/白
  #312     @bob                09:30  ok                ← 已读，不闪
  #7       @daniel             昨天   见到回复            ← 已读

↑/↓ 选择 · Enter 进入 · /archive 归档 · q 退出
```

- 未读行 `foreground` 在 `yellow`/`white` 每 500ms 切（useEffect + setInterval）
- 点进去后 daemon ack read（IPC + relay POST /reads）→ state.unread=0 → 闪停

**视图 2：Thread 详情**

```
← #363 @alice                               📬 0 unread
─────────────────────────
  [10:00] alice: 测试测试
  [10:05] alice: 收到请回复
  (scroll view 自动滚底)

─────────────────────────
💡 Claude: 好的，收到，稍等。    ← 仅当有 suggestion 时显示
[Tab: 接收 · Esc: 丢弃]
─────────────────────────
> @Claude 帮我想想怎么正式点回  ← 输入框
  Esc 返回列表 · Enter 发送
```

## MCP 工具 + IPC 协议扩展

**新 MCP tool** `suggest_reply` (main-mode only):
```ts
{
  name: "suggest_reply",
  description: "Push a draft reply into the LYY TUI for the user to review and send. Use after the user asked you to help reply to a thread.",
  inputSchema: {
    type: "object",
    properties: {
      thread_id: { type: "string" },
      body: { type: "string" },
    },
    required: ["thread_id", "body"],
  },
  execute: (args, ctx) => ctx.ipc.call("suggest_reply", args),
}
```

**新 IPC methods**：
```ts
// long-lived connection 模式。TUI 连上后 call subscribe → daemon 把该 socket
// 加进 event listeners 集 → push 事件（JSON line with `{ event: ... }` 区别）
subscribe: { params: {}; result: "streaming events" };

suggest_reply: {
  params: { threadId: string; body: string };
  result: { ok: true };
};
```

daemon 内部加 `EventBus`：router + suggest_reply handler 都 emit 事件；subscribe listeners 收到就 socket.write。

**IPC 协议兼容**：现有 request/response JSON line 不变。server push 加 `{ type: "event", ... }` 帧（现在的 response 帧是 `{ id, result }` / `{ id, error }`）。client 区分。

## zellij 布局改

`packages/cli/src/commands/default.ts` 里 `zellijLayout()`:

```kdl
layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    children
  }
  tab name="${name}" {
    pane split_direction="vertical" {
      pane command="claude"
      pane size="40%" command="lyy-tui"
    }
  }
}
```

右 pane 40% 宽。用户可手动 resize（Ctrl+n r ←/→）。

## 死代码清理

完全替换意味着 `/pickup + thread-pane + claude --session-id=<threadId>` 整条线废：

**删除**：
- `packages/mcp/src/tools/spawn-thread.ts` (tool + export)
- `packages/cli/src/commands/thread.ts` (`lyy thread <n>` CLI)
- `packages/cli/src/index.ts` 里 thread 命令注册
- `claude-assets/commands/pickup.md` (slash command)
- `packages/cli/src/commands/hook.ts` 里 thread-mode 分支（SessionStart 注 history / prompt-submit drain inbox）→ 只保留 main 模式 no-op（可能整个 hook 文件可删）
- `packages/daemon/src/pane-registry.ts` 如果不再有 pane 概念，可删；但 paneInbox 仍有离线 buffer 用途，保留文件 + 改 daemon 定期 drain 注入 TUI（实际 subscribe push 已经替代，paneInbox 可能也可以删）

**保留**：
- `claude-assets/commands/inbox.md` → 左 claude 里 `/inbox` 仍能看摘要，TUI 挂了时兜底（但 TUI 一直开着时冗余）——可选
- `send_to` / `list_inbox` / `list_threads` / `read_thread` / `list_peers` / `search` / `archive`：全留，TUI 和 claude 都用
- `reply` tool：没有 thread-mode 了，删
- `statusline`：同一 session 里 TUI 就能看见 inbox，但跨 tab / 裸 claude 仍有用，留

## 实现 Phase（顺序 + 独立可测）

1. **Phase 1**：`packages/tui/` 脚手架 + Ink hello world + 零配置运行 `lyy-tui` binary
2. **Phase 2**：TUI 列表视图，读 state.json + peers（IPC list_inbox + list_peers）。静态（无实时推）
3. **Phase 3**：TUI 详情视图 + 历史滚动（IPC read_thread）。Esc 返回
4. **Phase 4**：daemon subscribe IPC + TUI 实时推（message:new）。OICQ 闪。视图 2 里自动 append 新行
5. **Phase 5**：TUI 输入框 + IPC send_message 发送。乐观渲染
6. **Phase 6**：@Claude 注入（zellij action move-focus + write-chars，实测选多行方案）
7. **Phase 7**：suggest_reply MCP tool + daemon push 卡片。TUI 卡片渲染 + Tab 接收
8. **Phase 8**：zellij layout 改双 pane（`default.ts` zellijLayout）
9. **Phase 9**：/pickup + thread-pane + 相关死代码全删 + hook.ts 瘦身

Phase 1-7 不动现有 `/pickup` 流程（可共存测试）。Phase 8 切 layout。Phase 9 扫尾。

## 验收

- `lyy --profile alice` → 双 pane 出来，左 claude，右 TUI
- alice 发消息 → TUI 列表未读行闪黄
- 进详情看历史 → 回车发回复
- TUI 输入 `@Claude 怎么回` → 左 pane claude 输入框自动填 prompt
- claude 回 `lyy.suggest_reply(...)` → TUI 右下弹建议卡片 → Tab 接受 → 发
- 现有 `/pickup` 命令返回 "该命令已废弃，使用 TUI"（Phase 9）

## 不做（YAGNI）

- 多窗口同时打开 TUI（一 profile 一 TUI 就够）
- TUI 里群聊（schema 支持但 UX 暂不做）
- 声音提示（bell）、桌面通知（macOS notification）
- TUI 图片 / 文件附件预览
- 历史消息搜索（MCP `search` 已在；TUI UI 后加）
- IPC method string union 重构（跟本 plan 并行或后置）
