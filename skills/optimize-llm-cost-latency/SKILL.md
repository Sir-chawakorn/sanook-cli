---
name: optimize-llm-cost-latency
description: Cuts LLM token cost and tail latency via context trimming, provider prompt caching on stable prefixes, model tiering/routing, semantic answer caching, batch APIs, and streaming, proving a measured before/after on cost-per-request and p50/p95 at equal output quality.
when_to_use: An LLM feature is too slow or too expensive, or usage is scaling and the bill/latency matters. Distinct from prompt-engineering (output quality), rag-pipeline (retrieval quality), and harden-llm-app-reliability (timeouts/retries/fallback).
---

## When to Use

Reach for this skill when the problem is **spend or speed**, not what the model says:

- "Our LLM bill is $X/month and climbing — cut it"
- "This call takes 8s; make it feel fast"
- "Token usage per request is huge — trim it"
- "We send the same 6k-token system prompt on every call"
- "We re-answer near-identical questions all day"
- "We have a nightly batch of 50k classifications — too slow/expensive"

NOT this skill:
- Making the *output* better/more correct/structured → prompt-engineering
- Improving *what gets retrieved* into context (chunking/embeddings/reranking) → rag-pipeline
- Timeouts, retries, fallback models, circuit breakers when a call fails → harden-llm-app-reliability
- Blocking malicious instructions in inputs/tools → defend-llm-prompt-injection
- Generic HTTP/data response caching unrelated to LLM token economics → caching-strategy
- Cutting compute/storage/egress spend on the infra bill → cloud-cost-optimize

## Steps

1. **Measure first — no optimization without a baseline.** Log per request: `input_tokens`, `output_tokens`, model id, end-to-end latency, and time-to-first-token (TTFT). Get exact counts from the provider's usage object or a count-tokens endpoint — never estimate from `len(text)/4` for billing decisions. Compute `$/req` from current per-token prices and aggregate **p50/p95** (means hide the tail that users actually feel). You cannot claim a win without these numbers before and after.

   ```python
   # cost per request from the provider usage object (Anthropic-style)
   u = resp.usage  # input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens
   cost = (u.input_tokens*IN + u.output_tokens*OUT
           + u.cache_creation_input_tokens*CACHE_WRITE   # ~1.25x input
           + u.cache_read_input_tokens*CACHE_READ) / 1e6 # ~0.1x input
   ```

2. **Apply levers in ROI order — cheapest, highest-impact first.** Do not jump to a fancy router before you've capped output and cached the prefix.

   | Lever | Typical win | Effort | Use when |
   |---|---|---|---|
   | Cap `max_tokens` + stop sequences | 10–40% output cost | trivial | output runs longer than needed |
   | Context diet (trim history, drop dead few-shot) | 20–60% input cost | low | long/growing prompts |
   | **Prompt caching** (cache stable prefix) | **up to 90% on the cached portion**, lower TTFT | low | long fixed system prompt / RAG docs reused across calls |
   | Streaming | TTFT 5–10x better (perceived) | low | user-facing chat/UI |
   | Model tiering/routing | 50–95% on easy traffic | medium | mixed easy/hard requests |
   | Semantic cache | ~100% on a cache hit | medium | repeated/near-duplicate queries |
   | Batch API | ~50% on $ | medium | offline, non-urgent jobs |

3. **Context diet — shrink input before you optimize how you send it.** Every input token is paid on every call. (a) **Cap history**: keep the last N turns; once over a token budget, **summarize** older turns into a compact running summary instead of carrying raw transcript. (b) **Cut dead few-shot examples**: drop each example and re-run the eval — keep only those that move accuracy. Most prompts carry 3–4 examples that earn nothing. (c) Strip boilerplate, redundant instructions, and verbose tool schemas. Re-measure tokens after each cut.

4. **Prompt caching — usually the single biggest win.** Put the **stable, large** content first (system prompt, tool definitions, RAG documents, long instructions) and the **variable** part (the user's actual turn) last, then mark the boundary with the provider's cache control so the prefix is reused across requests. Order matters: the cache keys on an exact prefix match, so one moving token near the top busts the whole cache.

   ```python
   # Anthropic: cache_control breakpoint on the stable prefix; variable user msg stays uncached
   system=[{"type":"text","text":BIG_STABLE_PROMPT,"cache_control":{"type":"ephemeral"}}]
   # OpenAI: automatic prefix caching — just keep the prefix byte-identical and put it first
   ```
   Cache reads are ~10% of input price; writes ~25% more than input — so caching pays off once a prefix is reused even a handful of times within its TTL (~5 min ephemeral). Verify hits via `cache_read_input_tokens > 0`.

5. **Model tiering + routing — send easy work to the cheap model.** Default the bulk of traffic to a small/fast model; escalate only when needed. Pick a **deterministic router** over an LLM-classifier router when you can (no extra call, no extra latency): route on cheap signals — input length, required output schema, presence of code/math, retrieval confidence, or an explicit difficulty flag. Use a tiny classifier model only when rules can't separate easy from hard. Always escalate on low-confidence or a validation failure rather than returning a bad cheap answer.

   ```python
   def route(req):
       if req.tokens < 800 and not req.needs_reasoning: return SMALL   # ~1/10 the cost
       if req.needs_long_reasoning or req.high_stakes:  return LARGE
       return MID
   # escalate: if small-model output fails schema/confidence check -> retry once on LARGE
   ```

6. **Semantic cache for repeated/near-duplicate queries.** Embed the normalized query, look it up in a vector store; on cosine similarity ≥ ~0.95 return the cached answer (0 LLM tokens). Set a conservative threshold (too low → wrong cached answers), scope the key by anything that changes the answer (user/tenant/locale/tool-version), and TTL it so stale facts expire. Bypass the cache for personalized or time-sensitive responses. This is *exact/near-exact answer reuse*, layered on top of prompt caching (which reuses the prefix, not the answer).

7. **Batch the offline work.** Anything not blocking a user — nightly classification, backfills, evals, bulk summarization — goes through the provider **Batch API** (Anthropic Message Batches / OpenAI Batch) for ~50% off, accepting up to ~24h turnaround. Never batch interactive requests.

8. **Stream to cut *perceived* latency.** For any user-facing surface, stream tokens (`stream=True` / SSE) so first text shows in a few hundred ms instead of after the full generation. This doesn't reduce cost or total wall-clock, but it collapses TTFT — often the only latency users perceive. Combine with caching: a cached prefix also lowers real TTFT.

9. **Re-measure and prove equal quality.** Re-run the same metrics (step 1) after changes, and run your eval set to confirm output quality didn't regress (see Verify). A cost win that drops accuracy is not a win — report cost/latency **and** the quality delta together.

## Common Errors

- **Optimizing without a baseline.** "Feels faster/cheaper" is not a number. Capture p50/p95 and $/req before touching anything, or you can't prove (or trust) the result.
- **Estimating tokens with `len/4`.** Fine for a rough guess, wrong for billing and for `max_tokens` budgeting. Use the provider usage object / count-tokens endpoint.
- **Cache-busting the prefix.** Putting a timestamp, request id, randomized example order, or the user message *before* the stable block invalidates the cache every call. Stable content first, byte-identical; variable content last.
- **Caching the wrong span.** Marking a tiny or rarely-reused prefix as cached pays the ~25% write premium for no reads. Cache large prefixes reused within the TTL; confirm with `cache_read_input_tokens`.
- **Semantic-cache threshold too loose.** A 0.85 similarity match returns a confidently wrong answer for a different question. Start ≥0.95, log near-miss hits, and never cache personalized/time-sensitive answers.
- **Unscoped cache key.** Caching by query text alone leaks one tenant/user/locale's answer to another. Include every dimension that changes the correct answer in the key.
- **Router that always escalates.** A misconfigured or overcautious router sends everything to the big model — you pay more *and* added a routing hop. Verify the cheap-model hit rate; if <50% on easy traffic, the rules are wrong.
- **Unbounded `max_tokens`.** Leaving it at the model max lets a runaway generation bill thousands of output tokens. Set it to the real ceiling and add stop sequences.
- **Batching interactive traffic.** Batch APIs trade latency for price; a user waiting on a 24h-window response is a broken product. Batch only offline work.
- **Streaming to a non-interactive consumer.** Streaming into code that just `.join()`s the whole thing adds complexity with zero benefit — and can hide errors that arrive mid-stream. Stream only where a human sees partial output.
- **Trimming context until quality silently drops.** Aggressive history truncation or cutting a load-bearing few-shot example tanks accuracy. Gate every cut behind the eval (step 9).

## Verify

1. **Baseline captured:** before/after table exists with `input_tokens`, `output_tokens`, `$/req`, p50, p95, and TTFT — real measured numbers, not estimates.
2. **Cost dropped:** post-change `$/req` is measurably lower (state the %), computed from the provider usage object at current prices.
3. **Latency dropped:** p95 (and TTFT for user-facing paths) improved; report the actual ms, not "feels faster."
4. **Cache is hot:** `cache_read_input_tokens > 0` on repeat requests, and the measured hit rate is reported. A prompt cache that never reads is dead config.
5. **Router behaves:** the cheap model handles the majority of easy traffic (hit-rate stated), and escalation fires on low-confidence/validation-fail (one logged example each).
6. **Semantic cache is safe:** a deliberately *different* query below threshold does **not** return a cached answer; key scoping (tenant/locale) prevents cross-leak.
7. **Quality held:** the eval set scores within tolerance of baseline (state the delta) — the cost/latency win did not regress accuracy. If it did, the change is rejected.

Done = a before/after table shows lower $/req and lower p50/p95 (with cache hit rate and cheap-model share stated), and the eval confirms output quality is unchanged at the new, cheaper, faster configuration.
