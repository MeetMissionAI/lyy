---
description: Show LYY peer inbox (unread + active threads)
---

Call the `list_inbox` MCP tool to fetch the local LYY inbox state.

Format the result as a numbered list, ordered by `lastMessageAt` descending:

```
#<shortId>  @<peerName>  · <lastBody truncated to 60 chars>  · <relative time>  [unread:<n>]
```

If `unreadCount` is 0 say "Inbox is empty (no unread messages)."

At the end print the hint:
> Open the LYY TUI (right zellij pane) and select a thread with ↑/↓ Enter · /archive <shortId> to hide
