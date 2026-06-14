---
name: code-comments
description: Adds high-signal code comments and docstrings that explain WHY (intent, invariants, gotchas) rather than restating WHAT, in the language's idiomatic doc format (JSDoc/TSDoc, Google/NumPy Python docstrings, rustdoc, godoc) — without over-commenting.
when_to_use: User asks to comment/document a function, add docstrings, explain a tricky block, or prep code for handoff/review; legacy code with no comments. Not for prose docs (that's write-docs).
---

## When to Use

- User says "comment this", "add docstrings", "document this function/module/class", or "explain this tricky block".
- Prepping code for handoff or review where intent isn't obvious.
- Legacy code with zero comments where you must infer and record WHY.
- NOT for prose docs (README/guides/API pages) — that's `write-docs`.
- NOT a refactor — if logic looks wrong, flag it separately; this skill changes comments only.

## Steps

1. **Read the full unit first.** Read the whole function/module before writing a single comment. Trace data flow, error paths, and callers (grep for usages) so you comment real intent, not a guess. If intent is genuinely unrecoverable, write `// FIXME: intent unclear — <specific question>` instead of inventing a rationale.

2. **Mark only the non-obvious.** Tag lines/blocks where WHY ≠ WHAT: magic numbers, off-by-one guards, ret/ timeout / backoff constants, workarounds for upstream bugs, ordering that looks swappable but isn't, perf hacks, locking/concurrency assumptions, security checks. Skip anything a competent reader infers from the code itself.

3. **Write the docstring in the language's idiomatic format.** Use the existing convention in the file/repo if one is present (match it). Otherwise default to:
   - **TS/JS** → TSDoc/JSDoc: one-line summary, then `@param`, `@returns`, `@throws`. Omit `@param` types in TS (the type is in the signature) — describe meaning/constraints/units instead.
   - **Python** → match repo (Google or NumPy). Sections: summary, `Args:`/`Parameters`, `Returns:`, `Raises:`. Add `Examples:` (doctest-style) only for non-trivial contracts.
   - **Rust** → rustdoc `///`: summary, `# Arguments` (when non-obvious), `# Errors`, `# Panics`, `# Safety` for `unsafe`. `# Examples` should be compilable.
   - **Go** → godoc: comment starts with the identifier name (`// Foo does ...`), full sentences, period-terminated.

4. **Put the signal in the docstring, not the body.** Document: units (ms vs s, bytes vs KB), valid ranges, nullability, ownership/lifetime, side effects, thread-safety, idempotency, and what each error/exception actually means for the caller. These are the things callers can't see from the signature.

5. **Inline comments only for surprising WHY.** One line, above the code (not trailing, unless very short). Good: `// Retry 3x — upstream returns 503 on cold start`. Bad: `// loop over items`. Prefer `# TODO(context)` / `# HACK:` / `# SAFETY:` tags so they're greppable.

6. **Delete redundant and stale comments you encounter.** While editing, remove comments that restate code, are commented-out dead code, or contradict current behavior (stale comments are worse than none). Don't expand scope hunting the whole repo — just clean what's in your editing path.

7. **Keep the diff comment-only.** Zero logic, formatting, or whitespace changes beyond the comments themselves. The diff must be reviewable as "comments added/removed" and nothing else.

## Common Errors

- **Restating WHAT.** `i++ // increment i`, `return user // return the user`. If the comment is the code in English, delete it.
- **Inventing rationale.** Writing a confident "why" you didn't verify. If you can't confirm intent from code + callers, say so (`FIXME: intent unclear`) — a wrong comment is a future bug.
- **Over-commenting.** Docstring on every trivial getter/setter, comment on every line. Noise drowns the 3 comments that matter. Comment the surprising, skip the obvious.
- **Wrong format / mixing conventions.** JSDoc in a Python file, NumPy sections in a Google-style repo, `/** */` in Go. Match the file's existing style; if none, use the language default above.
- **Duplicating types in TS JSDoc.** `@param {string} name` when the signature already says `name: string` — drift risk when the type changes. Describe meaning, not type.
- **Touching logic.** "Improving" a line while commenting it. Any behavior change voids the comment-only contract — stop and split it out.
- **Stale-comment blindness.** Adding new docstrings while leaving an old comment that now lies. Reconcile or delete the old one.
- **Commenting the wrong layer.** Explaining a workaround in the body when the caller needs it — put caller-facing contracts (raises, side effects, units) in the docstring where callers actually read them.

## Verify

1. **Diff is comment-only** — `git diff` shows only added/removed comment lines and docstrings; no logic, no reordering, no reformatting. If logic changed, revert it.
2. **Still compiles / lints** — run the build or doc-comment linter (e.g. `tsc --noEmit`, `ruff`/`pydocstyle`, `cargo doc`, `go vet`). Malformed docstrings (bad `@param`, broken rustdoc `# Examples`) must pass.
3. **Doctests pass** if you added any runnable examples (`pytest --doctest-modules`, `cargo test --doc`).
4. **WHY-not-WHAT scan** — reread each added comment: does it tell the reader something the code doesn't already say? Delete any that fail.
5. **No invented facts** — every "because/to avoid/upstream bug" is traceable to the code or an explicit `FIXME`, not a guess.
