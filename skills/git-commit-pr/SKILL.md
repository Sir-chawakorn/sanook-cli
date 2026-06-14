---
name: git-commit-pr
description: Stages and writes a Conventional Commits message from the actual diff, then opens a pull request with a structured description (summary, changes, test plan) using the gh CLI. Use when changes are ready to commit and/or turn into a PR.
when_to_use: Use when changes are ready to commit and/or turn into a pull request — i.e. work is finished and needs committing, a PR must be opened, or the user explicitly says commit / push / open a PR.
---

## When to Use

- Work is finished and the user asked to commit, push, or open a PR.
- Do NOT auto-commit or auto-push. Only commit/push when the user explicitly requests it.
- If the user only said "commit" (not "push"/"PR"), stop after the commit step.

## Steps

1. **Read the actual diff first.** Run `git status` and `git diff` (staged + unstaged) and `git log --oneline -5`. Never write a commit message from memory or from the task description — describe what the diff actually changed.
2. **Scan for secrets before staging.** Grep the diff for keys/tokens (e.g. `sk-`, `ghp_`, `glpat-`, `AKIA`, `Bearer `, `password`, `api_key`, `.env` contents). If found, stop and flag it — do not commit.
3. **Split into logical units.** If the diff covers unrelated concerns (e.g. a bugfix + an unrelated refactor), make separate commits with `git add <specific paths>` per unit. One commit = one coherent change. Do not lump everything into one blob.
4. **Write a Conventional Commits message.** Format: `type(scope): summary` where type ∈ `feat|fix|refactor|chore|docs|test|perf|build|ci`. Keep the subject ≤ ~72 chars, imperative mood. In the body, explain **why** the change was made (the problem/intent), not just a restatement of the file list.
5. **Add a co-author trailer** if your environment defines one (blank line, then `Co-Authored-By: Name <email>`). Skip if none is configured.
6. **Branch if on the default branch.** Run `git branch --show-current`. If it's `main`/`master`, create a topic branch (`git switch -c <type>/<short-desc>`) before committing — never commit directly to the default branch.
7. **Commit.** Use a heredoc for multi-line messages so formatting survives:
   ```
   git commit -m "$(cat <<'EOF'
   fix(parser): handle empty input without panicking

   Empty stdin previously hit an unchecked index. Guard the read
   and return an empty result instead.
   EOF
   )"
   ```
8. **Push the branch** (only if the user wants a PR/push): `git push -u origin <branch>`.
9. **Open the PR with a structured body** via `gh`:
   ```
   gh pr create --title "<type(scope): summary>" --body "$(cat <<'EOF'
   ## Summary
   One or two sentences on what this PR does and why.

   ## Changes
   - bullet per meaningful change
   - grouped by area if large

   ## Test plan
   - [ ] command(s) run to verify, with expected result
   - [ ] manual checks performed
   EOF
   )"
   ```
10. **Return the PR URL** that `gh pr create` prints.

## Common Errors

- **Interactive flags fail.** `-i` (e.g. `git rebase -i`, `git add -i`) and editor-launching commands hang in a non-interactive environment. Always pass the message via `-m`/`--body` (heredoc), never let an editor open.
- **`gh` not authenticated.** If `gh pr create` errors with auth, run `gh auth status` to confirm. Don't fall back to printing a manual PR link unless asked.
- **No upstream / no remote branch.** First push must use `git push -u origin <branch>`, or `gh pr create` can't find the head branch.
- **Committed to default branch by accident.** If you discover you committed to `main`/`master`, move the commit to a new branch (`git switch -c <branch>`) and reset the default branch back (`git reset --hard origin/main`) — but reset is destructive, so confirm before running.
- **Empty diff.** If `git status` shows nothing staged/changed, there is nothing to commit — report that instead of creating an empty commit.
- **Pre-commit hooks rewrite files.** If a hook modifies files, the commit may abort. Re-stage the hook's changes and commit again; if it still fails, surface the hook output rather than using `--no-verify`.

## Verify

- `git log -1 --stat` shows your commit with a Conventional Commits subgraph and the expected files.
- `git status` is clean (or shows only intentionally-unstaged paths).
- No secret strings appear in `git show HEAD`.
- For a PR: `gh pr view --json url,title,body` returns the PR with the title, and a body containing `## Summary`, `## Changes`, and `## Test plan`.
- The current branch is NOT the default branch when a PR was opened.
