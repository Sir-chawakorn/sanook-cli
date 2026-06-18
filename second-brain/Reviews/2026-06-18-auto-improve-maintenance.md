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

- Existing uncommitted changes already included a `serve --port` missing-value UX fix in `src/cli-args.ts`, search split-option hardening, matching tests, changelog text, and release-readiness notes.
- Full test baseline passed before this follow-up work.
- This run consolidated duplicated inline/split CLI option-value handling into `src/cli-option-values.ts`, shared by `parseArgs`, `parseServeArgs`, and `parseSearchArgs`.
- Parser behavior is intended to stay unchanged by the consolidation; existing focused parser tests cover the touched surfaces.
- This recurring follow-up added a spawned CLI regression test for `sanook gateway setup ntfy`, covering required split-option missing values and preserving single-dash secret values like `--token -tk_secret`.

## Verification

- `npm test` before new edits - 94 files, 810 tests passed.
- `npm test -- src/search/cli.test.ts` - 1 file, 10 tests passed.
- `npm run typecheck` - passed.
- One chained full-suite attempt hit sandbox loopback `EPERM` while another listen probe was running; `npm test -- src/integration.test.ts` passed on rerun.
- `npm test` after new edits - 94 files, 811 tests passed.
- `npm run build` - passed.
- Follow-up baseline `npm test` - 94 files, 811 tests passed.
- `npm test -- src/cli-args.test.ts src/search/cli.test.ts` - 2 files, 30 tests passed.
- Follow-up `npm run typecheck` - passed.
- Follow-up `npm test` after consolidation - 94 files, 811 tests passed.
- Follow-up `npm run build` - passed.
- Recurring maintenance baseline `npm test` - 95 files, 814 tests passed.
- `npm test -- src/gateway-setup-cli.test.ts` - 1 file, 2 tests passed.
- `npm run typecheck` - passed.
- Follow-up `npm test` after gateway setup CLI regression coverage - 96 files, 816 tests passed.
- `npm run build` - passed.

## Follow-up Audit

- Reviewed the remaining direct next-argument readers in `src/tools/permission.ts` and `src/bin.ts`.
- No safe behavior change was made this pass: the `permission.ts` readers intentionally model shell/git option semantics where a following token that begins with `-` can still be the consumed value, and the gateway setup helpers in `bin.ts` may receive secret/token values that begin with `-`.
- Avoid broad conversion to the shared CLI option helper unless the target command surface has tests proving flag-like values should be rejected.

## Next Candidate

Consider extracting a small gateway setup option parser only if more setup command regressions appear; for now the spawned CLI regression coverage protects the known brittle edge without broad parser churn.

up:: [[Reviews/_Index]]
