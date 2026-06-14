---
tags: [rule, frontmatter, standard]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
---

# Frontmatter Standard (+ bi-temporal validity + provenance)

> field มาตรฐานของทุกโน้ต + 2 ระบบใหม่: **bi-temporal** (รู้ว่า fact ยังจริงไหม) + **provenance** (รู้ว่า fact มาจากไหน)

## Core fields (ทุกโน้ต)
`tags` · `note_type` · `created` · `updated` · `parent` + ท้ายไฟล์ `up:: [[parent/_Index]]`

## Bi-temporal validity (fact notes: Core-Facts / Decision-Memory / Entities)

| field | ความหมาย |
|---|---|
| `valid_from:` | YYYY-MM-DD ที่ fact เริ่มจริง |
| `invalidated_at:` | ว่าง = ยังจริง · มีค่า = เลิกจริงตั้งแต่วันนั้น |
| `status:` | `active` (ความจริงปัจจุบัน) \| `superseded` |
| `superseded_by::` | `[[note ใหม่]]` ที่มาแทน |

**กฎ (ขยาย DELETE op ของ memory-write):** เจอ fact ขัดกัน → **อย่าทับเงียบ** → stamp อันเก่า `invalidated_at` + `status: superseded` + `superseded_by` แล้วสร้างอันใหม่ที่ใส่ `supersedes:: [[เก่า]]` กลับ → ทำให้แยก "เคยจริง" ออกจาก "ผิดมาตลอด" ได้ (history queryable ผ่าน git ด้วย)

## Provenance (derived/ingested claim notes)

- `source::` = wikilink/URL/path ของ **แหล่งจริงต่อ claim** (ต่างจาก `source_quality` ที่เป็นแค่ tier A/B/C)
- ทุก `source::` ต้อง resolve ไปยังบรรทัดใน `[[Shared/Provenance/ingest-log]]` หรือไฟล์ใน `Intake/Raw Sources/`
- ไม่มี source resolvable = verification gate (§11) ไม่ผ่าน

up:: [[Shared/Rules/_Index]]
