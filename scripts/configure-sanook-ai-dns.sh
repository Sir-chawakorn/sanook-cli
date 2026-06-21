#!/usr/bin/env bash
# Point sanook.ai (GoDaddy) at GitHub Pages, then redeploy with custom domain.
# Requires: GODADDY_API_KEY + GODADDY_API_SECRET (GoDaddy developer keys), or follow printed steps.
set -euo pipefail
DOMAIN="${1:-sanook.ai}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GITHUB_IPS=(185.199.108.153 185.199.109.153 185.199.110.153 185.199.111.153)

echo "=== sanook.ai → GitHub Pages ==="
echo ""

if [[ -n "${GODADDY_API_KEY:-}" && -n "${GODADDY_API_SECRET:-}" ]]; then
  echo "Updating GoDaddy A records for @ …"
  payload='['
  for ip in "${GITHUB_IPS[@]}"; do
    payload+="{\"data\":\"${ip}\",\"ttl\":600},"
  done
  payload="${payload%,}]"
  curl -fsSL -X PUT "https://api.godaddy.com/v1/domains/${DOMAIN}/records/A/@" \
    -H "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}" \
    -H "Content-Type: application/json" \
    -d "$payload"
  curl -fsSL -X PUT "https://api.godaddy.com/v1/domains/${DOMAIN}/records/CNAME/www" \
    -H "Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}" \
    -H "Content-Type: application/json" \
    -d '[{"data":"Sir-chawakorn.github.io","ttl":600}]'
  echo "✓ DNS updated via GoDaddy API"
else
  cat <<EOF
GoDaddy API keys not set. Update DNS manually (domain uses GoDaddy nameservers):

1. https://dcc.godaddy.com/control/portfolio → sanook.ai → DNS
2. Remove GoDaddy Website Builder / forwarding on @ (currently parking page)
3. A records @ → ${GITHUB_IPS[*]}
4. CNAME www → Sir-chawakorn.github.io
5. Wait 5–30 min, then run:
   bash scripts/deploy-sanook-ai-pages.sh --cname ${DOMAIN}

Or export GoDaddy keys and re-run this script:
  export GODADDY_API_KEY=… GODADDY_API_SECRET=…
  bash scripts/configure-sanook-ai-dns.sh
EOF
  exit 0
fi

echo "Redeploying Pages with custom domain …"
bash "$ROOT/scripts/deploy-sanook-ai-pages.sh" --cname "$DOMAIN"
echo "After DNS propagates: curl -fsSL https://${DOMAIN}/install.sh | bash"
