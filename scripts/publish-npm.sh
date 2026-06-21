#!/usr/bin/env bash
# Publish sanook-cli to npm — fails fast with a clear message if not logged in.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! npm whoami >/dev/null 2>&1; then
  cat <<'EOF' >&2
npm publish failed: you are not logged in (or your token expired).

Fix:
  npm logout
  npm login          # use the account that owns sanook-cli (maintainer: chawakorn)
  npm whoami         # should print your npm username
  bash scripts/publish-npm.sh

If you use 2FA, choose "Publish" token or enter OTP when prompted.
EOF
  exit 1
fi

USER=$(npm whoami)
echo "Publishing as npm user: ${USER}"
LOCAL_VER=$(node -p "require('./package.json').version")
PKG=$(node -p "require('./package.json').name")
PUBLISHED_VER=$(npm view "${PKG}" version 2>/dev/null || true)
if [[ "${PUBLISHED_VER}" == "${LOCAL_VER}" ]]; then
  cat <<EOF >&2
npm publish blocked: ${PKG}@${LOCAL_VER} is already on npm.

Fix:
  npm version patch          # bumps package.json (e.g. 0.5.9 → 0.5.10)
  bash scripts/publish-npm.sh
EOF
  exit 1
fi
npm test
npm publish --access public
echo "✓ Published $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")"
