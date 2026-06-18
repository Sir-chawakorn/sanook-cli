---
tags: [final-gate, verification, second-brain]
note_type: final-gate
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
---

# 2026-06-18 - Final Gate Template - Final Gate

> Evidence-backed closeout for adding [[Templates/final]] and wiring it into the Sanook second-brain framework.

## 0. Final Gate Rule

- [x] This final gate was created before the final owner-facing answer.
- [x] Every PASS/PARTIAL/FAIL/BLOCKED claim below has evidence or an explicit reason.
- [x] No unchecked item is silently treated as done.
- [x] If a row has no evidence, it cannot be `PASS`.

## 1. Objective / DoD Lock

Original request:

```text
งั้น ช่วยทำทั้งแปดข้อให้ฉันหน่อยอย่างละเอียด
```

Expected output:

- [x] Create a detailed `final.md` template that implements the eight proposed logic areas.
- [x] Wire the template into existing second-brain indexes/standards so agents can discover it.
- [x] Add verification that the template is bundled and keeps the eight sections.

Definition of Done:

| DoD item | Status | Evidence | Notes |
|---|---|---|---|
| `Templates/final.md` exists and covers all eight logic areas. | PASS | `second-brain/Templates/final.md`; `npm test -- src/brain.test.ts src/brain-review.test.ts` | Test asserts all eight headings. |
| Template is linked from canonical indexes/hot path. | PASS | `Templates/_Index.md`, `Shared/AI-Context-Index.md`, `verification-standard.md`, operating sequence | Discoverable from template, hot context, and technical standard. |
| Existing scaffold copies final template. | PASS | `src/brain.test.ts`; targeted test passed | `scaffoldBrain` copies bundled markdown seeds. |
| Work was verified without touching unrelated gateway changes. | PASS | `git status --short`; final response note | Gateway files were pre-existing unrelated changes and were not edited. |

## 2. Evidence-Backed Checklist

| Gate | Status | Evidence | Notes |
|---|---|---|---|
| Relevant source/context was read before editing. | PASS | Read template/index/verification files and `src/brain.test.ts` | Used current repo state, not memory only. |
| Existing canonical note/file was searched before creating a new one. | PASS | `find second-brain/Templates...`; `rg final/checklist/verification` | No existing `Templates/final.md`. |
| Changes were made in the correct folder/module boundary. | PASS | `Templates/final.md`; Tech-Standards/Runbook/AI index updates | No root folder added. |
| No unrelated user/worktree changes were reverted or overwritten. | PASS | `git status --short` still shows gateway files separate | Gateway files untouched. |
| New/changed durable notes have `parent` and `up::`. | PASS | `brain.test.ts` bundled markdown hygiene test passed | Includes final/session notes. |
| Index/backlink/discoverability was updated. | PASS | `Templates/_Index.md`, `Sessions/_Index.md`, `Shared/Tech-Standards/_Index.md` | Added links. |
| Verification was run at the right scope. | PASS | Targeted tests, typecheck, full tests, diff check | Listed below. |
| Residual risk is stated clearly. | PASS | Residual Risk section | No CLI command implemented yet. |

## 3. Status Matrix

| Work item / phase | Status | Evidence | Owner-visible outcome |
|---|---|---|---|
| Frame objective and DoD | PASS | This final gate section 1 | The eight items became concrete deliverables. |
| Retrieve required context | PASS | Read local template/standard/runbook files | Work fits existing vault taxonomy. |
| Implement / write / edit | PASS | Files changed list below | `final.md` and wiring added. |
| Verify behavior or artifact | PASS | `npm test`, typecheck, targeted tests | Scaffold/template hygiene preserved. |
| Update memory/index/session if needed | PASS | Session note + Sessions index + current-state updates | Trace preserved. |
| Prepare final response | PASS | Final-answer draft below | Response will match evidence. |

## 4. Evidence Matrix

Commands:

| Command | Status | Important output | Scope proven |
|---|---|---|---|
| `npm test -- src/brain.test.ts src/brain-review.test.ts` | PASS | 2 files, 26 tests passed | Template/scaffold/review targeted behavior. |
| `npm run typecheck` | PASS | `tsc --noEmit` passed | TypeScript compile surface. |
| `git diff --check` | PASS | No output | No whitespace conflict markers. |
| `npm test` | PASS | 100 files, 865 tests passed | Full current test suite. |

Files inspected:

| File/path | Why it matters | Evidence |
|---|---|---|
| `second-brain/Shared/Tech-Standards/verification-standard.md` | Existing DoD and verification contract | Updated with Final Gate section. |
| `second-brain/Checklists/preflight-postflight-template.md` | Existing pre/postflight checklist pattern | Final template complements, not replaces it. |
| `second-brain/Templates/session.md` | Existing session closeout structure | Final gate links to session/handoff closeout. |
| `second-brain/Runbooks/ai-second-brain-operating-sequence.md` | Agent phase model | Added final gate note under Eval. |
| `src/brain.test.ts` | Scaffold/template regression guard | Added final gate assertions. |

Files changed:

| File/path | Change summary | Evidence |
|---|---|---|
| `second-brain/Templates/final.md` | New canonical final gate template with eight detailed sections. | File exists and targeted tests passed. |
| `second-brain/Templates/_Index.md` | Links final template with other templates. | Index updated. |
| `second-brain/Shared/Tech-Standards/verification-standard.md` | Adds final gate contract. | Standard updated. |
| `second-brain/Shared/Tech-Standards/_Index.md` | Links verification standard. | Index updated. |
| `second-brain/Shared/AI-Context-Index.md` | Adds hot-path pointer to final template. | Index updated. |
| `second-brain/Runbooks/ai-second-brain-operating-sequence.md` | Adds final gate in Eval phase. | Runbook updated. |
| `second-brain/Sessions/2026-06-18-final-gate-template.md` | Session log for this work. | File exists. |
| `second-brain/Sessions/2026-06-18-final-gate-template-final.md` | This final gate. | File exists. |
| `src/brain.test.ts` | Regression tests for final template. | Targeted tests passed. |

## 5. Residual Risk

| Risk | Impact | Mitigation / next check |
|---|---|---|
| No `sanook brain final` command exists yet. | Agents/users must instantiate `Templates/final.md` manually. | Dogfood manually; automate later if repeated use proves the shape. |
| Template is detailed and may be too heavy for trivial tasks. | Could create checklist theater if overused. | Use only for non-trivial, multi-file, framework, release, or auditable tasks. |
| Full tests passed with unrelated gateway worktree changes present. | Test result covers current worktree, not a clean branch. | Final answer should mention gateway files were unrelated and not touched. |

Checks not run:

| Check | Reason not run | Consequence |
|---|---|---|
| `npm run build` | This change is markdown/test-only; typecheck/full tests passed. | Build artifact not separately regenerated for this note-only change. |
| `sanook brain review/eval` | Not required for a template-only framework note, and current configured vault may be user-local. | Could run later after indexing the actual vault. |

## 6. Change Summary Audit

What changed:

- Added a detailed final gate template.
- Wired it into template index, AI context index, verification standard, and operating sequence.
- Added tests to keep the final template bundled and structurally complete.
- Logged the work in Sessions and current-state.

What did not change:

- No CLI command was added.
- No root folder was added.
- Existing unrelated gateway files were not edited.

Behavior before:

- The vault had preflight/postflight and session templates, but no canonical final evidence matrix.

Behavior after:

- Non-trivial work can instantiate [[Templates/final]] before the final answer and close with evidence instead of unchecked claims.

## 7. Final Answer Draft

```text
ทำทั้ง 8 ข้อเป็น `Templates/final.md` แล้ว และผูกเข้ากับ verification standard, AI hot path, operating sequence, indexes, session log, current-state, และ scaffold tests.

Verified:
- npm test -- src/brain.test.ts src/brain-review.test.ts: PASS
- npm run typecheck: PASS
- git diff --check: PASS
- npm test: PASS (100 files, 865 tests)

Residual risk:
- ยังไม่ได้ทำ CLI automation เช่น `sanook brain final`; ตอนนี้เป็น reusable template/manual gate ก่อน
```

## 8. Second-Brain Routing / Memory Closeout

Session / handoff:

- [x] Added [[Sessions/2026-06-18-final-gate-template]].
- [x] Added this final gate note.
- [x] Updated [[Sessions/_Index]].

Durable memory:

- [x] Updated [[Shared/Operating-State/current-state]] with final gate status.
- [x] No user preference or personal invariant was discovered.

Indexes / discoverability:

- [x] Updated [[Templates/_Index]].
- [x] Updated [[Shared/Tech-Standards/_Index]].
- [x] Updated [[Shared/AI-Context-Index]].

Quality loop:

- [x] Targeted and full tests passed.
- [x] Final gate template is covered by `src/brain.test.ts`.

## Final Verdict

| Verdict | Choose one | Evidence |
|---|---|---|
| Ready to close | YES | Full tests, typecheck, diff check, targeted scaffold tests passed. |
| Close with caveats | YES | No CLI automation yet; template/manual gate only. |
| Needs more work | NO | Requested eight detailed logic areas are implemented in template. |
| Blocked | NO | No blocker. |

One-line final state:

> Ready to close: `Templates/final.md` implements all eight requested closeout logic areas with evidence requirements and is wired into the vault framework.

up:: [[Sessions/_Index]]
