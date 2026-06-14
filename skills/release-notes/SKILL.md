---
name: release-notes
description: Generate a CHANGELOG / release notes from git history (Keep-a-Changelog + Conventional Commits aware). Filters internal/noise commits and rewrites developer commit messages into plain-language, user-facing entries grouped by Added/Changed/Fixed/Deprecated/Removed/Security, with breaking-change callouts and an optional SemVer bump suggestion.
when_to_use: User asks for a changelog, release notes, "what changed since vX", or to prep a version bump — i.e. turning a range of commits into a human-readable summary. Distinct from the git-commit-pr skill (that writes commits/PRs; this only summarizes an existing range).
---

## When to Use

Use when the input is **a range of existing commits** and the output is **prose for humans** (end users, not contributors):

- "Generate release notes for v1.4.0" / "what changed since v1.3.2?"
- "Prep a CHANGELOG entry for the next release"
- "Summarize commits since last Friday"

Do NOT use for: writing a new commit message or PR body (that is the git-commit-pr skill), or auto-bumping versions in package manifests. This skill reads history and emits markdown; it does not commit.

## Steps

1. **Resolve the range.** Pick a base ref, in priority order:
   - Explicit user input (`v1.3.2..HEAD`, `--since="2026-06-01"`).
   - Else latest semver tag: `git describe --tags --abbrev=0 --match "v*"` → range `<tag>..HEAD`.
   - Else, if no tags exist: `git rev-list --max-parents=0 HEAD` (root) `..HEAD`, and warn the user this is the full history.
   Confirm the resolved range back to the user in one line before producing notes.

2. **Pull structured commit data**, not just subjects — you need bodies to catch `BREAKING CHANGE:` footers:
   ```
   git log <range> --no-merges --reverse --pretty=format:'%H%x1f%s%x1f%b%x1e'
   ```
   Split records on `0x1e`, fields on `0x1f` → (hash, subject, body). `--no-merges` drops merge commits; `--reverse` gives chronological order.

3. **Parse each subject as a Conventional Commit**: `^(?P<type>\w+)(?P<scope>\([^)]+\))?(?P<bang>!)?:\s+(?P<desc>.+)$`. Map type → Keep-a-Changelog section:
   | type | section |
   |---|---|
   | `feat` | Added |
   | `fix` | Fixed |
   | `perf`, `refactor` | Changed (only if user-visible) |
   | `revert` | Changed (note what was reverted) |
   | `security`, fixes a CVE | Security |
   | deprecation noted in body | Deprecated |
   | removal of a feature/flag | Removed |
   Non-conforming subjects: keep them, classify by keyword (`add/added`→Added, `fix/fixed`→Fixed), else park under Changed and flag for human review.

4. **Drop internal/noise commits** from user-facing notes: `chore`, `ci`, `build`, `test`, `docs` (unless user-facing docs), `style`, and any subject matching `merge|bump version|wip|fixup|lint|formatting`. Keep a count of dropped commits — report it ("18 internal commits omitted") so nothing looks silently lost.

5. **Rewrite each kept entry in plain user language** — describe the *benefit/effect*, not the implementation. Strip scopes, ticket IDs, and jargon.
   - `feat(parser): add streaming token decoder` → "Responses now stream token-by-token for faster first output."
   - `fix(auth): null-check session before refresh` → "Fixed a crash when refreshing an expired login."
   One line per entry. No "we", no commit hashes in the line itself (hashes can go in a trailing link if the repo wants them).

6. **Detect breaking changes** = subject has `!` after type/scope (`feat!:`) OR body contains `BREAKING CHANGE:`. Surface these in a dedicated `### ⚠ BREAKING CHANGES` block at the **top** of the version, each with a one-line migration note pulled from the `BREAKING CHANGE:` footer (or flagged `migration note needed` if absent).

7. **Emit dated, version-headed markdown** in Keep-a-Changelog order (Breaking → Added → Changed → Deprecated → Removed → Fixed → Security). Omit empty sections. Header format:
   ```
   ## [1.4.0] - 2026-06-14
   ```
   Use the user-supplied version, or `[Unreleased]` if none. When prepending to an existing `CHANGELOG.md`, insert above the most recent version block, never rewrite released sections.

8. **Suggest a SemVer bump** from what you found: any breaking → **major**; any `feat` → **minor**; only `fix`/`perf` → **patch**. State it as a recommendation, not an action: "Recommended bump: minor (1.3.2 → 1.4.0) — 3 features, no breaking changes."

## Common Errors

- **`git log <tag>..HEAD` empty** → the tag is *ahead of* or equal to HEAD (e.g. notes already cut), or the tag is on a different branch. Check `git merge-base --is-ancestor <tag> HEAD`; if false, the tag isn't in history — ask the user for the right base.
- **Squash/rebase repos** collapse many changes into one Conventional subject, so the body holds the real list. Always parse bodies (step 2) — `feat: revamp auth (#412)` may hide a `BREAKING CHANGE:` footer.
- **Monorepos**: a flat `git log` mixes packages. If the repo has workspaces, scope the range with a pathspec: `git log <range> -- packages/<pkg>/` and produce per-package notes.
- **Reverts double-count**: a `feat` later undone by a `revert` should appear in neither Added nor Changed if both are in-range — net them out, don't list a feature that no longer ships.
- **`--no-merges` + GitHub squash-merge**: squash merges are *not* merge commits, so they survive `--no-merges` (correct). Don't also try `--first-parent` or you'll drop them.
- **Non-Conventional repos**: if <30% of subjects parse as Conventional Commits, say so and fall back to keyword classification rather than forcing prefixes that aren't there.
- **Internal jargon leaking through**: scope names and internal service names are not user vocabulary — translate or remove them in step 5.

## Verify

Before handing back the notes, confirm all of:

1. Every line reads as a benefit/effect a user understands — no commit hashes, scopes, or ticket IDs in the prose.
2. Section order matches Keep-a-Changelog; no empty sections rendered.
3. Breaking-changes count in the ⚠ block equals the count of `!`/`BREAKING CHANGE:` commits found (`git log <range> --grep='BREAKING CHANGE' --oneline | wc -l` plus `!`-subject count).
4. Dropped-commit count + kept-entry count = total non-merge commits in range (`git rev-list --no-merges --count <range>`). If they don't add up, something was lost — re-check the filter.
5. Date is the actual release date (today or user-specified), version header present, SemVer bump recommendation stated.
6. When prepending to an existing CHANGELOG, released sections are byte-for-byte unchanged — only a new block was added on top.
