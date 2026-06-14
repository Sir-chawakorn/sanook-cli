---
tags: [eval, golden-set]
note_type: reference
created: {{DATE}}
updated: {{DATE}}
parent: "[[Evals/_Index]]"
---

# Golden Set

> ตัวอย่างงานที่ "ทำถูก" เก็บไว้เทียบ — input → expected output ที่ยอมรับ (regression guard)
> ต่างจาก [[Acceptance/_Index]] (fixtures ดิบ) ตรงที่นี่คือชุดที่ผ่านการ curate แล้วใช้ใน eval-loop

## Cases

_(รูปแบบ:)_

```
### <task-family> — <ชื่อ case>
- input: ...
- expected: ... (เกณฑ์ที่ถือว่าผ่าน)
- last_verified: YYYY-MM-DD
```

up:: [[Evals/_Index]]
