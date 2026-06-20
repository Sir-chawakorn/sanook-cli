---
tags: [operating-state, current-state]
note_type: operating-state
created: {{DATE}}
updated: 2026-06-20
parent: "[[Shared/Operating-State/_Index]]"
ai_surface: starter
---

# 🎯 Current State — {{OWNER_NAME}}

> ตอนนี้กำลังโฟกัสอะไร (AI อ่านเพื่อรู้ context "ปัจจุบัน" — อัปเดตเมื่อ priority เปลี่ยน)

## Now

- 2026-06-20: **Sanook CLI 0.5.3** shipped — brain pack/new/repair/consolidate/metrics, MCP safety, gateway doctor, project workspace auto-detect
- 2026-06-20: Multi-project strategy — ใช้ vault เดียว, โฟลเดอร์ `Projects/<slug>/` ต่อ repo จริง (`repo_path` ใน `repo.md`)
- 2026-06-18: Sanook-native brain CLI P0/P1 complete (doctor, context, eval, review, final)

## Active Bets

- **Projects/ as single portfolio hub** — AI รู้ project จาก cwd ไม่ต้องเดา
- Scientific Loop Sequence + context packs + final gate ลด claim-done เกินจริง
- Token/cost ลดจาก stale tool compression ก่อน ไม่บีบ user intent

## Active Project

- [[Projects/sanook-cli/current-state]] — primary focus (Sanook CLI itself)

## Blockers

_(ติดอะไรอยู่)_

## Next Actions

- [ ] เพิ่ม project workspace ถัดไปด้วย `sanook brain new project --title "..." --repo /path`
- [ ] Dogfood `sanook brain context` จาก cwd ของแต่ละ repo
- [ ] Weekly `sanook brain consolidate --apply` + `sanook index`

up:: [[Shared/Operating-State/_Index]]
