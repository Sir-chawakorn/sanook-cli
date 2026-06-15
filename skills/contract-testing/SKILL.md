---
name: contract-testing
description: Implements consumer-driven contract testing so services deploy independently without a full integration environment — the consumer's unit tests record concrete request/response expectations against a stub (Pact `pact-jvm`/`pact-js`/`pact-python`, or Spring Cloud Contract DSL), the resulting contract (pact file / Spring stub jar) is published to a broker (Pact Broker / PactFlow) tagged by consumer version + branch + environment, the provider replays every expectation against its real app in CI with provider states (`@State` / `Given`) seeding data, and `pact-broker can-i-deploy --pacticipant X --version <git-sha> --to-environment production` gates the pipeline — plus webhook-triggered provider verification on contract change, bi-directional contracts (verify a provider's OpenAPI against consumer pacts without running the provider), pending/WIP pacts so a new consumer expectation never breaks the provider build, and version pinning via the consumer's git SHA with `record-deployment`/`record-release`.
when_to_use: You have ≥2 services that talk over HTTP/messages and want to catch integration breakage in fast unit-speed CI instead of a brittle shared E2E env — adding Pact or Spring Cloud Contract, wiring a Pact broker, gating deploys with can-i-deploy, or deciding consumer-driven vs bi-directional contracts. Distinct from rest-graphql-contract (defines the API spec/schema itself — OpenAPI/GraphQL SDL/JSON Schema; this skill tests that two specific deployed versions actually agree) and schema-evolution-compatibility (the back/forward-compat rules a change must obey; this skill is the CI mechanism that proves a given consumer↔provider pair still satisfies them).
---

## When to Use

Reach for this skill when two or more independently deployed services integrate and you want integration confidence at unit-test speed, not via a fragile end-to-end stack:

- "Provider changed a field and a consumer broke in prod — catch it in CI before merge"
- "Our shared staging/E2E env is flaky and slow; we want to test integration without it"
- "Add Pact / Spring Cloud Contract between our frontend/BFF and the API"
- "Gate the deploy: don't ship the provider until every consumer's contract still passes"
- "We already have an OpenAPI spec — verify the provider matches it AND the consumers (bi-directional)"
- "A new consumer's expectation shouldn't be able to red the provider's build (pending pacts)"
- "Mobile app v3 is still live; how do we know the provider didn't drop a field v3 needs?"

NOT this skill:
- Authoring the API spec/schema (OpenAPI, GraphQL SDL, JSON Schema, field types, pagination shape) → rest-graphql-contract (defines *what* the API is; this skill proves two running versions *agree* on it)
- The back/forward-compatibility *rules* (additive-only, never-remove-required, default-on-new-optional) → schema-evolution-compatibility (the policy; this skill is the per-pair CI enforcement of it)
- gRPC/protobuf service definition and codegen → design-protobuf-grpc-service (you can still Pact-test gRPC via message pacts, but the `.proto` itself lives there)
- General API design / breaking-change review of a diff → api-design-review
- Browser/UI end-to-end flows across the whole app → write-playwright-e2e (this skill *replaces* most cross-service E2E with isolated pair contracts)
- Structuring the unit-test suite itself / assertions / fixtures → write-tests, test-data-factories (this skill specifies the contract interactions; those build the surrounding suite/data)
- Wiring the CI stages / runners / caching → cicd-pipeline-author; the deploy gate's release flow → deploy-release (this skill supplies the can-i-deploy check those stages run)

## Steps

1. **Pick consumer-driven (Pact) when consumers know what they need; bi-directional/spec-driven when the provider already owns an OpenAPI/GraphQL spec.** They are not interchangeable:

   | Approach | How it works | Use when | Limitation |
   |---|---|---|---|
   | **Consumer-driven (Pact)** | consumer's tests *generate* expectations; provider *replays* them against the real app | consumers drive the API; you want to know exactly which fields are used | provider must run verification against real code; needs provider states |
   | **Bi-directional (PactFlow)** | provider's OpenAPI is verified as a "provider contract"; consumer pacts compared statically against it — provider need not run | provider already has a trustworthy spec; can't run full provider verification | only as good as the spec; a spec that lies passes |
   | **Spring Cloud Contract** | contracts in Groovy/YAML DSL live with the *provider*; generate provider tests + a stub jar consumers run against | JVM-heavy estate, provider-owned contracts, message + HTTP | JVM-centric; less natural for polyglot consumers |

   Default to **consumer-driven Pact** for polyglot HTTP/message estates; **Spring Cloud Contract** for an all-JVM shop; add **bi-directional** when a provider can't feasibly run verification but has a real OpenAPI.

2. **Write the consumer test against a Pact mock — assert on the request you send and matchers (not literals) for the response.** The consumer test spins up Pact's local mock server, you exercise your real client code against it, and Pact records the interaction. Use **matchers** so the contract pins *structure/type*, not brittle example values:

   ```js
   // pact-js v3+ (V3/V4 spec)
   const { PactV3, MatchersV3: M } = require('@pact-foundation/pact');
   const provider = new PactV3({ consumer: 'web-bff', provider: 'orders-api' });

   provider
     .given('order 42 exists')                       // provider state — seeds data later
     .uponReceiving('a request for order 42')
     .withRequest({ method: 'GET', path: '/orders/42',
                    headers: { Accept: 'application/json' } })
     .willRespondWith({ status: 200,
       headers: { 'Content-Type': M.regex('application/json.*', 'application/json') },
       body: { id: M.integer(42), total: M.decimal(19.99),
               status: M.regex('PAID|PENDING', 'PAID'),
               items: M.eachLike({ sku: M.string('ABC'), qty: M.integer(1) }) } });

   await provider.executeTest(mock => new OrdersClient(mock.url).getOrder(42));
   ```
   Rules: assert only on **fields the consumer actually reads** (Pact verifies the provider returns *at least* these — extra provider fields are fine; that's how providers stay free to add). Use `integer/decimal/string/regex/eachLike/like`, never hardcoded values, or any data change reds the provider. One `given(...)` per distinct precondition; the string must match a provider state handler exactly.

3. **Run the consumer test in normal unit CI; it emits a pact JSON file as a side effect — there is no provider involved here.** `npm test` / `mvn test` / `pytest` produces `pacts/web-bff-orders-api.json`. This runs at unit speed, no network, no provider deployed. The pact file is the deliverable.

4. **Publish the pact to a broker, tagged with the consumer's git SHA + branch + (later) environments.** The broker is the exchange point; never email pact files around.

   ```bash
   pact-broker publish ./pacts \
     --consumer-app-version $(git rev-parse --short HEAD) \
     --branch $GIT_BRANCH \
     --broker-base-url $PACT_BROKER_URL --broker-token $PACT_BROKER_TOKEN
   ```
   **Version MUST be the git SHA (or `<semver>+<sha>`), not a timestamp or "latest"** — can-i-deploy reasons about specific versions, and a non-unique version corrupts the matrix. `--branch` enables WIP/pending-pact selection. Self-host the OSS **Pact Broker** (Docker, Postgres-backed) or use hosted **PactFlow** (adds bi-directional + WIP UI).

5. **Provider verification: replay every consumer's pact against the real running provider, seeding data via provider-state handlers.** The provider pulls pacts from the broker by **consumer version selectors** (not "all pacts ever") and runs them against a real instance:

   ```java
   // pact-jvm JUnit5
   @Provider("orders-api")
   @PactBroker(url="${PACT_BROKER_URL}", selectors = {
       @VersionSelector(deployedOrReleased = true),   // pacts live in any env
       @VersionSelector(mainBranch = true) })          // + main branch
   class OrdersApiPactTest {
     @State("order 42 exists")                          // matches given(...) string EXACTLY
     void seedOrder42() { db.insertOrder(42, "PAID"); } // arrange real data
     @TestTemplate @ExtendWith(PactVerificationInvocationContextProvider.class)
     void verify(PactVerificationContext ctx) { ctx.verifyInteraction(); }
   }
   ```
   Verify against the **real app + a test DB**, not mocks — the point is to prove the actual provider satisfies the expectation. **`@State` handlers are mandatory and must be idempotent**; they set up exactly the data the interaction needs and clean up after. A missing/misnamed state handler fails verification with "state not found".

6. **Publish verification results back to the broker so the matrix is complete on both sides.** Set `pact.verifier.publishResults=true` (pact-jvm) / `publishVerificationResult: true` (pact-js) **only in CI, keyed to the provider's git SHA**. This is what lets can-i-deploy answer "has provider@sha verified consumer@sha?" — without it the matrix has holes and the gate fails open or stuck.

7. **Gate every deploy with `can-i-deploy` against the target environment — this is the whole payoff.** Before shipping either side, ask the broker whether this version is compatible with everything currently in the target env:

   ```bash
   pact-broker can-i-deploy \
     --pacticipant orders-api --version $(git rev-parse --short HEAD) \
     --to-environment production --retry-while-unknown 30 --retry-interval 10
   # exit 0 = safe to deploy; non-zero = a consumer in prod would break → fail the stage
   ```
   `--retry-while-unknown` waits for in-flight verifications instead of failing on a race. After a successful deploy, record it so the matrix tracks what's live:
   ```bash
   pact-broker record-deployment --pacticipant orders-api \
     --version $(git rev-parse --short HEAD) --environment production
   ```
   Use `record-deployment` for environments you replace-in-place (one version live), `record-release`/`record-support-ended` for things like mobile apps where **multiple versions are live at once** — that's how you stop the provider dropping a field old app builds still need.

8. **Trigger provider re-verification automatically on contract change via broker webhooks.** Configure a broker **webhook** on `contract_content_changed` / `contract_requiring_verification_published` to POST to the provider's CI (GitHub Actions `repository_dispatch`, GitLab pipeline trigger). New consumer expectation published → provider pipeline runs verification → result published → consumer's can-i-deploy unblocks. Without this the loop is manual and contracts rot.

9. **Use pending pacts + WIP pacts so a new/changed consumer expectation can't red the provider's main build.** Enable `enablePending: true` and `includeWipPactsSince: <date>` in the provider's selectors. A brand-new consumer expectation is verified but reported as **pending** — failures are visible but **non-blocking** for the provider — until it verifies green once, at which point it becomes blocking. This decouples teams: a consumer can publish a forward-looking contract without breaking the provider's release, and the provider opts in when ready. Pair with branch-based selectors so you verify against `main` + `deployedOrReleased`, not every stale feature-branch pact.

10. **For async/messaging, use message pacts; for the provider's own spec, optionally add a bi-directional contract.** **Message pacts**: the consumer asserts on a *message body* it can handle (no HTTP mock); the provider verifies its producer function emits a matching message — same broker, same can-i-deploy. **Bi-directional**: publish the provider's OpenAPI as a provider contract (`pactflow-cli publish-provider-contract openapi.yaml`); PactFlow statically cross-validates consumer pacts against it, so the provider needn't run verification — accept the tradeoff that a wrong spec passes (mitigate by also asserting the spec in the provider's own tests).

## Common Errors

- **Asserting on literal example values instead of matchers.** Hardcoding `total: 19.99` means any data change reds provider verification. Fix: `M.decimal()/integer()/regex()/eachLike()` — pin type/structure, not the example.
- **Consumer over-specifies fields it doesn't use.** Asserting on every response field couples you to the provider's full shape and blocks its additive changes. Fix: assert only the fields the consumer reads; extra provider fields must pass.
- **Provider state string ≠ `@State`/`Given` handler.** `given('order exists')` vs `@State("order 42 exists")` → "no state handler" verification failure. Fix: keep the strings byte-identical; treat them as a shared contract.
- **Verifying the provider against mocks/in-memory stubs.** Defeats the purpose — you prove the mock matches, not the real app. Fix: run verification against the real provider + test DB seeded by state handlers.
- **Versioning pacts with `latest`/timestamps instead of the git SHA.** can-i-deploy's matrix needs unique, reproducible versions; "latest" makes the gate meaningless. Fix: `--consumer-app-version <git-sha>`, branch via `--branch`.
- **Not publishing verification results (or publishing from local dev).** Holes in the matrix → can-i-deploy can't answer → gate fails open or hangs. Fix: publish results only from CI, keyed to the provider SHA.
- **Skipping can-i-deploy and just deploying.** Contracts that aren't gated provide false safety. Fix: make can-i-deploy a required pipeline stage that fails the deploy on non-zero exit; add `record-deployment` after.
- **No pending pacts → new consumer expectation reds the provider main build.** Teams get blocked on each other and disable Pact in frustration. Fix: `enablePending` + WIP pacts; new expectations are non-blocking until first green.
- **Treating Pact as full-coverage E2E.** Pact verifies the request/response *shape* per interaction, not business correctness or multi-hop flows. Fix: keep a thin layer of true E2E for critical journeys; Pact replaces the broad, flaky middle.
- **Forgetting multi-version providers (mobile).** `record-deployment` assumes one live version; old app builds still in the wild get dropped. Fix: `record-release`/`record-support-ended` so can-i-deploy keeps every supported app version in the matrix.
- **Webhook not configured → manual verification loop.** Contracts published but provider never re-verifies, so the broker shows stale green. Fix: `contract_requiring_verification_published` webhook → provider CI dispatch.

## Verify

1. **Consumer test produces a pact at unit speed:** running the consumer suite emits `pacts/<consumer>-<provider>.json` with matchers (not literals), no provider or network involved.
2. **Provider verification replays real interactions:** the provider's verification task pulls pacts from the broker, runs against the real app + seeded DB via every `@State`/`Given` handler, and all interactions pass (or are explicitly pending).
3. **Matrix is complete both ways:** the broker shows the consumer pact *and* a published verification result for the provider's version — no "unverified" holes.
4. **Gate actually blocks:** introduce a breaking provider change (drop/rename a consumed field), run `can-i-deploy --to-environment production` → it exits non-zero and the deploy stage fails; revert → exit 0.
5. **Additive change is safe:** add a new optional field on the provider → consumer pact still verifies green and can-i-deploy passes (proves extra fields don't break consumers).
6. **Pending pacts don't red main:** publish a new consumer expectation the provider doesn't yet satisfy → provider build reports it pending/non-blocking, not failed; once provider implements it and verifies, it becomes blocking.
7. **Versions are git SHAs:** every publish/verify/record uses `git rev-parse` versions; grep CI for `latest`/timestamp versions and remove them.
8. **Webhook closes the loop:** publishing a changed contract auto-triggers the provider's verification pipeline; the broker reflects the fresh result without manual intervention.
9. **Multi-version handled (if applicable):** `record-release` keeps every supported mobile/app version in the matrix; can-i-deploy refuses a provider change that breaks any still-supported version.

Done = consumers generate matcher-based pacts at unit speed, the provider replays them against the real app with idempotent state handlers, verification results and deployments are recorded to the broker keyed by git SHA, every deploy is gated by can-i-deploy against the target environment, new expectations land as non-blocking pending pacts, and contract changes auto-trigger provider re-verification via webhook — proven by the breaking-change-blocks / additive-change-passes / pending-doesn't-red tests in checks 4–6.
