---
tags: [runbook, consolidation, memory, review]
note_type: runbook
created: {{DATE}}
updated: {{DATE}}
parent: "[[Runbooks/_Index]]"
---

# Runbook: Sleep-Time Consolidation (จัดระเบียบความจำตอนว่าง)

> งาน offline (เช่น รายวัน/รายสัปดาห์) ที่กลั่น raw → learned แทนที่จะทำกลางบทสนทนา
> หลักฐาน: Letta sleep-time compute · Mem0 ADD/UPDATE/DELETE/NOOP

## Steps

1. **Route inbox** — เคลียร์ `[[Shared/Memory-Inbox/memory-inbox]]` → promote เข้า durable (User-Memory / Decision-Memory / Entities) หรือ discard · ตัดสิน op: ADD/UPDATE/DELETE/NOOP (Merge, Don't Append)
2. **Dedup + merge** — รวมโน้ตซ้อน · เจอ fact ขัดกัน → bi-temporal supersede (ดู [[Shared/Rules/frontmatter-standard]])
3. **Stale → Archive** — โน้ตเลย `stale_after` + ไม่ถูกแตะนาน + low-action → **flag → ถามก่อน → ย้ายเข้า `[[Shared/Archive]]`** (ออกจาก retrieval, ไม่ลบ · Core-Facts ยกเว้น)
4. **Pattern → promote** — เห็น pattern ≥3 ครั้ง → tactic/heuristic ที่ปรับดีขึ้นเรื่อยๆ → `Playbooks/` · principle ที่กลั่นนิ่งแล้ว → `Distillations/`
5. **Retrieval check** — รัน [[Evals/retrieval-eval]] กับงานล่าสุด → failure เข้า failure-taxonomy

## หลักการ
- step 3 = ปิด decay loop (signal `stale_after` มีอยู่ แต่ต้องมี "action" ย้ายจริง ไม่งั้น stale = distractor)
- ทุก destructive move ถามก่อน (§10)

up:: [[Runbooks/_Index]]
