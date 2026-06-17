---
tags: [index, moc, evals]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Home]]"
---

# Evals

> quality loop (runner + ผล) — error-analysis + self-eval

## ใส่ที่นี่
failure-taxonomy/self-eval-rubric/golden-set/correction-pairs/quality-ledger/benchmarks

## ไม่ใส่ที่นี่
golden case เอง (→Acceptance)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Evals/_Index]]"` และท้ายไฟล์ `up:: [[Evals/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

## Evaluation Assets

- [[Evals/second-brain-benchmarks]] — benchmark set สำหรับวัดว่า AI ใช้ vault/framework ได้ดีขึ้นจริงไหม
- [[Evals/self-eval-rubric]] — binary self-eval หลังงานไม่ trivial
- [[Evals/retrieval-eval]] — eval ว่าโหลด context ถูกตัวไหม
- [[Evals/quality-ledger]] — ledger ผล eval ตามเวลา
- [[Evals/failure-taxonomy]] — taxonomy ของ failure
- [[Evals/correction-pairs]] — ❌→✅ examples + lessons
- [[Evals/golden-set]] — curated golden set

up:: [[Home]]
