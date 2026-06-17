---
tags: [context-pack, second-brain, maintenance]
note_type: context-pack
created: 2026-06-17
updated: 2026-06-17
parent: "[[Shared/Context-Packs/_Index]]"
---

# Context Pack: Second-Brain Maintenance

> Use when editing vault structure, routing rules, memory policy, indexes, runbooks, or agent adapters.

## Load Order

1. [[Shared/AI-Context-Index]]
2. [[Runbooks/ai-second-brain-operating-sequence]]
3. [[Vault Structure Map]]
4. [[Shared/Rules/context-assembly-policy]]
5. Destination `_Index.md`
6. [[Shared/Rules/memory-write-protocol]] if changing memory/facts
7. [[Evals/second-brain-benchmarks]] before and after framework edits

## Required Role

- Primary: Librarian
- Secondary: Scientist

## Output Artifacts

- Updated target note/index
- Quality/evidence note when non-trivial: [[Evals/quality-ledger]] or [[Sessions/_Index]]
- No new root folder unless [[Vault Structure Map]] is updated and drift tests are considered

## Done Criteria

- New/changed notes have `parent` and `up::`
- Index links make the artifact discoverable
- Benchmark or explicit verification is recorded
- Context bloat is checked; do not preload every rule

up:: [[Shared/Context-Packs/_Index]]
