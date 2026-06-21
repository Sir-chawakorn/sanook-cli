#!/usr/bin/env bash
# Copy install scripts into the sanook.ai static site before Pages deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/packaging/sanook-ai"
cp "$ROOT/scripts/install.sh" "$SITE/install.sh"
cp "$ROOT/scripts/install.ps1" "$SITE/install.ps1"
chmod +x "$SITE/install.sh"
echo "Synced install scripts → packaging/sanook-ai/"
