---
name: write-tests
description: Writes new automated tests for a function, API, parser, or module using a real test runner — TDD-first when the contract is clear (write test, run to FAIL, then implement). Use when adding test coverage or building a feature with a defined contract. Does NOT diagnose existing failures.
when_to_use: เพิ่ม coverage; สร้าง feature ที่มี contract ชัด (function/API/parser/bot) แบบ TDD; ก่อนแก้ regression
---

## When to Use

- Adding test coverage to existing code whose behavior is already stable.
- Building a new feature with a clear contract (function signature, API request/response, parser input→output, bot command). Use TDD: write the test first, watch it fail, then implement.
- Reproducing a regression as a failing test BEFORE fixing the bug.

Do NOT use this to diagnose why existing tests fail — that is a debugging task, not a test-writing one.

## Steps

1. **Pin the contract before writing any code.** State in one line: inputs, expected output, and side effects. List edge cases explicitly — empty input, null/undefined, zero/negative, max boundary, malformed input, error path. If the contract is ambiguous, resolve it from the spec/types/caller, not from the current implementation.

2. **Detect the repo's test runner — never introduce a new one.** Check config/manifest:
   - Node: `package.json` `scripts.test` and devDeps → `jest` / `vitest` / `node:test` / `mocha`.
   - Python: `pytest.ini` / `pyproject.toml` `[tool.pytest]` / `tox.ini` → `pytest`; else `unittest`.
   - Go: `go test ./...`. Rust: `cargo test`.
   Match an existing test file's location, naming (`*.test.ts`, `*.spec.ts`, `test_*.py`, `*_test.go`), and import style.

3. **Write tests covering happy path + every edge case + error path.** One assertion target per test, descriptive names (`returns_empty_array_when_input_is_null`). Assert real values, not just "no throw". For error cases, assert the specific error type/message, not a bare catch.

4. **Mock only true external boundaries** (network, clock, filesystem, DB). Do NOT mock the unit under test or pure logic. If a test mocks so much that it only asserts the mock was called, it tests nothing — delete or rewrite it.

5. **Run the tests and confirm RED.** For TDD, the test MUST fail because the feature is unimplemented — not because of an import error or typo. Read the failure message and verify it fails for the contract reason. A test that passes immediately on unwritten code is broken.

6. **For TDD: commit the failing test BEFORE writing implementation.** This makes the red→green transition visible in history (anti-cheat). Then implement until green.

7. **Implement until all tests pass. Never weaken a test to make it green** — no deleting assertions, loosening matchers, or `skip`/`xit`. If a test is genuinely wrong about the contract, fix the contract understanding explicitly, don't silently soften the assertion. Fix failures at root cause; do not suppress errors or catch-and-ignore.

## Common Errors

- **Over-mocking → vacuous test.** Mocking the function under test means you assert your own mock. Rule: if removing the assertion changes nothing, the test is dead.
- **Test written against implementation, not contract.** Asserting internal call order or private state couples the test to refactors. Assert observable behavior (return value, emitted event, persisted row) instead.
- **Test never actually ran red.** Skipping step 5 hides tests that pass for the wrong reason (e.g. function returns `undefined`, assertion is `toBeFalsy`). Always see it fail first.
- **Non-deterministic test.** Real time (`Date.now()`), random, unordered map iteration, or network make tests flaky. Inject a fixed clock/seed; sort before comparing; stub the network.
- **Wrong runner / orphan test file.** Putting a Vitest file in a Jest repo (or vice versa) — it won't be picked up by the test command and silently never runs. Confirm the file is collected by the existing `test` command.
- **Async not awaited.** Missing `await`/`return` on a promise assertion → test passes before the assertion runs. Await every async assertion.

## Verify

- Run the repo's actual test command (`npm test` / `pytest` / `go test ./...`) — the new tests appear in the run count and pass.
- Temporarily break the implementation (flip a return, comment a line) → the new test goes RED. Revert. This proves the test actually exercises the code.
- For TDD: `git log`/`diff` shows the failing-test commit landed before the implementation commit.
- Coverage report (if available) shows the new branches/lines are hit — confirm edge and error paths execute, not just the happy path.
- Tests are deterministic: run them twice (or with `--runInBand` / no parallelism toggle) and get identical results.
