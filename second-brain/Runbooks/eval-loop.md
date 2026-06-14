---
tags: [runbook, eval, loop]
note_type: runbook
created: {{DATE}}
updated: {{DATE}}
parent: "[[Runbooks/_Index]]"
---

# Runbook: Eval Loop (driver ของ Evals/)

> รัน quality loop — error-analysis + binary self-eval + Reflexion → ของที่ Evals/ เก็บไว้ถูกใช้จริง

## Steps

1. **Self-eval** — หลังงานไม่ trivial: ตอบ [[Evals/self-eval-rubric]] (binary y/n)
2. **Log** — บันทึกผลลง [[Evals/quality-ledger]] (append)
3. **Classify failure** — ข้อที่ "n" → จัดเข้า [[Evals/failure-taxonomy]] (หรือเพิ่มหมวด)
4. **Correction pair** — เขียน ❌→✅ + บทเรียนลง [[Evals/correction-pairs]]
5. **Promote** — บทเรียนที่เห็น ≥3 ครั้ง → [[Playbooks/_Index]] (tactic) หรือ [[Distillations/_Index]] (principle)
6. **Regression** — เทียบกับ [[Evals/golden-set]] ว่าไม่ทำพังของที่เคยถูก

> ทำเป็นส่วนหนึ่งของ [[Runbooks/sleep-time-consolidation]] (รอบ) หรือ ad-hoc หลังงานสำคัญ

up:: [[Runbooks/_Index]]
