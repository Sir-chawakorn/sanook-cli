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

Sanook คือ **AI coding agent** ที่รันใน terminal — สั่งงานเป็นภาษาคน แล้วมันอ่านไฟล์ / แก้โค้ด / รันคำสั่ง / commit ให้ หัวใจคือ loop เดียว:

```text
prompt → LLM → เรียก tool → ผลลัพธ์ → loop → ตอบ
```

จุดต่างจากเจ้าใหญ่คือ **second brain** (โครงสร้างโน้ต Obsidian) ที่ agent อ่านก่อนทำงานทุกครั้ง จึงจำได้ว่าเคยทำอะไร ชอบอะไร และตัดสินใจอะไรไปแล้วข้าม session

## เริ่มใช้

ติดตั้งแบบ **global** (ต้องมี `-g`) — ต้องมี **Node ≥ 22** (เช็กด้วย `node -v`):

```bash
npm install -g sanook-cli
```

> ⚠️ **`'sanook' is not recognized` / command not found?**
> แปลว่าลงแบบ local — `npm i sanook-cli` (ไม่มี `-g`) มันลงในโฟลเดอร์ปัจจุบัน **ไม่เข้า PATH** คำสั่ง `sanook` เลยหาไม่เจอ
> แก้: ลงใหม่ด้วย `npm install -g sanook-cli` · หรือเรียกผ่าน **`npx sanook`** (ใช้ตัวที่ลง local ไปแล้วได้เลย)
> หรือรัน **`npx sanook doctor`** — ตรวจ Node/PATH/สถานะการติดตั้งให้ แล้วบอกคำสั่งแก้ที่ตรงกับ OS (มีบรรทัดแก้ PATH บน Windows แบบปลอดภัยให้ก็อปด้วย)

ตั้ง API key (หรือรัน `sanook` เฉย ๆ ครั้งแรกจะมี setup wizard ให้เลือก provider + วาง key):

```bash
# macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...

# Windows (Command Prompt) — export ใช้ไม่ได้ ต้อง setx แล้วเปิด terminal ใหม่
setx ANTHROPIC_API_KEY "sk-ant-..."
```

แล้วสั่งงานได้เลย:

```bash
sanook                 # REPL (ครั้งแรก = setup wizard)
sanook "อ่าน package.json แล้วบอกว่ามี dependencies อะไรบ้าง"
sanook -c "ทำต่อจาก session ล่าสุดของ project นี้"
sanook --continue-any "ทำต่อจาก session ล่าสุดข้าม project"
```

## ทำอะไรได้บ้าง

- **BYOK + 12 providers** — Anthropic, Google, OpenAI, DeepSeek, xAI, Mistral, Groq, MiniMax, GLM, Ollama, LM Studio, Codex
- **Second brain** — `sanook brain init` สร้าง workspace Obsidian ให้ AI จำงานข้ามวัน
- **Tools** — อ่าน/เขียน/แก้ไฟล์ · รัน bash · git · grep/glob พร้อม permission gate
- **Gateway + cron** — `sanook serve` รันเป็น service 24/7 + ตั้งงานล่วงหน้า + ต่อ Telegram
- **MCP + Skills** — ต่อ MCP server ได้ + มี built-in skills และติดตั้งเพิ่มได้
- **Update ง่าย** — ใช้ `sanook update` เพื่ออัปเดต CLI เป็นเวอร์ชันล่าสุดจาก npm

## ใช้ provider ไหนก็ได้

```bash
sanook -m sonnet "..."         # Claude
sanook -m gemini "..."         # Gemini
sanook -m glm:smart "..."      # GLM (z.ai Coding Plan)
sanook -m ollama "..."         # local ไม่ต้องมี key
```

ตั้งค่า default model ได้ด้วย:

```bash
sanook config set model sonnet
# หรือใช้ env
SANOOK_MODEL=sonnet sanook "..."
```

## อัปเดต CLI

เวลามีเวอร์ชันใหม่ ใช้คำสั่งเดียว:

```bash
sanook update
sanook update --check   # เช็กอย่างเดียว
```

คำสั่งนี้จะเช็ก npm `latest` ของ `sanook-cli` แล้วอัปเดตด้วย `npm install -g sanook-cli@latest` เมื่อมีเวอร์ชันใหม่กว่า

ถ้าเปิด TUI ด้วย `sanook` เฉย ๆ CLI จะเช็กอัปเดตอย่างมากวันละครั้ง ถ้ามีเวอร์ชันใหม่จะถาม `Yes/No` ก่อนอัปเดต ปิด prompt ได้ด้วย `SANOOK_DISABLE_UPDATE_CHECK=1`

## ความปลอดภัย

Sanook ตั้งค่าเริ่มต้นให้ระวังไว้ก่อน:

- `ask` mode เป็นค่าเริ่มต้น ก่อนเขียนไฟล์หรือรัน shell จะขออนุมัติ ถ้าเป็น headless แล้วไม่มี UI จะปฏิเสธ mutation
- file tools แตะได้เฉพาะ workspace ปัจจุบันและ second brain ที่ตั้งไว้ ถ้าจะออกนอก scope ต้อง opt-in ด้วย `SANOOK_ALLOW_OUTSIDE_WORKSPACE=1`
- path เสี่ยงอย่าง `.env`, `.git`, `node_modules`, credential folders และ `~/.sanook` ถูกบล็อก
- project `.sanook/config.json` ที่ยังไม่ trusted ตั้งค่าทั่วไปได้ แต่ลด `permissionMode` เป็น `auto` ไม่ได้
- project `.sanook/mcp.json`, `.sanook/hooks.json`, `.sanook/skills/`, และ `.sanook/commands/` ถูก ignore จนกว่าจะ trust project:

```bash
sanook trust status
sanook trust add
sanook trust remove
```

- gateway bind ที่ `127.0.0.1` และต้องใช้ bearer token ยกเว้น `/health`; mutating tools ใน `sanook serve` เป็น `ask` โดย default และ opt-in unattended write ได้ด้วย `sanook config set permissionMode auto` หรือ `SANOOK_GATEWAY_ALLOW_WRITE=1`
- session/memory/prompt history/worklog redact API keys ก่อนบันทึก และปิด persistence ทั้งหมดได้ด้วย `SANOOK_DISABLE_PERSISTENCE=1`

## พัฒนา

```bash
npm install
npm run build
npm test            # vitest
npm run typecheck
```

---

<div align="center">

**สร้างโดย [Sanook AI](https://www.facebook.com/sanookai)** — เครื่องมือ + ความรู้ AI สำหรับคนไทย

[Facebook](https://www.facebook.com/sanookai) · [X / Twitter](https://x.com/sanook_ai)

</div>
