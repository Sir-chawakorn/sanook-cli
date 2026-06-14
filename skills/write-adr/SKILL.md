---
name: write-adr
description: Sanook captures a significant technical decision as a structured Architecture Decision Record (Michael Nygard format) — context, decision, alternatives considered, consequences — written to docs/adr/ as numbered files with an index.
when_to_use: A decision moment appears ('let's go with X instead of Y', choosing a stack/library/pattern/boundary); user asks to 'record this decision' or 'write an ADR'; locking in an architectural choice.
---

## When to Use

Invoke when a decision is being locked in and would be expensive to reverse or confusing to re-litigate later:

- A choice was made between real options: "let's go with X instead of Y" — a stack, library, framework, datastore, protocol, pattern, or module boundary.
- User explicitly says "record this decision" / "write an ADR" / "ADR this".
- Reversing an earlier decision (the old ADR must be superseded, not silently deleted).

Do NOT use for: reversible implementation details, code style nits, or decisions with no real alternative (those go in code comments or commit messages, not an ADR). One ADR = one decision; if the prompt bundles several, split them.

## Steps

1. **Name the decision and its trigger before writing.** State it as a single sentence: "We will use X for Y, because Z." If you can't, the decision isn't ripe — ask which option won and why the alternatives lost. Capture the trigger (the problem/forcing function that made a decision necessary) — that becomes Context. If no genuine alternative was ever on the table, stop: it's not an ADR.

2. **Locate or create `docs/adr/`.** Check whether the repo already has an ADR directory — common locations: `docs/adr/`, `docs/architecture/decisions/`, `doc/adr/`, `adr/`. Reuse the existing one and its filename convention; do NOT invent a parallel directory. If none exists, create `docs/adr/`.

3. **Assign the next sequential number.** List existing files (`ls docs/adr/`), find the highest `NNNN`, add 1. Zero-pad to 4 digits. Filename: `NNNN-kebab-case-title.md` (e.g. `0007-use-postgres-for-event-store.md`). Never reuse or renumber an existing ADR number — numbers are permanent IDs other ADRs link to.

4. **Write the record in Nygard format**, exactly these sections in order:
   ```markdown
   # NNNN. <Short imperative title>

   - Status: <Proposed | Accepted | Deprecated | Superseded by ADR-MMMM>
   - Date: <YYYY-MM-DD>

   ## Context
   <The forces at play: the problem, constraints, requirements, and assumptions
   that make a decision necessary. Factual and neutral — no solution yet.>

   ## Decision
   <"We will ..." — the choice, stated actively and unambiguously. One decision.>

   ## Alternatives Considered
   - **<Option A>** — <what it is> — rejected because <concrete reason>.
   - **<Option B>** — <what it is> — rejected because <concrete reason>.
   <Each real alternative + the specific tradeoff that lost it. "Do nothing" can
   be a valid alternative. If you list only the winner, you haven't justified it.>

   ## Consequences
   **Positive:** <what gets easier/safer/faster>
   **Negative:** <what gets harder, what we now must maintain, what risk we accept>
   **Neutral / follow-ups:** <new work this creates, things to revisit later>
   ```
   Status starts `Proposed` unless the decision is already final-and-shipped (then `Accepted`). Context describes *why a decision is needed*, not the decision. Consequences MUST include negatives — an ADR with only upsides is propaganda, not a record.

5. **Maintain the index.** Keep `docs/adr/README.md` (or `index.md`) as a table: `# | Title | Status | Date`, one row per ADR, linking to each file. Append the new row; update the Status cell of any ADR whose status changed. Create the index if it's missing.

6. **On a reversal, supersede — never edit history.** To overturn ADR-N: write a *new* ADR-M for the new decision, and in its Context reference ADR-N. Then change ADR-N's status line to `Superseded by ADR-M` (with a link) — do not rewrite ADR-N's body or delete it. Link both ways: new ADR points back to the one it replaces. Accepted ADRs are immutable except for the Status field.

## Common Errors

- **Editing an accepted ADR's body to "update" a decision.** Accepted ADRs are an append-only log. A change of mind is a new, superseding ADR — never a rewrite of the old one. Only the Status line of an existing ADR may change.
- **Reusing/skipping a number.** Numbers are permanent references. Deleting ADR-0004 and giving 0004 to a new decision corrupts every link that pointed at the old one. Always take `max + 1`.
- **No real alternatives section.** Listing only the chosen option (or alternatives with no stated reason for rejection) makes the ADR worthless — the whole value is *why the other paths lost*. Each alternative needs a concrete rejection reason.
- **Context that already contains the decision.** Context = forces and constraints only. If "we will use X" appears in Context, you've collapsed the record. Keep the problem and the solution in separate sections.
- **All-positive Consequences.** Every real decision has a cost (new dependency to maintain, lock-in, migration work). Omitting negatives hides the tradeoff future readers most need.
- **Multiple decisions in one ADR.** "Use Postgres AND adopt hexagonal architecture" is two ADRs. Bundled records can't be individually superseded later. Split them.
- **Forgetting the index / dangling supersede link.** A new ADR not added to the index, or an old ADR left as `Accepted` after being replaced, makes the log lie about current state. Update both sides.
- **Leaking private context** — personal/author names, machine paths, internal tickets, secrets in Context or Decision. Keep it about the system, with generic placeholders.

## Verify

- [ ] Decision stated as one clear "We will ..." sentence; exactly one decision in the record.
- [ ] File is `docs/adr/NNNN-kebab-title.md` with `NNNN = highest existing + 1`, zero-padded; no number reused.
- [ ] All five sections present and correctly scoped: Status, Context (forces only, no solution), Decision, Alternatives Considered (each with a why-rejected reason), Consequences (includes negatives).
- [ ] Status is a valid value (`Proposed`/`Accepted`/`Deprecated`/`Superseded by ADR-MMMM`) and matches reality.
- [ ] Index (`README.md`/`index.md`) has a row for this ADR linking to it; statuses there match the files.
- [ ] If this reverses a prior decision: old ADR's Status changed to `Superseded by ADR-N` (body untouched), and the new ADR links back to it — both directions.
- [ ] No personal identifiers, absolute home paths, internal URLs, or secrets anywhere in the record.
