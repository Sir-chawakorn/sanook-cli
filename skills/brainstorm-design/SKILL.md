---
name: brainstorm-design
description: Run a structured design conversation that explores requirements, proposes 2-3 approaches with tradeoffs, and converges on a validated design BEFORE any code is written — used when a feature/idea is fuzzy or under-specified.
when_to_use: User describes a feature/idea/problem that is vague, open-ended, or has multiple viable approaches; before write-plan or implementation; when 'should I build X or Y' framing appears. Skip for one-line trivial changes (typo, rename, log line).
---

## When to Use

Invoke when the request is a **design decision, not a typing task**. Concrete triggers:

- The ask is a goal, not a mechanism: "add caching", "make onboarding smoother", "let users export data" — *how* is undecided.
- "Should I build X or Y?" / "What's the best way to do Z?" framing.
- The change touches ≥2 modules, a public API/schema, or a data model (decisions are expensive to reverse later).
- Success criteria, target users, scale, or constraints are unstated.

**Skip** (go straight to edit/write-plan) when the diff fits in one sentence: typo, rename, log line, version bump, copy tweak, adding a flag to an existing call. Burning a design round on these annoys the user.

This skill **stops at a validated design brief**. It never writes implementation code. Hand the brief to `write-plan` (or implementation) next.

## Steps

1. **Read the surrounding code first, then ask.** Before any questions, grep the repo for the relevant module/feature so questions are informed, not generic. Skip questions the code already answers (existing patterns, current schema, conventions). Asking what you could have read yourself wastes the user's turn.

2. **Ask 3-5 narrowing questions in ONE message** (not drip-fed one at a time). Cover the axes that actually change the design:
   - **Scope / non-goals** — what is explicitly out of scope for v1?
   - **Users & trigger** — who hits this, how often, from where (UI, API, CLI, cron)?
   - **Constraints** — latency budget, data volume, existing stack/deps you must reuse, deadline, backwards-compat?
   - **Success criteria** — how do we know it works? (a measurable bar, not "it's good")
   - **Failure tolerance** — what happens on error/empty/duplicate input — block, retry, or degrade?
   
   Ask only the axes that are genuinely ambiguous. If the user already pinned scope, don't re-ask it.

3. **Propose 2-3 candidate approaches as a tradeoff table.** One row per approach, columns: `Approach | Effort | Risk | Reversibility | Fit`. Approaches must be *materially* different (e.g. "sync in-request" vs "background queue" vs "precompute on write") — not three flavors of the same thing. Each cell is a short concrete phrase, not a paragraph. If you can only think of one real approach, say so and skip the table — don't invent strawmen to pad to three.

4. **Recommend one** with 1-2 sentences of reasoning tied to the user's stated constraints from step 2 (e.g. "Given the 'no new infra' constraint, B avoids a queue dep while still meeting the 200ms budget"). Take a position — this is a design partner, not a menu.

5. **Probe the chosen approach for edge cases and failure modes** before locking it: empty/null input, concurrent writes, partial failure, scale ceiling, security/auth surface, migration of existing data. List the ones that genuinely apply; note how the design handles each or flag it as an open question.

6. **Emit the design brief** and stop. Exactly these sections, kept tight:
   ```
   ## Design Brief: <feature>
   **Problem:** <1-2 sentences — the user-facing need>
   **Chosen approach:** <name + 2-3 sentence mechanism>
   **Why:** <the tradeoff that decided it>
   **Non-goals:** <explicit out-of-scope for this iteration>
   **Edge cases handled:** <bullets>
   **Open questions:** <unresolved decisions needing user input — or "none">
   ```
   Then hand off: "Ready for `write-plan` / implementation." Do not start coding.

## Common Errors

- **Skipping questions and jumping to a table.** If you guess the constraints, the "best" approach is best for the wrong problem. Always run step 2 unless the user already pinned every axis.
- **Drip-feeding questions** one per turn — exhausting and slow. Batch all of them into a single message.
- **Three fake approaches.** Listing minor variants of one idea to fill the table is noise. Two genuinely distinct options beat three near-duplicates.
- **Refusing to recommend** ("it depends, here are options"). The user invoked a design *partner*. Pick one and defend it; they can override.
- **Re-asking what's in the repo or in chat.** Read the code and the existing message first. Asking about conventions the codebase already demonstrates reads as not having looked.
- **Sliding into implementation** — pseudocode, function signatures, file edits. The deliverable is a brief, not a diff. Stop at the brief even when the design feels obvious.
- **Brief with no non-goals or open questions.** "Non-goals" prevents scope creep in the next phase; omitting it is the #1 cause of bloated plans downstream.

## Verify

Before declaring the design done, confirm all of:

- [ ] Read the relevant existing code/schema (not designing blind).
- [ ] User answered the narrowing questions, or explicitly waved them off.
- [ ] ≥2 materially distinct approaches were surfaced (or a clear reason only one is viable).
- [ ] A single approach is recommended with reasoning tied to a stated constraint.
- [ ] Edge cases / failure modes were enumerated and addressed or parked.
- [ ] Brief contains all sections including **Non-goals** and **Open questions**.
- [ ] **No implementation code was written** — output is the brief, handed to the next phase.

If any box is unchecked, the design is not ready to hand off — finish it before moving on.
