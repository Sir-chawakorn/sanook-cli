# {{VAULT_NAME}}

ระบบ **"สมองที่สอง" (second brain)** บน Obsidian — คลังความรู้ + ความจำของ AI agent ที่ทำงานต่อเนื่องข้าม session ได้

> scaffold โดย [`sanook brain`](https://github.com/Sir-chawakorn/sanook-cli) เมื่อ {{DATE}}

## โครงสร้าง

| โฟลเดอร์ | บทบาท |
|---|---|
| `Projects/` | งานจริง — 1 โฟลเดอร์ = 1 โปรเจค |
| `Sessions/` | log งานของ AI ลงวันที่ (flat) |
| `Shared/` | สมองกลาง — memory, rules, decisions, state |
| `Intake/` `Runbooks/` `Templates/` `Bugs/` `Handoffs/` | core workflow |
| `Goals/` `Areas/` | ทิศทาง (north-star + โดเมนต่อเนื่อง) |
| `Research/` `Learning/` `Distillations/` | knowledge pipeline |
| `Skills/` `Playbooks/` `Evals/` `Entities/` | frontier loops (self-improving) |

> รายละเอียดครบทุกโฟลเดอร์ (role + ใส่อะไร / ห้ามใส่อะไร) → **`Vault Structure Map.md`**

## ใช้ยังไง

1. เปิดโฟลเดอร์นี้ใน **Obsidian** (Open folder as vault)
2. ให้ AI agent อ่าน `Shared/AI-Context-Index.md` ก่อนทำงานเสมอ
3. ก่อนสร้างหรือย้ายโน้ต ให้เลือกปลายทางจาก `Vault Structure Map.md` แล้วอ่าน `_Index.md` ของโฟลเดอร์นั้นเพื่อทำตาม **AI Routing Contract**
4. constitution อยู่ที่ `CLAUDE.md` / `GEMINI.md` / `AGENTS.md` / `SANOOK.md` — กฎปฏิบัติของ AI

## ปรับให้เป็นของคุณ

แก้ค่าตัวตน/preference ได้ที่ `USER.md` + `Shared/User-Memory/user-preferences.md`
