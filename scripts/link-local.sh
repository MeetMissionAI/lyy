#!/usr/bin/env bash
# Dev mode: symlink ~/.lyy/bin/{lyy,lyy-daemon,lyy-mcp} to the bin-dev
# scripts in THIS repo. No sudo. Edit TS → next \`lyy\` sees the change.
#
#   ./scripts/link-local.sh              # link to this checkout
#   ./scripts/link-local.sh --unlink     # remove

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LYY_HOME_DIR="${LYY_HOME:-$HOME/.lyy}"
BIN_DIR="${LYY_BIN_DIR:-$LYY_HOME_DIR/bin}"
ACTION="${1:-link}"

SUDO=""
[[ -w "$BIN_DIR" ]] || [[ ! -d "$BIN_DIR" ]] || SUDO="sudo"

LYY="$REPO_ROOT/packages/cli/bin/lyy-dev"
DAEMON="$REPO_ROOT/packages/daemon/bin/lyy-daemon-dev"
MCP="$REPO_ROOT/packages/mcp/bin/lyy-mcp-dev"

case "$ACTION" in
  unlink|--unlink)
    for name in lyy lyy-daemon lyy-mcp; do
      $SUDO rm -f "$BIN_DIR/$name"
      echo "  removed $BIN_DIR/$name"
    done
    echo "done."
    exit 0
    ;;
esac

if [[ ! -d "$REPO_ROOT/node_modules/.pnpm" ]]; then
  echo "→ pnpm install"
  (cd "$REPO_ROOT" && pnpm install --frozen-lockfile)
fi

for bin in "$LYY" "$DAEMON" "$MCP"; do
  [[ -f "$bin" ]] || { echo "✗ missing $bin" >&2; exit 1; }
done

mkdir -p "$BIN_DIR"
[[ -w "$BIN_DIR" ]] || SUDO="sudo"

echo "Linking $BIN_DIR → $REPO_ROOT"
$SUDO ln -sf "$LYY" "$BIN_DIR/lyy"
$SUDO ln -sf "$DAEMON" "$BIN_DIR/lyy-daemon"
$SUDO ln -sf "$MCP" "$BIN_DIR/lyy-mcp"

# PATH injection (only if BIN_DIR is user-owned and not yet on PATH)
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  case "$shell_name" in
    zsh)  rc="$HOME/.zshrc" ;;
    bash) rc="$HOME/.bashrc" ;;
    *)    rc="" ;;
  esac
  if [[ -n "$rc" && -f "$rc" ]] && ! grep -qF "$BIN_DIR" "$rc"; then
    {
      echo ""
      echo "# added by lyy link-local"
      echo "export PATH=\"$BIN_DIR:\$PATH\""
    } >> "$rc"
    echo "→ added $BIN_DIR to PATH in $rc"
    echo "⚠  Restart shell or \`source $rc\` to pick up PATH."
  fi
fi

echo
echo "Linked to local source (tsx runtime, no build needed)."
echo "Edit TS → next \`lyy\` reflects change."
echo "Unlink: ./scripts/link-local.sh --unlink"
