#!/usr/bin/env bash
# Dev mode: symlink /usr/local/bin/{lyy,lyy-daemon,lyy-mcp} to the bin
# scripts in THIS repo. Code changes take effect after `pnpm build`.
#
#   ./scripts/link-local.sh              # link to this checkout
#   ./scripts/link-local.sh --unlink     # remove + restore release tarball install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${LYY_BIN_DIR:-/usr/local/bin}"
ACTION="${1:-link}"

need_sudo() { [[ -w "$BIN_DIR" ]] && echo "" || echo "sudo"; }
SUDO="$(need_sudo)"

LYY="$REPO_ROOT/packages/cli/bin/lyy-dev"
DAEMON="$REPO_ROOT/packages/daemon/bin/lyy-daemon-dev"
MCP="$REPO_ROOT/packages/mcp/bin/lyy-mcp-dev"

case "$ACTION" in
  unlink|--unlink)
    for name in lyy lyy-daemon lyy-mcp; do
      $SUDO rm -f "$BIN_DIR/$name"
      echo "  removed $BIN_DIR/$name"
    done
    echo "done. Re-run bootstrap.sh to restore release install."
    exit 0
    ;;
esac

# Dev bins run TS source directly via tsx (no build needed). Ensure deps.
if [[ ! -d "$REPO_ROOT/node_modules/.pnpm" ]]; then
  echo "→ pnpm install (node_modules missing)"
  (cd "$REPO_ROOT" && pnpm install --frozen-lockfile)
fi

for bin in "$LYY" "$DAEMON" "$MCP"; do
  [[ -f "$bin" ]] || { echo "✗ missing $bin" >&2; exit 1; }
done

echo "Linking $BIN_DIR → $REPO_ROOT"
$SUDO ln -sf "$LYY" "$BIN_DIR/lyy"
$SUDO ln -sf "$DAEMON" "$BIN_DIR/lyy-daemon"
$SUDO ln -sf "$MCP" "$BIN_DIR/lyy-mcp"

echo
echo "Linked to local source (tsx runtime, no build needed)."
echo "Edit TS → next \`lyy\` invocation reflects change."
echo "Swap back to release install: ./scripts/link-local.sh --unlink && bootstrap.sh"
