#!/usr/bin/env bash
# Open a PR to microsoft/winget-pkgs with manifests from packaging/winget/
# Requires: gh CLI, git. Run after GitHub Release + scripts/build-win-portable.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -gt 0 && -n "${1:-}" ]]; then
  VERSION="$1"
else
  VERSION="$(node -e "const fs=require('node:fs'); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$ROOT/package.json")"
fi
PKG_ID="Sanook.SanookCLI"
MANIFEST_DIR="manifests/s/Sanook/SanookCLI/$VERSION"
MANIFESTS=(
  "$ROOT/packaging/winget/Sanook.SanookCLI.yaml"
  "$ROOT/packaging/winget/Sanook.SanookCLI.installer.yaml"
  "$ROOT/packaging/winget/Sanook.SanookCLI.locale.en-US.yaml"
)

echo "Publishing WinGet manifest for ${PKG_ID} ${VERSION}..."

for manifest in "${MANIFESTS[@]}"; do
  if ! grep -Fxq "PackageVersion: $VERSION" "$manifest"; then
    echo "WinGet manifest $(basename "$manifest") is not synced to $VERSION." >&2
    echo "Run: node scripts/sync-packaging.mjs $VERSION after publishing npm/release artifacts." >&2
    exit 1
  fi
done

INSTALLER_URL="InstallerUrl: https://github.com/Sir-chawakorn/sanook-cli/releases/download/v${VERSION}/sanook-cli-win-x64.zip"
if ! grep -Fq "$INSTALLER_URL" "$ROOT/packaging/winget/Sanook.SanookCLI.installer.yaml"; then
  echo "WinGet installer URL is not synced to $VERSION." >&2
  echo "Run: node scripts/sync-packaging.mjs $VERSION after publishing npm/release artifacts." >&2
  exit 1
fi

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
cp "${MANIFESTS[@]}" "$MANIFEST_DIR/"

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
