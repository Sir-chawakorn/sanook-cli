---
name: rag-pipeline
description: Builds and tunes retrieval-augmented-generation pipelines (chunking, embeddings, vector store, retrieval, reranking, grounding) when an agent needs an LLM to answer over a private corpus or knowledge base.
when_to_use: User wants to add 'chat over my docs/code/DB', improve retrieval relevance, fix hallucination/grounding, or choose chunk size, embedding model, vector DB, or reranker. NOT for prompt-only work (use prompt-engineering) or measuring answer quality (use llm-eval-harness).
---

## When to Use

- "Chat over my docs / code / DB" — corpus too big or too private to stuff in the prompt.
- Answers are wrong/made-up because the model never saw the source → grounding problem, not a model problem.
- Retrieval returns junk: right answer exists in corpus but never reaches the LLM (low recall).
- You need to pick chunk size, embedding model, vector store, or a reranker and want a non-guessing default.

**Do NOT use for:** wording/format of a single prompt (use prompt-engineering); scoring final answer quality (use llm-eval-harness). RAG is plumbing that gets the right text into context; those skills shape and grade the output.

## Steps

1. **Pin the corpus + query shape first.** Write down: doc count & avg length, modality (prose / code / tables / mixed), update frequency (static vs hourly), and 10–20 real example questions. Two facts decide everything downstream: (a) are queries lookup ("what is X") or multi-hop ("compare X and Y across docs"), (b) does stale data return wrong answers (→ need re-index or freshness filter). Skip this and you will tune chunk size against questions that don't exist.

2. **Chunk by structure, not by character count.** Default 400–800 tokens, 10–15% overlap. Split on natural boundaries: prose → headings/paragraphs; code → whole functions/classes (AST-aware, never mid-function — a half function embeds to garbage); markdown → keep a section together, prepend the heading path to each chunk. Tables → keep the header row with every row-group. Store metadata on every chunk: `source_path`, `title`, `section`, `chunk_index`, `updated_at`. You will need it for filtering and citations.

3. **Embed deterministically and store the contract.** Pick one model and freeze it; record `model_name`, `dim`, and `normalize`. Two non-negotiables: (a) embed the query with the **exact same model** as the docs, (b) if your similarity metric is cosine, L2-normalize both sides. Batch 50–200 chunks/call. Hash each chunk (`sha256(text)`) and skip re-embedding unchanged chunks on re-index — this is the single biggest cost saver. For code or asymmetric search, prefer an embedding model trained for retrieval (query/doc asymmetry) over a generic sentence model.

4. **Choose the store by ops reality, not benchmarks.** Already on Postgres → use the pgvector extension (one DB, transactional, metadata filters in SQL). Need managed/huge scale → a hosted vector DB. Prototype/local → an embedded vector store. Index params that actually matter: HNSW `m` (16–32) and `ef_construction` (64–200) for build, `ef_search` at query time for the recall/latency trade. Set the distance metric to match how you embedded (cosine vs inner product vs L2) — a mismatch silently returns wrong neighbors with no error.

5. **Retrieve hybrid + rerank, not top-k dense alone.** Pull dense (top 20–50) AND keyword/BM25 (top 20–50), fuse with Reciprocal Rank Fusion. Dense misses exact IDs, error codes, rare tokens, function names; BM25 catches them. Apply metadata filters (date, source, type) **before** scoring, not after, or you lose your top-k to filtered-out rows. Then rerank the fused ~40 candidates with a cross-encoder reranker down to the final 3–8 that go in the prompt. Reranking is usually the highest-leverage relevance win per dollar.

6. **Write a grounding prompt that can say "I don't know."** Inject retrieved chunks with explicit source labels (`[1] path#section`). Instruct: answer ONLY from the provided context, cite the `[n]` you used, and if the context doesn't contain the answer, say so instead of guessing. Put the question after the context. Order chunks best-last if the model shows lost-in-the-middle behavior on long contexts.

7. **Measure retrieval and end-to-end as TWO separate numbers.** Retrieval: from your example questions, label which chunk(s) are correct, then compute recall@k and MRR — "is the right chunk in the top-k at all." End-to-end: is the final answer correct AND grounded in cited chunks. Diagnosis rule: bad recall@k → fix chunking/embeddings/hybrid (step 2–5); good recall but bad answer → fix the grounding prompt (step 6) or model. Optimizing blindly without splitting these wastes days.

8. **Tune cost/latency last, once relevant.** Cache query embeddings (same question hits often). Persist doc embeddings — never re-embed on every run. Drop `ef_search`/top-k until recall@k degrades, then back off one notch. Consider a smaller embedding dim only after confirming recall holds. Add a cheap query-router so trivial lookups skip the reranker.

## Common Errors

- **Query/doc embedding model mismatch** — docs embedded with model A, queries with model B (or different version). Vectors live in different spaces; recall craters with zero errors thrown. Pin one model id everywhere and assert it at query time.
- **Metric mismatch** — embedded normalized for cosine but index configured for L2/inner product (or vice versa). Returns plausible-but-wrong neighbors silently. Set the index metric explicitly to match your normalization.
- **Mid-function / mid-sentence chunks** — fixed character splitting cuts a function or sentence in half; each half embeds to a meaningless vector that never retrieves. Always split on structural boundaries.
- **Filtering after retrieval** — fetching top-k then filtering by date/source leaves you with 1–2 rows when most of the top-k got filtered out. Push filters into the vector query (pre-filter).
- **Lost context on chunks** — a chunk says "it supports this" with no idea what "it" is. Prepend the doc title + heading path to each chunk so it's self-contained.
- **Re-embedding everything on each index run** — burns API cost and time for unchanged docs. Hash chunks and skip unchanged ones.
- **No "I don't know" path** — without an explicit refuse-when-no-context instruction, the model fabricates fluently from its weights. The grounding prompt must license abstention.
- **Tuning against a single number** — chasing end-to-end accuracy while retrieval recall is the real bottleneck (or vice versa). Always split the two metrics before tuning.
- **Stale index treated as fresh** — corpus changed, index didn't; users get confidently outdated answers. Track `updated_at` and re-index or filter on freshness.

## Verify

1. **Sanity probe:** embed one known query, fetch top-5, eyeball that the expected source chunk is present. If not, stop — embedding/metric is broken, nothing downstream matters.
2. **Recall@k on the labeled set:** run all example questions, confirm the gold chunk lands in top-k for a clear majority. Below target → revisit chunking/hybrid/rerank, not the prompt.
3. **Grounding check:** ask a question whose answer is NOT in the corpus. A correct pipeline refuses or says it lacks context — it must not fabricate.
4. **Citation check:** every claim in a sample of answers maps to a retrieved `[n]` chunk; no uncited assertions.
5. **Idempotent re-index:** run indexing twice on an unchanged corpus — second run re-embeds ~nothing (hash cache working) and produces an identical index.
6. **Latency/cost budget:** end-to-end p95 latency and per-query cost are within target with caching on.
