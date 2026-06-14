---
name: llm-eval-harness
description: Builds an evaluation harness for LLM/agent outputs using golden datasets, code-based scorers, and LLM-as-judge, run as a regression gate when prompts, models, or RAG configs change.
when_to_use: User wants to measure prompt/model/agent quality, stop regressions when changing a prompt or model, set up llm-as-judge or a golden dataset, or go beyond vibes-based testing. NOT for deterministic unit tests of plain code (use write-tests).
---

## When to Use

Reach for this when output quality is **non-deterministic** and "looks fine" is not good enough:

- Changing a prompt, model version, temperature, tool definitions, or RAG retrieval config and need proof it didn't regress.
- Setting up llm-as-judge, a golden dataset, or any CI gate that scores model/agent output.
- A bug report like "answers got worse after we switched models" — you need a number, not a vibe.

Do **NOT** use for deterministic code (a parser, a pure function, an API contract) — that is a normal unit test; use write-tests. The line: if the same input can produce different-but-valid outputs, it's an eval; if there's one correct output, it's a test.

## Steps

1. **Pick the unit of evaluation first.** Decide what one "case" is: a single prompt→completion, a full agent trajectory (tool calls + final answer), or a RAG turn (query + retrieved context + answer). Everything below is keyed to this unit. Don't mix units in one suite.

2. **Build a lean golden dataset (start at 20–50 cases, not 1000).** Pull real cases from production logs/traces, not invented ones — sample across the actual input distribution. Each case is a row with: `id`, `input` (+ any `variables` like retrieved_context), `expected` (or `reference`), and `tags` (e.g. `edge`, `regression`, `pii`). Deliberately seed known edge cases and every past failure. Store as JSONL or CSV under `evals/data/` so diffs are reviewable in git.

3. **Layer metrics cheapest-first; only escalate to a judge when needed.**
   - **Code scorers (deterministic, free, run first):** exact match, regex/JSON-schema validation, "must contain / must NOT contain" substrings, valid-tool-was-called, refusal-detector, latency/cost budget, output parses as valid JSON. These catch the majority of regressions with zero flakiness.
   - **Semantic match:** embedding cosine similarity vs. reference, with a calibrated threshold — use for "is this roughly the right answer" when wording varies.
   - **LLM-as-judge (last resort, for fuzzy quality):** correctness, faithfulness-to-context, helpfulness, tone. Only build a judge for dimensions code can't check.

4. **Make the judge rigorous, not vibes-in-a-trenchcoat.**
   - Write a **rubric with discrete levels** (e.g. 1–5 or pass/borderline/fail) where each level has a concrete, observable definition. Force the judge to emit `reasoning` BEFORE `score` (CoT lifts agreement).
   - **Pin the judge: fixed model id + `temperature=0`** (or near-0) so the gate is reproducible.
   - **Prefer pairwise or reference-based grading over a lonely 1–10 score** — absolute scores drift; "is A better than reference B?" is far more stable. Mitigate position bias by randomizing A/B order.
   - For faithfulness/RAG, the judge sees the answer + the retrieved context and rules ONLY on "is every claim supported by context" — not on world knowledge.

5. **Calibrate the judge against humans before trusting it.** Hand-label 20–30 cases. Run the judge on the same cases and compute agreement (Cohen's κ or simple % match). If agreement is low, the rubric is ambiguous — tighten level definitions and re-run. Do not ship a judge you haven't calibrated; an uncalibrated judge is a random number generator with a PhD voice.

6. **Wire variable mapping + per-case pass/fail.** Each case template maps dataset columns → prompt variables (e.g. `{{question}}`, `{{context}}`). Define per-case pass = all code scorers pass AND judge score ≥ threshold. Aggregate to a suite-level pass rate and per-tag breakdown.

7. **Run as a deterministic gate in CI and on every prompt/model/config change.** Trigger on changes to prompt files, model id, or RAG config. The runner: load dataset → run candidate system per case → score → compare against the committed **baseline scores file** (`evals/baseline.json`). **Fail the build if pass-rate drops below threshold OR any case in the `regression` tag flips from pass→fail.** Print a per-case delta table (old score → new score) so the regression is obvious in the PR.

8. **Add random-sample probing to surface NEW failures.** The golden set only tests known cases. On a schedule, sample fresh production inputs, run them, and have the judge flag low-quality outputs for human review. This finds failure modes the static dataset can't.

9. **Close the loop: every confirmed failure becomes a golden case.** When probing or production surfaces a bad output, add it to the dataset tagged `regression` with the corrected `expected`. The harness gets stronger over time and the same bug can never silently return.

## Common Errors

- **Judge with `temperature > 0` → non-reproducible gate.** Two runs of the same diff give different verdicts and the gate becomes noise. Pin model + temp=0, and pin the model *version/snapshot* (a silently-updated judge model is itself a regression source).
- **Same model judges its own output → inflated, biased scores.** Use a different (often stronger) model as judge, or at minimum acknowledge the bias. Never let the system grade its own homework on quality dimensions.
- **Absolute 1–10 scoring drifts and clusters at 7–8.** Switch to pairwise (vs. reference) or a discrete rubric with anchored definitions. "Rate 1–10" without anchors is the #1 cause of a useless judge.
- **Position/verbosity bias in pairwise judging.** Judges favor the first option and longer answers. Randomize order per case (and optionally swap-and-average); penalize verbosity explicitly in the rubric if needed.
- **Tiny or synthetic dataset → green evals, red production.** 5 cherry-picked cases prove nothing. Pull from real traffic and cover the actual input distribution, including the boring/edge tails.
- **Reaching for the LLM judge when a code scorer would do.** If the spec is "output must be valid JSON with field X" or "must not leak the system prompt," that's a regex/schema check — deterministic, free, flake-free. Don't pay a judge to check what `assert` can.
- **No committed baseline → "is this better?" is unanswerable.** Without `baseline.json` under version control you can detect a crash but not a regression. Commit baselines and update them deliberately (in a reviewed PR), never silently.
- **Judge marks a faithful RAG answer wrong because it "knows better."** A faithfulness judge must rule only on support-by-retrieved-context, not on its own world knowledge. State this explicitly in the judge prompt or you'll get false fails.
- **Flaky scorers fail the gate for the wrong reason.** Network timeouts / rate limits on judge calls look like quality regressions. Add retries + a clear "harness error" vs. "quality fail" distinction so a 429 doesn't block a ship.

## Verify

- Run the full suite twice on the **same** candidate; the score must be **identical** (proves the gate is deterministic). If it isn't, a scorer/judge has hidden randomness.
- Confirm the gate actually bites: introduce a deliberately bad prompt and check the suite **fails** with a clear per-case delta pointing at the regressed cases.
- Confirm a known-good change passes and the baseline-comparison table renders old→new deltas.
- Spot-check 3–5 judge verdicts by hand against the rubric — the judge's `reasoning` should justify its `score`. If reasoning and score disagree, the rubric/prompt needs tightening.
- Verify CI is wired: the eval job triggers on prompt/model/RAG-config file changes and blocks merge on failure (not just warns).
- Confirm every `regression`-tagged case maps to a real past failure, and that the latest surfaced failure has been added back into the golden set.
