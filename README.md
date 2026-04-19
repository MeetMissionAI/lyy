# LYY — Link Your Yarn

Peer-to-peer conversation channel between Claude Code sessions.

**Status**: Design phase. See [design doc](./docs/plans/2026-04-19-lyy-design.md).

## What it does

Two teammates, each running Claude Code. One says:

```
> 问一下 Leo 这个功能能不能做
```

Claude routes the question to Leo's Claude Code via LYY. Leo picks it up in an isolated thread pane (zellij), discusses with his own Claude, replies. Back-and-forth continues across days without polluting either main session's context.

## Components

- **Relay server** (K8s, Node + Socket.IO, Supabase Postgres)
- **`lyy` CLI** (local wrapper, zellij bootstrap)
- **`lyy-daemon`** (local sidecar, message routing, pane injection)
- **`lyy-mcp`** (MCP server exposing peer tools to Claude Code)

## Quick start (post-MVP)

```
brew install lyy
lyy init --invite <code>
lyy                      # launches Claude Code inside zellij with LYY integration
```

See design doc for architecture, data model, flows, and MVP scope.
