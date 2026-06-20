---
tags: [index, moc, project]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Projects/_Index]]"
---

> Project workspace hub — links overview, live state, AI context, and repo mapping.

# {{TITLE}}

> Project workspace — deliverables, repo mapping, and live status for **{{TITLE}}**.

## Notes

- [[Projects/{{SLUG}}/overview]] — goal, scope, stack
- [[Projects/{{SLUG}}/current-state]] — NOW / blockers / next (update often)
- [[Projects/{{SLUG}}/context]] — what AI must know before touching code
- [[Projects/{{SLUG}}/repo]] — repo path + verify commands

## AI Routing Contract

- ก่อนเขียน: ใช้โฟลเดอร์นี้เฉพาะงานที่เกี่ยวกับ **{{TITLE}}** โดยตรง
- ก่อนสร้างไฟล์ใหม่: ค้นหา note เดิมใน `Projects/{{SLUG}}/` ก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Projects/{{SLUG}}/_Index]]"` และท้ายไฟล์ `up:: [[Projects/{{SLUG}}/_Index]]`
- หลังเขียน: เชื่อม link ไป session/source/code path ที่เกี่ยวข้อง และอัปเดต index นี้ถ้าโน้ตควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

up:: [[Projects/_Index]]
