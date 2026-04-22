# LYY — Link Your Yarn

A peer-to-peer conversation channel between Claude Code sessions. Ask a
teammate something without tying up your own session, and let their Claude
draft the reply in an isolated thread. Conversations persist across days and
never pollute either main session's context.

---

## Table of contents

- [Install](#install)
- [Pair with the relay](#pair-with-the-relay)
- [Daily usage](#daily-usage)
  - [Launching](#launching)
  - [Reading the inbox](#reading-the-inbox)
  - [Opening a thread](#opening-a-thread)
  - [Writing a message](#writing-a-message)
  - [Mentioning Claude in a thread](#mentioning-claude-in-a-thread)
  - [Sending a message from a Claude prompt](#sending-a-message-from-a-claude-prompt)
  - [Multiple profiles](#multiple-profiles)
- [Upgrading](#upgrading)
- [Troubleshooting](#troubleshooting)
- [Admin: issuing invites](#admin-issuing-invites)
- [Architecture at a glance](#architecture-at-a-glance)
- [Development](#development)

---

## Install

One-line installer for macOS and Linux. No sudo needed (uses `~/.lyy/bin`).

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
```

What it does:

1. Fetches the latest release tarballs (`lyy-cli`, `lyy-daemon`, `lyy-mcp`,
   `lyy-tui`) from GitHub Releases.
2. Unpacks them into `~/.lyy/runtime/`.
3. Pins every bin's shebang to your current `node` (so Claude Code's trimmed
   spawn PATH doesn't break MCP launches).
4. Symlinks `lyy`, `lyy-daemon`, `lyy-mcp`, `lyy-tui` into `~/.lyy/bin/`.
5. Adds `~/.lyy/bin` to your shell rc (`.zshrc` / `.bashrc` / fish).
6. Installs [`zellij`](https://zellij.dev) via `brew` if it isn't already
   present — LYY uses it to lay out the Claude + TUI panes side by side.

**Prereqs**: `node >= 20`, `curl`, `tar`. For auto-install of zellij on
macOS, `brew` must be present; otherwise bootstrap prints manual install
hints and moves on.

Verify:

```bash
lyy --version       # 0.2.7 or newer
lyy doctor          # identity / daemon / relay / zellij / rogue-daemon check
```

If your shell hasn't picked up `~/.lyy/bin` yet, open a new terminal or
`source ~/.zshrc`.

---

## Pair with the relay

Every team member needs a one-time invite code from an admin (see
[Admin: issuing invites](#admin-issuing-invites) below).

```bash
lyy init \
  --invite <INVITE_CODE> \
  --name <your-short-name> \
  --email <you@your-team.com>
```

This:

- Consumes the invite on the relay server.
- Generates your peer identity (`~/.lyy/identity.json`), stored only
  locally. The relay only holds your peer ID, name, and the JWT it issues
  to you.
- Registers the `lyy` MCP server in `~/.claude/settings.json` so Claude
  Code can call tools like `send_to`, `list_inbox`, and `suggest_reply`.
- Installs a statusline hook that shows unread peer messages in your
  Claude prompt.

`--relay-url` defaults to the team relay; pass `--relay-url <url>` to use
a different deployment.

---

## Daily usage

### Launching

```bash
lyy
```

This opens a `zellij` session with two panes side by side:

- **Left**: Claude Code, as if you'd launched `claude` directly.
- **Right**: `lyy-tui`, the peer inbox / thread view.

Both panes share the same `lyy-daemon` running in the background. Closing
the zellij session does **not** kill the daemon — it stays connected to
the relay so new messages still reach `state.json` and surface next time
you launch. Use `Ctrl+q` or `exit` to leave zellij.

### Reading the inbox

The TUI shows two columns:

- **Peers**: everyone on the relay (green ● = currently connected, gray
  ○ = offline).
- **Threads**: ongoing conversations, newest activity first. Unread rows
  blink yellow. Each row shows `#<id>  @<peer>  <last message preview>`.

Status bar at the bottom shows `v<LYY_VERSION> · daemon ● · relay ●`.

Keybindings (list view):

| Key     | Action                         |
| ------- | ------------------------------ |
| `Tab`   | Switch focus Peers ↔ Threads   |
| `↑ ↓`   | Move cursor in focused column  |
| `Enter` | Open the selected row          |
| `Esc`   | Back (from thread → list)      |

### Opening a thread

- **From Threads column**: Enter on a row opens its history.
- **From Peers column**: Enter on a peer reuses an existing thread with
  them if one exists, otherwise starts a new one.

The thread view shows timestamped messages, newest at the bottom, and a
single-line input box below.

### Writing a message

In a thread pane:

- Type normally in the input box.
- `Enter` sends.
- `\` followed by `Enter` inserts a newline instead of sending (for
  multi-line messages).
- `Backspace`, arrow keys, `Ctrl+A` / `Ctrl+E` (line start/end), `Ctrl+U`
  / `Ctrl+K` (kill to start/end), `Ctrl+W` (delete word), `Ctrl+Z` /
  `Ctrl+Y` (undo/redo) all work.
- Paste multi-line text works (bracketed paste is unwrapped for you).
- Send failures restore the draft so you can retry.

### Mentioning Claude in a thread

Start a message with `@Claude ` (or the alias `@CC`, case-insensitive,
any punctuation tolerated):

```
@Claude, what's a good schema for this?
```

Pressing `Enter`:

1. Takes the thread's full history + your question.
2. Pipes it into the Claude pane next door via `zellij action
   write-chars`, so Claude sees:
   `You are in LYY thread #7 with @alice. Help me craft a reply. History: [...] My question: what's a good schema for this?`
3. Claude works on it using its own context, then — when it's ready —
   calls the `lyy.suggest_reply` MCP tool with the draft.
4. The TUI pops a cyan card in your thread: `💡 Claude: <draft>` with
   `[Tab: accept · Esc: dismiss]`.
5. `Tab` drops the draft into your input box; edit + send as normal.

### Sending a message from a Claude prompt

Inside Claude Code, just tell it what you want to say:

```
> Ask Leo whether we can build this feature.
```

Claude uses the `lyy.send_to` tool to open / continue a thread with Leo.
You'll see the outgoing message in the thread pane.

Related MCP tools Claude has access to (configured automatically by `lyy
init`):

- `list_peers` — see everyone on the relay.
- `list_inbox` — read your own unread summary.
- `read_thread` — pull recent messages in a thread.
- `send_to` / `reply` / `archive_thread` — standard ops.
- `search` — full-text search across your threads.

### Multiple profiles

Need to be two separate peers on the same machine (e.g. personal + bot,
or alice-test + bob-test for demos)? Pass `--profile`:

```bash
lyy --profile alice
lyy --profile bob        # in another terminal
```

Each profile has its own identity, state, daemon PID lockfile, and
zellij session. They can message each other through the relay. Profile
home is `~/.lyy/profiles/<name>/`. Runtime binaries are shared.

---

## Upgrading

You shouldn't need to think about this. On every non-dev launch, `lyy`
checks GitHub Releases (cached via `If-None-Match`, so 304 is the normal
response and costs zero rate-limit quota). When there's a new version it
downloads the four tarballs in parallel, verifies each against
`SHA256SUMS.txt`, atomically swaps `~/.lyy/runtime/`, and re-execs into
the new `lyy` — all before `zellij` opens. Usual delay on an upgrade:
2-5 s. Usual delay on a no-op check: ~100 ms.

Failure modes (network drop, bad checksum, tar corruption, etc.) are
fail-soft: a warning is printed, any staging dir is cleaned up, and the
old version keeps running.

To opt out for one run: `LYY_JUST_UPGRADED=1 lyy ...`.

To downgrade / pin a version, re-run the installer:

```bash
LYY_VERSION=v0.2.5 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
```

---

## Troubleshooting

Start with:

```bash
lyy doctor
```

Common failures:

- **`daemon: ... missing`** — daemon exited (crash, SIGKILL). The next
  `lyy` invocation will respawn it.
- **`rogue daemons: N rogue pid(s)...`** — orphaned `lyy-daemon`
  processes from prior runs. `lyy doctor --fix-daemons` SIGKILLs the
  ones not tracked by any profile's `daemon.pid`.
- **`zellij: ... not on PATH`** — install manually: `brew install
  zellij`, or see <https://zellij.dev/documentation/installation>.
  Without zellij, `lyy` falls back to launching plain `claude` with no
  TUI pane.
- **TUI footer shows `relay ○` (red)** — daemon can't reach the relay.
  Check network, check `~/.lyy/profiles/<name>/daemon.log`.
- **Messages don't arrive** — confirm both sides are v0.2.5 or newer
  (`lyy --version`). Daemons run a version handshake on launch that
  SIGTERMs a mismatched daemon; very old deployments may need one more
  manual `bootstrap.sh` run to get auto-upgrade started.

To completely uninstall + reinstall fresh:

```bash
pkill -f lyy-daemon 2>/dev/null; pkill -f lyy-tui 2>/dev/null
rm -rf ~/.lyy
sudo rm -f /usr/local/bin/lyy /usr/local/bin/lyy-daemon /usr/local/bin/lyy-mcp /usr/local/bin/lyy-tui
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
lyy init --invite <NEW_CODE> --name <short> --email <addr>
```

---

## Admin: issuing invites

Every new teammate needs a one-time invite. Admins with database access
can issue one:

```bash
# From the repo root, with DATABASE_URL in your env (or in .env):
lyy admin invite teammate@your-team.com
```

Flags:

- `--days <n>` — how long the invite stays valid (default 7, max 90).
- `--code <code>` — override the generated code. Useful for scripted /
  predictable codes.
- `--db-url <url>` — override `DATABASE_URL`.
- `--relay-url <url>` — override the URL printed in the join command
  (defaults to the team relay).

Output is the invite code plus a ready-to-copy `lyy init` line to send
to the new teammate.

---

## Architecture at a glance

```
  Your machine                                 Teammate's machine
  ────────────                                 ──────────────────
  zellij                                       zellij
  ├── Claude Code  ──┐                    ┌── Claude Code
  │   └─ lyy-mcp    │                    │   └─ lyy-mcp
  └── lyy-tui       │                    └── lyy-tui
                    │                                │
                    ▼                                ▼
              lyy-daemon ── socket.io ──────── lyy-daemon
                    │                                │
                    └──────── HTTPS / WSS ───────────┘
                                    │
                                    ▼
                              Relay server (K8s)
                              ├─ Socket.IO (real-time)
                              ├─ Fastify (REST)
                              └─ Supabase Postgres
                                 (peers, threads, messages)
```

- **Relay server**: K8s deployment, Node + Socket.IO for push, Fastify for
  REST. Supabase Postgres stores peers, threads, messages, archives.
  Persists messages so daemons can resync on reconnect.
- **`lyy` CLI**: thin launcher. Auto-upgrades runtime, ensures the daemon
  is running, writes a zellij layout, and `exec`s into `zellij`.
- **`lyy-daemon`**: per-profile long-lived sidecar. Holds the WebSocket to
  the relay, maintains `state.json`, talks to every process on the
  machine (TUI + MCP) over a Unix socket under `~/.lyy/profiles/<name>/`.
- **`lyy-mcp`**: MCP server spawned by Claude Code. Exposes peer-ops
  tools (`send_to`, `read_thread`, `suggest_reply`, …). Just a
  thin proxy over the daemon IPC.
- **`lyy-tui`**: Ink-based TUI (peers + threads list + thread detail +
  input). Subscribes to the daemon for live updates.

See the design docs under `docs/plans/` for details (data model,
migrations, flows, reasoning).

---

## Development

Monorepo layout:

```
packages/
  shared/   common types, Postgres client, repo layer
  relay/    relay server (Node + Fastify + Socket.IO)
  daemon/   local sidecar
  mcp/      MCP server
  cli/      lyy CLI + auto-upgrade
  tui/      React Ink TUI
```

Toolchain: pnpm workspaces, TypeScript, vitest, biome, Node 20+.

```bash
pnpm install     # install all deps
pnpm build       # tsc -b in every package
pnpm test        # vitest run (set LYY_SKIP_DB=1 to skip Postgres tests)
pnpm lint        # biome check
pnpm format      # biome format --write
```

For iterative dev, link the in-repo source as your global `lyy`:

```bash
sudo ./scripts/link-local.sh
```

This swaps `~/.lyy/bin/{lyy,lyy-daemon,lyy-mcp,lyy-tui}` to the
`packages/*/bin/*-dev` shims, which run `tsx src/bin.ts` directly
against the repo. Dev installs skip the auto-upgrader. `./scripts/link-local.sh --unlink` restores the bootstrap-installed runtime.

Plans and design docs live under `docs/plans/`.
