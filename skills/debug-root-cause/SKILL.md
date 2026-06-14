---
name: debug-root-cause
description: Diagnoses a failing test, crash, exception, or wrong output by reproducing the failure, isolating the cause, and fixing at the root — never by suppressing the error or weakening assertions.
when_to_use: test/build fail, exception/crash, output ผิด, behavior ไม่ตรงคาด — มี failure ที่เกิดขึ้นแล้วและต้องหาว่าทำไม ก่อนจะแก้
---

## When to Use

Invoke when a failure **already exists** and you need to find *why*:

- A test or build fails (red CI, failing assertion, compile error).
- An exception / crash / stack trace appears at runtime.
- Output is wrong, behavior doesn't match the spec, or a regression appeared.

Do NOT use for: greenfield feature work, "make it faster", or vague "improve this" — those aren't failures with a reproducible signal.

## Steps

1. **Capture the exact signal first.** Run the failing command yourself and copy the *verbatim* error: full message, stack trace, exit code, failing assertion, expected-vs-actual. Do not paraphrase or work from the user's summary — the real text usually names the file/line/value. If you can't reproduce it, you cannot fix it: stop and gather repro steps.

2. **Write a minimal failing test that reproduces it.** Before touching any production code, encode the bug as a test (or a tiny script) that FAILS for the right reason. Run it, confirm it goes red, confirm the failure message matches step 1. This is your oracle — without it, "fixed" is a guess. For a crash with no test harness, write the smallest standalone repro that triggers it.

3. **Isolate by narrowing, not guessing.**
   - Shrink the input: delete half the data/config/steps; if it still fails, the removed half was irrelevant. Binary-search down to the smallest trigger.
   - Bisect history: if it worked before, `git bisect` (or diff against last-good commit) to find the introducing change.
   - Narrow the code path: comment out / short-circuit branches until the failure flips, then you've bracketed the cause.

4. **Trace the actual values.** At the suspected boundary, log or breakpoint the real runtime values (types, nulls, lengths, timestamps, the thing right before it breaks). Compare what you *assumed* vs what's *actually there*. The gap is almost always the bug.

5. **Form one hypothesis and state it explicitly.** "X is null because Y returns early when Z" — a single, falsifiable claim that explains the *entire* observed symptom (not just part of it). If your hypothesis only explains some of the evidence, it's wrong; keep tracing.

6. **Fix at the root and verify.** Change the cause, not the symptom. Re-run the step-2 test → it must now PASS. Re-run the full suite → no new failures. Keep the reproduction test in the codebase as a regression guard.

7. **Show evidence.** Paste the command(s) you ran and their output: red before, green after. "Fixed it" without the before/after output is not a finished fix.

## Common Errors / Gotchas

- **Patching the symptom.** Wrapping the call in `try/catch` that swallows the error, adding `?.`/`if (x) return` to dodge a null, or `// eslint-disable` does NOT fix anything — it hides the next failure and creates a silent prod bug. Find why `x` was null in the first place.
- **Weakening the test to go green.** Loosening an assertion, deleting a case, adding `.skip`, bumping a tolerance, or asserting the *buggy* output as "expected" defeats the entire point. Never edit the test to make a broken fix pass.
- **Fixing without reproducing.** "It's probably the cache" → blind edit → suite still red, now with extra noise. No repro = no fix; you can't confirm a cause you never isolated.
- **Stopping at the first plausible cause.** A hypothesis that explains *part* of the symptom (e.g. one of three failing cases) is incomplete. Account for all the evidence.
- **Usual root causes to check fast:** null/undefined, off-by-one / boundary, async timing & race (await missed, unresolved promise, ordering), shared/mutated state, type coercion (`==`, string vs number, truthy `0`/`""`), stale cache or memoization, env mismatch (versions, locale, timezone, missing env var), encoding, float precision.
- **Heisenbug warning:** if adding a log makes it pass, suspect timing/ordering/concurrency — the log changed scheduling. Don't conclude "can't reproduce", change tactic to deterministic timing.

## Verify

You are done only when ALL hold:

- The minimal repro test exists in the codebase and **fails on the old code, passes on the fixed code** (you ran both).
- The fix targets the cause named in your hypothesis — not a guard/catch/skip around the symptom.
- The full test suite passes with **no new failures** and no assertions were weakened.
- You pasted the before (red) and after (green) command output as evidence.

If you cannot produce a failing-then-passing test, you have not found the root cause — keep going, do not ship.
