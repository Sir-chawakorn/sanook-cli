---
tags: [project, context, sanook-cli]
note_type: project-context
created: 2026-06-20
updated: 2026-06-20
parent: "[[Projects/sanook-cli/_Index]]"
---

> Stable AI context — architecture, conventions, and gotchas before editing Sanook CLI code.

# Context — Sanook CLI

> สิ่งที่ AI ต้องรู้ก่อนแตะโค้ด

## Architecture

- **Entry:** `src/bin.ts` → CLI routing; `src/loop.ts` → agent loop (Vercel AI SDK)
- **Brain:** `src/memory.ts`, `src/brain-*.ts`, `src/project-registry.ts` — vault context + project detect
- **Search:** `src/search/` — BM25 + optional semantic; indexes vault + memory + sessions + skills
- **Bundled vault:** `second-brain/` ships with npm; user `brainPath` usually points here or a copy

## Conventions

- Branch: `main`
- Verify: `npm run typecheck && npm test` (1210+ tests)
- Commit style: complete sentences, focus on why
- Minimize diff scope; match existing TS patterns; Thai comments OK in CLI strings

## Gotchas

- `brainPath` in `~/.sanook/config.json` — brain CLI commands need it configured
- Bundled vault path in repo: `second-brain/` (not only user's external vault)
- `loadBrainContext(cwd)` auto-injects matching `Projects/<slug>/` when cwd is inside `repo_path`

up:: [[Projects/sanook-cli/_Index]]
