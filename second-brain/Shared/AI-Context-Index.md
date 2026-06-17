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

> **อ่านก่อนสร้าง/ย้ายโน้ตทุกครั้ง** → [[Vault Structure Map]] — แผนที่ครบทุกโฟลเดอร์ (role + ใส่อะไร + ห้ามใส่อะไร)

## Quick Identity

- เจ้าของ: **{{OWNER_NAME}}** · AI = {{AI_NAME}} ({{AI_PRONOUN}}) · ภาษา {{LANGUAGE}} · โทน {{TONE}}
- Autonomy: **{{AUTONOMY}}** — ดู `CLAUDE.md` / `GEMINI.md` / `AGENTS.md`

## Default Retrieval Path (อ่านตามลำดับเท่าที่ต้องการ)

1. [[USER]] — เจ้าของเป็นใคร
2. [[Shared/Operating-State/current-state]] — ตอนนี้โฟกัสอะไร
3. [[Shared/User-Memory/user-preferences]] — ชอบ/ไม่ชอบอะไร
4. [[Shared/Decision-Memory/decision-log]] — ตัดสินใจอะไรไปแล้ว
5. งาน project → [[Projects/_Index]] → overview → context → current-state

## Best AI Operating Sequence

> default สำหรับงานไม่ trivial: [[Runbooks/ai-second-brain-operating-sequence]]

**Frame → Retrieve → Role → JIT Rules → Act → Write → Eval → Consolidate**

- เริ่มด้วย hot path ด้านบนเสมอ
- เลือกบทบาท AI ก่อนลงมือ: Scientist / Cartographer / Librarian / Operator / Editor / Archivist
- ถ้ามี pack ตรงงาน ให้ใช้ [[Shared/Context-Packs/_Index]] แทนการประกอบ context ใหม่จากศูนย์
- โหลด rule/runbook เฉพาะ task นั้นแบบ JIT; อย่าโหลดทั้ง vault
- งาน framework/หลาย session/แก้ durable memory ให้ eval และบันทึก evidence

## Taste & Benchmarks

- owner-facing tone/examples → [[Shared/User-Memory/response-examples]]
- framework quality checks → [[Evals/second-brain-benchmarks]]

## Default Write Path (ก่อนสร้าง/แก้โน้ต)

1. Classify artifact: project work, session log, decision, preference, source, reusable skill, runbook, or temporary scratch
2. อ่าน [[Vault Structure Map]] เพื่อเลือก canonical home เพียงที่เดียว
3. เปิด `_Index.md` ของโฟลเดอร์ปลายทาง แล้วทำตาม **AI Routing Contract**
4. Search ก่อนเขียน: ถ้า note เดิมมีอยู่แล้วให้ merge/update ไม่ append ซ้ำ
5. หลังเขียน: ใส่ `parent` + `up::`, link กลับ project/session/source/decision ที่เกี่ยวข้อง, แล้วบันทึก evidence ที่ verify แล้ว

## Memory Routing (เจออะไร เก็บที่ไหน — §4)

| สิ่งที่พบ | → |
|---|---|
| preference ใหม่ | [[Shared/User-Memory/user-preferences]] |
| decision สำคัญ | [[Shared/Decision-Memory/decision-log]] |
| priority/current focus เปลี่ยน | [[Shared/Operating-State/current-state]] |
| session checkpoint / งานจบ | `Sessions/YYYY-MM-DD-<topic>.md` |
| ยังไม่ชัด/ขัดกัน | [[Shared/Memory-Inbox/memory-inbox]] |
| invariant truth | [[Shared/Core-Facts/protected-facts]] |
| finding ที่อิง source ภายนอก | `Research/<topic>.md` + `source::` |
| scratch ระหว่างงานเดียว | `Shared/Working-Memory/<topic>.md` |
| expected output fixture | [[Acceptance/golden-case-template]] |
| pre/postflight gate | [[Checklists/preflight-postflight-template]] |
| entity/person/org page | `Entities/<name>.md` |
| อื่นๆ / ไม่แน่ใจว่าโฟลเดอร์ไหน | [[Vault Structure Map]] |

## Framework Rules (โหลดตาม task — ดู CLAUDE.md §19)

- **งานไม่ trivial ทุกงาน** → [[Runbooks/ai-second-brain-operating-sequence]] (Scientific Loop Sequence + roles)
- **งานซ้ำ/task family ชัดเจน** → [[Shared/Context-Packs/_Index]] (ใช้ context pack แทน assemble ใหม่)
- **ก่อน/หลังแก้ framework** → [[Evals/second-brain-benchmarks]] (วัดว่าดีขึ้นจริงไหม)
- **ก่อนประกอบ context เสมอ** → [[Shared/Rules/context-assembly-policy]] (head/tail + budget, กัน context-rot)
- ingest ของนอก → [[Runbooks/ingest-quarantine]] · fact → [[Shared/Rules/frontmatter-standard]] (bi-temporal + `source::`)
- script ทำซ้ำ → [[Shared/Rules/skills-admission]] (Skills/) · consolidate → [[Runbooks/sleep-time-consolidation]]
- หลาย agent ทำพร้อมกัน → อ่าน [[Shared/Coordination/NOW]] ก่อนแตะ vault · เขียน/แก้ fact → [[Shared/Rules/memory-write-protocol]] (ADD/UPDATE/DELETE/NOOP)
- สร้าง durable note ใหม่ → [[Shared/Rules/contextual-note-rule]] + [[Shared/Rules/rules-formatting]]
- ทำ runbook/procedure → [[Shared/Rules/procedural-runbook-header]]
- งาน technical/release → [[Shared/Tech-Standards/verification-standard]]
- งานหลาย session/หลาย agent → overview [[Shared/Coordination/task-board]] · task cards [[Shared/Coordination/task-board/_Index]] · registry [[Shared/Coordination/agent-registry]]
- acceptance/checklist/entity ใหม่ → [[Acceptance/golden-case-template]] · [[Checklists/preflight-postflight-template]] · [[Entities/entity-template]]

## Current Snapshot

_(อัปเดตเมื่อ priority เปลี่ยน — ดู [[Shared/Operating-State/current-state]])_

up:: [[Shared/_Index]]
