---
tags: [eval, rubric, self-eval]
note_type: reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Evals/_Index]]"
---

# Self-Eval Rubric (binary)

> เกณฑ์ที่ AI ใช้ตรวจงานตัวเองก่อน ship — ตอบ y/n ต่อข้อ (ไม่ใช่คะแนน 1-10 — binary ชัดกว่า)

## ก่อน ship เช็ก

- [ ] grounded — คำตอบอิงโน้ต/ไฟล์จริงที่อ่าน (ไม่แต่ง)?
- [ ] retrieval_hit — โหลด context ที่ต้องใช้ครบ?
- [ ] verified — path/link/fact ที่อ้าง verify แล้ว (§11)?
- [ ] scope — ตอบตรงที่ถาม ไม่เกิน/ไม่ขาด?
- [ ] format — ตรง preference เจ้าของ (กระชับ/ตาราง)?

> ข้อไหนตอบ "n" → แก้ก่อน ship · failure ซ้ำ → จัดเข้า [[Evals/failure-taxonomy]] + [[Evals/correction-pairs]]

up:: [[Evals/_Index]]
