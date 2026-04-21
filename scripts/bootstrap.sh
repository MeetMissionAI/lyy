#!/usr/bin/env bash
# LYY bootstrap — one-liner installer for team members.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
#
# Fetches latest release tarballs (cli / daemon / mcp), extracts to
# ~/.lyy/runtime, symlinks bins into ~/.lyy/bin, appends that dir to
# $PATH via the user's shell rc file. No sudo.
#
# Prereqs: node 20+, curl, tar. No git / pnpm needed.
# Override version: LYY_VERSION=v0.1.2 bash -c "$(curl -fsSL ...)"
# Override bin dir: LYY_BIN_DIR=~/.local/bin bash -c ...

set -euo pipefail

REPO="MeetMissionAI/lyy"
LYY_HOME_DIR="${LYY_HOME:-$HOME/.lyy}"
RUNTIME_DIR="$LYY_HOME_DIR/runtime"
BIN_DIR="${LYY_BIN_DIR:-$LYY_HOME_DIR/bin}"
VERSION="${LYY_VERSION:-latest}"

info() { echo "  $*"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v node >/dev/null || die "node not on PATH (need v20+)"
command -v curl >/dev/null || die "curl not installed"
command -v tar >/dev/null || die "tar not installed"

node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < 20 )); then
  die "node v$node_major found; need v20 or higher"
fi

echo "LYY bootstrap"
info "repo:    $REPO"
info "version: $VERSION"
info "runtime: $RUNTIME_DIR"
info "bin dir: $BIN_DIR"
echo

# Resolve tag
if [[ "$VERSION" == "latest" ]]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -1)
  [[ -n "$TAG" ]] || die "no releases found at https://github.com/${REPO}/releases"
else
  TAG="$VERSION"
fi
info "resolved tag: $TAG"

# Fetch + extract
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$RUNTIME_DIR"
for pkg in cli daemon mcp tui; do
  TARBALL="$TMPDIR/lyy-${pkg}.tgz"
  info "fetching lyy-${pkg}.tgz"
  curl -fsSL "${BASE_URL}/lyy-${pkg}.tgz" -o "$TARBALL"
  DEST="$RUNTIME_DIR/${pkg}"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  tar -xzf "$TARBALL" -C "$DEST"
done

for b in "cli/bin/lyy" "daemon/bin/lyy-daemon" "mcp/bin/lyy-mcp" "tui/bin/lyy-tui"; do
  [[ -f "$RUNTIME_DIR/$b" ]] || die "expected $RUNTIME_DIR/$b, missing"
done

# Rewrite shebang with absolute node path. Claude Code (macOS GUI) spawns MCP
# servers with a minimal PATH that lacks nvm/brew node — `#!/usr/bin/env node`
# fails with ENOENT. Using an absolute path skips PATH resolution entirely.
NODE_BIN="$(command -v node)"
info "pinning shebang → #!$NODE_BIN"
for b in "cli/bin/lyy" "daemon/bin/lyy-daemon" "mcp/bin/lyy-mcp" "tui/bin/lyy-tui"; do
  sed -i.bak "1s|.*|#!$NODE_BIN|" "$RUNTIME_DIR/$b"
  rm -f "$RUNTIME_DIR/$b.bak"
done

# Symlink (user-owned dir by default → no sudo)
mkdir -p "$BIN_DIR"
SUDO=""
if [[ ! -w "$BIN_DIR" ]]; then
  SUDO="sudo"
  echo "[note] $BIN_DIR not writable — will use sudo"
fi

echo
echo "→ linking bins into $BIN_DIR"
for pair in "lyy:cli/bin/lyy" "lyy-daemon:daemon/bin/lyy-daemon" "lyy-mcp:mcp/bin/lyy-mcp" "lyy-tui:tui/bin/lyy-tui"; do
  name="${pair%%:*}"
  path="${pair##*:}"
  $SUDO ln -sf "$RUNTIME_DIR/$path" "$BIN_DIR/$name"
  info "$BIN_DIR/$name → $RUNTIME_DIR/$path"
done

echo "$TAG" > "$RUNTIME_DIR/VERSION"

# PATH injection for user-owned bin dirs (~/.lyy/bin, ~/.local/bin, etc.)
add_to_path() {
  local rc="$1"
  local line="export PATH=\"$BIN_DIR:\$PATH\""
  [[ -f "$rc" ]] || return 0
  grep -qF "$BIN_DIR" "$rc" && return 0
  {
    echo ""
    echo "# added by lyy bootstrap"
    echo "$line"
  } >> "$rc"
  echo "→ added $BIN_DIR to PATH in $rc"
}

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  case "$shell_name" in
    zsh)  add_to_path "$HOME/.zshrc" ;;
    bash) add_to_path "$HOME/.bashrc"; add_to_path "$HOME/.bash_profile" ;;
    fish)
      mkdir -p "$HOME/.config/fish"
      local_fish="$HOME/.config/fish/config.fish"
      if ! grep -qF "$BIN_DIR" "$local_fish" 2>/dev/null; then
        echo "set -gx PATH $BIN_DIR \$PATH" >> "$local_fish"
        echo "→ added $BIN_DIR to fish_user_paths in $local_fish"
      fi
      ;;
    *) echo "[note] unknown shell ($shell_name) — add $BIN_DIR to PATH manually" ;;
  esac
  NEED_SOURCE=1
else
  NEED_SOURCE=0
fi

echo
echo "Installed lyy $TAG."
if [[ "$NEED_SOURCE" == 1 ]]; then
  echo "⚠  Restart your shell (or \`source ~/.zshrc\`) to pick up PATH."
fi
echo "Verify: lyy --version && lyy doctor"
echo "Next:   lyy init --invite=<code> --relay-url=https://lyy-relay.uneeland.com"
