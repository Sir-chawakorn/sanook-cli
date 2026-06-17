---
tags: [index, moc, runbooks]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Home]]"
---

# Runbooks

> prose how-to ที่อ่านแล้วทำตามเอง

## ใส่ที่นี่
ขั้นตอน setup/deploy/maintain + loop driver

## ไม่ใส่ที่นี่
runnable unit (→Skills)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Runbooks/_Index]]"` และท้ายไฟล์ `up:: [[Runbooks/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

## Runbooks

- [[Runbooks/ai-second-brain-operating-sequence]] — default sequence สำหรับ AI ทำงานกับ vault จากผลทดลอง 2026-06-17
- [[Runbooks/eval-loop]] — quality loop หลังงานไม่ trivial
- [[Runbooks/ingest-quarantine]] — gate สำหรับข้อมูลภายนอก/untrusted content
- [[Runbooks/sleep-time-consolidation]] — consolidate memory เป็นรอบ

up:: [[Home]]
