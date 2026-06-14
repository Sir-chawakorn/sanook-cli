---
name: write-rfc
description: Sanook drafts an engineering RFC / design doc / technical proposal for a non-trivial change — motivation, proposed design, alternatives, tradeoffs, rollout/migration, risks, and open questions — structured for team review and sign-off.
when_to_use: User asks to write an RFC, design doc, tech proposal, or 'design document' for a system/feature/migration that needs review before building; larger than an ADR (which records one decision).
---

## When to Use

Use for a non-trivial change that needs **review before building**: a new service, a cross-cutting refactor, a data migration, an API redesign, a build-vs-buy decision. Reach for this when the change touches multiple teams/systems, is expensive to reverse, or has > 1 viable approach worth comparing.

Do NOT use when:
- The decision is already made and you just need to record *what* and *why* → write an **ADR** (single decision, ~1 page), not an RFC.
- The change is a one-liner you can describe in a PR description → just open the PR.
- It's a pure incident/postmortem → use a postmortem template.

An RFC is bigger than an ADR: it explores the *solution space* and asks reviewers to choose. An ADR records *one locked decision*. If an RFC locks a sub-decision, spawn an ADR for it and link.

## Steps

1. **Locate the repo's RFC convention first.** Look for an existing `docs/rfc/`, `rfcs/`, or `docs/adr/` dir and copy the latest file's structure, numbering, and frontmatter. Match the team's house style over this template. New file: `docs/rfc/NNNN-kebab-title.md` where `NNNN` = (highest existing number + 1), zero-padded. If no convention exists, create `docs/rfc/0001-<title>.md`.

2. **Write the metadata header** (status drives review): `RFC #`, `Title`, `Author(s)`, `Status: Draft` (lifecycle: Draft → In Review → Accepted / Rejected / Superseded), `Created` date, `Reviewers` (named, not "the team"), `Related: ` links to prior RFCs/ADRs/issues.

3. **Lead with a TL;DR / Summary** (3-5 sentences max): what you're proposing, the *one* recommended option, and **why now** (the forcing function — what breaks or gets blocked if we don't). A reviewer who reads only this paragraph should know what they're approving.

4. **Motivation** — state the concrete problem with evidence (a metric, an incident, a scaling limit, a recurring support load), not "it would be nice." Then **Goals** and **Non-Goals** as two explicit bullet lists. Non-Goals is the highest-leverage section for killing scope-creep arguments in review — name what's deliberately out.

5. **Proposed Design** — the recommended option, in enough detail to estimate and critique:
   - Architecture / data flow. Add a `mermaid` diagram when components or sequence matter:
     ```mermaid
     flowchart LR
       Client --> API --> Queue --> Worker --> DB
     ```
   - API / schema / interface changes — show the actual signatures, table DDL, or message shapes.
   - Key behaviors, failure modes, and concurrency/consistency assumptions.

6. **Alternatives Considered** — at least 2 real options (one is usually "do nothing / status quo"). For each: a one-line description + **why not** chosen. Reviewers trust a recommendation more when they see the rejected paths. This is the section that separates an RFC from a spec.

7. **Tradeoffs** — a comparison table across the live options on the axes that matter here (e.g. complexity, cost, latency, migration effort, blast radius, lock-in). Pick axes specific to *this* decision; don't ship a generic grid.

8. **Migration / Rollout** — ordered, runnable steps: feature flag → backfill → dual-write/shadow → cutover → cleanup. State the **backout plan** (how to revert at each phase) and whether each step is reversible. Note data backfill and any irreversible point-of-no-return explicitly.

9. **Risks & Mitigations** — table of `Risk | Likelihood | Impact | Mitigation`. Include the failure that keeps you up at night, not just easy ones.

10. **Security & Performance Impact** — new attack surface, authz/data-exposure changes, PII handling, new dependencies; expected latency/throughput/cost delta and how you'll measure it. If the change touches auth, input handling, or secrets, say so loudly here so reviewers route it to a security pass.

11. **Open Questions** — honest unknowns you want input on. An RFC with zero open questions usually means you haven't thought hard enough.

12. **Decisions Needed** — end with a numbered list of explicit asks: each item = a question + the options + your recommendation, phrased so a reviewer can reply "approve #1, #3; let's discuss #2." This is what unblocks sign-off; don't bury it.

## Common Errors

- **Describing the solution before the problem.** If Motivation/Goals are weak, reviewers argue about the design forever. Lock the problem statement first.
- **Strawman alternatives.** Listing options you obviously dismiss signals you didn't really explore. Each alternative needs a *plausible* reason someone would pick it, then your honest why-not.
- **No backout plan.** "We'll roll forward" is not a plan. Every migration phase needs a documented revert path; flag irreversible steps in bold.
- **Generic tradeoff table.** A grid of complexity/cost/maintainability that could apply to any RFC adds nothing. Choose axes that actually differ between *these* options.
- **Vague ownership.** "Reviewers: the team" and "Author: TBD" stall sign-off. Name people. "Decisions needed" with no recommendation forces reviewers to do your synthesis.
- **RFC that's actually an ADR.** If there's only one option and the decision is made, you're padding a 1-page ADR into 5 pages. Downgrade it.
- **Mermaid that doesn't render.** Wrong fence (` ```mermaid `), or `flowchart`/`sequenceDiagram` typos break the diagram silently in the doc viewer. Paste-test before shipping.
- **Letting status go stale.** A doc stuck on `Status: Draft` after it shipped misleads future readers. Update to Accepted/Superseded on resolution.

## Verify

Before declaring the RFC ready for review, confirm:

- [ ] A reviewer can read **only the TL;DR** and know what they're approving and why now.
- [ ] **Goals AND Non-Goals** are both present and explicit.
- [ ] **≥ 2 alternatives** each have a concrete *why-not* (status quo counts as one).
- [ ] **Tradeoff table** uses axes specific to this decision, not boilerplate.
- [ ] **Migration section has a backout/revert path**, with irreversible steps flagged.
- [ ] **Security & performance impact** is addressed (even if "none, because…").
- [ ] Doc ends with a **numbered "Decisions Needed"** list, each with a recommendation.
- [ ] Any **mermaid diagram renders** (correct fence + valid syntax).
- [ ] Every locked sub-decision links to (or spawns) an **ADR**; metadata names real **author + reviewers** and `Status`.
- [ ] File lives under the repo's RFC dir with correct sequential numbering and matches the house template if one exists.
