# Sanook CLI — Install & Distribution Infrastructure

This guide walks through everything you need to make the multi-platform install commands
(shown on the Dashboard **Install** page) actually work. Today only **npm** works out of the box;
the rest need the one-time setup below.

> Package name used everywhere: **`sanook-cli`** (binaries: `sanook`, `sanookai`).

---

## 0. Prerequisite — publish to npm (unlocks everything else)

Every other channel ultimately pulls from npm, so do this first.

```bash
# one time
npm login                       # log in as the package owner

# each release
npm version patch               # bump version + git tag
npm publish --access public     # runs prepublishOnly → build
```

After this, these work immediately with **no extra infra**:

```bash
npm install -g sanook-cli       # global install
npx sanook-cli                  # run without installing
```

---

## 1. `curl | bash` and `irm | iex` install scripts

The scripts already exist in this repo:

- `scripts/install.sh` (macOS / Linux / WSL)
- `scripts/install.ps1` (Windows PowerShell)

They check Node ≥ 22 then run `npm install -g sanook-cli`. To serve them at a short URL:

### Option A — your own domain (matches the Dashboard copy)
1. Buy a domain (e.g. `sanook.ai`).
2. Host the two files at the root so these resolve:
   - `https://sanook.ai/install.sh`
   - `https://sanook.ai/install.ps1`
   - Easiest: Cloudflare Pages / GitHub Pages / any static host. Set `Content-Type: text/plain`.
3. Users run:
   ```bash
   curl -fsSL https://sanook.ai/install.sh | bash
   irm https://sanook.ai/install.ps1 | iex
   ```

### Option B — GitHub raw (**works today, no domain needed**)
```bash
curl -fsSL https://raw.githubusercontent.com/Sir-chawakorn/sanook-cli/main/scripts/install.sh | bash
irm https://raw.githubusercontent.com/Sir-chawakorn/sanook-cli/main/scripts/install.ps1 | iex
```
The Dashboard Install page and `src/install-info.ts` use these URLs by default.

### Option C — Dashboard local mirror
When `sanook dashboard` is running, scripts are also at:
- `http://127.0.0.1:9119/install.sh`
- `http://127.0.0.1:9119/install.ps1`

---

## 2. Homebrew (`brew install sanook-cli`)

**Status: live** — https://github.com/Sir-chawakorn/homebrew-tap

```bash
brew tap Sir-chawakorn/tap
brew install sanook-cli
```

To bump on release: `bash scripts/publish-homebrew-tap.sh <version>` (or automatic via `.github/workflows/release.yml`).

Formula template in this repo: `packaging/homebrew/sanook-cli.rb`.

---

## 3. WinGet (`winget install Sanook.SanookCLI`)

**Status: PR open** — https://github.com/microsoft/winget-pkgs/pull/391114  
**Release asset:** https://github.com/Sir-chawakorn/sanook-cli/releases/tag/v0.5.7 (`sanook-cli-win-x64.zip`)

After the PR merges:
```powershell
winget install Sanook.SanookCLI
```

Build locally: `npm run build && node scripts/build-win-portable.mjs`  
Submit next version: `bash scripts/publish-winget-pr.sh <version>`

---

## 4. Keeping versions in sync each release

When you bump `package.json` version, also update:

- `packaging/homebrew/sanook-cli.rb` → `url` + `sha256`
- `packaging/winget/*.yaml` → `PackageVersion` + installer URL/hash
- `scripts/publish-homebrew-tap.sh` + `scripts/publish-winget-pr.sh`

Release workflow `.github/workflows/release.yml` on tag `v*`: npm publish → Windows zip → Homebrew tap bump.

---

## 5. `sanook.ai` short URLs (GitHub Pages)

Static site lives in `packaging/sanook-ai/` (install scripts + landing page).

1. **Enable Pages** (once): Repo → Settings → Pages → Source: **GitHub Actions**  
   Or: `gh api repos/Sir-chawakorn/sanook-cli/pages -X POST -f build_type=workflow`
2. Push to `main` — workflow `.github/workflows/pages.yml` deploys on change.
3. **Custom domain** — `packaging/sanook-ai/CNAME` already contains `sanook.ai`.  
   In Pages settings, set custom domain to `sanook.ai` and enable HTTPS.
4. **DNS** at your registrar (choose one):
   - **CNAME** `@` or `www` → `Sir-chawakorn.github.io` (if supported for apex, use ALIAS/ANAME)
   - **A records** for apex `@` → GitHub Pages IPs: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - **CNAME** `www` → `Sir-chawakorn.github.io`

After DNS propagates:
```bash
curl -fsSL https://sanook.ai/install.sh | bash
irm https://sanook.ai/install.ps1 | iex
```

Until DNS is live, GitHub raw URLs work as fallbacks.
