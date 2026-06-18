---
tags: [final-gate, verification, sanook-cli, second-brain]
note_type: final-gate
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
---

# 2026-06-18 - Sanook Brain Final CLI - Final Gate

> Evidence-backed closeout for implementing `sanook brain final`, `--from-diff`, [[Templates/final-lite]], final-gate validation, and eval coverage.

## 0. Final Gate Rule

- [x] This final gate was created before the final owner-facing answer.
- [x] Every PASS/PARTIAL/FAIL/BLOCKED claim below has evidence or an explicit reason.
- [x] No unchecked item is silently treated as done.
- [x] If evidence is missing, status is `PARTIAL`, `FAIL`, or `BLOCKED`, not `PASS`.
- [x] If a row has no evidence, it cannot be `PASS`.

## 1. Objective / DoD Lock

Original request:

```text
ทำทั้งหมดมาได้เลย
```

Expected output:

- [x] Add `sanook brain final`.
- [x] Support `--from-diff`.
- [x] Add a final-gate validator.
- [x] Add [[Templates/final-lite]].
- [x] Integrate final-gate coverage with `sanook brain eval`.

Definition of Done:

| DoD item | Status | Evidence | Notes |
|---|---|---|---|
| CLI can create a final gate note in Sessions. | PASS | `src/brain-final.ts`; temp-vault smoke with `node dist/bin.js brain final --task "smoke final gate" --from-diff` | Smoke created `Sessions/2026-06-18-smoke-final-gate-final.md`. |
| Diff prefill works. | PASS | `src/brain-final.test.ts`; smoke output `from-diff: 23 file(s)` | Prefills changed-file table from git status. |
| Lite template exists and is scaffolded. | PASS | `second-brain/Templates/final-lite.md`; `src/brain.test.ts`; temp-vault smoke with `--lite --output Sessions/smoke-lite-final.md` | Scaffold test includes full and lite templates; smoke created a lite final gate. |
| Review validates final-gate evidence. | PASS | `src/brain-review.ts`; `src/brain-review.test.ts` | Test catches TODO and PASS-without-evidence rows. |
| Eval covers final-gate contract. | PASS | `src/brain-eval.ts`; `src/brain-eval.test.ts` | `SB-FINAL` case added. |
| Work is documented and discoverable. | PASS | [[Sessions/2026-06-18-sanook-brain-final-cli]], [[Evals/quality-ledger]], [[Templates/_Index]], [[Shared/AI-Context-Index]] | Index and hot path updated. |

Out of scope / non-goals:

- No automatic filling of all final-gate evidence rows from tests; the CLI creates a scaffold and prefilled diff evidence, then the agent/owner must complete it.
- No broad `sanook brain new TYPE` template generator in this change.

## 2. Evidence-Backed Checklist

| Gate | Status | Evidence | Notes |
|---|---|---|---|
| Relevant source/context was read before editing. | PASS | Read `src/brain.ts`, `src/brain-review.ts`, `src/brain-eval.ts`, `src/bin.ts`, existing templates, and tests | Matched local command/test style. |
| Existing canonical note/file was searched before creating a new one. | PASS | `rg final-lite|brain final|review.final-gates|SB-FINAL` | No existing CLI final generator was present. |
| Changes were made in the correct folder/module boundary. | PASS | New logic isolated in `src/brain-final.ts`; docs in second-brain templates/standards/evals | Existing `brain context/eval/review` patterns preserved. |
| No unrelated user/worktree changes were reverted or overwritten. | PASS | `git status --short` showed `src/config.ts` and `src/config.test.ts` as pre-existing modified files; they were not edited | Mention in final answer. |
| New/changed durable notes have `parent` and `up::`. | PASS | This file and session log include `parent` and `up::`; scaffold hygiene tests passed | Full tests passed. |
| Index/backlink/discoverability was updated when needed. | PASS | [[Sessions/_Index]], [[Templates/_Index]], [[Shared/AI-Context-Index]], [[Evals/quality-ledger]] | Links added. |
| Verification was run at the right scope. | PASS | Targeted tests, typecheck, full tests, build, diff check, CLI smoke | Listed in Evidence Matrix. |
| Residual risk is stated clearly. | PASS | Residual Risk section | Known limitation documented. |

## 3. Status Matrix

| Work item / phase | Status | Evidence | Owner-visible outcome |
|---|---|---|---|
| Frame objective and DoD | PASS | Section 1 of this final gate | "ทำทั้งหมด" mapped to five concrete deliverables. |
| Retrieve required context | PASS | Files inspected list below | Implementation follows existing Sanook brain command structure. |
| Implement / write / edit | PASS | Files changed list below | New CLI workflow exists. |
| Verify behavior or artifact | PASS | Commands table below | Tests/build/smoke passed. |
| Update memory/index/session if needed | PASS | Session, final gate, current-state, quality ledger, Sessions index | Work is traceable. |
| Prepare final response | PASS | Final-answer draft below | Response can cite verified evidence. |

Blocked / partial explanation:

- `PARTIAL`: none.
- `BLOCKED`: none.

## 4. Evidence Matrix

Commands:

| Command | Status | Important output | Scope proven |
|---|---|---|---|
| `npm test -- src/brain-final.test.ts src/brain-review.test.ts src/brain-eval.test.ts src/brain.test.ts` | PASS | 4 files, 37 tests passed | Targeted final/review/eval/scaffold behavior. |
| `npm run typecheck` | PASS | `tsc --noEmit` passed | TypeScript compile surface. |
| `npm test` | PASS | 102 files, 881 tests passed | Full current test suite. |
| `npm run build` | PASS | `tsc -p tsconfig.build.json` passed | Build output compiles. |
| `git diff --check` | PASS | No output | No whitespace/conflict-marker issues. |
| `node dist/bin.js brain init ...` then `node dist/bin.js brain final --task "smoke final gate" --from-diff` | PASS | Created temp-vault final note, linked Sessions index, `from-diff: 23 file(s)` | Real CLI path from built output. |
| `node dist/bin.js brain init ...` then `node dist/bin.js brain final --task "smoke lite final" --lite --output Sessions/smoke-lite-final.md` | PASS | Created temp-vault lite final note and linked Sessions index. | Real lite CLI path from built output. |

Files inspected:

| File/path | Why it matters | Evidence |
|---|---|---|
| `src/brain.ts` | Scaffold/copy pattern | New template covered by scaffold tests. |
| `src/brain-review.ts` | Existing curator check shape | Added final-gate check in same pattern. |
| `src/brain-eval.ts` | Existing benchmark runner shape | Added `SB-FINAL`. |
| `src/bin.ts` | CLI subcommand wiring | Added `runBrainFinal` and dispatcher entry. |
| `second-brain/Templates/final.md` | Full final gate source | Lite template mirrors section contract. |

Files changed:

| File/path | Change summary | Evidence |
|---|---|---|
| `src/brain-final.ts` | New parser, generator, diff prefill, Sessions index update, and validator helpers. | Targeted tests and typecheck passed. |
| `src/brain-final.test.ts` | Parser/generation/validator coverage. | Targeted tests passed. |
| `src/bin.ts` / `src/commands.ts` | CLI help and dispatcher wiring for `brain final`. | CLI smoke passed. |
| `src/brain-review.ts` / `src/brain-review.test.ts` | Review check for final-gate templates and session final gates. | Targeted tests passed. |
| `src/brain-eval.ts` / `src/brain-eval.test.ts` | `SB-FINAL` eval case. | Targeted tests passed. |
| `src/brain.test.ts` | Scaffold/template coverage for `final-lite`. | Targeted tests passed. |
| `second-brain/Templates/final-lite.md` | New compact evidence-backed final gate template. | Scaffold tests passed. |
| `second-brain/*` indexes/standards/evals/session files | Discoverability and quality-loop closeout. | This final gate and full tests. |
| `CHANGELOG.md` | User-facing release note. | Diff reviewed. |

Artifacts/rendered outputs:

| Artifact | Status | Evidence |
|---|---|---|
| Built CLI smoke final note in temp vault | PASS | Smoke output showed created path and Sessions index link. |

External sources, if any:

| Source | Claim supported | Link / citation |
|---|---|---|
| N/A | This task used local repo state only. | N/A |

## 5. Residual Risk

Known risk:

| Risk | Impact | Mitigation / next check |
|---|---|---|
| `--from-diff` uses `git status --porcelain=v1` path parsing and does not deeply unescape exotic quoted paths. | Very unusual filenames may need manual adjustment in the generated evidence table. | Keep generated rows editable; add quoted-path parser later if a real case appears. |
| Generated final gate still contains TODO rows by design. | `brain review` will warn until the gate is filled. | This is intentional; users/agents must complete evidence before claiming done. |
| Worktree had unrelated config changes before this task. | Full tests cover current tree, but those files are not part of this implementation. | Final answer names them as untouched unrelated changes. |

Checks not run:

| Check | Reason not run | Consequence |
|---|---|---|
| Visual/browser QA | No frontend or visual artifact changed. | N/A |

Do not claim done if:

- [x] Required checks passed.
- [x] Changed behavior was exercised by tests and CLI smoke.
- [x] Final answer will mention residual risk and unrelated modified files.

## 6. Change Summary Audit

What changed:

- `sanook brain final` can create full or lite final-gate notes in Sessions.
- `--from-diff` can prefill changed-file evidence rows.
- `brain review` validates session final gates.
- `brain eval` includes `SB-FINAL`.
- Second-brain docs/indexes/quality ledger/session state now point to the workflow.

What did not change:

- No broad template generator was added.
- No automatic evidence completion was added.
- Pre-existing `src/config.ts` and `src/config.test.ts` changes were not edited.

Behavior before:

- Final gate existed as a manual template only.
- Review/eval did not know whether final gates existed or were complete.

Behavior after:

- Sanook can generate final-gate notes from CLI, smoke-tested through built `dist/bin.js`.
- Review/eval can keep the final-gate workflow from drifting.

Compatibility / migration notes:

- Existing vaults without `Templates/final-lite.md` can still run the command because the generator falls back to bundled templates.

## 7. Final Answer Draft

```text
ทำครบแล้วครับ: เพิ่ม `sanook brain final`, `--from-diff`, `--lite`, final-gate validator ใน `brain review`, และ `SB-FINAL` ใน `brain eval` พร้อม docs/templates/session closeout.

Verified:
- npm test -- src/brain-final.test.ts src/brain-review.test.ts src/brain-eval.test.ts src/brain.test.ts: PASS
- npm run typecheck: PASS
- npm test: PASS (102 files, 881 tests)
- npm run build: PASS
- git diff --check: PASS
- built CLI smoke: PASS (`--from-diff` and `--lite`)

Note:
- `src/config.ts` และ `src/config.test.ts` เป็น modified อยู่ก่อนแล้ว ผมไม่ได้แตะสองไฟล์นี้
```

Final-answer safety check:

- [x] Does not claim tests/build/smoke passed unless listed in Evidence Matrix.
- [x] Names files/commands accurately.
- [x] Mentions skipped checks or residual risk.
- [x] Is concise enough for the owner.

## 8. Second-Brain Routing / Memory Closeout

Session / handoff:

- [x] Added [[Sessions/2026-06-18-sanook-brain-final-cli]].
- [x] Added this final gate note.
- [x] Updated [[Sessions/_Index]].

Durable memory:

- [x] Updated [[Shared/Operating-State/current-state]].
- [x] No new owner preference or protected fact discovered.

Indexes / discoverability:

- [x] Updated [[Templates/_Index]].
- [x] Updated [[Shared/AI-Context-Index]].
- [x] Updated [[Evals/quality-ledger]].
- [x] Updated [[Evals/second-brain-benchmarks]].

Quality loop:

- [x] Added `SB-FINAL` eval case.
- [x] Ran targeted tests, typecheck, full tests, build, diff check, and CLI smoke.

## Final Verdict

| Verdict | Choose one | Evidence |
|---|---|---|
| Ready to close | PASS | Tests, typecheck, build, diff check, and CLI smoke passed. |
| Close with caveats | PASS | Residual risk around exotic git paths and intentionally unfilled generated gates is documented. |
| Needs more work | N/A | No required item remains open. |
| Blocked | N/A | No blocker. |

One-line final state:

> Ready to close: Sanook now has a CLI-backed final-gate workflow with diff prefill, lite template, review validation, eval coverage, and documented evidence.

up:: [[Sessions/_Index]]
