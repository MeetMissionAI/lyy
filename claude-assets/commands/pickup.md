---
description: Open a peer thread in a new pane
argument-hint: <thread-shortId>
---

The user wants to open peer thread #$ARGUMENTS in a new pane.

1. Call `list_inbox` to resolve `$ARGUMENTS` (a numeric shortId) to a `threadId` (UUID).
2. Call the `spawn_thread` tool with `thread_id` and `thread_short_id`.
3. Report success with the new pane info, and remind the user they can switch with their pane keybinding (Alt+arrow in zellij).

If `$ARGUMENTS` doesn't match any thread in the inbox, tell the user and suggest `/inbox` to see options.
