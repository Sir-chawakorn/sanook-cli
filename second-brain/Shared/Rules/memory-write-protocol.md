---
tags: [rule, memory, protocol]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
---

# Memory-Write Protocol (ADD / UPDATE / DELETE / NOOP)

> ทุกครั้งที่จะเขียน durable memory — เลือก operation ชัด (Mem0-style) แทนการ append มั่ว
> หลักการแม่: **Merge, Don't Append**

## ก่อนเขียน
1. **diff กับ [[Shared/Core-Facts/protected-facts]]** (invariant) → ขัด = **หยุด + flag เจ้าของ** (ห้ามทับเงียบ)
2. search ปลายทางหา entry หัวข้อเดียวกัน

## เลือก operation
| op | เมื่อ | ทำ |
|---|---|---|
| **ADD** | ของใหม่จริง (ไม่เจอเดิม) | เพิ่ม entry |
| **UPDATE** | เจอ entry เดิม | แก้ + bump `updated:` (ห้ามเพิ่มซ้ำ) |
| **DELETE** | fact เลิกจริง/ถูกแทน | bi-temporal supersede (ดู [[Shared/Rules/frontmatter-standard]]) ไม่ลบทิ้ง |
| **NOOP** | รู้อยู่แล้ว | ไม่ต้องเขียน |

> ขัดกัน (ไม่ใช่แค่ซ้ำ) → THESIS/ANTITHESIS/SYNTHESIS → บันทึก decision-log + `supersedes::`

up:: [[Shared/Rules/_Index]]
