#!/usr/bin/env bash
# LYY local installer — builds the monorepo and symlinks the 3 bins into
# /usr/local/bin (or $LYY_BIN_DIR override) so `lyy` / `lyy-daemon` / `lyy-mcp`
# are on your PATH.
#
#   ./scripts/install.sh              # install
#   ./scripts/install.sh --uninstall  # remove symlinks
#
# Prereqs: node 20+, pnpm 9+, git.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${LYY_BIN_DIR:-/usr/local/bin}"
ACTION="${1:-install}"

LYY_BIN="$REPO_ROOT/packages/cli/bin/lyy"
DAEMON_BIN="$REPO_ROOT/packages/daemon/bin/lyy-daemon"
MCP_BIN="$REPO_ROOT/packages/mcp/bin/lyy-mcp"

need_sudo() {
  # /usr/local/bin is owned by root on some installs; fallback to sudo
  [[ -w "$BIN_DIR" ]] && echo "" || echo "sudo"
}

link() {
  local src="$1" dst="$2"
  if [[ ! -f "$src" ]]; then
    echo "✗ missing $src — did build succeed?" >&2
    exit 1
  fi
  local sudo
  sudo="$(need_sudo)"
  $sudo ln -sf "$src" "$dst"
  echo "  $dst → $src"
}

uninstall_all() {
  local sudo
  sudo="$(need_sudo)"
  for name in lyy lyy-daemon lyy-mcp; do
    local target="$BIN_DIR/$name"
    if [[ -L "$target" ]]; then
      $sudo rm "$target" && echo "  removed $target"
    fi
  done
}

case "$ACTION" in
  --uninstall|uninstall)
    echo "LYY: removing symlinks from $BIN_DIR"
    uninstall_all
    echo "done."
    exit 0
    ;;
esac

echo "LYY: installing from $REPO_ROOT → $BIN_DIR"

if ! command -v node >/dev/null; then
  echo "✗ node not on PATH. Install via volta / brew / nvm and retry." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null; then
  echo "✗ pnpm not on PATH. \`npm install -g pnpm\` or via corepack." >&2
  exit 1
fi

echo "→ pnpm install"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

echo "→ pnpm build"
pnpm build

mkdir -p "$BIN_DIR" 2>/dev/null || true
echo "→ linking bins into $BIN_DIR"
link "$LYY_BIN" "$BIN_DIR/lyy"
link "$DAEMON_BIN" "$BIN_DIR/lyy-daemon"
link "$MCP_BIN" "$BIN_DIR/lyy-mcp"

echo
echo "Done. Verify:"
echo "  lyy --version"
echo "  lyy doctor"
echo
echo "Next: \`lyy init --invite=<code> --relay-url=https://lyy-relay.uneeland.com\`"
