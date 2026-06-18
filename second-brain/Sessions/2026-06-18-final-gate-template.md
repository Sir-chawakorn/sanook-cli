---
tags: [session, session-log, final-gate, verification, second-brain]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 - Final Gate Template

> Session log for turning the owner's `final.md` idea into a reusable evidence-backed closeout template.

## Summary

Created [[Templates/final]] as the final phase gate for non-trivial work. It turns the owner's eight requested logic areas into a detailed checklist with required evidence, status vocabulary, residual risk, change audit, final answer draft, and second-brain closeout routing.

## What Was Tried

- Read existing verification and closeout notes:
  - [[Shared/Tech-Standards/verification-standard]]
  - [[Checklists/preflight-postflight-template]]
  - [[Templates/session]]
  - [[Runbooks/ai-second-brain-operating-sequence]]
  - [[Shared/Rules/rules-formatting]]
- Added `Templates/final.md`.
- Linked it from [[Templates/_Index]].
- Added final-gate rules to [[Shared/Tech-Standards/verification-standard]].
- Added hot-path pointers in [[Shared/AI-Context-Index]] and [[Runbooks/ai-second-brain-operating-sequence]].
- Added scaffold tests so the final template stays bundled and keeps the eight logic sections.

## Errors

- None blocking.

## Solutions

- Final gate uses `PASS`, `PARTIAL`, `FAIL`, `N/A`, and `BLOCKED`.
- Every row requires evidence; no-evidence rows cannot be `PASS`.
- Final answer draft is generated from evidence rather than memory or intent.
- Closeout includes session/handoff, durable memory routing, indexes, and Sanook brain doctor/review/eval gates.

## Key Decisions

- `Templates/final.md` is the canonical reusable template.
- Actual final gates should be instantiated as session/project artifacts when needed; the template itself stays in `Templates/`.
- `final.md` should remain read-only guidance for now, not a new CLI command, until repeated use proves an automation shape.

## Files Changed

- `second-brain/Templates/final.md`
- `second-brain/Templates/_Index.md`
- `second-brain/Shared/Tech-Standards/verification-standard.md`
- `second-brain/Shared/Tech-Standards/_Index.md`
- `second-brain/Shared/AI-Context-Index.md`
- `second-brain/Runbooks/ai-second-brain-operating-sequence.md`
- `src/brain.test.ts`

## Verification

- `npm test -- src/brain.test.ts src/brain-review.test.ts`: PASS
- `npm run typecheck`: PASS
- `git diff --check`: PASS
- `npm test`: PASS (100 files, 865 tests)

## Next Steps

- [ ] Dogfood [[Templates/final]] on the next non-trivial implementation task.
- [ ] If it proves useful repeatedly, consider `sanook brain final` or `sanook brain new final`.

up:: [[Sessions/_Index]]
