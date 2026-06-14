<div align="center">

# Sanook CLI

**AI coding agent ใน terminal ที่ "จำงานข้ามวันได้" — open-source**

ใส่ API key ของคุณเอง (BYOK) · 12 providers · MCP · มี **"สมองที่สอง" (second brain)** ที่ทำให้ AI จำ context ข้าม session ได้ — สิ่งที่ Claude Code / Codex / Gemini CLI ลืมทุกครั้งที่ปิด terminal

[![npm](https://img.shields.io/npm/v/sanook-cli.svg?color=2563eb)](https://www.npmjs.com/package/sanook-cli)
[![downloads](https://img.shields.io/npm/dm/sanook-cli.svg?color=2563eb)](https://www.npmjs.com/package/sanook-cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-22c55e.svg)](LICENSE)

🇬🇧 [Read in English](README.md)

</div>

---

## มันคืออะไร

เครื่องมือ **AI coding agent** ที่รันใน terminal — สั่งงานเป็นภาษาคน แล้วมันอ่านไฟล์ / แก้โค้ด / รันคำสั่ง / commit ให้ หัวใจคือ loop เดียว:

```
prompt → LLM → เรียก tool → ผลลัพธ์ → loop → ตอบ
```

จุดต่างจากเจ้าใหญ่: มี **second brain** (โครงสร้างโน้ต Obsidian) ที่ agent อ่านก่อนทำงานทุกครั้ง → **จำได้ว่าเคยทำอะไร ชอบอะไร ตัดสินใจอะไรไปแล้ว** ข้าม session

## เริ่มใช้

```bash
npm install -g sanook-cli

# ครั้งแรกรัน sanook เฉยๆ จะมี setup wizard ให้เลือก provider + วาง key
sanook
```

หรือสั่งงานตรงๆ:
```bash
sanook "อ่าน package.json แล้วบอกว่ามี dependencies อะไรบ้าง"
```

## ทำอะไรได้บ้าง

- **BYOK + 12 providers** — Anthropic, Google, OpenAI, DeepSeek, xAI, Mistral, Groq, MiniMax, GLM, Ollama, LM Studio, Codex (ใส่ key ของค่ายไหนก็ได้)
- **Second brain** — `sanook brain init` สร้าง workspace Obsidian ให้ AI จำงานข้ามวัน
- **Tools** — อ่าน/เขียน/แก้ไฟล์ · รัน bash · git · grep/glob (มี permission gate กันคำสั่งอันตราย)
- **Gateway + cron** — `sanook serve` รันเป็น service 24/7 + ตั้งงานล่วงหน้า + ต่อ Telegram
- **MCP + Skills** — ต่อ MCP server ได้ + skill สำเร็จรูป 69 ตัว

## ใช้ provider ไหนก็ได้

```bash
sanook -m sonnet "..."         # Claude
sanook -m gemini "..."         # Gemini
sanook -m glm:smart "..."      # GLM (z.ai Coding Plan)
sanook -m ollama "..."         # local ไม่ต้องมี key
```

---

<div align="center">

**สร้างโดย [Sanook AI](https://www.facebook.com/sanookai)** — เครื่องมือ + ความรู้ AI สำหรับคนไทย

[Facebook](https://www.facebook.com/sanookai) · [X / Twitter](https://x.com/sanook_ai)

</div>
