---
tags: [session, session-log, second-brain, hermes, research]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 — Hermes Second-Brain Expansion Research

> Session log for the research pass on what to add to this second-brain for Hermes CLI support. Links to the sourced research note and leaves implementation as a next step.

## Summary

Researched Hermes Agent docs, context engineering guidance, agent memory papers, LangGraph memory concepts, and PARA. Main conclusion: avoid many new root folders; prioritize Hermes-specific adapter/context, memory sync policy, atomic benchmarks, golden fixtures, and scheduled vault-health reviews.

## What Was Tried

- Read current vault map, AI context index, evals index, context packs index, user memory index, and operating sequence.
- Checked current worktree status and avoided unrelated CLI/search changes.
- Searched current Hermes docs for context files, persistent memory, skills, and curator behavior.
- Compared with external agent-memory/context sources.

## Errors

- Some docs pages were rendered HTML-heavy; raw GitHub markdown for Hermes docs was easier to inspect.

## Solutions

- Added [[Research/2026-06-18-hermes-cli-second-brain-expansion-research]] as the durable research note with source URLs and prioritized recommendations.

## Key Decisions

- No taxonomy folders were created yet.
- Recommended next build is `HERMES.md` plus a small Hermes-specific shared policy area before wider taxonomy changes.

## Files Changed

- `second-brain/Research/2026-06-18-hermes-cli-second-brain-expansion-research.md`
- `second-brain/Sessions/2026-06-18-hermes-second-brain-expansion-research.md`
- `second-brain/Research/_Index.md`
- `second-brain/Sessions/_Index.md`
- `second-brain/Shared/Operating-State/current-state.md`

## Next Steps

- [ ] Decide whether to implement the recommended Hermes bundle.
- [ ] If adding folders, update `Vault Structure Map.md` and `src/brain.ts` together.
- [ ] If only adding files under existing folders, keep taxonomy unchanged.

up:: [[Sessions/_Index]]
