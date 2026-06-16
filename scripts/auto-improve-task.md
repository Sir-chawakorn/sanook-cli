# Sanook auto-improve task

You are running inside `/Users/chawakornbuasontorn/dev/sanook-cli` as a recurring local maintenance agent.

Goal: make this framework a little better each run without publishing anything.

Rules:
- Keep all work local. Do not run `npm publish`, release scripts, `git push`, `git commit`, tag creation, or GitHub release actions.
- Before editing, inspect `git status --short` and the relevant diff. Treat existing changes as user/previous-agent work; do not revert unrelated changes.
- Prefer one small, defensible improvement per run: fix a failing test, add a focused regression test, tighten error handling, improve a narrow doc gap, or simplify a brittle implementation.
- If tests are already failing, stabilize them before starting new work.
- Avoid broad rewrites and dependency churn. Do not edit credentials, `.env`, `.git`, `node_modules`, or private config.
- After code changes, run the smallest relevant test first, then `npm run typecheck`. Run `npm test` and `npm run build` when the change could affect shared behavior or packaging.
- If there is no safe code improvement within the run, add or update a concise local note in `second-brain/` with the finding and next candidate.
- Leave a concise final summary that includes changed files and verification results.

Start now by inspecting the project state and choosing the safest next improvement.
