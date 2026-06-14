---
tags: [eval, retrieval, quality]
note_type: reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Evals/_Index]]"
---

# Retrieval-Quality Eval (โหลดโน้ตถูกตัวไหม)

> Evals ทั่วไปวัด **output** — อันนี้วัด **retrieval** (โหลด context ถูกหรือเปล่า) → ปิด loop ของ [[Shared/Rules/context-assembly-policy]]
> หลักฐาน: RAG eval (Precision@k, faithfulness/grounding 0/1) · Self-RAG

## หลังงานไม่ trivial — log 4 field (binary)

| field | คำถาม |
|---|---|
| `retrieval_hit` | โน้ตที่ต้องใช้อยู่ใน context ไหม? (y/n) |
| `wrong_context_loaded` | ดึง distractor มาด้วยไหม? (y/n) |
| `grounding_ok` | คำตอบอิงโน้ตที่โหลดจริงไหม? (y/n) |
| `retrieval_path_len` | กี่ hop กว่าจะเจอ |

## Failure → taxonomy

- `retrieval-miss` (ของที่ต้องใช้ไม่ถูกโหลด) → correction-pair: แก้ index/link ให้เจอง่ายขึ้น
- `distractor-pulled` (ดึงของไม่เกี่ยว) → correction-pair: ตัด/archive ของที่ทำให้สับสน

> ทำใน [[Runbooks/sleep-time-consolidation]] step 5 ด้วย

up:: [[Evals/_Index]]
