---
tags: [rule, context, retrieval]
note_type: rule
created: {{DATE}}
updated: {{DATE}}
parent: "[[Shared/Rules/_Index]]"
ai_surface: hot
ai_preload: true
---

# Context Assembly Policy (กัน context-rot)

> โหลด context ยังไง + วางตรงไหน — กฎนี้โหลดก่อน (ai_preload) เพราะกระทบ **correctness** โดยตรง
> หลักฐาน: Chroma "Context Rot" (2025), "Lost in the Middle" (TACL 2024) — token เยอะ + วางกลาง context = ตอบแย่ลง แม้ยังไม่เต็ม window

## 3 กฎ

1. **Positional placement** — วางของสำคัญที่ **หัว** (invariant: active goal · Core-Facts · task DoD) และ **ท้าย** (state ล่าสุด · next action) **ห้ามฝังกลาง context**
2. **Identifiers before bodies** — โหลด path/wikilink/heading ก่อน → expand เนื้อเฉพาะที่ต้องใช้จริง (just-in-time) ไม่ดึงทั้งไฟล์มากอง
3. **Token budget** — core pack ~2k tokens · เกินให้ตัด · **"ไม่แน่ใจ = โหลดน้อยกว่า"**

## Self-check ก่อนเริ่มงาน

- [ ] ของ load-bearing อยู่หัว/ท้าย ไม่ใช่กลาง?
- [ ] โหลด identifier ก่อน body แล้ว?
- [ ] core context ≤ ~2k? ตัด distractor ออกหมดแล้ว?

up:: [[Shared/Rules/_Index]]
