---
tags: [review, maintenance, auto-improve]
note_type: review
created: 2026-06-18
updated: 2026-06-18
parent: "[[Reviews/_Index]]"
---

# Auto Improve Maintenance - 2026-06-18

> Purpose: Record the local recurring maintenance run, the small improvement chosen, and verification status for future agents.

## Scope

Recurring local maintenance run for `sanook-cli`.

## Current State

- Existing uncommitted source changes are concentrated in `src/tools/permission.ts`, `src/tools/tools.test.ts`, and `src/tools/jsgrep.test.ts`.
- Those changes harden the permission gate around `git --config-env` aliases, `env -S` parsing, and broad JS grep fallback symlink handling.
- This run extended the permission gate to also detect dangerous aliases injected through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_N` / `GIT_CONFIG_VALUE_N`.
- The maintenance note now includes the required AI-purpose blockquote so bundled markdown validation passes.

## Verification

- `npm test -- src/tools/tools.test.ts src/tools/jsgrep.test.ts` - passed.
- `npm run typecheck` - passed.
- `npm test` - 94 files, 796 tests passed.
- `npm run build` - passed.

## Next Candidate

After the current permission hardening settles, consider a focused regression around quoted command text in `checkBash` if over-blocking ordinary test commands becomes a real workflow problem.

up:: [[Reviews/_Index]]
