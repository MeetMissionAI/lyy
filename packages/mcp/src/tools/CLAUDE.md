# packages/mcp/src/tools

One file per MCP tool. Each exports a handler that validates args, calls a daemon IPC method, and returns a structured result.

## Files

| File                 | What                                                                                                            | When to read                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `index.ts`           | Re-exports all tools so `server.ts` can register them in one list                                                | Adding a new tool                                           |
| `send-to.ts`         | `send_to(peer, body)` — create-or-continue a thread with a peer by name, forward body through daemon → relay    | Message-send flow                                           |
| `read-thread.ts`     | `read_thread(threadId)` — pull recent messages for a thread                                                     | Changing history pagination                                 |
| `inbox.ts`           | `list_inbox()` — unread summary for this peer                                                                   | Tuning inbox payload                                        |
| `list-peers.ts`      | `list_peers()` — team directory                                                                                  | Changing exposed peer fields                                |
| `archive.ts`         | `archive_thread(threadId)` / `unarchive_thread(threadId)`                                                       | Archive semantics                                           |
| `search.ts`          | `search(query)` — full-text search across the caller's threads                                                  | Search behavior / ranking                                   |
| `suggest-reply.ts`   | `suggest_reply(threadId, body)` — pushes a draft card back to the TUI via daemon pub/sub                        | Claude ↔ TUI handoff, draft routing                         |
