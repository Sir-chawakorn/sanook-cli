#!/usr/bin/env bash
# Sanook CLI installer — macOS / Linux / WSL
# Usage (GitHub raw — works today):
#   curl -fsSL https://raw.githubusercontent.com/Sir-chawakorn/sanook-cli/main/scripts/install.sh | bash
# Optional short URL when hosted:
#   curl -fsSL https://sanook.ai/install.sh | bash
# Honored env vars:
#   SANOOK_PKG      npm package name (default: sanook-cli)
#   SANOOK_VERSION  version/tag to install (default: latest)
set -euo pipefail

PKG="${SANOOK_PKG:-sanook-cli}"
VERSION="${SANOOK_VERSION:-latest}"
MIN_NODE_MAJOR=22

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[36m›\033[0m %s\n' "$1"; }
err()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; }

bold "Installing Sanook CLI…"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js not found. Install Node.js >= ${MIN_NODE_MAJOR} first: https://nodejs.org"
  err "macOS:  brew install node     •  Linux:  use your package manager or nvm"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "Node.js ${MIN_NODE_MAJOR}+ required (found $(node -v)). Upgrade Node and retry."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  err "npm not found (it ships with Node.js). Reinstall Node.js."
  exit 1
fi

info "Using $(node -v) / npm $(npm -v)"
info "npm install -g ${PKG}@${VERSION}"

if npm install -g "${PKG}@${VERSION}"; then
  :
elif command -v sudo >/dev/null 2>&1; then
  info "Permission issue — retrying with sudo"
  sudo npm install -g "${PKG}@${VERSION}"
else
  err "Global install failed. Try a Node version manager (nvm) or fix npm prefix permissions."
  exit 1
fi

bold "✓ Sanook CLI installed."
info "Run:  sanook            (start the agent)"
info "      sanook setup      (first-time setup wizard)"
info "      sanook dashboard  (open the web dashboard)"
