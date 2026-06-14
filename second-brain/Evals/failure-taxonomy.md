---
tags: [eval, failure-taxonomy]
note_type: reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Evals/_Index]]"
---

# Failure Taxonomy

> ประเภทของ "ความผิดพลาด" ที่ AI ทำ — จัดหมวดเพื่อแก้ที่ root cause ไม่ใช่ราย case
> เจอ failure → จัดเข้าหมวด (หรือเพิ่มหมวดใหม่) → ทำ correction-pair (ดู [[Evals/correction-pairs]])

## Modes

| mode | คือ | ตัวอย่าง | แก้ที่ |
|---|---|---|---|
| retrieval-miss | โน้ตที่ต้องใช้ไม่ถูกโหลด | ตอบโดยไม่เห็น current-state | index/link ให้เจอง่ายขึ้น |
| distractor-pulled | ดึงโน้ตไม่เกี่ยวมา | สับสนเพราะ stale note | archive/ตัด distractor |
| hallucination | แต่งข้อมูลที่ verify ไม่ได้ | อ้าง path/fact ที่ไม่มี | §11 verification gate |
| over-engineering | ทำเกินจำเป็น | สร้าง machinery ที่ไม่มีคนใช้ | "Done > Perfect" |
| _(เพิ่มหมวดเมื่อเจอ pattern ใหม่)_ | | | |

up:: [[Evals/_Index]]
