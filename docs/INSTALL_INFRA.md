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

If you use Option A, set `INSTALL_DOMAIN` in `src/install-info.ts` so the Dashboard shows the matching short URL.

---

## 2. Homebrew (`brew install sanook-cli`)

Formula template: `packaging/homebrew/sanook-cli.rb`.

1. Create a tap repo named **`homebrew-tap`** under your account:
   `github.com/Sir-chawakorn/homebrew-tap`
2. Copy the formula into `Formula/sanook-cli.rb` in that repo.
3. Fill in the tarball `url` + `sha256` for the published version (or run `node scripts/sync-packaging.mjs`):
   ```bash
   V=0.5.7
   curl -sL "https://registry.npmjs.org/sanook-cli/-/sanook-cli-$V.tgz" -o pkg.tgz
   shasum -a 256 pkg.tgz   # paste into the formula
   ```
4. Users install with:
   ```bash
   brew tap Sir-chawakorn/tap
   brew install sanook-cli
   ```
5. Automate the bump per release with the `brew bump-formula-pr` workflow or a GitHub Action.

---

## 3. WinGet (`winget install Sanook.SanookCLI`)

Manifests template: `packaging/winget/` (version + installer + locale).

WinGet installs a **Windows artifact** (zip/exe/msi), not an npm package, so:

1. Produce a self-contained Windows build and attach it to a GitHub Release, e.g.
   a portable `sanook-cli-win-x64.zip` containing `sanook.exe`.
   - Build the exe with a Node packager such as `@yao-pkg/pkg`:
     ```bash
     npx @yao-pkg/pkg dist/bin.js --targets node22-win-x64 --output sanook.exe
     # zip it: Compress-Archive sanook.exe sanook-cli-win-x64.zip
     ```
2. Fill `InstallerUrl` + `InstallerSha256` in `Sanook.SanookCLI.installer.yaml`:
   ```powershell
   (Get-FileHash sanook-cli-win-x64.zip -Algorithm SHA256).Hash
   ```
3. Validate and submit to `microsoft/winget-pkgs`:
   ```powershell
   winget validate packaging/winget
   # then open a PR to https://github.com/microsoft/winget-pkgs (or use wingetcreate)
   ```

---

## 4. Keeping versions in sync each release

When you bump `package.json` version, also update:

- `packaging/homebrew/sanook-cli.rb` → `url` + `sha256`
- `packaging/winget/*.yaml` → `PackageVersion` + installer URL/hash
- `src/dashboard/api-helpers.ts` → `INSTALL_DOMAIN` (only if it changed)

A single release GitHub Action can: `npm publish`, build the Windows zip, attach release assets,
compute hashes, and open the Homebrew/WinGet bump PRs automatically.
