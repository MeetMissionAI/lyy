# packages/tui/src

React Ink TUI. Single app mounts at startup; views are conditional on `App`'s view state (`list` / `thread` / `newThread`).

## Files

| File                      | What                                                                                                          | When to read                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `bin.ts`                  | Process entry; calls `main()` from `main.tsx`                                                                 | Rarely; edit `main.tsx`                                                       |
| `main.tsx`                | Boot: load identity, make IPC client, fetch initial state + peers, render `<App />`                           | Changing startup data load                                                    |
| `app.tsx`                 | Top-level component: list view (peers + threads + status bar), thread view, newThread view, keyboard routing | UI structure, view transitions, optimistic insert, subscribe reconnect wiring |
| `app.test.tsx`            | App render + keyboard + subscribe-event coverage                                                              | Any `app.tsx` change                                                          |
| `thread-view.tsx`         | Thread detail: history + input box; `@Claude` parser + optimistic draft clear; suggestion card                | Thread UI, input handling                                                     |
| `thread-view.test.tsx`    | Thread view behavior                                                                                          | Thread UI changes                                                             |
| `text-area.tsx`           | Multi-line input (Hermes port): grapheme-aware cursor, word nav, undo/redo, kill-line, paste normalization     | Key handling bugs, Ink v5 key-semantic quirks, cursor rendering               |
| `inject-claude.ts`        | `parseClaudeMention` + `buildClaudePrompt` + `injectIntoClaudePane` (`zellij action write-chars`)              | Claude handoff: mention regex, prompt template, zellij wire                   |
| `inject-claude.test.ts`   | Mention parser + prompt builder tests                                                                         | Changing mention / prompt behavior                                            |
| `ipc.ts`                  | Daemon IPC client: `fetchState/Peers/Thread`, `sendMessage/ToPeer`, `subscribe` with 1s-backoff reconnect     | Adding an IPC call, subscribe lifecycle                                       |
| `use-blink.ts`            | Simple interval hook for unread-row blink                                                                     | Animation tweaks                                                              |
