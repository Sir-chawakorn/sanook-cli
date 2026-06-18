---
tags: [session, session-log, sanook-cli, second-brain, correction]
note_type: session-log
created: 2026-06-18
updated: 2026-06-18
parent: "[[Sessions/_Index]]"
ai_surface: history
---

# 2026-06-18 — Sanook CLI Second-Brain Roadmap Correction

> Correction session after owner clarified that the target is Sanook CLI, not Hermes CLI. Captures the Sanook-native direction and leaves Hermes research as reference only.

## Summary

Reframed the previous Hermes-heavy research into a Sanook CLI roadmap. Sanook already has `brain init`, vault context injection, memory routing, index/search, and MCP serving, so the next useful work is CLI features: `brain doctor`, `brain context`, `brain eval`, and later `brain review`.

## What Was Tried

- Read `src/brain.ts`, `src/bin.ts`, `src/commands.ts`, `src/doctor.ts`, `src/knowledge.ts`, and `second-brain/SANOOK.md`.
- Checked current command surface for `brain init`, `index`, `search`, MCP, and memory behavior.
- Created a Sanook project workspace note under `Projects/sanook-cli/`.

## Errors

- Initial research over-weighted Hermes-specific implementation because the earlier wording mentioned Hermes CLI.

## Solutions

- Added [[Projects/sanook-cli/second-brain-feature-roadmap]] as the corrected implementation roadmap.
- Left Hermes research as a compatibility reference, not the main next action.

## Key Decisions

- Do not add `HERMES.md` as the next step for this objective.
- First Sanook-native slice should be `sanook brain doctor`.

## Files Changed

- `second-brain/Projects/_Index.md`
- `second-brain/Projects/sanook-cli/_Index.md`
- `second-brain/Projects/sanook-cli/second-brain-feature-roadmap.md`
- `second-brain/Sessions/_Index.md`
- `second-brain/Sessions/2026-06-18-sanook-cli-second-brain-roadmap-correction.md`
- `second-brain/Shared/Operating-State/current-state.md`
- `second-brain/Research/2026-06-18-hermes-cli-second-brain-expansion-research.md`

## Next Steps

- [ ] Implement `sanook brain doctor`.
- [ ] Then implement `sanook brain context [--task]`.
- [ ] Then implement `sanook brain eval`.

up:: [[Sessions/_Index]]
