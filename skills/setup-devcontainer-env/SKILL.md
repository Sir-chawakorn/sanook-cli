---
name: setup-devcontainer-env
description: Builds a reproducible Dev Container workspace from a devcontainer.json — pinned base image, language toolchains via devcontainer features, editor config, postCreate provisioning, runtime-injected dev secrets, dependency cache volumes, and parity with the CI base image.
when_to_use: User wants a clone-and-reopen reproducible workspace, to kill "works on my machine", to onboard a dev fast, or to make a repo Codespaces-ready. Not the production runtime image (dockerfile-optimize), not the multi-service backing stack (compose-local-dev-stack), not host-level version pinning without containers (pin-toolchain-versions).
---

## When to Use

- "Set up a dev container so everyone gets the same Node/Python/Go and tools"
- "New hire spends a day installing deps — make it `clone → reopen in container → it just works`"
- "Make this repo open in GitHub Codespaces"
- "Our CI uses a different image than our laptops and that's why builds diverge"
- "I want a disposable, sandboxed workspace I can blow away and rebuild"

NOT this skill:
- Optimizing the **production runtime** image (multi-stage, distroless, smaller layers) → dockerfile-optimize
- Standing up **backing services** (Postgres + Redis + a queue) the app talks to → compose-local-dev-stack
- Pinning tool versions on the **host without containers** (asdf/mise/.tool-versions) → pin-toolchain-versions
- Secrets in CI/infra, Vault, rotation, leak scanning → secrets-management
- The CI **workflow** itself (jobs, caching, OIDC) → cicd-pipeline-author

A Dev Container is the **development** environment (editor, debuggers, source bind-mounted, runs as you). Keep it distinct from the lean image you ship.

## Steps

1. **Pick the container source — one of three, decided up front.** Put `.devcontainer/devcontainer.json` at repo root (or `.devcontainer/<name>/devcontainer.json` for multiple).

   | Source key | Use when | Tradeoff |
   |---|---|---|
   | `image` | Toolchain is standard, get a workspace in seconds | Customize only via features + postCreate, no custom layers |
   | `build.dockerfile` | You need OS packages/layers not covered by features, **or want parity with your CI image** | Slower first build; you maintain a Dockerfile |
   | `dockerComposeFile` + `service` | The dev workspace must join a multi-container stack (db, redis) | Heaviest; stack ownership belongs to compose-local-dev-stack — reference it, don't rebuild it |

   **Default: `build.dockerfile`** pointing at a thin dev Dockerfile that `FROM`s the *same pinned base as CI*. That single decision is what kills environment drift.

2. **Pin the base by digest, never `latest`.** A floating tag means a rebuild three months later silently bumps glibc/openssl and re-breaks "works on my machine". Use the prebuilt devcontainer bases (they ship a non-root `vscode` user + common CLIs) and pin them:

   ```dockerfile
   # .devcontainer/Dockerfile
   FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04@sha256:<digest>
   # OS packages features can't provide — keep this list tiny
   RUN apt-get update && apt-get install -y --no-install-recommends \
         postgresql-client \
       && rm -rf /var/lib/apt/lists/*
   ```
   Refresh the digest deliberately (a dependency-upgrade pass), not by accident.

3. **Install toolchains via `features`, not ad-hoc `apt`/`curl|sh`.** Features are versioned, composable, cache well, and stay portable to Codespaces. Pin each feature to an exact toolchain version — `latest` here reintroduces the drift you just removed.

   ```jsonc
   {
     "name": "app-dev",
     "build": { "dockerfile": "Dockerfile" },
     "features": {
       "ghcr.io/devcontainers/features/node:1": { "version": "20.17.0" },
       "ghcr.io/devcontainers/features/python:1": { "version": "3.12" },
       "ghcr.io/devcontainers/features/github-cli:1": {}
     },
     "remoteUser": "vscode"
   }
   ```
   Keep feature versions in lockstep with `.tool-versions`/CI so host, container, and CI agree. Reserve the Dockerfile for things no feature provides (step 2).

4. **Wire the editor, ports, and lifecycle hooks in the same file.**

   ```jsonc
   {
     "customizations": {
       "vscode": {
         "extensions": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode", "ms-python.python"],
         "settings": { "editor.formatOnSave": true, "terminal.integrated.defaultProfile.linux": "zsh" }
       }
     },
     "forwardPorts": [3000, 5432],
     "portsAttributes": { "3000": { "label": "web", "onAutoForward": "notify" } },
     "onCreateCommand": "git config --global --add safe.directory ${containerWorkspaceFolder}",
     "postCreateCommand": "npm ci && npm run build",
     "postStartCommand": "npm run db:migrate"
   }
   ```
   - `postCreateCommand` — runs **once** after the container is created. Put idempotent provisioning here: install deps, build, seed. Make it a script (`.devcontainer/post-create.sh`, `set -euo pipefail`) once it grows past one command.
   - `postStartCommand` — runs **every start**. Cheap/repeatable only (migrations, service warmup). Never put `npm ci` here.
   - `onCreateCommand` — earliest hook, before secrets/mounts; use for the `safe.directory` fix and base setup.

5. **Run as a non-root user; only `root` when a hook truly needs it.** Set `"remoteUser": "vscode"` so bind-mounted files you create are owned by your host UID, not root. If a feature/base lacks the user, create it in the Dockerfile (`useradd -m vscode`). Need root for one provisioning step? Use `"onCreateCommand"` with `sudo`, then drop back — don't run the whole container as root.

6. **Cache dependencies in named volumes so rebuilds aren't from-scratch.** Bind-mounting the workspace is automatic; the slow part is re-downloading deps. Mount package caches (not `node_modules` inside the workspace — that fights the bind mount):

   ```jsonc
   "mounts": [
     "source=app-pnpm-store,target=/home/vscode/.local/share/pnpm/store,type=volume",
     "source=app-pip-cache,target=/home/vscode/.cache/pip,type=volume"
   ]
   ```
   A fresh `postCreateCommand` then restores from a warm cache instead of the network. For `node_modules`, prefer a volume at the workspace's `node_modules` path so it doesn't sync over the bind mount on macOS/Windows.

7. **Inject dev secrets at runtime — never bake them into the image.** A secret in a Dockerfile layer is in the image history forever and leaks to anyone who pulls it.
   - Provide a committed `.env.example`; have `postCreateCommand` copy it to a gitignored `.env` the app reads.
   - For values devs supply, use `"remoteEnv"` referencing host env vars (`"remoteEnv": { "GH_TOKEN": "${localEnv:GH_TOKEN}" }`), or `runArgs: ["--env-file", ".devcontainer/devcontainer.env"]` (gitignored).
   - In **Codespaces**, real secrets come from repo/Codespaces secrets and appear as env vars — your code must read from env either way, with no host-path assumptions.
   These are *dev-only* credentials (local DB password, sandbox API key). Real production secrets and rotation belong to secrets-management.

8. **Achieve CI parity by sharing the base, not eyeballing versions.** Point the dev Dockerfile's `FROM` (or a shared build stage) at the **exact pinned image your CI runs on**, and keep feature/toolchain versions equal to CI's. Build the image once and let both consume it; if CI builds its own, diff the resolved versions (`node -v`, `python --version`) in step 9. Parity verified by sameness of inputs beats "looks close".

9. **Verify on a truly clean machine state (see Verify).** The only honest test of reproducibility is a fresh clone + rebuilt container with no host toolchain, including a Codespaces or `--no-cache` rebuild.

## Common Errors

- **`latest`/floating tags on the base image or features.** Looks reproducible until a rebuild months later pulls a new toolchain and breaks the build. Pin the base by `@sha256:` digest and every feature to an exact version.
- **Installing toolchains with `RUN curl ... | sh` in the Dockerfile.** Unpinned, unportable, and re-downloads on every cache miss. Use a versioned `feature` instead; reserve the Dockerfile for OS packages features can't provide.
- **Baking secrets/tokens into image layers** (`ENV API_KEY=...` or `COPY .env`). They persist in image history and leak on push. Inject at runtime via `remoteEnv`/`--env-file`/Codespaces secrets; commit only `.env.example`.
- **Running the container as root.** Files you create on the bind-mounted workspace become root-owned and uneditable from the host. Set `remoteUser` to a non-root user matching your UID.
- **Heavy work in `postStartCommand`.** It runs on every start, so `npm ci`/full builds make every "reopen" crawl. Heavy/once-only provisioning → `postCreateCommand`; only cheap idempotent steps → `postStartCommand`.
- **Non-idempotent `postCreateCommand`.** Re-running on rebuild double-seeds the DB or fails on existing rows. Guard with `IF NOT EXISTS`/`--if-not-exists`/existence checks so a rebuild is clean.
- **`node_modules` (or other native deps) on the host bind mount.** Native binaries built for the host OS break in the Linux container, and sync is slow on macOS/Windows. Put `node_modules` in a named volume at the workspace path.
- **Dev container drifting from CI.** Different base, different Node minor → the classic green-locally/red-in-CI. Derive both from one pinned base and keep feature versions identical; diff resolved versions in verification.
- **Testing the rebuild on a machine that still has the host toolchain installed.** It masks "the container forgot to install X" because the host silently provides it. Validate where no host toolchain exists (Codespaces, a clean VM, or a `--no-cache` rebuild).
- **Editing `devcontainer.json` and expecting a running container to pick it up.** Lifecycle/feature changes only apply on **Rebuild Container**, not reload-window. Always rebuild after config changes.

## Verify

1. **Fresh clone, cold open:** Clone into a directory with no prior build, "Reopen in Container" → container builds, `postCreateCommand` runs to completion (exit 0), and the app builds/starts with **zero host toolchain installed** (uninstall or run in a clean VM).
2. **Pins are real:** `grep` the Dockerfile and `devcontainer.json` — base is `@sha256:`, every feature has an explicit `version`, no `:latest`. No raw `curl|sh` toolchain installs.
3. **No baked secrets:** `docker history --no-trunc <image>` shows no tokens/keys/`.env`; the running app reads secrets from env/`.env` injected at runtime. `.env` is gitignored; `.env.example` is committed.
4. **Non-root + ownership:** `whoami` inside ≠ `root`; a file created in the workspace is owned by your host user, editable from the host.
5. **CI parity:** Resolved versions inside the container (`node -v`, `python --version`, `go version`) match the CI job's exactly. The dev base and CI base resolve to the same digest (or documented-equal).
6. **Cache works:** Rebuild the container; `postCreateCommand` restores deps from the cache volume without re-downloading the full dependency set (visibly faster than the first build).
7. **Idempotent rebuild:** Run "Rebuild Container" twice — second `postCreateCommand` succeeds with no duplicate seeds/errors.
8. **Codespaces (if targeted):** The repo opens in a Codespace and reaches the same working state with no local-filesystem/host assumptions.

Done = a fresh clone with no host toolchain reaches a building, running app via reopen-in-container; every base/feature is version-pinned; no secret is in any image layer; the container runs non-root; and resolved toolchain versions match CI exactly.
