---
name: idempotency-keys
description: Makes operations safe to repeat so retries and at-least-once delivery don't double-charge or double-create — idempotency by design first (PUT/upsert, conditional writes with version/ETag/If-Match, natural deterministic keys, set-don't-increment) and by key second (client Idempotency-Key header, a dedup table keyed unique on the key that stores request fingerprint + status + response and replays the SAME response, 409 in-progress lock for concurrent duplicates, 422 on key-reuse-with-different-body), plus consumer-side dedup (processed-event-id store / dedup window), the outbox pattern for atomic write+publish, and DB mechanics (ON CONFLICT, SELECT FOR UPDATE / advisory locks). Effectively-once via dedup, because exactly-once delivery is a myth.
when_to_use: An operation can run more than once and must not have double effects — a POST that creates/charges behind a client/proxy/SDK retry, an at-least-once queue or webhook consumer that may redeliver, a job that may run twice, or you're adding an Idempotency-Key header or a dedup table. Distinct from resilience-timeouts-retries (decides WHEN/how to retry; this skill makes the target safe to retry into) and deliver-webhooks (the sender side — at-least-once delivery + signed retries; this skill is what makes the receiver safe under that redelivery).
---

## When to Use

Reach for this skill when the same operation may execute more than once and a second execution must NOT produce a second effect:

- "A POST timed out, the client retried, and we charged/created twice"
- "Our SDK/proxy/load balancer retries — make the create idempotent"
- "Add an Idempotency-Key header so replays return the original response"
- "The queue/webhook is at-least-once; the consumer ran the same event twice"
- "Make this job safe to run twice" / "dedup redelivered events"
- "Atomically write a row AND publish an event without dual-write loss" (outbox)

NOT this skill:
- Deciding the retry policy itself — backoff, jitter, retry budget, circuit breaker, which errors are retryable → resilience-timeouts-retries (it generates the duplicate calls; this skill absorbs them safely)
- The webhook *sender*: at-least-once dispatch, signing, retry schedule, DLQ for failed deliveries → deliver-webhooks
- The webhook *receiver's* signature/replay-window verification (HMAC over raw body, timestamp window) → ingest-webhook-secure (this skill is the dedup-on-event-id half it hands off to)
- Building the queue/worker, DLQ, poison-message handling → message-queue-jobs (this skill specifies the *idempotent consumer* it needs)
- Idempotent PSP charges + subscription/proration/ledger reconciliation → payments-billing-integration (it owns billing state and calls this skill's key pattern for money-mutating calls)
- The rounding/allocation math of the amounts → money-decimal-arithmetic

## Steps

1. **Make it idempotent BY DESIGN before reaching for a key — that's cheaper and self-healing.** A surprising amount of "double effect" disappears if the operation is naturally repeatable:

   | Technique | How | Why it's idempotent |
   |---|---|---|
   | **PUT / upsert** to a client-chosen id | `PUT /orders/{client_uuid}` → `INSERT ... ON CONFLICT (id) DO NOTHING/UPDATE` | second call hits the same row, no new row |
   | **Conditional write** (optimistic concurrency) | `If-Match: <etag>` / `WHERE version = N` → bump version | stale retry's precondition fails → no double-apply |
   | **Natural / deterministic key** | derive id from stable inputs (`hash(order_id+sku)`, not `uuid()`) | same inputs → same id → conflict, not insert |
   | **Set, don't increment** | `balance = 100` not `balance += 10`; `status = 'paid'` | reapplying the same set is a no-op |
   | **DELETE / "ensure absent"** | delete-by-id, "cancel if active" | already-gone is success, not error |

   Increments, "append a row", and server-generated ids on POST are the *non*-idempotent shapes that force you to step 2.

2. **For non-idempotent POSTs, use a client-supplied Idempotency-Key.** The client (not the server, not per-retry) generates ONE key for a logical operation and sends it on the original request AND every retry — header `Idempotency-Key: <opaque-uuid>`. The key must be **stable across retries and unique per operation**: generate it once before the first send, store it with the in-flight request, reuse it on retry. This is the Stripe model and the reference semantics to copy.

3. **Persist the key with a dedup table — fingerprint, status, and the stored response.** One row per key:

   ```sql
   CREATE TABLE idempotency_keys (
     id_key        text NOT NULL,
     scope         text NOT NULL,            -- e.g. (user_id || ':' || endpoint)
     request_hash  text NOT NULL,            -- SHA-256 of canonical request body+route
     status        text NOT NULL,            -- 'in_progress' | 'completed'
     response_code int,
     response_body jsonb,
     created_at    timestamptz NOT NULL DEFAULT now(),
     expires_at    timestamptz NOT NULL,     -- TTL: now() + 24h..7d
     PRIMARY KEY (scope, id_key)              -- UNIQUE on (scope, key)
   );
   ```
   Scope the key per `(user/tenant, endpoint)` so one client's key can't collide with or replay another's. Retention 24h–7d (Stripe = 24h); a TTL/cron purges expired rows so storage is bounded.

4. **Server flow — claim, execute, store, replay — atomically.** On each request:
   1. Compute `request_hash` from the canonical (sorted/normalized) body + method + route.
   2. **Atomically claim** the key: `INSERT (scope, id_key, request_hash, status='in_progress') ON CONFLICT (scope, id_key) DO NOTHING`. The insert *is* the lock.
   3. **If the insert won** (0 conflicts): run the real operation, then `UPDATE ... SET status='completed', response_code, response_body` and return the response.
   4. **If it conflicted**, read the existing row:
      - `status='completed'` **and** `request_hash` matches → return the **stored** `response_code`/`response_body` verbatim (the replay path — same result, no re-execution).
      - `status='in_progress'` → a concurrent duplicate is still running → return **409 Conflict** (or `425`-style "in progress"); the client should retry-after, not re-execute.
      - `request_hash` **differs** (same key, different body) → return **422 Unprocessable Entity** — the key was reused for a different operation; never run it.

5. **Hold a lock for the in-flight window so concurrent duplicates don't both execute.** The `INSERT ... ON CONFLICT DO NOTHING` claim handles most of it, but if you read-then-write, take a row lock: `SELECT ... FOR UPDATE` on the key row, or a Postgres advisory lock `pg_advisory_xact_lock(hashtext(scope||id_key))` around the whole claim+execute. Without this, two parallel retries can both see "no row" and both run. Wrap claim + business write + result-store in **one transaction** (or make the business write itself idempotent via step 1) so a crash between execute and store doesn't lose the recorded response.

6. **Consumer-side dedup for at-least-once queues and webhooks — "exactly-once delivery" is a myth; you get effectively-once.** Brokers (SQS, Kafka, RabbitMQ) and webhook senders redeliver on ack timeout, so the *consumer* must be idempotent. Two patterns:
   - **Processed-event-id store:** a `processed_events(event_id PRIMARY KEY, processed_at)` table. Before handling, `INSERT ... ON CONFLICT DO NOTHING`; if 0 rows inserted, it's a duplicate → ack and skip. Dedup on the **provider's stable event id** (not your own per-receipt uuid). Pairs with ingest-webhook-secure / message-queue-jobs.
   - **Dedup window:** a bounded TTL set (Redis `SET key NX EX <window>`) when full history is too large — only safe if redelivery is bounded within the window.

   Best of all: make the *handler* naturally idempotent (step 1: upsert by event-derived key, set-don't-increment) so even a missed dedup is harmless.

7. **Atomic write + publish → outbox pattern (no dual-write).** Writing the DB row and publishing the event as two separate calls can crash between them (row saved, event lost — or vice versa). Instead, in **one transaction** write the business row AND an `outbox` row; a separate relay polls/CDC-tails the outbox and publishes (at-least-once → consumers dedup per step 6). The transaction guarantees the event is recorded iff the state changed.

8. **DB mechanics cheat-sheet.**
   - Postgres/SQLite: `INSERT ... ON CONFLICT (cols) DO NOTHING` (claim/dedup) or `DO UPDATE SET ...` (upsert). MySQL: `INSERT ... ON DUPLICATE KEY UPDATE`. The **UNIQUE constraint/index is what makes it safe** — `ON CONFLICT` without a matching unique index silently doesn't dedup.
   - Serialize the in-flight window with `SELECT ... FOR UPDATE` (row) or `pg_advisory_xact_lock` (cross-row/logical) — released at transaction end.
   - Check the *result* of the upsert (rows affected / `RETURNING xmax = 0`) to know whether you inserted or hit an existing row.

## Common Errors

- **Generating the key per-retry (`uuid()` / `now()` inside the retry loop).** Every attempt gets a fresh key → zero dedup → still double-charges. Fix: generate ONCE before the first send; reuse the identical key on every retry.
- **No request-fingerprint check.** Same key replayed with a *different* body silently returns the old response (or runs the new op). Fix: store `request_hash`; on mismatch return 422, never execute.
- **Racing duplicates with no lock.** Two parallel retries both `SELECT` (no row), both execute, both insert. Fix: atomic `INSERT ... ON CONFLICT DO NOTHING` as the claim, or `FOR UPDATE` / advisory lock around read-modify-write.
- **`ON CONFLICT` / upsert without a UNIQUE index on the key.** No conflict ever fires → no dedup, duplicate rows. Fix: enforce a unique constraint on `(scope, id_key)` (or the natural key).
- **Unbounded key storage.** The dedup table grows forever. Fix: `expires_at` + a purge job; pick 24h–7d retention.
- **Treating a non-idempotent op as idempotent.** Retrying `balance += 10` or "append row" doubles the effect even *with* a key if you don't replay the stored response. Fix: replay the stored response on hit; or redesign to set-don't-increment (step 1).
- **Recording the result in a separate step from the business write.** Crash in between → next retry re-executes a completed op. Fix: same transaction, or idempotent business write so re-execution is a no-op.
- **Believing the broker gives exactly-once.** "Exactly-once delivery" doesn't exist over a network; redelivery happens. Fix: idempotent consumer + processed-event-id dedup = effectively-once.
- **Dual-write (DB then publish, two calls).** A crash loses one side. Fix: outbox in the same transaction + a relay.
- **Acking before the work is durable.** Ack-then-process loses the message on a crash. Fix: process (idempotently) and commit, *then* ack.

## Verify

1. **Duplicate POST is a no-op:** send the same request with the same `Idempotency-Key` twice → exactly one effect (one charge/row) and the second response is byte-identical to the first.
2. **Concurrent duplicates:** fire N parallel requests with the same key → exactly one executes; the rest get the stored response or `409 in-progress`, never a second effect. (This is the race test — run it against the real shared store.)
3. **Key reuse, different body:** same key + changed payload → `422`, and no operation runs.
4. **Per-retry-key bug guard:** confirm the client generates the key once and reuses it (grep the retry path for `uuid()`/`now()` *inside* the loop).
5. **Consumer redelivery:** deliver the same event id to the queue/webhook consumer twice → handled once (processed-events insert conflicts on the second); effect is identical to single delivery.
6. **By-design ops:** issue the same `PUT`/upsert / conditional write twice → one row, version advances once; a stale `If-Match` retry is rejected, not double-applied.
7. **Outbox atomicity:** kill the process between the business write and publish → on restart the relay still publishes (event recorded iff state changed); no orphan event, no lost event.
8. **Retention bounded:** expired keys are purged; an old key past TTL behaves as a fresh request (documented), and the table doesn't grow without bound.

Done = duplicate and concurrent requests produce exactly one effect with an identical replayed response, same-key/different-body returns 422, the in-flight window is locked, consumers dedup at-least-once delivery on stable event ids, write+publish is atomic via the outbox, and key storage is TTL-bounded — all proven by the parallel/redelivery tests in checks 1–7.
