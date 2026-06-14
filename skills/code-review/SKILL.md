---
name: code-review
description: Reviews the current git diff (or a target PR/branch) for correctness bugs, logic errors, edge cases, and missing error handling, grouping findings by severity (Critical/Warning/Suggestion). Use after implementing a non-trivial change and before declaring it done, or when asked to review a PR.
when_to_use: After implementing a non-trivial change and before declaring it done; when asked to review a PR, branch, or diff; when a change touches correctness across multiple files. Skip for one-line edits whose effect is obvious (typo, rename, log string).
---

## When to Use

- Right after finishing a non-trivial implementation, **before** reporting it as done.
- When explicitly asked to review a PR, branch, or working-tree diff.
- When a change touches logic, control flow, data handling, or error paths across one or more files.

Skip it for changes whose full effect fits in one sentence (typo fix, rename, comment, log-string tweak) — reviewing those wastes a pass.

This skill hunts for **correctness defects only**. Style, naming, and refactor opportunities are out of scope; leave those to a cleanup/refactor pass. Never block a change on style.

## Steps

1. **Get the exact diff — never review the whole repo.** Pick the source:
   - Working tree (uncommitted): `git diff` and `git diff --staged`
   - Last commit: `git diff HEAD~1`
   - Branch vs base: `git diff $(git merge-base HEAD <base>)...HEAD` (base is usually the default branch)
   - A PR: `gh pr diff <number>` (or `gh pr diff <number> --patch`)
   If unsure what to review, default to `git diff HEAD` plus staged changes.

2. **Lock scope to changed lines + their blast radius.** Read only the changed hunks and the immediate surrounding function/caller needed to judge correctness. If a changed function is called elsewhere, open just those call sites — do not audit unrelated files.

3. **Run the correctness checklist over each hunk.** For every changed function/branch, ask:
   - **Null / undefined / None:** new value dereferenced without a guard? optional/map-lookup assumed present? empty string/array/`0`/`false` mishandled by a truthiness check?
   - **Off-by-one / bounds:** loop `<` vs `<=`, slice/index ranges, first/last element, empty-collection case.
   - **Async / concurrency:** missing `await`, unhandled rejected promise, shared state mutated without ordering guarantee, race between read and write, fire-and-forget that should block.
   - **Error paths:** failures swallowed or only logged; thrown error left uncaught; partial failure leaves state half-updated; non-happy-path return value ignored.
   - **Boundaries / inputs:** untrusted or empty input, very large input, negative/zero, unicode, timezone/locale, numeric overflow or float precision.
   - **Resource leaks:** file/socket/db handle, lock, timer, subscription, or listener opened but not closed on all exit paths (including the error path).
   - **Logic regressions:** inverted condition, wrong variable, changed default that alters existing behavior, broken invariant a caller depends on.

4. **Triage each finding by severity** and report with `path:line`, a one-line explanation of the failure mode, and a concrete suggested fix:
   - **Critical** — will produce wrong results, crash, data loss, or a security hole on a realistic input. Must be fixed before done.
   - **Warning** — plausible bug in an edge case, or correctness depends on an assumption that isn't enforced. Should be fixed or explicitly justified.
   - **Suggestion** — minor robustness/clarity improvement that affects correctness only weakly. Optional.
   Order findings most-severe-first. If a section is empty, say so (e.g. "Critical: none") rather than omitting it.

5. **Apply fixes (or hand them to the implementer), then re-review the new diff** — focus on whether each fix is correct and whether it introduced a new issue. **Do not declare done while any Critical remains unresolved.**

## Common Errors

- **Reviewing the whole repo instead of the diff.** Floods the report with pre-existing issues you didn't change and weren't asked about. Always diff first; comment only on changed lines and their direct callers.
- **Drowning in false positives.** Reporting "could be null" on a value the surrounding code already guarantees non-null. Read enough context to confirm the path is actually reachable before flagging; if you can't tell, mark it Warning, not Critical, and say what you assumed.
- **Nitpicking style as if it were a bug.** Renames, formatting, "prefer const", import order — out of scope here. Flagging them buries the real findings and trains the reader to ignore the report.
- **Severity inflation.** Marking everything Critical destroys the signal of the Critical tier. Reserve Critical for "wrong on a realistic input," not "theoretically possible if three unlikely things happen."
- **Reviewing intent instead of code.** Judge what the diff *does*, not what the description says it should do; the two diverging is itself a finding.
- **Stopping after the first pass.** A fix can introduce a fresh bug. The change isn't reviewed until the post-fix diff is clean.

## Verify

The review is complete when:
- The diff source is explicit and covers exactly the intended change set (and nothing unrelated).
- Every checklist category in step 3 was considered for each changed hunk (not silently skipped).
- Findings are grouped Critical / Warning / Suggestion, each with `path:line` + failure mode + suggested fix; empty tiers stated explicitly.
- Zero Critical findings remain open — every one is either fixed (and the fix re-reviewed) or has a written justification for why it's not a defect.
- The final reported diff differs from the initial one only by the applied fixes, and re-review of those fixes surfaced no new issues.
