# Sanook CLI — Install & Distribution Infrastructure

This guide walks through everything you need to make the multi-platform install commands
(shown on the Dashboard **Install** page) actually work.

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
brew trust Sir-chawakorn/tap   # once on newer Homebrew
brew tap Sir-chawakorn/tap
brew install sanook-cli
```

To bump on release: `bash scripts/publish-homebrew-tap.sh <version>` (or automatic via `.github/workflows/release.yml`).

Formula template in this repo: `packaging/homebrew/sanook-cli.rb`.

---

## 3. WinGet (`winget install Sanook.SanookCLI`)

**Status: CLA signed — PR open** — https://github.com/microsoft/winget-pkgs/pull/391114  
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

**Deploy (no Actions minutes — uses `gh-pages` branch):**
```bash
bash scripts/deploy-sanook-ai-pages.sh              # → sir-chawakorn.github.io/sanook-cli/
bash scripts/deploy-sanook-ai-pages.sh --cname sanook.ai   # after DNS is ready
```

**GitHub Pages works today:**
```bash
curl -fsSL https://sir-chawakorn.github.io/sanook-cli/install.sh | bash
```

**Custom domain `sanook.ai`** — domain is on **GoDaddy** (currently parking). Steps:

1. GoDaddy → DNS → remove Website Builder / forwarding on `@`
2. Run `bash scripts/configure-sanook-ai-dns.sh` (prints manual steps, or set `GODADDY_API_KEY` + `GODADDY_API_SECRET`)
3. A records `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
4. CNAME `www` → `Sir-chawakorn.github.io`
5. `bash scripts/deploy-sanook-ai-pages.sh --cname sanook.ai`

After DNS propagates:
```bash
curl -fsSL https://sanook.ai/install.sh | bash
irm https://sanook.ai/install.ps1 | iex
```

Until DNS is live, GitHub raw URLs work as fallbacks.
