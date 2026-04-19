#!/usr/bin/env bash
# LYY bootstrap — one-liner installer for team members.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
#
# Fetches the latest release tarballs (cli / daemon / mcp), extracts to
# ~/.lyy/runtime, and symlinks bins into /usr/local/bin.
#
# Prereqs: node 20+, curl, tar. No git / pnpm needed.
# Override version: LYY_VERSION=v0.1.2 bash -c "$(curl -fsSL ...)"
# Override bin dir: LYY_BIN_DIR=~/.local/bin bash -c ...

set -euo pipefail

REPO="MeetMissionAI/lyy"
RUNTIME_DIR="${LYY_HOME:-$HOME/.lyy}/runtime"
BIN_DIR="${LYY_BIN_DIR:-/usr/local/bin}"
VERSION="${LYY_VERSION:-latest}"

info() { echo "  $*"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v node >/dev/null || die "node not on PATH (need v20+)"
command -v curl >/dev/null || die "curl not installed"
command -v tar >/dev/null || die "tar not installed"

# Require Node 20+
node_major=$(node -p 'process.versions.node.split(".")[0]')
if (( node_major < 20 )); then
  die "node v$node_major found; need v20 or higher"
fi

need_sudo() { [[ -w "$BIN_DIR" ]] && echo "" || echo "sudo"; }

echo "LYY bootstrap"
info "repo:    $REPO"
info "version: $VERSION"
info "runtime: $RUNTIME_DIR"
info "bin dir: $BIN_DIR"
echo

# Resolve actual tag (GitHub API)
if [[ "$VERSION" == "latest" ]]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -1)
  [[ -n "$TAG" ]] || die "no releases found at https://github.com/${REPO}/releases"
else
  TAG="$VERSION"
fi
info "resolved tag: $TAG"

# Download + extract each package tarball
BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$RUNTIME_DIR"
for pkg in cli daemon mcp; do
  TARBALL="$TMPDIR/lyy-${pkg}.tgz"
  info "fetching lyy-${pkg}.tgz"
  curl -fsSL "${BASE_URL}/lyy-${pkg}.tgz" -o "$TARBALL"
  DEST="$RUNTIME_DIR/${pkg}"
  rm -rf "$DEST"
  mkdir -p "$DEST"
  tar -xzf "$TARBALL" -C "$DEST"
done

# Verify bins exist
for b in "cli/bin/lyy" "daemon/bin/lyy-daemon" "mcp/bin/lyy-mcp"; do
  [[ -f "$RUNTIME_DIR/$b" ]] || die "expected $RUNTIME_DIR/$b, missing"
done

# Symlink
SUDO="$(need_sudo)"
mkdir -p "$BIN_DIR" 2>/dev/null || true
echo
echo "→ linking bins into $BIN_DIR"
for pair in "lyy:cli/bin/lyy" "lyy-daemon:daemon/bin/lyy-daemon" "lyy-mcp:mcp/bin/lyy-mcp"; do
  name="${pair%%:*}"
  path="${pair##*:}"
  $SUDO ln -sf "$RUNTIME_DIR/$path" "$BIN_DIR/$name"
  info "$BIN_DIR/$name → $RUNTIME_DIR/$path"
done

# Write version marker so future bootstraps can detect installed version
echo "$TAG" > "$RUNTIME_DIR/VERSION"

echo
echo "Installed lyy $TAG."
echo "Verify: lyy --version && lyy doctor"
echo "Next:   lyy init --invite=<code> --relay-url=https://lyy-relay.uneeland.com"
