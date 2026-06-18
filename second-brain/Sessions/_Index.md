---
tags: [index, moc, sessions]
note_type: moc
created: {{DATE}}
updated: {{DATE}}
parent: "[[Home]]"
---

# Sessions

> flat chronological log ของงาน (YYYY-MM-DD-<topic>.md)

## ใส่ที่นี่
session log 7 หัวข้อ + checkpoint

## ไม่ใส่ที่นี่
code/config · subfolder (Sessions = flat เสมอ)

## AI Routing Contract

- ก่อนเขียน: เช็กว่าเนื้อหาตรง "ใส่ที่นี่" และไม่เข้า "ไม่ใส่ที่นี่"; ถ้าก้ำกึ่งอ่าน [[Vault Structure Map]] ก่อน
- ก่อนสร้างไฟล์ใหม่: ค้นหาโน้ตเดิมในโฟลเดอร์นี้และโฟลเดอร์ใกล้เคียงก่อน เพื่อ merge/update แทน append ซ้ำ
- เมื่อสร้างโน้ตในโฟลเดอร์นี้: ตั้ง `parent: "[[Sessions/_Index]]"` และท้ายไฟล์ `up:: [[Sessions/_Index]]`
- หลังเขียน: เชื่อม link ไป source/project/session/decision ที่เกี่ยวข้อง และอัปเดต hub/index ถ้าโน้ตนี้ควรถูกค้นเจอในอนาคต

> รายละเอียดทุกโฟลเดอร์ + decision rules → [[Vault Structure Map]]

## Sessions

- [[Sessions/2026-06-17-ai-second-brain-sequence-experiment]] — ทดลองและปรับ AI operating sequence ของ second-brain
- [[Sessions/2026-06-17-ai-framework-additional-zones]] — เพิ่ม benchmark, response examples, และ context packs เข้า framework
- [[Sessions/2026-06-18-framework-dogfood-permission-and-memory]] — ใช้ context packs ใหม่กับ permission/tools + memory update + benchmark dogfood
- [[Sessions/2026-06-18-cli-args-release-readiness]] — ตรวจ cli-args serve port UX + release readiness gates
- [[Sessions/2026-06-18-hermes-second-brain-expansion-research]] — วิจัยว่า second-brain ควรเพิ่มอะไรเพื่อรองรับ Hermes CLI ให้ดีขึ้น
- [[Sessions/2026-06-18-sanook-cli-second-brain-roadmap-correction]] — correction: เป้าจริงคือทำ second-brain feature ใน Sanook CLI
- [[Sessions/2026-06-18-sanook-brain-cli-p0-implementation]] — implement `brain doctor`, `brain context`, `brain eval`, and `brain review`
- [[Sessions/2026-06-18-final-gate-template]] — add evidence-backed [[Templates/final]] final gate
- [[Sessions/2026-06-18-final-gate-template-final]] — evidence-backed closeout for the final gate template work
- [[Sessions/2026-06-18-sanook-brain-final-cli]] — implement `sanook brain final`, final-lite, review validation, and eval coverage
- [[Sessions/2026-06-18-sanook-brain-final-cli-final]] — evidence-backed closeout for the Sanook brain final CLI work
- [[Sessions/2026-06-18-mcp-ecosystem-and-sanook-ux-scan]] — scan Sanook MCP support and registry-based integration opportunities
- [[Sessions/2026-06-18-token-reduction-framework-integration]] — integrate selective context compression after GitHub framework scan

up:: [[Home]]
