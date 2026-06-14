---
tags: [index, durable-index, ai-context]
note_type: durable-index
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/_Index]]"
ai_surface: hot
---

# AI Context Index — Single Retrieval Path

> **ไฟล์ที่ AI อ่านก่อนเสมอ** (§1) — ได้ context ครบในไฟล์เดียว แล้วค่อยเดินลิงก์ไปลึก

## Folder Map (ของชนิดนี้เก็บที่ไหน)

> **อ่านก่อนสร้าง/ย้ายโน้ตทุกครั้ง** → [[Vault Structure Map]] — แผนที่ครบ 36 โฟลเดอร์ (role + ใส่อะไร + ห้ามใส่อะไร)

## Quick Identity

- เจ้าของ: **{{OWNER_NAME}}** · AI = {{AI_NAME}} ({{AI_PRONOUN}}) · ภาษา {{LANGUAGE}} · โทน {{TONE}}
- Autonomy: **{{AUTONOMY}}** — ดู `CLAUDE.md` / `GEMINI.md` / `AGENTS.md`

## Default Retrieval Path (อ่านตามลำดับเท่าที่ต้องการ)

1. [[USER]] — เจ้าของเป็นใคร
2. [[Shared/Operating-State/current-state]] — ตอนนี้โฟกัสอะไร
3. [[Shared/User-Memory/user-preferences]] — ชอบ/ไม่ชอบอะไร
4. [[Shared/Decision-Memory/decision-log]] — ตัดสินใจอะไรไปแล้ว
5. งาน project → [[Projects/_Index]] → overview → context → current-state

## Memory Routing (เจออะไร เก็บที่ไหน — §4)

| สิ่งที่พบ | → |
|---|---|
| preference ใหม่ | [[Shared/User-Memory/user-preferences]] |
| decision สำคัญ | [[Shared/Decision-Memory/decision-log]] |
| ยังไม่ชัด/ขัดกัน | [[Shared/Memory-Inbox/memory-inbox]] |
| invariant truth | [[Shared/Core-Facts/protected-facts]] |
| entity/person/org page | `Entities/<name>.md` |
| อื่นๆ / ไม่แน่ใจว่าโฟลเดอร์ไหน | [[Vault Structure Map]] |

## Framework Rules (โหลดตาม task — ดู CLAUDE.md §19)

- **ก่อนประกอบ context เสมอ** → [[Shared/Rules/context-assembly-policy]] (head/tail + budget, กัน context-rot)
- ingest ของนอก → [[Runbooks/ingest-quarantine]] · fact → [[Shared/Rules/frontmatter-standard]] (bi-temporal + `source::`)
- script ทำซ้ำ → [[Shared/Rules/skills-admission]] (Skills/) · consolidate → [[Runbooks/sleep-time-consolidation]]

## Current Snapshot

_(อัปเดตเมื่อ priority เปลี่ยน — ดู [[Shared/Operating-State/current-state]])_

up:: [[Shared/_Index]]
