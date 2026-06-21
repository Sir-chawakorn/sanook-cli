#!/usr/bin/env bash
# Publish or update Sir-chawakorn/homebrew-tap from packaging/homebrew-tap/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAP_SRC="$ROOT/packaging/homebrew-tap"
VERSION="${1:-}"

if [[ -n "$VERSION" ]]; then
  node "$ROOT/scripts/sync-packaging.mjs" "$VERSION"
  cp "$ROOT/packaging/homebrew/sanook-cli.rb" "$TAP_SRC/Formula/sanook-cli.rb"
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R "$TAP_SRC/." "$WORK/"
cd "$WORK"
git init -q
git config user.email "sanook-cli@users.noreply.github.com"
git config user.name "sanook-cli"
git add -A
git commit -q -m "Add sanook-cli formula"

if gh repo view Sir-chawakorn/homebrew-tap >/dev/null 2>&1; then
  git remote add origin "https://github.com/Sir-chawakorn/homebrew-tap.git"
  git branch -M main
  git push -u origin main --force
  echo "✓ Updated https://github.com/Sir-chawakorn/homebrew-tap"
else
  gh repo create Sir-chawakorn/homebrew-tap --public --source=. --remote=origin --push
  echo "✓ Created https://github.com/Sir-chawakorn/homebrew-tap"
fi

echo "Install: brew tap Sir-chawakorn/tap && brew install sanook-cli"
