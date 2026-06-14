---
tags: [rule, review, staleness]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
---

# Review & Staleness Policy

> เมื่อไหร่ทบทวน + เมื่อไหร่โน้ต "หมดอายุ" → ปิด decay loop (ดู [[Runbooks/sleep-time-consolidation]])

## Cadence
- **Daily:** session log เฉพาะวันมีงาน
- **Weekly:** เคลียร์ Memory-Inbox · promote durable · lint (orphan/dead-link/frontmatter)
- **Monthly:** vault health audit + เก็บกวาด stale

## Staleness
- โน้ตควรมี `review_date` / `stale_after` (โน้ตที่เปลี่ยนตามเวลา)
- เลย `stale_after` + ไม่ถูกแตะนาน + low-action → **flag → ถามก่อน → ย้าย [[Shared/Archive]]** (ไม่ลบ · Core-Facts ยกเว้น)

up:: [[Shared/Rules/_Index]]
