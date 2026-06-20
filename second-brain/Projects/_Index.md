---
tags: [index, moc, projects]
note_type: moc
created: 2026-06-18
updated: 2026-06-20
parent: "[[Home]]"
---

# Projects

> workspace ของงานจริง — 1 โฟลเดอร์ = 1 โปรเจค = 1 repo (ผ่าน `repo.md`)

## ใส่ที่นี่
deliverable + overview/context/current-state ของ project

## ไม่ใส่ที่นี่
ความรู้ทั่วไป (→Learning) · log งาน (→Sessions)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Projects/_Index]]"` และท้ายไฟล์ `up:: [[Projects/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

## Project Dashboard

| Project | Repo | Status | Hub |
|---|---|---|---|
| Sanook CLI | `/Users/chawakornbuasontorn/dev/sanook-cli` | active | [[Projects/sanook-cli/_Index]] |

## Projects

- [[Projects/sanook-cli/_Index]] — Sanook CLI (terminal agent + second brain)

### Add a project

```bash
sanook brain new project --title "My App" --repo /path/to/repo
sanook brain projects list
```

up:: [[Home]]
