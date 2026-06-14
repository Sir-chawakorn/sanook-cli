---
name: rate-limiting
description: Implements rate limiting and throttling (token-bucket, sliding-window, distributed Redis counters, per-key quotas, 429 + Retry-After) to protect APIs from abuse and overload.
when_to_use: User wants to add or tune rate limiting, throttle an endpoint or client, enforce quotas/plans, or protect against bursts and abuse. Distinct from caching-strategy (load reduction) and auth (identity).
---

## When to Use

Reach for this skill when the request is about **controlling request rate**, not request content:

- "Cap this endpoint at N req/s per user/IP/API key"
- "Add quotas per plan tier (free/pro/enterprise)"
- "We got hammered / scraped / brute-forced — throttle it"
- "Smooth out bursts to a downstream that has its own limit"
- Tuning an existing limiter (wrong window, double-counting, false 429s)

NOT this skill:
- Reducing load by serving cached responses → caching-strategy
- Deciding *who* the caller is → auth (rate limiting consumes identity, it does not establish it)
- Backpressure inside a queue/worker pool → concurrency/queue control

## Steps

1. **Pick the algorithm by requirement — do not default to fixed window.**

   | Algorithm | Use when | Cost |
   |---|---|---|
   | Fixed window | Rough cap, simplest, OK to allow 2x burst at window edge | 1 counter |
   | Sliding window (log) | Need exact count over rolling period | O(n) memory per key |
   | Sliding window (counter) | Approximate rolling cap, cheap | 2 counters |
   | **Token bucket** | Allow bursts up to `capacity`, refill at steady rate — best general default for APIs | 2 fields (tokens, ts) |
   | Leaky bucket | Force a *constant* outflow to a fragile downstream | queue + drain |

   Default to **token bucket** for public API limits: `capacity` = max burst, `refill_rate` = sustained req/s.

2. **Define the key — this is where most bugs live.** Compose the rate key explicitly: `ratelimit:{scope}:{identity}:{route?}:{window?}`.
   - Per-API-key/user for authed traffic (stable, fair).
   - Per-IP only for unauthed/pre-auth routes (login, signup) — and normalize the IP from the real client header set by *your* trusted proxy, never a raw client-supplied `X-Forwarded-For`.
   - Add `:{route}` only when limits differ per route; otherwise one global bucket per identity is cheaper and harder to game.

3. **Make the counter atomic in a shared store (Redis).** In-memory counters break the moment you run >1 instance. Do the read-modify-write in **one round trip** via a Lua script (or `INCR`+`EXPIRE` for fixed window). Race-free token bucket in Lua:

   ```lua
   -- KEYS[1]=bucket  ARGV: now_ms, refill_per_ms, capacity, cost
   local b = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
   local tokens = tonumber(b[1]) or tonumber(ARGV[3])
   local ts     = tonumber(b[2]) or tonumber(ARGV[1])
   local now    = tonumber(ARGV[1])
   tokens = math.min(tonumber(ARGV[3]), tokens + (now - ts) * tonumber(ARGV[2]))
   local allowed = tokens >= tonumber(ARGV[4])
   if allowed then tokens = tokens - tonumber(ARGV[4]) end
   redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', now)
   redis.call('PEXPIRE', KEYS[1], math.ceil(tonumber(ARGV[3]) / tonumber(ARGV[2])) + 1000)
   return { allowed and 1 or 0, tokens }
   ```
   Never do `GET` then `SET` in two app-side calls — concurrent requests both read the old value and overshoot.

4. **Drive limits from config, not hardcoded numbers.** Map tier → `{capacity, refill_rate}` in a config table so plans change without a deploy. Resolve the caller's tier *after* auth, fall back to an anonymous/default tier, and treat unknown tiers as the strictest limit.

5. **Return a strict response contract on reject.** On deny, respond `429 Too Many Requests` and always emit:
   - `Retry-After: <seconds>` — integer seconds until one token/slot frees up (compute from refill math, don't guess).
   - `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (or the legacy `X-RateLimit-*`) — also set these on **allowed** responses so good clients self-throttle.
   - A small JSON body with a stable machine-readable `code`.

6. **Place it at the edge, decide fail mode explicitly.** Run the check as early middleware / at the gateway, *before* expensive work (DB, downstream calls). When the limiter store (Redis) is unreachable, choose deliberately:
   - **Fail-open** (allow) for revenue/availability-critical traffic — abuse risk during outage.
   - **Fail-closed** (deny) for security-sensitive routes (login, payments) — availability risk.
   Log every fallback so a silent Redis outage doesn't quietly disable all limits.

7. **Verify under burst and concurrency** (see Verify) before shipping. A limiter that passes single-threaded tests almost always leaks under parallel load.

## Common Errors

- **Two app-side calls (GET then SET / INCR then check).** Under concurrency both requests see the pre-increment value and the limit is breached. Make it one atomic op (Lua / `INCR` returns the new value — check *that*, not a separate read).
- **Fixed window edge burst.** With a 60s/100-req fixed window a client can send 100 at 0:59 and 100 at 1:00 = 200 in ~1s. If that's unacceptable, use sliding window or token bucket.
- **Trusting client `X-Forwarded-For`.** Anyone can spoof it to dodge per-IP limits or frame another IP. Read only the value your own trusted proxy appends; strip/ignore the rest.
- **Missing `EXPIRE` on the counter key.** Keys accumulate forever and leak memory. Every counter/bucket key must have a TTL ≥ its window. (The Lua above sets `PEXPIRE` every call.)
- **Clock skew across instances.** Token-bucket math using each app server's local clock drifts. Pass `now` from a single source (Redis `TIME`, or accept the small skew but never mix sources mid-bucket).
- **Counting before auth on authed routes.** Rate-limiting an authed endpoint by IP lets one NAT'd office exhaust the shared limit while an attacker rotates IPs. Key authed traffic by user/API key.
- **Hot-key contention.** A single global bucket (or one whale tenant) serializes every request on one Redis key/slot. Shard the key (`:{n}` suffix, sum N sub-buckets) or move global caps to an approximate counter.
- **`Retry-After` that's wrong or absent.** Clients then retry immediately and amplify the storm. Compute it from real refill time; emit it on every 429.
- **Limiter inside the app, after the DB call.** Defeats the purpose — the expensive work already happened. Reject at the edge before doing anything costly.
- **No headers on 2xx.** Without `RateLimit-Remaining` on success, well-behaved clients can't back off and only discover the limit by getting 429s.

## Verify

1. **Single-key cap (steady):** Fire exactly `limit` requests serially → all `200`. The next request → `429` with `Retry-After` and `RateLimit-Remaining: 0`.
2. **Concurrency / race:** Fire `limit + 50` requests **in parallel** (e.g. `hey`/`vegeta`/`ab` or `xargs -P`). Allowed count must equal the limit exactly — not limit+ε. This is the test that catches non-atomic counters; run it against the *distributed* store.
3. **Burst then sustain (token bucket):** Send `capacity` requests instantly (all pass), then send at exactly `refill_rate` → steady-state passes; faster → 429s. Confirms burst capacity and refill are independent.
4. **Window reset:** After a 429, wait `Retry-After` seconds, retry → `200`. Confirms TTL/refill releases on schedule and `Retry-After` is honest.
5. **Multi-instance:** Run ≥2 app instances behind a balancer hitting one Redis. The aggregate limit across instances must still equal the configured limit (proves the counter is shared, not per-process).
6. **Key isolation:** Two different keys/users hitting the limit simultaneously must not affect each other's allowance.
7. **Fail mode:** Kill/block Redis, send traffic → behavior matches the documented fail-open/closed choice, and a fallback is logged (not silent).
8. **Headers present on success:** A normal `200` carries `RateLimit-Limit/Remaining/Reset`.

Done = tests 1–5 pass with the **distributed** store under **parallel** load, fail mode is explicit and logged, and every response (200 and 429) carries the correct rate-limit headers.
