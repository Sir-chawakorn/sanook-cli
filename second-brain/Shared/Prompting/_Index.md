---
tags: [index, moc, prompting]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/_Index]]"
---

# Prompting

> prompt-engineering pattern (style/structure)

## ใส่ที่นี่
pattern การเขียน prompt ที่ reuse

## ไม่ใส่ที่นี่
prompt asset ต่อ task (→Prompts)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Shared/Prompting/_Index]]"` และท้ายไฟล์ `up:: [[Shared/Prompting/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

_(ยังว่าง — โน้ตในโฟลเดอร์นี้จะถูกลิงก์ที่นี่)_

up:: [[Shared/_Index]]
