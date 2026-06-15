---
name: property-based-testing
description: Finds bugs example tests miss by asserting properties over thousands of generated inputs instead of hand-picked cases — pick the invariant (round-trip encode/decode, idempotence f(f(x))==f(x), oracle/reference equivalence, metamorphic relations, commutativity/associativity, conservation/no-loss), build generators that hit edge cases (empty, huge, Unicode, NaN, negative-zero), and let the framework auto-shrink a failure to a minimal counterexample with a reproducible seed. Covers Hypothesis (Python), fast-check (JS/TS), QuickCheck/Hedgehog (Haskell), proptest/quickcheck (Rust), jqwik (Java), and stateful/model-based testing that drives a system through random command sequences checking it against a model. Distinct from example tests: you specify what's always true, not what one input returns.
when_to_use: You have a function/codec/parser/data structure with a property that holds for ALL inputs (round-trips, idempotent ops, an invariant, or a slow-but-correct reference to check against), example tests feel like they're missing edge cases, or you want a stateful model test that hammers an API/state machine with random command sequences. Distinct from write-tests (curates specific example-based cases for known behavior; this generates inputs + shrinks counterexamples for universal properties) and fuzz-dynamic-security-test (throws malformed bytes to find crashes/memory-safety/DoS, no correctness oracle; PBT checks a stated invariant holds).
---

## When to Use

Reach for this skill when correctness can be stated as a rule true for **every** input, not just the cases you thought of:

- "Test this encoder/decoder / serializer / parser — `decode(encode(x)) == x` for any `x`"
- "This operation should be idempotent / commutative / order-independent — prove it over random inputs"
- "I have a slow-but-obviously-correct reference (or the old impl); check the fast/new one matches it"
- "Example tests pass but prod keeps hitting edge cases (empty, Unicode, huge, negative-zero, DST)"
- "Hammer this stateful API / cache / state machine with random valid command sequences and check invariants"
- "A property test failed — minimize it to the smallest reproducing input and pin the seed"

NOT this skill:
- Curating specific input→output example cases for known/spec'd behavior, organizing the suite, fixtures/mocks → write-tests (it structures example-based tests; this one *generates* inputs and *shrinks* counterexamples for universal properties)
- Throwing malformed/adversarial bytes to find crashes, OOM, panics, memory-safety, ReDoS, parser DoS — with no correctness oracle → fuzz-dynamic-security-test (security crash-finding; PBT asserts a stated invariant, not "didn't crash")
- A test that fails non-deterministically and you need to stabilize/quarantine it → debug-flaky-tests (note: PBT failures look flaky but are *real* bugs found by a different seed — capture the seed, don't retry-til-green)
- Building reusable typed input builders/fixtures for example tests → test-data-factories (a factory can *seed* a PBT generator, but generators add ranges + shrinking)
- Validating a real dataset for nulls/outliers/dupes → validate-data-quality; precision/rounding invariants of money → money-decimal-arithmetic (this skill is *how* you'd test those invariants)
- API request/response contract conformance across services → contract-testing

## Steps

1. **First find the property — this is the hard part, not the framework.** A property is a predicate true for all valid inputs. The reusable archetypes (memorize these; most code fits one):

   | Property | Shape | Good for |
   |---|---|---|
   | **Round-trip / inverse** | `decode(encode(x)) == x`, `parse(render(x)) == x`, `decompress(compress(x)) == x` | codecs, serializers, parsers, ORMs, URL/path builders |
   | **Idempotence** | `f(f(x)) == f(x)` | normalize, dedupe, sort, sanitize, `PUT`, migrations, formatters |
   | **Oracle / reference** | `fast(x) == slow_obviously_correct(x)`, or `new(x) == old(x)` | optimizations, rewrites, replacing a lib, regression vs prod |
   | **Metamorphic** | relate two runs without knowing the answer: `sin(x)==sin(π−x)`, `len(sort(xs))==len(xs)`, `f(x)+f(y)==f(x∪y)`, search results superset of stricter query | ML, numeric, search/ranking, anything with no easy oracle |
   | **Invariant / postcondition** | output always satisfies P: sorted is ordered, balanced tree stays balanced, total preserved, no PII leaks | data structures, allocators, accounting |
   | **Algebraic laws** | commutativity `a∘b==b∘a`, associativity, identity, distributivity | merges, set ops, CRDTs, query builders |
   | **Conservation / no-loss** | nothing created or destroyed: `sum(split(x))==x`, `count in == count out`, partition reassembles | sharding, money allocation, ETL, pagination |

   If you can't state a property, you're not ready for PBT — fall back to write-tests. The classic trap: re-implementing the function inside the test (tautology). Prefer round-trip/metamorphic/oracle, which don't need a second copy of the logic.

2. **Pick the framework and learn its three primitives — generator, runner, shrinker.**

   | Lang | Library | Generate | Decorator/runner | Reproduce a failure |
   |---|---|---|---|---|
   | Python | **Hypothesis** | `@given(st.integers())`, `st.text()`, `st.lists(...)` | `@given(...)` on a test fn | prints `@reproduce_failure` / `@example`; `--hypothesis-seed=` |
   | JS/TS | **fast-check** | `fc.integer()`, `fc.string()`, `fc.record({...})` | `fc.assert(fc.property(gen, pred))` | prints `seed` + `path`; `{ seed, path }` in `fc.assert` |
   | Rust | **proptest** / quickcheck | `proptest!{ \|(x in 0..100u32)\| {...} }`, `any::<T>()` | `proptest! { ... }` macro | failures persisted to `proptest-regressions/*.txt` (commit it) |
   | Haskell | **QuickCheck** / Hedgehog | `Arbitrary`, `Gen`; Hedgehog integrated shrinking | `prop> forAll gen $ \x -> ...` | `--quickcheck-replay=`, Hedgehog prints seed |
   | Java/Kotlin | **jqwik** | `@ForAll`, `@Provide` Arbitraries | `@Property` method | `@Property(seed = "...")` |
   | Go | testing/quick (basic) or **rapid** | `rapid.Int()`, `rapid.Custom` | `rapid.Check(t, func(t){...})` | rapid prints `-rapid.seed=`/`-rapid.failfile=` |

   Defaults to bump: run **≥1000 cases** in CI for cheap properties (Hypothesis defaults 100, fast-check 100, proptest 256). Set `max_examples`/`numRuns`/`PROPTEST_CASES` higher for critical codecs; lower (and a deadline) for slow ones.

3. **Write generators that actually reach the bug — composition + shaping, not just `random int`.** Build complex inputs from primitives, then constrain:
   - **Compose:** `st.lists(st.builds(User, name=st.text(), age=st.integers(0, 130)))` (Hypothesis) / `fc.array(fc.record({ name: fc.string(), age: fc.nat(130) }))` (fast-check). Generate the *whole* domain object, not field-by-field manual loops.
   - **Constrain with `map`/`filter`/`assume`, but prefer construction.** `filter`/`assume` that rejects >~50% of inputs starves the run (Hypothesis raises `FailedHealthCheck`). Instead `map` into the valid space: to get even numbers use `integers().map(lambda n: n*2)`, not `filter(is_even)`. For "sorted pair", generate two and sort — don't reject unsorted.
   - **Force the edge cases generators under-sample.** Add `@example(...)` (Hypothesis) / explicit `fc.constantFrom` mixes for: empty string/list/dict, single element, the boundary value, `0`, `-0.0`, `NaN`/`Infinity`, max int, surrogate-pair & combining-char Unicode, duplicate keys. Hypothesis already biases toward these; fast-check less so — seed them.
   - **Stateful/model generators** generate *command sequences*, not single inputs (step 6).

4. **Trust automatic shrinking — it's the feature that makes PBT worth it; don't shrink by hand.** When a property fails, the framework re-runs with progressively simpler inputs (smaller numbers toward 0, shorter lists, shorter strings) until it finds a **minimal counterexample** — the smallest input that still fails. A raw failure of `[8348, -2, 991, 0, 17]` shrinks to `[0, 0]` or `[1]`, which points straight at the bug. Pitfalls that break shrinking:
   - **`assume()`/`filter` mid-test** that discards the shrunk candidate → shrinker stalls. Constrain via the generator (step 3) so every generated value is valid.
   - **Hand-rolled generators without a shrinker** (custom `fc.constantFrom` of opaque blobs, or returning a closure) shrink poorly. Use built-in combinators that carry shrink logic; in Hedgehog/Hypothesis shrinking is integrated so composed generators shrink for free.
   - **Mutable shared state / non-determinism in the property** → the shrunk case "doesn't reproduce." Make the property a pure function of its inputs; reset state each run.

5. **Pin the seed and persist regressions — a PBT failure is a real bug, capture it, never "rerun until green."** Each framework prints a seed/replay token on failure:
   - **Hypothesis:** maintains a `.hypothesis/examples` DB that auto-replays the last failing case; copy the printed `@reproduce_failure(...)` or add `@example(...)` to lock it permanently. Set `derandomize=True` or `--hypothesis-seed=0` for fully deterministic CI.
   - **fast-check:** copy the reported `seed` and `path` into `fc.assert(prop, { seed, path })` to replay exactly; commit it as a regression test.
   - **proptest:** auto-writes the failing input to `proptest-regressions/<test>.txt` — **commit that file**; it's replayed first on every future run.
   - **jqwik:** add `@Property(seed = "…")`; rapid: `-rapid.seed=`. Treat a flake-looking PBT failure as a found bug (a different seed exercised a real path), not noise → fix it, don't quarantine (that's debug-flaky-tests territory only if the *property itself* is non-deterministic).

6. **Stateful / model-based testing — drive the system through random command sequences and check it against a simple model.** For stateful systems (caches, queues, key-value stores, allocators, an API, a shopping cart, a state machine), single-input properties miss interaction bugs. The pattern:
   - Define a **model**: a trivial in-memory reference (a `dict` for a KV store, a `list` for a queue) that's obviously correct.
   - Define **commands** with preconditions (when valid), the real action (mutate the SUT), and a postcondition (assert SUT result matches model).
   - The framework generates a random *valid sequence* of commands, runs both, and asserts they agree at every step; on failure it **shrinks the sequence** to the shortest failing trace (e.g. `put(a,1); delete(a); get(a)`).
   - Tools: **Hypothesis** `RuleBasedStateMachine` (`@rule`, `@precondition`, `@invariant`); **fast-check** `fc.commands([...])` + `fc.modelRun`; **proptest-state-machine**; QuickCheck `quickcheck-state-machine`. This finds ordering/concurrency/leak bugs example tests never reach.

7. **Wire into CI with bounded time and a fixed seed — and keep the corpus.** Make runs deterministic and budgeted:
   - Set a **per-property deadline/timeout** (Hypothesis `deadline=`, fast-check `interruptAfterTimeLimit`) so one slow generator can't hang CI.
   - Fix the CI seed for reproducibility but **also run a nightly job with a random/rotating seed and more examples** (`max_examples=10000`) to keep discovering — a single fixed seed eventually stops finding anything.
   - Commit the regression corpus (`proptest-regressions/`, `.hypothesis/` cache as appropriate, pinned `@example`/`seed` cases) so every found bug stays found.

8. **When PBT beats example tests (and when it doesn't).** Reach for PBT when: the input space is large/structured (parsers, codecs, numeric, collections), you have an oracle or invariant, or bugs cluster at edges you keep missing. **Skip it** when: there's no expressible property (just "this specific input returns this specific value" — that's write-tests); the function calls non-deterministic externals you can't model; or a 3-line pure function where one example *is* the spec. Best practice: a **thin layer of example tests** (documentation + spec'd corner cases) **plus** properties (the invariants) — they're complementary, not either/or.

## Common Errors

- **No real property — testing a tautology.** Re-implementing the function inside the test (`assert add(a,b) == a+b`) proves nothing. Fix: use round-trip/metamorphic/oracle/invariant shapes that don't restate the logic.
- **`filter`/`assume` that rejects most inputs.** Starves the generator, triggers `FailedHealthCheck`, and breaks shrinking. Fix: `map`/construct into the valid space instead of filtering out of the invalid one.
- **Forgetting the edge cases generators under-sample.** Empty, single-element, `0`, `-0.0`, `NaN`, max int, surrogate-pair/combining Unicode, duplicate keys. Fix: add explicit `@example`/`constantFrom` for them.
- **Treating a failure as flaky and rerunning until green.** A different seed found a *real* bug. Fix: capture the seed/minimal case, add it as a regression, fix the code.
- **Not committing the regression corpus.** `proptest-regressions/*.txt` / pinned `@example` get dropped → the same bug returns. Fix: commit them; they replay first.
- **Non-deterministic or stateful property body.** Shared mutable state / clocks / RNG make the shrunk case not reproduce. Fix: pure property, reset state per run, inject the clock/seed.
- **Too few runs.** 100 default cases barely scratch a large space. Fix: ≥1000 in CI for cheap props; nightly 10k with rotating seed.
- **Hand-rolled generators that don't shrink.** Opaque blobs/closures give you a 4000-element counterexample. Fix: build from library combinators that carry shrink logic.
- **No deadline on slow properties.** One expensive generator hangs CI. Fix: per-property timeout/deadline.
- **Using PBT where there's no invariant.** Forcing a property onto "input X → output Y" is awkward and weak. Fix: write-tests for spec'd examples; PBT for universal rules — layer both.

## Verify

1. **The property is non-tautological:** it's a round-trip/metamorphic/oracle/invariant — not a second copy of the implementation. Mutate the code under test (flip a sign, drop an element) and confirm the property *fails*; a property that never fails on injected bugs is testing nothing.
2. **Edge cases are reached:** the run includes (or has `@example` for) empty, single, boundary, `0`/`-0.0`/`NaN`, max, and tricky-Unicode inputs; coverage/`Hypothesis statistics` shows them exercised.
3. **Failures shrink to minimal:** introduce a real bug → the reported counterexample is *small and pointed* (e.g. `[0,0]`, `""`, `1`), not a giant random blob. If it doesn't shrink, fix the generator/`assume` (step 4).
4. **Reproducible:** re-running with the printed seed/`@reproduce_failure`/`seed+path`/regression file reproduces the *same* failure deterministically; the regression artifact is committed.
5. **Run count + budget:** CI runs ≥1000 cases per cheap property within a per-property deadline; a nightly/extended job runs more with a rotating seed.
6. **Stateful (if applicable):** the model-based test drives random command sequences, checks SUT==model at each step, and shrinks a failure to the shortest failing command trace.
7. **Layered:** example tests cover the documented/spec corners; properties cover the universal invariants — both present, neither doing the other's job.

Done = each function/codec/state machine has at least one non-tautological property (round-trip, idempotence, oracle, metamorphic, invariant, algebraic, or conservation), generators construct valid inputs (not filter) and hit known edges, failures auto-shrink to a minimal reproducible counterexample with a committed seed/regression, stateful systems are checked against a model via random command sequences, and runs are deterministic-but-budgeted in CI with an extended nightly sweep — proven by the bug-injection and shrink checks in 1–3.
