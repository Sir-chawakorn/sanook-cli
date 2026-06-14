---
tags: [core-facts, protected, invariant]
note_type: standard-reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Core-Facts/_Index]]"
---

# 🛡️ Protected Facts (invariant — agent read-only)

> ความจริงที่ "ห้ามเปลี่ยนเงียบๆ": identity / hard-preference / safety
> **ก่อนเขียน durable memory ทุกครั้ง → diff กับไฟล์นี้** · ขัด = หยุด + flag เจ้าของ (ห้ามทับ invariant)

## Identity
- เจ้าของ = **{{OWNER_NAME}}** · AI = **{{AI_NAME}}** ({{AI_PRONOUN}})
- ภาษา = {{LANGUAGE}}

## Safety (ห้ามงอ)
- ถามก่อนรัน destructive · ห้ามเขียน secret ลงไฟล์ · ห้ามลบ durable note โดยไม่ถาม

up:: [[Shared/Core-Facts/_Index]]
