---
tags: [index, moc, user-persona]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/_Index]]"
---

# User-Persona

> identity profile ที่เปลี่ยนน้อยมาก (human-owned)

## ใส่ที่นี่
บทบาท/ค่านิยม/ภาษา/timezone (read-only)

## ไม่ใส่ที่นี่
สิ่งที่ AI เรียนรู้ (→User-Memory)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Shared/User-Persona/_Index]]"` และท้ายไฟล์ `up:: [[Shared/User-Persona/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

_(ยังว่าง — โน้ตในโฟลเดอร์นี้จะถูกลิงก์ที่นี่)_

up:: [[Shared/_Index]]
