#!/usr/bin/env bash
# LYY bootstrap — one-liner installer for team members.
#
#   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/MeetMissionAI/lyy/main/scripts/bootstrap.sh)"
#
# What it does:
#   1. Clones MeetMissionAI/lyy to ~/.lyy/src (or pulls latest if already there)
#   2. Runs the local install script (pnpm install + build + symlink bins)
#
# Prereqs: git, node 20+, pnpm 9+.
# Optional: zellij (recommended for multi-pane), claude CLI.

set -euo pipefail

REPO="https://github.com/MeetMissionAI/lyy.git"
DEST="${LYY_HOME:-$HOME/.lyy}/src"
BRANCH="${LYY_BRANCH:-main}"

info() { echo "  $*"; }
die() { echo "✗ $*" >&2; exit 1; }

command -v git >/dev/null || die "git not installed"
command -v node >/dev/null || die "node not on PATH (need v20+). Install via volta/brew/nvm."
command -v pnpm >/dev/null || die "pnpm not on PATH. Try: corepack enable && corepack prepare pnpm@9 --activate"

echo "LYY bootstrap"
echo

if [[ -d "$DEST/.git" ]]; then
  info "Updating existing checkout at $DEST"
  git -C "$DEST" fetch origin "$BRANCH" --prune
  git -C "$DEST" checkout "$BRANCH"
  git -C "$DEST" reset --hard "origin/$BRANCH"
else
  info "Cloning $REPO → $DEST"
  mkdir -p "$(dirname "$DEST")"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$DEST"
fi

echo
info "Running install script"
exec "$DEST/scripts/install.sh"
