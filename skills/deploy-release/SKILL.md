---
name: deploy-release
description: Prepares and runs a safe deploy/release — pre-flight checks (tests/build green, env vars, migrations applied), versioning/tagging, rollout, and post-deploy smoke verification with a rollback path. Use when shipping a build to staging/production.
when_to_use: deploy ขึ้น staging/prod; ทำ release; cut a version tag; ก่อน/หลัง rollout
---

## When to Use

Use this skill when shipping a build to **staging or production**: cutting a release, tagging a version, or rolling out a deployment. Do **not** use it for local dev runs, hotfix branches that never reach a shared environment, or read-only inspection of a running service.

Before doing anything, discover the repo's actual deploy mechanics — never assume. In order:
1. Read CI/CD config: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/`.
2. Read deploy/infra files: `Dockerfile`, `docker-compose*.yml`, `k8s/`, `helm/`, `Procfile`, `fly.toml`, `vercel.json`, `serverless.yml`, `Makefile` (look for `deploy`/`release`/`migrate` targets).
3. Read the package manifest scripts: `package.json`, `pyproject.toml`, `Cargo.toml`, etc.
4. Check `CHANGELOG.md`, `VERSION`, and existing git tags (`git tag --sort=-v:refname | head`).

If the rollout strategy or rollback command cannot be determined from the repo, **stop and ask** — do not invent one.

## Steps

1. **Confirm target + branch.** Identify the environment (staging vs prod) and the exact commit/branch being shipped. Run `git status` (clean working tree) and `git rev-parse HEAD`. Refuse to deploy uncommitted changes or a detached/unexpected ref.

2. **Pre-flight — must all pass before proceeding. Stop on the first red.**
   - Tests: run the repo's test command; require **exit code 0**. Do not weaken assertions or skip suites to get green.
   - Build: run the production build command; require exit 0 and verify artifacts/output exist.
   - Lint/typecheck: run if the repo defines it; require clean.
   - Env/secrets: enumerate required vars from the repo (`.env.example`, config schema, CI secret list) and confirm each is set in the **target** environment. Never print secret values — check presence only.
   - Migrations: detect pending DB migrations (e.g. `migrate status`, framework equivalent). Decide order per the repo's convention (usually migrate **before** rollout for additive changes; expand→migrate→contract for breaking schema). If migrations are destructive, surface them explicitly before running.

3. **Version + tag + changelog.** Bump version per repo convention (semver: patch/minor/major). Update `CHANGELOG.md` with the diff since the last tag. Commit, then create an **annotated** tag (`git tag -a vX.Y.Z -m "..."`). Push commit and tag.

4. **Rollback prep — BEFORE rollout, not after.** Capture and write down the exact rollback path: previous tag/image digest/release id, the precise revert command (e.g. redeploy prior image, `helm rollback`, platform "rollback" command), and any migration down-path. Do not start rollout until this is ready.

5. **Rollout** using the repo's strategy — do not improvise a different one:
   - **Blue-green:** deploy to idle env, smoke-test it, then flip traffic.
   - **Canary:** route a small % first, watch metrics/errors, then ramp.
   - **Rolling:** deploy incrementally, watch each batch's health gate.
   Trigger via the repo's documented command/CI pipeline.

6. **Post-deploy smoke test.** Hit the primary health endpoint and 1–2 critical user paths against the **live** target. Confirm expected status code AND response shape (not just 200). Check error rate / logs for a short window. For a UI deploy, load the page and screenshot.

7. **Decide.** Smoke green → record the deployed version + commit and close out. Smoke red → execute the rollback from step 4 immediately, then diagnose. Never leave a half-rolled-out failed deploy live.

## Common Errors

- **Shipping on red tests** — the single biggest gotcha. CI cache or a flaky suite makes it tempting to bypass. Don't. Re-run, fix root cause.
- **Forgotten migration** — code deployed expecting a column/table that isn't there → runtime 500s on first request. Always check pending migrations in pre-flight, and sequence migrate vs rollout for the schema-change type.
- **No smoke check** — assuming a successful deploy command means a working app. A clean rollout can still serve a crashing app (bad env var, failed boot). Always verify against the live endpoint.
- **Rollback prepared too late** — discovering the rollback command *after* prod is broken wastes the worst minutes. Capture it in step 4.
- **Env var set in CI but not runtime** (or in staging but not prod) — check presence in the actual target environment, not where you happen to be standing.
- **Lightweight tag instead of annotated** — `git tag vX` loses author/date/message; release tooling and `git describe` expect annotated tags.
- **Migration run twice / out of order** across blue and green nodes — gate migrations to run once, idempotently.

## Verify

Deploy is successful only when **all** hold, each backed by real evidence (output, status code, screenshot) — not assumption:

- Pre-flight: test + build commands exited 0 (show the output).
- Tag pushed: `git ls-remote --tags origin` shows the new annotated tag; `CHANGELOG.md` updated.
- Live smoke: health endpoint returns expected status **and** body shape; critical path works against the target host (paste the response / screenshot).
- Error rate / logs clean for the watch window after rollout.
- Rollback command is documented and was confirmed available before rollout.

If you cannot produce evidence for any line above, the deploy is **not** verified — do not declare done; roll back or hold.
