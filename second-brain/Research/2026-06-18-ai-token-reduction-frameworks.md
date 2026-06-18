---
tags: [research, token-reduction, ai-agent, sanook-cli]
note_type: research
created: 2026-06-18
updated: 2026-06-18
parent: "[[Research/_Index]]"
source:
  - https://github.com/microsoft/LLMLingua
  - https://github.com/liyucheng09/Selective_Context
  - https://github.com/chopratejas/headroom
---

# AI Token Reduction Frameworks for Sanook CLI

> Research note for choosing a token-reduction framework/pattern to integrate into Sanook CLI.

## Candidates

- Microsoft LLMLingua: strong prompt-compression family, but Python/model-heavy for a Node CLI default.
- Selective Context: removes low-information lexical units; good fit for a zero-LLM local compressor.
- Headroom: TypeScript package with Vercel AI SDK adapter, but direct compression requires a running proxy or cloud API key.

## Decision

Use a Sanook-native zero-dependency selective context compressor as the default, and expose Headroom as an optional framework mode.

Rationale:

- Works by default without a Python runtime, model download, proxy, or extra API key.
- Fits the current Sanook architecture because the biggest waste is stale tool output in multi-step agent loops.
- Keeps recent tool results full, preserving local correctness while reducing old transcript bloat.
- Lets users opt into the actual `headroom-ai` Vercel AI SDK adapter when they have a Headroom proxy/cloud compression layer.

## Implementation Shape

- New `contextCompression` config: `selective` (default), `headroom`, or `off`.
- `SANOOK_CONTEXT_COMPRESSION=off` disables it.
- `SANOOK_CONTEXT_COMPRESSION=headroom` wraps the Vercel AI SDK model with `headroom-ai/vercel-ai`.
- `SANOOK_HEADROOM_BASE_URL` and `SANOOK_HEADROOM_API_KEY` can point Sanook at the user's Headroom setup.
- `selectiveCompressText()` keeps head/tail anchors and high-information lines:
  - current user-query matches
  - errors, warnings, failures, tracebacks
  - file paths and line numbers
  - diffs and code structure
  - headings / JSON-like structure
  - rare lexical terms
- `selectivelyCompressStaleToolResults()` applies it only to old large tool outputs before each model step.
- Older stale tool outputs get tighter budgets; the newest tail remains full.

## Verification

- Unit tests cover preservation of query matches, errors, code/diff structure, unchanged short text, stale-tool compression, recency budgets, and recent-tail preservation.
- Full validation still needs `typecheck`, full test suite, and build after implementation.

up:: [[Research/_Index]]
