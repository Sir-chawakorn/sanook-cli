---
tags: [session, session-log, sanook-cli, second-brain]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 - Sanook Brain Final CLI

> Session log for turning the manual final-gate template into a Sanook CLI workflow with validation and eval coverage.

## Summary

- Added `sanook brain final [--task "..."] [--from-diff] [--lite]`.
- Added [[Templates/final-lite]] for smaller evidence-backed closeouts.
- Added final-gate validation to `sanook brain review`.
- Added `SB-FINAL` coverage to `sanook brain eval`.
- Verified with targeted tests, typecheck, full tests, build, diff check, and a temp-vault CLI smoke.

## What Was Tried

- Read the existing `brain context/eval/review` command pattern before adding a new subcommand.
- Kept the generator pure/testable in `src/brain-final.ts`.
- Used the existing Sessions folder as the canonical home for generated closeout notes.
- Let `--from-diff` prefill changed files from `git status --porcelain=v1`.
- Kept `brain review` non-blocking: incomplete final gates warn instead of failing the whole vault.

## Errors

- Initial typecheck failed because `CreateBrainFinalOptions` inherited required booleans from parsed CLI args even though runtime options are optional.

## Solutions

- Made `CreateBrainFinalOptions` explicitly optional for `fromDiff`, `lite`, `force`, `task`, and `output`.
- Added tests for parser behavior, full/lite generation, overwrite protection, output path safety, and validator warnings.
- Added a CLI smoke from `dist/bin.js` using a temp HOME and temp vault.

## Key Decisions

- Default output path is `Sessions/YYYY-MM-DD-<slug>-final.md`.
- `--output` is confined inside the configured second-brain vault.
- `--lite` uses the same eight final-gate section names so review/eval can share the same structural validator.
- `brain review` checks session final gates only, while template files are checked structurally so scaffolded vaults do not fail because templates contain TODO placeholders.

## Files Changed

- `src/brain-final.ts`
- `src/brain-final.test.ts`
- `src/bin.ts`
- `src/commands.ts`
- `src/brain-review.ts`
- `src/brain-review.test.ts`
- `src/brain-eval.ts`
- `src/brain-eval.test.ts`
- `src/brain.test.ts`
- `second-brain/Templates/final-lite.md`
- `second-brain/Templates/_Index.md`
- `second-brain/Shared/AI-Context-Index.md`
- `second-brain/Shared/Tech-Standards/verification-standard.md`
- `second-brain/Runbooks/ai-second-brain-operating-sequence.md`
- `second-brain/Evals/second-brain-benchmarks.md`
- `second-brain/Evals/quality-ledger.md`
- `second-brain/Shared/Operating-State/current-state.md`
- `CHANGELOG.md`

Unrelated pre-existing changes left untouched:

- `src/config.ts`
- `src/config.test.ts`

## Next Steps

- Dogfood `sanook brain final --task "..." --from-diff` in future non-trivial Sanook CLI work.
- Consider `sanook brain new TYPE` later if template instantiation becomes a broader workflow need.

up:: [[Sessions/_Index]]
