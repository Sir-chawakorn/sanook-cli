---
name: caching-strategy
description: Designs caching layers (cache-aside, write-through, TTLs, invalidation, stampede protection) typically with Redis to cut latency and database load when responses are slow or repeated.
when_to_use: User wants to add or fix caching, choose a cache pattern, set TTLs, solve stale data, cache stampede, or thundering-herd problems, or reduce DB load. NOT for measuring where time goes (use performance-profiling).
---

## When to Use

Reach for this skill when a read is **slow or repeated** and the underlying data is **more read than written** and **tolerant of some staleness**.

- Use when: hot read path hits the DB/external API every request; identical responses recomputed; DB CPU/connection pool saturated by reads; p99 latency dominated by one query/call.
- Do NOT use when: you don't yet know *where* time goes (profile first), data must be strictly fresh on every read (auth tokens, balances, inventory-at-checkout), write-heavy with near-zero re-reads (cache churns, hit ratio stays low), or working set fits in one cheap query already.

Decision gate before writing any code, answer all four:
1. What exact key identifies this read? (must be deterministic from request inputs)
2. How stale can the value be — seconds, minutes, hours? (sets TTL ceiling)
3. What's the current read:write ratio on this data? (<5:1 → caching rarely pays)
4. What's the blast radius if a stale value is served? (decides invalidation rigor)

If you can't answer #2 and #4, stop — caching here risks a correctness bug, not a speedup.

## Steps

1. **Pick exactly one hot read to cache first.** Confirm it's read-heavy and idempotent (same inputs → same output). Resist caching writes or per-user-unique reads with no reuse.

2. **Design the key namespace.** Format: `{domain}:{entity}:{id}:{version}` e.g. `user:profile:42:v3`. Rules:
   - Include a schema/serializer **version segment** so a deploy with a changed shape can't read old bytes as the new type.
   - Never put unbounded/unhashed user input in the key (cardinality explosion + injection); hash long or composite keys.
   - Keep one key = one entity. Avoid baking query params you'll later need to invalidate independently into a single blob.

3. **Choose the pattern:**
   - **Cache-aside (default, start here):** read → on miss, load from source, write to cache with TTL, return. App owns cache; source stays the truth.
   - **Write-through:** on write, update source **then** cache synchronously. Use when reads must reflect writes immediately and you accept slower writes.
   - **Write-behind:** buffer writes, flush to source async. Only with a durable queue and an accepted data-loss window — most teams should not.
   - Default to cache-aside unless a concrete requirement forces the others.

4. **Set TTL deliberately, never "just put a number."** TTL = max acceptable staleness from step 2. Add **jitter**: store with `ttl ± rand(0..ttl*0.1)` so keys created together don't all expire on the same tick. Pick eviction policy explicitly (e.g. `allkeys-lru` for a pure cache, `volatile-ttl` if the instance also holds non-expiring data) — don't inherit `noeviction`, which turns a full cache into write errors.

5. **Invalidate on write, don't rely on TTL alone for correctness.** On every mutation of the source, in the same transaction boundary: **delete** the affected key(s) (don't try to update them — update-in-place races with concurrent reads). For derived/list keys, track an index of dependent keys or use a key prefix + versioned namespace you can bump. After a DB commit, delete; if the delete can fail independently of the commit, prefer the **delete-after-commit + short TTL safety net** so a missed invalidation self-heals.

6. **Add stampede protection before it bites in prod.** When a hot key expires under load, all callers miss at once and dogpile the source. Use one of:
   - **Single-flight / per-key lock:** first miss acquires a short-lived lock (`SET lock:{key} 1 NX EX 5`), recomputes, fills cache; others briefly wait/retry or serve stale.
   - **Stale-while-revalidate:** store `{value, soft_expiry, hard_expiry}`; serve stale past soft_expiry while one worker refreshes in background. Best UX for read-heavy paths.
   - **Jittered TTL** (step 4) handles synchronized expiry; SWR/lock handles a single hot key. Use both.

7. **Layer only if measured need.** Optional L1 in-process cache (small, short TTL, e.g. 1–5s) in front of L2 (Redis) for ultra-hot keys. Cap L1 size and remember L1 is **per-instance → harder to invalidate**; keep its TTL short enough that staleness from a missed L1 invalidation is tolerable.

8. **Serialize compactly and cap size.** Pick a stable serializer (JSON for debuggability, msgpack/protobuf for size/speed). Reject caching values over a sane ceiling (e.g. a few hundred KB) — large values blow network and memory; cache an id/handle and fetch the body separately instead.

9. **Verify (step below) — never declare done on "it returns faster once."**

## Common Errors

- **Caching null/error as if it were data.** A miss that returns "not found" or throws must be cached **differently** (short negative-TTL sentinel) or not at all — otherwise either you re-hammer the DB for every missing id, or you pin a transient error for the full TTL.
- **Update-in-place on invalidation.** Reader loads old value → writer updates DB → writer overwrites cache → reader writes its stale value back. **Always delete, never set, on invalidation.** And delete *after* the source commit, not before.
- **Cache stampede ignored until launch.** Works fine in dev (1 caller), melts the DB on a hot key at scale. Add jitter + single-flight/SWR up front for any key you expect to be hot.
- **Unbounded key cardinality.** Caching per-request keys with no reuse (full query strings, timestamps, paginated infinite scroll) → near-zero hit ratio + memory bloat. Verify reuse exists before caching.
- **No serializer version in key.** Deploy changes the struct shape; new code deserializes old bytes → crash or silent corruption. Version segment in the key (step 2) prevents it.
- **`noeviction` on a cache instance.** When memory fills, writes start erroring instead of evicting cold keys, cascading into request failures. Set an `allkeys-*` / `volatile-*` policy.
- **TTL = correctness crutch.** Long TTL "to be safe" serves stale data; short TTL "to be fresh" kills hit ratio and re-stampedes. TTL is the staleness budget; explicit invalidation is the correctness mechanism. Use both.
- **Caching strongly-consistent data.** Balances, inventory at checkout, permission checks, auth state — do not cache, or cache only with write-through + immediate invalidation and a hard correctness review.
- **Thundering herd on cold start / flush.** After a cache restart or mass eviction, everything misses at once. Warm critical keys on deploy, or rely on per-key locks so only one caller rebuilds each key.

## Verify

Caching is "done" only when measured, not when it "felt faster."

1. **Hit ratio:** instrument hits/misses per key namespace; a working cache settles at a high hit ratio (target depends on path; a hot read should be well north of 80%). Persistently low → wrong key, no reuse, or TTL too short. Caching was the wrong move there.
2. **Latency:** compare p50 **and p99** of the cached path before/after under realistic concurrency, not a single warm call. Confirm the source load (DB QPS / external calls) actually dropped — that's the real win.
3. **Correctness under write:** write a test that (a) reads (populates cache), (b) mutates the source, (c) reads again and asserts the new value — proves invalidation fires. Add a test that a missing id doesn't repeatedly hit the source (negative caching) and doesn't pin an error.
4. **Stampede:** fire N concurrent requests at a freshly-expired hot key; assert the source is hit ~once, not N times (single-flight/SWR working).
5. **Eviction/memory:** confirm the eviction policy is set and the instance evicts rather than erroring when full; watch memory under load.
6. **Failure mode:** kill/disconnect the cache and confirm the app **degrades to the source** (slower but correct), not 500s. The cache is an optimization, not a dependency.

If hit ratio is low or latency didn't move, the data wasn't cacheable here — revert and profile instead.
