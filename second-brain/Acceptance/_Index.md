---
tags: [index, moc, acceptance]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Home]]"
---

# Acceptance

> golden input→expected-output fixtures

## ใส่ที่นี่
case ที่ใช้ตัดสิน done/not-done

## ไม่ใส่ที่นี่
gate ticklist (→Checklists) · runner (→Evals)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Acceptance/_Index]]"` และท้ายไฟล์ `up:: [[Acceptance/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

_(ยังว่าง — โน้ตในโฟลเดอร์นี้จะถูกลิงก์ที่นี่)_

up:: [[Home]]
