#!/usr/bin/env bash
# Open a PR to microsoft/winget-pkgs with manifests from packaging/winget/
# Requires: gh CLI, git. Run after GitHub Release + scripts/build-win-portable.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-0.5.7}"
PKG_ID="Sanook.SanookCLI"
MANIFEST_DIR="manifests/s/Sanook/SanookCLI/$VERSION"

echo "Publishing WinGet manifest for ${PKG_ID} ${VERSION}..."

if ! gh repo view Sir-chawakorn/winget-pkgs >/dev/null 2>&1; then
  echo "Forking microsoft/winget-pkgs…"
  gh repo fork microsoft/winget-pkgs --clone=false
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 "https://github.com/Sir-chawakorn/winget-pkgs.git" "$WORK/winget-pkgs"
cd "$WORK/winget-pkgs"
git checkout -b "sanook-cli-$VERSION"
mkdir -p "$MANIFEST_DIR"
cp "$ROOT/packaging/winget/Sanook.SanookCLI.yaml" "$MANIFEST_DIR/"
cp "$ROOT/packaging/winget/Sanook.SanookCLI.installer.yaml" "$MANIFEST_DIR/"
cp "$ROOT/packaging/winget/Sanook.SanookCLI.locale.en-US.yaml" "$MANIFEST_DIR/"

git add -A
git commit -m "Add $PKG_ID $VERSION"
git push -u origin "sanook-cli-$VERSION"

gh pr create \
  --repo microsoft/winget-pkgs \
  --head "Sir-chawakorn:sanook-cli-$VERSION" \
  --title "Sanook.SanookCLI version $VERSION" \
  --body "Adds Sanook CLI — terminal AI coding agent (BYOK, MCP, second brain).

Installer: GitHub Release portable zip (sanook.exe).

Package: https://github.com/Sir-chawakorn/sanook-cli"

echo "✓ WinGet PR opened (check: gh pr list -R microsoft/winget-pkgs --author @me)"
