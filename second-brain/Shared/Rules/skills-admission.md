---
tags: [rule, skills, verification]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
---

# Skills Admission Gate (verified-only)

> `Skills/` = คลังของที่ทำซ้ำได้ (script / command sequence / tool snippet) ที่ **พิสูจน์แล้วว่ารันได้**
> หลักฐาน: Voyager (arXiv 2305.16291) — skill library ที่ไม่มี verification gate จะสะสม buggy code แล้วพังในที่สุด

## Admission rule (HARD gate)

candidate เข้า `Skills/` ได้ **ก็ต่อเมื่อ** รัน verification command แล้ว **ผ่านจริง** — ไม่งั้นค้างที่ `Memory-Inbox/`

## Skill note ต้องมี

| field | ความหมาย |
|---|---|
| `skill_id` | ชื่อสั้น unique |
| `signature` | input → output |
| `verification` | คำสั่งที่ใช้พิสูจน์ + ผลที่คาด |
| `verified_on` | YYYY-MM-DD ที่ผ่านล่าสุด |
| `load_when` | trigger ที่ควรหยิบ skill นี้มาใช้ |

> ต่างจาก `Runbooks/` (prose how-to) + `Playbooks/` (tactic) — `Skills/` = unit ที่ "รันได้" + ผ่าน test

up:: [[Shared/Rules/_Index]]
