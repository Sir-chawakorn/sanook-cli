---
name: write-plan
description: Converts an approved design/PRD/RFC into a concrete, batched implementation plan — ordered steps, files to touch, dependencies, checkpoints, and a verification step per phase — ready to execute or hand to subagents.
when_to_use: After brainstorm/design sign-off, or for a migration/refactor/multi-file feature where the approach is settled but execution needs sequencing ("make a plan to build X"). Skip for single-file trivial edits that you can describe in one sentence.
---

## When to Use

Use after the *approach* is decided and you need to turn it into ordered, verifiable execution. Inputs you should already have (if missing, go get them first — a plan on a guessed design is worthless):

- An approved design / PRD / RFC, OR a sign-off from a brainstorm step.
- The actual current state of the code (read it — do not plan against assumptions).

**Skip this skill** when the change fits in one file and you can state the diff in one sentence (typo, rename, add a log line, bump a version). Just do it.

**Stop and escalate instead of planning** when the design is still ambiguous, success criteria are undefined, or two steps contradict each other. A plan cannot resolve an unresolved decision — kick it back to design.

This skill produces a *plan only*. No code is written here. Output is consumed by an execute step or dispatched to subagents.

## Steps

1. **Anchor the goal in one line.** Write the single outcome this plan delivers and its Definition of Done (DoD) — observable, testable conditions, not "it works". Example: "`POST /import` accepts a CSV, writes rows to `imports` table, returns 202 + job id; integration test green; existing endpoints unchanged." Everything below must serve this line.

2. **Map the real current state.** Grep/read the modules the design touches. List the exact files and the functions/types/configs each change will land in. If you can't name the file a step edits, you don't understand it yet — read more before continuing. Note existing tests covering this area (they're your regression net).

3. **Decompose into checkpointed steps.** Break the work into the smallest units that each end at a *verifiable* state. Heuristic: a step that touches >3 files or can't be verified on its own is too big — split it. Each step must leave the build/tests green (or explicitly red-by-design in TDD: test committed first, failing, then made to pass).

4. **Annotate every step** with these four fields — no step ships without all four:
   - **Touches:** exact files/modules (e.g. `src/import/handler.ts`, `db/migrations/004_imports.sql`).
   - **Depends on:** which prior step(s) must land first, and why (schema before handler, types before callers).
   - **Verify:** the *concrete* command or check that proves the step is done — `pytest tests/import_test.py::test_csv_accepted`, `npm run build`, `curl … | jq .status == "queued"`, or a named manual check. "Looks right" is not a verification.
   - **Risk/backout:** only if the step is risky (migration, deletes data, touches auth/payments/shared interface). State the failure mode and how to undo (revert migration, feature-flag off, keep old path until cutover).

5. **Separate sequential from parallel.** Mark which steps share no files and have no dependency — those can run concurrently (good subagent candidates). Mark the critical path: the longest dependency chain that gates DoD. Put risky/irreversible steps as late as safely possible and behind a flag where feasible.

6. **Order for fail-fast.** Front-load the step most likely to invalidate the design (the spike, the unknown API, the perf-critical query). If it's going to break the plan, break it on step 2, not step 9.

7. **Emit the plan as an executable checklist** — a `- [ ]` todo list grouped into phases, each phase ending in its Verify line, plus the overall DoD at the top. Format so an execute step or a subagent can pick up any item and know its files, deps, and done-check without re-reading the design. Then stop — do not start coding.

## Common Errors

- **Planning against imagined code.** The #1 failure. Steps reference files/functions that don't exist or have moved. Fix: step 2 is mandatory — read before you plan.
- **Checkpoints with no real verify.** "Verify: confirm it works" is theater. Every checkpoint needs a runnable command or a specific observable. If a step genuinely can't be verified in isolation, it's mis-sized — merge or split until it can.
- **Hidden dependency = false parallelism.** Two "independent" steps both edit a shared types file / route table / migration sequence and collide when run in parallel. Trace shared files explicitly in step 5 before declaring anything parallel.
- **Migration/refactor with no backout.** Irreversible step buried mid-plan with no undo path. Any data migration, destructive change, or shared-interface break must carry a backout and sit behind a flag or run last.
- **Boil-the-ocean step.** "Implement the feature" as one line. Useless — can't checkpoint, can't verify, can't hand off. Decompose until each step is a verifiable unit.
- **Plan that drifts from DoD.** Steps accrete scope unrelated to the one-line goal. Re-check every step against the DoD; cut anything that doesn't serve it.
- **Writing code here.** This skill plans only. Slipping into implementation skips the review/approval the plan exists to enable.

## Verify

The plan is done when all of these hold:

- DoD is stated up top in observable/testable terms.
- Every step lists Touches + Depends-on + Verify; risky steps also list a backout.
- Every Verify is a runnable command or a specific observable, not "looks right".
- Sequential vs parallel is explicit; the critical path and any irreversible steps are flagged.
- Following the checklist top-to-bottom satisfies the DoD with no gaps and no unstated prerequisites.
- Output is a `- [ ]` checklist ready for an execute step or subagent dispatch — and zero production code was written.
