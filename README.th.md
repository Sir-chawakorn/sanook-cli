<div align="center">

# Sanook CLI

**AI coding agent ใน terminal ที่ "จำงานข้ามวันได้" — open-source**

ใส่ API key ของคุณเอง (BYOK) · 9 providers · MCP · มี **"สมองที่สอง" (second brain)** ที่ทำให้ AI จำ context ข้าม session ได้ — สิ่งที่ Claude Code / Codex / Gemini CLI ลืมทุกครั้งที่ปิด terminal

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

เริ่มด้วย setup wizard แบบเป็นทางการ หรือจะตั้ง API key เองก็ได้:

```bash
sanook setup                    # เลือก provider + model และเสนอสร้าง second brain
sanook model                    # กลับมาเปลี่ยน provider/model ภายหลัง
sanook auth add anthropic --api-key sk-ant-... --use

# macOS / Linux
export ANTHROPIC_API_KEY=sk-ant-...

# Windows (Command Prompt) — export ใช้ไม่ได้ ต้อง setx แล้วเปิด terminal ใหม่
setx ANTHROPIC_API_KEY "sk-ant-..."
```

แล้วสั่งงานได้เลย:

```bash
sanook                 # REPL (ครั้งแรก = setup wizard)
sanook "อ่าน package.json แล้วบอกว่ามี dependencies อะไรบ้าง"
sanook chat -q "อ่าน package.json แล้วสรุป dependencies" --provider anthropic
sanook -z "สรุป diff นี้"     # one-shot เฉพาะคำตอบสุดท้าย เหมาะกับ script
sanook status          # ดู provider/key/brain/gateway แบบ redact secret
sanook sessions        # ดู saved sessions ของ project นี้
sanook --resume <session_id> "ทำต่อจาก session นี้"
sanook dump            # diagnostic/support snapshot โดยไม่โชว์ raw secret
sanook -c "ทำต่อจาก session ล่าสุดของ project นี้"
sanook --continue-any "ทำต่อจาก session ล่าสุดข้าม project"
```

ตัวอย่างตั้งค่า messaging:

```bash
sanook gateway setup line --channel-access-token "$LINE_CHANNEL_ACCESS_TOKEN" \
  --channel-secret "$LINE_CHANNEL_SECRET" --home-channel U1234567890abcdef
sanook gateway setup sms --account-sid "$TWILIO_ACCOUNT_SID" --auth-token "$TWILIO_AUTH_TOKEN" \
  --phone-number "$TWILIO_PHONE_NUMBER" --home-channel +15551234567 \
  --webhook-url https://your-tunnel.example.com/sms/webhook
sanook gateway setup ntfy --topic sanook-yourname-2026 --token "$NTFY_TOKEN" --markdown
sanook gateway setup mattermost --url https://mm.example.com --token "$MATTERMOST_TOKEN" \
  --allowed-users user_id_1 --home-channel chan_home_id --thread-replies
sanook gateway setup homeassistant --url http://homeassistant.local:8123 --token "$HASS_TOKEN" \
  --home-channel sanook_agent --watch-domains light,binary_sensor,climate
sanook gateway setup signal --account +15550000000 --home-channel +15551234567 \
  --http-url http://127.0.0.1:8080
sanook gateway setup whatsapp --phone-number-id "$WHATSAPP_CLOUD_PHONE_NUMBER_ID" \
  --access-token "$WHATSAPP_CLOUD_ACCESS_TOKEN" --app-secret "$WHATSAPP_CLOUD_APP_SECRET" \
  --home-channel 15551234567 --public-url https://your-tunnel.example.com
sanook gateway setup matrix --homeserver https://matrix.example.org \
  --access-token "$MATRIX_ACCESS_TOKEN" --allowed-users @alice:matrix.org \
  --home-room '!abc123:matrix.example.org'
sanook gateway setup googlechat --service-account-json "$GOOGLE_CHAT_SERVICE_ACCOUNT_JSON" \
  --home-channel spaces/AAAA --allowed-spaces spaces/AAAA
sanook gateway setup googlechat --incoming-webhook-url "$GOOGLE_CHAT_INCOMING_WEBHOOK_URL"
sanook gateway setup bluebubbles --server-url http://localhost:1234 --password "$BLUEBUBBLES_PASSWORD" \
  --home-channel user@example.com --allowed-users user@example.com,+15551234567
sanook gateway setup teams --incoming-webhook-url "$TEAMS_INCOMING_WEBHOOK_URL"
sanook gateway setup webhooks --secret "$WEBHOOK_SECRET" --public-url https://your-tunnel.example.com
sanook webhook subscribe github-issues --events issues \
  --prompt "Issue #{issue.number}: {issue.title}" --to slack:C01ABCDEF
sanook send --to sms "deploy finished"
sanook send --to ntfy "deploy finished"
sanook send --to mattermost "deploy finished"
sanook send --to homeassistant "deploy finished"
sanook send --to signal "deploy finished"
sanook send --to whatsapp "deploy finished"
sanook send --to matrix "deploy finished"
sanook send --to googlechat "deploy finished"
sanook send --to bluebubbles "deploy finished"
sanook send --to teams "deploy finished"
sanook cron add "09:00" "สรุปงานเช้านี้" --to ntfy
sanook cron add "09:00" "สรุปงานเช้านี้" --to mattermost
sanook cron add "09:00" "สรุปงานเช้านี้" --to homeassistant
sanook cron add "09:00" "สรุปงานเช้านี้" --to whatsapp
sanook cron add "09:00" "สรุปงานเช้านี้" --to matrix
sanook cron add "09:00" "สรุปงานเช้านี้" --to googlechat
sanook cron add "09:00" "สรุปงานเช้านี้" --to bluebubbles
sanook cron add "09:00" "สรุปงานเช้านี้" --to teams
```

ใน Telegram/Discord/Slack/Mattermost/Email/LINE/SMS/ntfy/Signal/WhatsApp/Matrix ใช้คำสั่งสไตล์ Hermes ได้โดยไม่เรียก model: `/new`, `/reset`, `/model`, `/personality`, `/retry`, `/undo`, `/compress`, `/usage`, `/insights`, `/stop`, `/status`, `/sethome`, และ `/help`; Matrix/Mattermost ใช้ `!new`, `!reset`, `!status`, `!help` ได้ด้วยสำหรับ client ที่กันคำสั่ง `/`

Home Assistant ใช้ Long-Lived Access Token, รับเฉพาะ `state_changed` ที่ตรง `--watch-domains`, `--watch-entities` หรือ `--watch-all`, และตอบกลับผ่าน persistent notification (`homeassistant[:notification_id]`). Tools อ่านสถานะ/บริการได้ ส่วน `ha_call_service` ต้องผ่าน approval และ block domain เสี่ยงเช่น `shell_command`, `command_line`, `python_script`, `pyscript`, `hassio`, `rest_command`

Google Chat ตอนนี้รองรับ proactive delivery/cron ผ่าน incoming webhook (`googlechat`) หรือ Service Account + Chat REST API (`googlechat:spaces/...`). ค่าของ Pub/Sub (`GOOGLE_CHAT_PROJECT_ID`, `GOOGLE_CHAT_SUBSCRIPTION_NAME`, `GOOGLE_CHAT_ALLOWED_USERS`) บันทึกไว้เพื่อทำ inbound parity ต่อ

BlueBubbles/iMessage ตอนนี้รองรับ proactive delivery/cron ผ่าน BlueBubbles REST API (`bluebubbles`, `imessage:user@example.com`, หรือ raw chat GUID). ใช้ `sanook gateway setup bluebubbles --server-url ... --password ... --home-channel ...`; ค่า webhook/mention (`BLUEBUBBLES_WEBHOOK_*`, `BLUEBUBBLES_REQUIRE_MENTION`) ถูกบันทึกไว้เพื่อทำ inbound parity ต่อ

Microsoft Teams ตอนนี้รองรับ proactive delivery/cron ผ่าน Incoming Webhook (`teams`) หรือ Graph mode (`teams:'19:chatid@thread.v2'`). ใช้ `sanook gateway setup teams --incoming-webhook-url ...` สำหรับเริ่มง่ายที่สุด

## ทำอะไรได้บ้าง

- **BYOK + 9 providers** — Anthropic, Google, OpenAI, xAI, Mistral, Groq, Ollama, LM Studio, Codex
- **Familiar CLI** — `sanook setup`, `sanook model`, `sanook auth`, `sanook chat -q`, `sanook gateway`, `sanook status`, `sanook sessions`, `sanook dump`, `sanook tools`, `sanook send`
- **Second brain** — `sanook brain init` สร้าง workspace Obsidian ให้ AI จำงานข้ามวัน
- **Tools** — อ่าน/เขียน/แก้ไฟล์ · รัน bash · git · grep/glob พร้อม permission gate
- **Gateway + cron** — `sanook gateway run` (alias: `sanook serve`) รัน 24/7 + ตั้งงานล่วงหน้า + ต่อ Telegram/Discord/Slack/Mattermost/Home Assistant/Email/LINE/SMS/ntfy/Signal/WhatsApp/Matrix/Google Chat/BlueBubbles/Teams/Webhooks; task ใช้ `--to` เพื่อส่งผลลัพธ์กลับไปยัง messaging target ได้
- **Messaging setup/send** — `sanook gateway setup telegram|discord|slack|mattermost|homeassistant|email|line|sms|ntfy|signal|whatsapp|matrix|googlechat|bluebubbles|teams|webhooks` บันทึก token/allowlist หรือ SMTP/IMAP/LINE/Twilio/ntfy/Mattermost/Home Assistant/Signal/WhatsApp/Matrix/Google Chat/BlueBubbles/Teams/Webhook config; `sanook gateway run` เริ่ม Telegram long-polling, Discord Gateway, Slack Socket Mode, Mattermost REST/WebSocket, Home Assistant state-change WebSocket, Email IMAP polling + SMTP threaded replies, LINE webhook, Twilio SMS webhook, ntfy topic stream, Signal ผ่าน `signal-cli` HTTP/SSE, WhatsApp Cloud webhook + Graph Messages API, Matrix Client-Server sync/send, Google Chat outbound ผ่าน incoming webhook/Chat REST API, BlueBubbles outbound ผ่าน REST API, Teams Incoming Webhook/Graph delivery และ generic webhooks เมื่อ config พร้อม; history ถูกเก็บต่อ platform/target และถ้าคำตอบสุดท้ายเป็น `[SILENT]`, `SILENT`, `NO_REPLY`, หรือ `NO REPLY` จะบันทึกไว้แต่ไม่ส่งกลับ; `sanook send --to telegram|discord|slack|mattermost|homeassistant|email|line|sms|ntfy|signal|whatsapp|matrix|googlechat|bluebubbles|teams "..."`, `sanook webhook subscribe` และ `sanook cron add --to ...` ใช้กฎส่งออกชุดเดียวกัน
- **MCP + Skills** — ต่อ MCP server ได้ + มี built-in skills และติดตั้งเพิ่มได้
- **Update ง่าย** — ใช้ `sanook update` เพื่ออัปเดต CLI เป็นเวอร์ชันล่าสุดจาก npm

## ใช้ provider ไหนก็ได้

```bash
sanook -m sonnet "..."         # Claude
sanook -m gemini "..."         # Gemini
sanook -m ollama "..."         # local ไม่ต้องมี key
sanook auth list               # ดู key/provider status แบบ redact secret
sanook auth status openai      # ดู env/store/console ของ provider
sanook sessions                # ดู session ที่บันทึกไว้ของ project นี้
sanook sessions show <id>      # ดูรายละเอียด session แบบย่อ
sanook sessions export <id> --format markdown --output session.md
sanook sessions rename <id> "ชื่อ session"
sanook sessions stats --all
sanook sessions prune --keep 20 --yes
sanook sessions rm <id>        # ลบ session
sanook dump [--show-keys]      # support dump; key ยังถูก redact
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
