---
description: Send a message to another peer (creates or extends a thread)
argument-hint: <@peer> <message body>
---

Parse `$ARGUMENTS` as `<peer> <body>` where `<peer>` is the first whitespace-separated token (with or without leading `@`). The remainder is the message body.

Call the `send_to` tool with the parsed `peer` (strip leading `@`) and `body`.

If the user wants a fresh thread (says "new thread" / "新 thread"), pass `new_thread: true`.

After the tool returns, report:
- Thread shortId (#N) it landed on
- Whether it's a new thread or continued an existing one (compare `seq` — if 1, new)
- Any errors verbatim
