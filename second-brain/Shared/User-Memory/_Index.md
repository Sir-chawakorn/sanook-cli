---
tags: [index, moc, user-memory]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/_Index]]"
---

# User-Memory

> สิ่งที่ AI เรียนรู้เกี่ยวกับเจ้าของ (mutable)

## ใส่ที่นี่
preference/response-example/signal

## ไม่ใส่ที่นี่
identity static (→User-Persona)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Shared/User-Memory/_Index]]"` และท้ายไฟล์ `up:: [[Shared/User-Memory/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

## User-Memory Notes

- [[Shared/User-Memory/user-preferences]] — durable preferences ของเจ้าของ
- [[Shared/User-Memory/response-examples]] — examples/taste signals ว่าคำตอบ AI แบบไหนดีหรือไม่ดี

up:: [[Shared/_Index]]
