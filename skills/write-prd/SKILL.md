---
name: write-prd
description: Produces an opinionated, implementation-ready Product Requirements Document (PRD) via interactive discovery — evidence-first problem statement, measurable goals with counter-metrics, scoped requirements, and explicit prioritization.
when_to_use: User asks to write/draft a PRD, product spec, feature requirements, or 'spec this out'; product-side framing before engineering planning. Use when business intent must be structured before build.
---

## When to Use

- User says "write a PRD", "draft a spec", "spec this out", "feature requirements", or describes a feature/product to be built but hasn't framed it.
- Business intent exists but is not yet structured: vague goal, no success metric, fuzzy scope.
- The handoff target is engineering planning (a PRD precedes a tech design / implementation plan — do NOT put architecture, schemas, or code here).

Do NOT use for: a tech design doc, an RFC about *how* to build, a bug report, or a one-line change. If the user already knows the exact change, skip the PRD and plan the build.

## Steps

1. **Gate on context.** If the user gave a one-liner, do NOT start writing. Ask exactly 3-5 discovery questions, then stop and wait. Cover these five gaps (skip any the user already answered):
   - **Problem + evidence** — what's broken, and what data/observation proves it (not a hunch)?
   - **Target user** — who specifically hits this, and how often?
   - **Success metric** — one number that proves it worked, with current baseline and target.
   - **Constraints** — deadline, platform, team size, regulatory/tech limits.
   - **Scope boundary** — what is explicitly OUT of this version.
   Keep questions concrete and answerable in one line each. Don't ask what you can reasonably infer.

2. **Draft the PRD** in this exact section order. Each section is mandatory; write "None known" rather than deleting a heading.
   1. **Problem** — 2-4 sentences, evidence-backed. Lead with the observation/data, then the cost of inaction. Ban adjectives that aren't measured.
   2. **Goals** — 1-3 bullets, each a measurable outcome (`metric: baseline → target by date`). Every goal MUST be paired with a **counter-metric** (the thing you must NOT break while chasing it, e.g. "increase signup conversion without raising 30-day churn").
   3. **Non-goals** — explicit list of what this version will not do. This is where you kill scope creep on paper.
   4. **Requirements** — numbered, each tagged **P0 / P1 / P2** (P0 = ship-blocker, P1 = strongly wanted, P2 = nice-to-have). Each requirement has its own **acceptance criteria** written as testable Given/When/Then or a binary checklist. No requirement ships without criteria.
   5. **UX notes** — flows, states, edge/empty/error states. Words or ASCII, not pixel design. Note where design is still open.
   6. **Risks & dependencies** — what could sink this, what it relies on (other teams, APIs, data). One mitigation per risk.
   7. **Open questions** — unresolved decisions with an owner or a "needs decision by <date>".

3. **Prioritize honestly.** If everything is P0, nothing is — force-rank so P0 is the minimum shippable set that satisfies the Goals. State the cut line ("P0 = v1 release; P1+ = fast-follow").

4. **Flag every assumption inline** with a bold `**Assumption:**` prefix wherever you filled a gap the user didn't confirm. Do not silently invent a metric, user, or constraint.

5. **Hold the length budget.** Target ~1200 words, hard ceiling ~1500. If you're over, cut prose — never cut a required section or acceptance criteria. Clarity over volume.

6. **Output as a single Markdown document** (the PRD itself), not a conversational summary. End with a short "Assumptions & Open Questions to confirm" recap so the reader knows what's still soft.

## Common Errors

- **Writing the PRD from the one-liner without discovery.** The #1 failure. A PRD built on guesses is worse than no PRD. Always run step 1 first unless the user explicitly says "just draft it, I'll fix details."
- **Goals with no number.** "Improve onboarding" is not a goal. If you can't attach `baseline → target`, it's a vision statement — push back and ask for the metric.
- **Forgetting counter-metrics.** A goal with no guardrail invites the team to game it (e.g. boost conversion by adding dark patterns that spike churn). Every goal needs its "without breaking X" clause.
- **Requirements without acceptance criteria.** Without testable criteria, engineering can't tell "done" from "looks done." Each requirement is incomplete until it has a binary pass/fail check.
- **Leaking solution into the problem.** "We need a Redis cache" is a solution, not a problem. The Problem section describes user/business pain; *how* belongs in the downstream tech design, not here.
- **P0 inflation.** Marking everything P0 defeats prioritization. Force a cut line; if pressed, the P0 set should be the smallest thing that hits the Goals.
- **Silent assumptions.** Inventing the target user or success metric and presenting it as fact. Always tag with `**Assumption:**` so it gets challenged.
- **Bloating past budget with backstory.** Long context-setting prose buries the requirements. Trim narrative, keep the spec.

## Verify

Before declaring the PRD done, confirm every item — fix and re-check any that fail:

- [ ] All 7 sections present and in order (Problem → Goals → Non-goals → Requirements → UX → Risks/deps → Open questions).
- [ ] Problem cites at least one piece of evidence (data/observation), not just opinion.
- [ ] Every Goal is measurable (`baseline → target`) AND has a paired counter-metric.
- [ ] Every Requirement has a P0/P1/P2 tag AND testable acceptance criteria.
- [ ] A clear P0 cut line exists (P0 ≠ "everything").
- [ ] Every gap you filled is marked `**Assumption:**`.
- [ ] Word count within ~1200 (≤1500 hard cap).
- [ ] No architecture/schema/code — those belong to the downstream design doc.
- [ ] Output is a Markdown PRD, ending with the Assumptions & Open Questions recap.
