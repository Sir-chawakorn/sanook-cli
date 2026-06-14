---
name: dependency-upgrade
description: Upgrades and audits project dependencies safely — reads changelogs/breaking changes, bumps versions, fixes resulting breakage, and verifies with tests/build. Use when updating packages, resolving version conflicts, or patching a vulnerable dependency.
when_to_use: อัปเดต package; แก้ version conflict / lockfile; patch dependency ที่มี CVE; bump major version
---

## When to Use

- A package is outdated and you need it updated (new feature, bug fix, or just freshness).
- A security advisory / CVE affects a direct or transitive dependency and needs patching.
- A version conflict or broken lockfile blocks install (peer-dep mismatch, resolution error).
- A major-version bump is requested and the resulting breakage must be fixed and verified.

Do NOT use for a brand-new dependency add (that's a feature change, not an upgrade) or for unrelated build failures that have nothing to do with dependency versions.

## Steps

1. **Snapshot a clean baseline first.** Ensure the working tree is committed and the build/tests pass *before* touching anything — you need a known-green starting point to attribute breakage. If the baseline is already red, stop and report; don't upgrade on top of existing failures.

2. **Detect the ecosystem and gather facts** (run the pair for the lockfile present):
   - npm/yarn/pnpm: `npm outdated` + `npm audit` (or `pnpm outdated` / `yarn npm audit`)
   - Python: `pip list --outdated` + `pip-audit` (or `uv pip list --outdated`)
   - Rust: `cargo outdated` + `cargo audit`
   - Go: `go list -m -u all` + `govulncheck ./...`

3. **Build a categorized plan, do not bump blindly.** Split targets into three buckets and handle them as *separate commits*:
   - **Security patches** (CVE-driven) — highest priority, smallest scope possible. Prefer the *minimum* version that clears the advisory.
   - **Minor / patch upgrades** — safe to batch together in one group.
   - **Major upgrades** — one package (or one tightly-coupled cluster) at a time, never batched with others.
   For each target note: current → target version, bump type (patch/minor/major), and reason (security/feature/maintenance).

4. **For every major bump, read the breaking changes before editing code.** Open the package's CHANGELOG / release notes / migration guide for *each major version crossed* (e.g. 2→4 means reading 3.0 and 4.0 notes, not just 4.0). List the breaking changes that touch APIs this project actually uses — grep the codebase for the affected symbols to confirm exposure.

5. **Apply one bucket at a time and regenerate the lockfile.** Update the manifest version, then run the install that rewrites the lockfile (`npm install` / `pnpm install` / `cargo update -p <pkg>` / `pip install -U <pkg> && pip freeze`). Check transitive dependencies that moved too — a "minor" direct bump can pull a major transitive bump.

6. **Fix resulting breakage at the source.** Follow the migration guide; update call sites, renamed exports, changed config, removed options. Do **not** pin around the breakage or silence type/lint errors to go green — fix the actual incompatibility.

7. **Verify the bucket is green, then commit including the lockfile.** Run lint + build + full test suite. Only when green, commit (manifest + lockfile together). Repeat steps 5–7 for the next bucket. Keeping buckets in separate commits means any later regression is bisectable and individually revertible.

## Common Errors

- **Batching majors → unbisectable breakage.** Bumping several major versions in one shot makes it impossible to tell which one broke the build. Always isolate majors into their own commit.
- **Lockfile left stale or uncommitted.** Editing the manifest but not regenerating/committing the lockfile means CI and teammates install different versions. The lockfile change is part of the upgrade, not optional.
- **Missing transitive breaking changes.** A direct bump that looks minor can hoist a transitive dependency across a major boundary. Inspect the lockfile diff, not just the manifest diff.
- **Skipping intermediate changelogs.** Jumping 2→5 and reading only the 5.0 notes misses breaking changes introduced in 3.0/4.0. Read every major boundary crossed.
- **Peer-dependency cascade.** Upgrading one package (e.g. a framework) often forces matching majors of its plugins/adapters. Resolve the whole compatible set together or the install errors / silently downgrades.
- **`audit fix --force` blindly.** The `--force` flag will install breaking majors to clear an advisory; run it only after you've read the breaking changes, or prefer an explicit pinned safe version instead.
- **Faking green.** Loosening test assertions, adding `// @ts-ignore`, or downgrading back to dodge the work hides a real runtime break. Fix the root cause.

## Verify

- Install is clean and reproducible: a fresh `npm ci` / `pip install -r` / `cargo build --locked` succeeds with no resolution warnings.
- Lint, build, and the **full** test suite pass — not a subset — and you can show the command + exit code, not just "it works".
- `npm audit` / `pip-audit` / `cargo audit` reports zero remaining advisories at the severity you set out to fix (or documents why any are unfixable).
- The lockfile diff is committed and contains only the intended version moves; no unexplained transitive jumps.
- Each major upgrade is its own commit, so any single one can be reverted independently.
