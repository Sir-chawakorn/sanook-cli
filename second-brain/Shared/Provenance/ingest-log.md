---
tags: [provenance, ledger, ingest]
note_type: registry
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Provenance/_Index]]"
---

# Ingest Ledger (lineage — append-only)

> บรรทัดเดียวต่อการ ingest — ทำให้ทุก `source::` ใน vault resolve ได้ + ตรวจ verification gate ได้
> หลักฐาน: Karpathy LLM-Wiki (grep-parseable log + immutable raw layer) · W3C PROV-O

## Format

```
## [YYYY-MM-DD] ingest | <title> | tier:A/B/C | <url-or-path> | touched: [[note1]], [[note2]]
```

- **tier** A=ทางการ/primary · B=secondary น่าเชื่อ · C=blog/unverified
- ทุก claim note ที่ derived ต้องมี `source::` ที่ชี้มาบรรทัดใน ledger นี้ หรือไฟล์ใน `Intake/Raw Sources/`

## Entries

_(append ด้านล่าง — ห้ามแก้/ลบของเก่า)_

up:: [[Shared/Provenance/_Index]]
