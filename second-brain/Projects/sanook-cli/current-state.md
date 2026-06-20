---
tags: [project, operating-state, sanook-cli]
note_type: project-state
status: active
created: 2026-06-20
updated: 2026-06-20
parent: "[[Projects/sanook-cli/_Index]]"
---

> Live project status — update when NOW / blockers / next actions change.

# Current State — Sanook CLI

> สถานะ project ปัจจุบัน (อัปเดตเมื่อ priority/blocker เปลี่ยน)

## Now

- 2026-06-20: Release **0.5.3** — brain pack/new/repair/consolidate/metrics, MCP enable/risk, gateway doctor, web_fetch, sanook init, TUI session/transcript polish
- 2026-06-20: **Project workspace auto-detect** — cwd ↔ `Projects/<slug>/repo.md` injects hot project context into agent prompt
- Active focus: multi-project vault under `Projects/` as single Sanook brain for all repos

## Blockers

_(none)_

## Next

- [ ] Dogfood project auto-detect on every repo under `Projects/`
- [ ] Add next project workspace with `sanook brain new project --title "..." --repo /path`
- [ ] Scheduled `sanook brain consolidate --apply` (weekly hook)

up:: [[Projects/sanook-cli/_Index]]
