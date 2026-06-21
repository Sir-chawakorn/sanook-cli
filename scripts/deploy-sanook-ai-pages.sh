#!/usr/bin/env bash
# Deploy packaging/sanook-ai to the gh-pages branch (legacy Pages — no Actions minutes).
# Usage: bash scripts/deploy-sanook-ai-pages.sh [--cname sanook.ai]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${GITHUB_REPOSITORY:-Sir-chawakorn/sanook-cli}"
CNAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cname) CNAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

bash "$ROOT/scripts/sync-sanook-ai-site.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp -R "$ROOT/packaging/sanook-ai/." "$WORK/"
if [[ -n "$CNAME" ]]; then
  echo "$CNAME" >"$WORK/CNAME"
else
  rm -f "$WORK/CNAME"
fi

cd "$WORK"
git init -q
git checkout -b gh-pages
git add -A
git -c user.email="sanook-cli@users.noreply.github.com" -c user.name="sanook-cli" commit -q -m "Deploy install site"
TOKEN="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [[ -n "$TOKEN" ]]; then
  git push -f "https://x-access-token:${TOKEN}@github.com/${REPO}.git" gh-pages
else
  git push -f "https://github.com/${REPO}.git" gh-pages
fi

if [[ -n "$CNAME" ]]; then
  gh api -X PUT "repos/${REPO}/pages" -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/' -f "cname=${CNAME}" >/dev/null
  echo "✓ Pages custom domain: https://${CNAME}/"
else
  gh api -X PUT "repos/${REPO}/pages" -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/' -f cname= >/dev/null 2>&1 || \
    gh api -X PUT "repos/${REPO}/pages" -f build_type=legacy -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null
  echo "✓ Pages URL: https://${REPO%%/*}.github.io/${REPO##*/}/"
fi

gh api -X POST "repos/${REPO}/pages/builds" >/dev/null
echo "✓ Triggered Pages build"
