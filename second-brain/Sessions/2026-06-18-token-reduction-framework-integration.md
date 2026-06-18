---
tags: [session, token-reduction, sanook-cli, ai-agent]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 - Token Reduction Framework Integration

> Session log for researching GitHub token-reduction frameworks and integrating a safe default into Sanook CLI.

## Summary

- Compared GitHub frameworks/patterns: Microsoft LLMLingua, Selective Context, and Headroom.
- Chose a Sanook-native selective context compressor as the default because it works without Python, model downloads, proxy services, or extra keys.
- Added `contextCompression: selective | headroom | off` with `SANOOK_CONTEXT_COMPRESSION`.
- Integrated the actual `headroom-ai` Vercel AI SDK adapter as an optional framework mode.
- Improved local selective mode with query-aware scoring and adaptive budgets for older stale tool outputs.
- Wired selective compression into the Vercel AI SDK `prepareStep` path, targeting stale huge tool outputs only.

## What Was Tried

- Inspected Sanook's existing token controls: prompt cache, auto-compaction, summarize-compaction, subagents, read ranges, output truncation.
- Checked `headroom-ai` npm package and Vercel AI adapter.
- Decided not to require Headroom by default because direct compression requires a proxy/cloud key, but added opt-in support.

## Errors

- A first patch to `selectivelyCompressStaleToolResults()` returned too early and left unreachable code; fixed by returning the mapped output only when a change occurred.
- A broad test patch missed exact context; re-applied as focused patches.

## Solutions

- Added `src/context-compression.ts` with `selectiveCompressText()`.
- Added `selectivelyCompressStaleToolResults()` in `src/compaction.ts`.
- Updated `src/loop.ts` to apply selective compression before `autoCompact()`.
- The compressor now uses the latest user message to boost relevant lines and spends fewer chars on older stale tool results.
- Updated config schema, env parsing, CLI validation, README, changelog, and tests.
- Added `headroom-ai` as a dependency for optional framework-backed compression.

## Key Decisions

- Preserve recent tool results fully.
- Compress only stale large tool output, not user intent or recent evidence.
- Keep this zero-LLM by default; use Headroom only when the user opts into a proxy/cloud setup.

## Files Changed

- `src/context-compression.ts`
- `src/context-compression.test.ts`
- `src/compaction.ts`
- `src/compaction.test.ts`
- `src/config.ts`
- `src/config.test.ts`
- `src/loop.ts`
- `src/bin.ts`
- `README.md`
- `CHANGELOG.md`
- `second-brain/Research/2026-06-18-ai-token-reduction-frameworks.md`

## Next Steps

- Run typecheck and tests.
- Benchmark local selective mode with real multi-step traces.
- Smoke test Headroom mode against a real proxy/cloud setup when credentials are available.

up:: [[Sessions/_Index]]
