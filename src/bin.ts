#!/usr/bin/env node
import { runAgent, type AgentEvent } from './loop.js';
import { assertDirectApiKey, redactKey } from './providers/keys.js';
import { specKey, parseSpec, PROVIDERS, consoleUrl, detectEnvProvider } from './providers/registry.js';
import { resolveKeyFromEnv } from './providers/keys.js';
import { hasPricingForKey } from './cost.js';
import type { ModelMessage } from 'ai';
import { loadConfig, isFirstRun, loadKeysIntoEnv, parsePricingOverride } from './config.js';
import {
  saveSession,
  latestSession,
  newSessionId,
  listSessions,
  loadSession,
  removeSession,
  pruneSessions,
  renameSession,
  sanitizeSessionForExport,
  sessionStorePath,
  type Session,
} from './session.js';
import { closeMcp, isValidMcpServerName } from './mcp.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { chmod, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { appHomePath, BRAND, BRAND_ENV, envFlag } from './brand.js';
import type { UpdateCache } from './update.js';
import { parseArgs } from './cli-args.js';

// สี: เคารพ NO_COLOR + auto-plain เมื่อ pipe/redirect (legacy Windows cmd ก็ไม่เห็น garbage ANSI); FORCE_COLOR บังคับได้
const useColor = !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || process.stdout.isTTY === true);
const DIM = useColor ? '\x1b[2m' : '';
const RESET = useColor ? '\x1b[0m' : '';

async function runHeadless(
  model: string,
  prompt: string,
  budgetUsd: number | undefined,
  maxSteps: number,
  json: boolean,
  history?: ModelMessage[],
  planMode = false,
  permissionMode: 'auto' | 'ask' = 'ask',
  quiet = false,
  fallbackModel?: string,
): Promise<void> {
  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.exit(130);
  });
  // budget cap ตั้งไว้แต่ไม่มี pricing สำหรับ model นี้ → cap จะไม่ทำงาน เตือนไม่ให้เงียบ (correctness)
  if (budgetUsd != null && !hasPricingForKey(specKey(model)) && !json) {
    process.stderr.write(
      `${DIM}⚠ budget $${budgetUsd} ตั้งไว้ แต่ไม่มี pricing สำหรับ ${model} → cap จะไม่ทำงาน ` +
        `(ตั้งราคาเอง: ${BRAND.cliName} config set pricing '{"${specKey(model)}":{"input":1,"output":3}}')${RESET}\n`,
    );
  }
  // เตือน fallback model ด้วย (budget cap re-key ไป fallback ตอน primary ล้ม) — ไม่ซ้ำถ้าทั้งคู่ไม่มี pricing
  if (budgetUsd != null && fallbackModel && fallbackModel !== model && !hasPricingForKey(specKey(fallbackModel)) && !json) {
    process.stderr.write(`${DIM}⚠ fallback model ${fallbackModel} ไม่มี pricing → budget cap จะไม่ทำงานถ้า fallback ถูกใช้${RESET}\n`);
  }
  try {
    const { cost, messages } = await runAgent({
      model,
      fallbackModel,
      prompt,
      history,
      budgetUsd,
      maxSteps,
      planMode,
      permissionMode, // headless ไม่มี approve → ask-mode = ปฏิเสธ mutate (ต้อง --yes)
      signal: controller.signal,
      onEvent: (e: AgentEvent) => {
        if (json) {
          process.stdout.write(`${JSON.stringify(e)}\n`);
          return;
        }
        if (e.type === 'text') process.stdout.write(e.text ?? '');
        else if (e.type === 'tool-call' && !quiet) process.stdout.write(`\n${DIM}→ ${e.tool}${RESET}\n`);
      },
    });
    if (!json && !quiet) process.stdout.write(`\n${DIM}${cost.summary()}${RESET}\n`);
    else if (quiet) process.stdout.write('\n');
    // จำ session ไว้ทำงานต่อได้ (sanook --continue "...") — แก้ concern AI ลืมว่าทำถึงไหน
    const now = new Date().toISOString();
    await saveSession({ id: newSessionId(), created: now, updated: now, model, cwd: process.cwd(), messages });
    // auto-worklog เข้า second-brain (ถ้าตั้ง brainPath) — "vault จำว่าวันนี้ทำอะไร"
    const { getBrainPath, appendBrainWorklog } = await import('./memory.js');
    const brain = await getBrainPath();
    if (brain) {
      await appendBrainWorklog(brain, { prompt, summary: cost.summary(), model, today: now.slice(0, 10) }).catch(() => {});
    }
  } catch (err) {
    const msg = redactKey((err as Error).message);
    if (json) process.stdout.write(`${JSON.stringify({ type: 'error', message: msg })}\n`);
    else console.error(`\nERROR: ${msg}`);
    process.exit(1);
  }
}

// อ่านจาก package.json (single source of truth) — กัน version constant drift
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};
const VERSION = PACKAGE.version;
const PACKAGE_NAME = PACKAGE.name;
const HELP = `${BRAND.productName} — a terminal AI coding agent (BYOK)

usage:
  ${BRAND.cliName} "<task>"            run one task (headless)
  ${BRAND.cliName} -z "<task>"         one-shot final output (script-friendly)
  ${BRAND.cliName} chat -q "<query>"   Hermes-style direct query
  ${BRAND.cliName}                     interactive REPL
  ${BRAND.cliName} setup [section]      setup wizard (model | gateway | tools | agent | brain)
  ${BRAND.cliName} model                choose provider + model
  ${BRAND.cliName} --json "<task>"     headless, JSONL output (for CI/scripts)
  ${BRAND.cliName} sessions             list/resume-audit saved conversation sessions
  ${BRAND.cliName} dump [--show-keys]   support snapshot (secrets redacted)
  ${BRAND.cliName} update              update ${BRAND.cliName} to the latest npm release
  ${BRAND.cliName} doctor              ตรวจการติดตั้ง + วิธีแก้ PATH (เมื่อพิมพ์ "${BRAND.cliName}" แล้วไม่เจอ)

gateway (อยู่ยาว 24/7 — HTTP loopback + cron):
  ${BRAND.cliName} gateway setup telegram          ตั้งค่า Telegram token + allowlist
  ${BRAND.cliName} gateway setup discord           ตั้งค่า Discord bot token + channel allowlist
  ${BRAND.cliName} gateway setup slack             ตั้งค่า Slack bot/app token + channel allowlist
  ${BRAND.cliName} gateway setup email             ตั้งค่า Email IMAP/SMTP + allowed senders
  ${BRAND.cliName} gateway run [--port 8787]       เปิด gateway (เหมือน serve)
  ${BRAND.cliName} gateway start [--port 8787]     เปิด gateway เป็น background process
  ${BRAND.cliName} gateway stop|restart|install    จัดการ gateway service
  ${BRAND.cliName} gateway status                  ดู config/status gateway
  ${BRAND.cliName} send --to telegram|discord|slack|email[:target] "msg" ส่งข้อความออก platform โดยไม่เรียก LLM
  ${BRAND.cliName} send --list [platform]          ดู messaging targets ที่ตั้งค่าไว้
  ${BRAND.cliName} serve [--port 8787]            เปิด gateway (OpenAI-compat /v1/chat/completions + scheduler)
  ${BRAND.cliName} cron add "<when>" "<task>"     ตั้งงานล่วงหน้า (when: "every 30m" | "09:00" | ISO | now)
  ${BRAND.cliName} cron list                      ดู task ทั้งหมด
  ${BRAND.cliName} cron rm <id>                   ลบ task

skills (built-in + ติดตั้งเพิ่มได้):
  ${BRAND.cliName} skill list                     ดู skill ทั้งหมด
  ${BRAND.cliName} skill add <user/repo|url|path> ติดตั้ง skill จาก GitHub / URL / local
  ${BRAND.cliName} skill remove <name>            ลบ skill ที่ติดตั้ง
  ${BRAND.cliName} models [provider]              ดู/verify model id (เทียบ provider จริงถ้ามี key)

second brain (Obsidian workspace สำหรับจัดเก็บงาน + ความจำ AI):
  ${BRAND.cliName} brain init [path]              สร้างโครงสร้าง second-brain ที่ path (ไม่ใส่ = ถาม)

search (BM25 + optional BYOK semantic เหนือ vault + memory + sessions + skills):
  ${BRAND.cliName} index                          (re)index vault+memory แบบ incremental (O(delta))
  ${BRAND.cliName} search "<query>" [--mode auto|fts|semantic|hybrid] [--limit N] [--source vault,memory]
  ${BRAND.cliName} mcp serve                       expose brain เป็น MCP server (stdio) ให้ Claude Desktop/Cursor

config & mcp:
  ${BRAND.cliName} status                         ดู provider/key/brain/gateway status แบบ redacted
  ${BRAND.cliName} auth [list|status|add|remove]  จัดการ API keys ของ providers (BYOK, redacted)
  ${BRAND.cliName} sessions [list|latest|show|rm] จัดการ saved sessions
  ${BRAND.cliName} dump [--show-keys]             diagnostic/support dump แบบไม่โชว์ raw secret
  ${BRAND.cliName} tools                          ดู tool surface ที่ agent ใช้ได้
  ${BRAND.cliName} config [get|set <k> <v>]       ดู/แก้ ${appHomePath('config.json')} (model/budgetUsd/permissionMode/cacheTtl/compaction/thinking/embeddingModel)
  ${BRAND.cliName} mcp [list|add <name> <cmd> …|remove <name>]   จัดการ MCP servers
  ${BRAND.cliName} trust [status|add|remove]      อนุญาต/ยกเลิก project .sanook mcp/hooks/skills/commands

flags:
  -m, --model <spec>   sonnet/opus/haiku/fable · gpt/codex · gemini · grok · deepseek · mistral · groq · ollama/lmstudio
                       or "provider:model-id" (e.g. openai:gpt-5.3-codex, groq:fast, google:gemini-2.5-flash)
  -b, --budget <usd>   stop when estimated cost exceeds this
  -c, --continue       resume the latest session ของ project นี้
  -r, --resume <id>    resume a specific saved session
      --continue-any   resume latest session ข้าม project (explicit)
      --plan           plan mode — สำรวจ+วางแผนเท่านั้น ไม่แก้ไฟล์ (read-only)
  -y, --yes            อนุมัติ tool อัตโนมัติ (ข้าม ask-mode permission)
      --yolo           alias ของ --yes (compat)
      --json           machine-readable JSONL output
  -v, --version
  -h, --help

env (BYOK — direct API key only):
  ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY
  ${BRAND_ENV.disableUpdateCheck}=1   disable interactive update prompts`;

/** sanook serve [--port N] [--model spec] — เปิด gateway (HTTP loopback + cron scheduler) อยู่ยาว */
async function runServe(args: string[]): Promise<void> {
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? Number(args[portIdx + 1]) : 8787;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`port ไม่ถูกต้อง: ${args[portIdx + 1]}`);
    process.exit(1);
  }
  const mIdx = args.findIndex((a) => a === '--model' || a === '-m');
  const config = await loadConfig({ model: mIdx !== -1 ? args[mIdx + 1] : undefined });
  const { startGateway } = await import('./gateway/serve.js');
  process.stdout.write(`${DIM}${BRAND.productName} gateway — model: ${config.model}${RESET}\n`);
  const stop = await startGateway({
    port,
    model: config.model,
    budgetUsd: config.budgetUsd,
    permissionMode: envFlag(BRAND_ENV.gatewayAllowWrite) ? 'auto' : config.permissionMode,
    onLog: (m) => process.stdout.write(`${DIM}[gateway] ${m}${RESET}\n`),
  });
  const shutdown = (): void => {
    stop();
    process.stdout.write('\n[gateway] หยุดแล้ว\n');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // server + scheduler interval ถือ event loop ไว้ → process อยู่ยาวจนกด Ctrl-C
}

async function startModelSetup(): Promise<void> {
  const config = await loadConfig({});
  const { startApp } = await import('./ui/render.js');
  startApp({
    needsSetup: true,
    appProps: {
      initialModel: config.model,
      fallbackModel: config.fallbackModel,
      budgetUsd: config.budgetUsd,
      permissionMode: config.permissionMode,
    },
  });
}

async function runTools(_args: string[] = []): Promise<void> {
  const { tools } = await import('./tools/index.js');
  const names = Object.keys(tools).sort();
  console.log(`${BRAND.productName} tools (${names.length})`);
  console.log(names.map((n) => `  ${n}`).join('\n'));
  console.log(`\nจัดการ MCP เพิ่มเติม: ${BRAND.cliName} mcp add <name> <command> [args...]`);
}

async function runAgentSetupSummary(): Promise<void> {
  const cfg = await loadConfig({});
  console.log(`${BRAND.productName} agent settings`);
  console.log(`  model:          ${cfg.model}`);
  console.log(`  fallbackModel:  ${cfg.fallbackModel ?? '(not set)'}`);
  console.log(`  permissionMode: ${cfg.permissionMode}`);
  console.log(`  maxSteps:       ${cfg.maxSteps}`);
  console.log(`  budgetUsd:      ${cfg.budgetUsd ?? '(not set)'}`);
  console.log(`  brainPath:      ${cfg.brainPath ?? '(not set)'}`);
  console.log('\nแก้ค่าได้ด้วย:');
  console.log(`  ${BRAND.cliName} config set permissionMode ask`);
  console.log(`  ${BRAND.cliName} config set budgetUsd 0.25`);
  console.log(`  ${BRAND.cliName} config set fallbackModel haiku`);
}

async function runGatewayStatus(): Promise<void> {
  const { readGatewayConfig, redactGatewayConfig, resolveDiscordConfig, resolveEmailConfig, resolveSlackConfig, resolveTelegramConfig, gatewayConfigPath } =
    await import('./gateway/config.js');
  const cfg = await readGatewayConfig();
  const telegram = resolveTelegramConfig(cfg);
  const discord = resolveDiscordConfig(cfg);
  const slack = resolveSlackConfig(cfg);
  const email = resolveEmailConfig(cfg);
  console.log(`${BRAND.productName} gateway`);
  console.log(`  config:   ${gatewayConfigPath()}`);
  console.log(`  token:    ${appHomePath('gateway', 'token')} (HTTP bearer, auto-created on run)`);
  const { gatewayServiceStatus } = await import('./gateway/service.js');
  const service = await gatewayServiceStatus();
  console.log(`  service:  ${service.running ? `running (pid ${service.state?.pid})` : service.state ? `stopped (last pid ${service.state.pid})` : 'not started'}`);
  console.log(`  log:      ${service.logPath}`);
  console.log(`  telegram: ${telegram.token ? `configured via ${telegram.source}` : 'not configured'}`);
  if (telegram.token) {
    console.log(`    enabled:       ${telegram.enabled}`);
    console.log(`    allowed chats: ${telegram.allowedChatIds.length ? telegram.allowedChatIds.join(', ') : '(none — fail closed)'}`);
    console.log(`    allow write:   ${telegram.allowWrite ? 'yes' : 'no'}`);
  }
  console.log(`  discord:  ${discord.token ? `configured via ${discord.source}` : 'not configured'}`);
  if (discord.token) {
    console.log(`    default channel:  ${discord.defaultChannelId ?? '(not set)'}`);
    console.log(`    allowed channels: ${discord.allowedChannelIds.length ? discord.allowedChannelIds.join(', ') : '(none)'}`);
  }
  console.log(`  slack:    ${slack.botToken ? `configured via ${slack.source}` : 'not configured'}`);
  if (slack.botToken) {
    console.log(`    app token:        ${slack.appToken ? 'set' : '(not set — needed for future Socket Mode gateway)'}`);
    console.log(`    default channel:  ${slack.defaultChannelId ?? '(not set)'}`);
    console.log(`    allowed channels: ${slack.allowedChannelIds.length ? slack.allowedChannelIds.join(', ') : '(none)'}`);
  }
  console.log(`  email:    ${email.address ? `configured via ${email.source}` : 'not configured'}`);
  if (email.address) {
    console.log(`    address:         ${email.address}`);
    console.log(`    smtp:            ${email.smtpHost ?? '(not set)'}:${email.smtpPort}`);
    console.log(`    imap:            ${email.imapHost ?? '(not set)'}:${email.imapPort}`);
    console.log(`    home address:    ${email.homeAddress ?? '(not set)'}`);
    console.log(`    allowed senders: ${email.allowedUsers.length ? email.allowedUsers.join(', ') : email.allowAllUsers ? '(all users)' : '(none)'}`);
  }
  console.log(`\nredacted config:\n${JSON.stringify(redactGatewayConfig(cfg), null, 2)}`);
}

async function runGatewaySetup(args: string[]): Promise<void> {
  const platformArgProvided = Boolean(args[0] && !args[0].startsWith('--'));
  let platform = platformArgProvided ? args[0] : undefined;
  const rest = platformArgProvided ? args.slice(1) : args;
  if (!platform) {
    if (!process.stdin.isTTY) {
      console.error(`ใช้: ${BRAND.cliName} gateway setup <telegram|discord|slack|email> [options]`);
      process.exit(1);
    }
    const { readGatewayConfig, resolveDiscordConfig, resolveEmailConfig, resolveSlackConfig, resolveTelegramConfig } = await import('./gateway/config.js');
    const cfg = await readGatewayConfig();
    const options = [
      { id: 'telegram', label: `Telegram ${resolveTelegramConfig(cfg).token ? '(configured)' : ''}` },
      { id: 'discord', label: `Discord ${resolveDiscordConfig(cfg).token ? '(configured)' : ''}` },
      { id: 'slack', label: `Slack ${resolveSlackConfig(cfg).botToken ? '(configured)' : ''}` },
      { id: 'email', label: `Email ${resolveEmailConfig(cfg).address ? '(configured)' : ''}` },
    ];
    console.log(`${BRAND.productName} gateway setup`);
    for (const [i, option] of options.entries()) console.log(`  ${i + 1}. ${option.label}`);
    const answer = await askText('เลือก platform [1-4]: ');
    const index = Number(answer || '1') - 1;
    platform = options[index]?.id;
  }
  if (!platform || !['telegram', 'discord', 'slack', 'email'].includes(platform)) {
    console.error(`ตอนนี้ setup อัตโนมัติรองรับ telegram / discord / slack / email — ได้ "${platform ?? ''}"`);
    process.exit(1);
  }

  if (platform === 'discord') return runDiscordGatewaySetup(rest);
  if (platform === 'slack') return runSlackGatewaySetup(rest);
  if (platform === 'email') return runEmailGatewaySetup(rest);

  let token = argValue(rest, '--bot-token', '--token');
  let allowedRaw = argValue(rest, '--allowed-chats', '--chat-ids');
  const allowWrite = rest.includes('--allow-write');

  if (!token) {
    if (!process.stdin.isTTY) {
      console.error(`ใช้: ${BRAND.cliName} gateway setup telegram --bot-token <token> --allowed-chats <chat_id[,chat_id]>`);
      process.exit(1);
    }
    console.log(`${BRAND.productName} Telegram setup`);
    console.log(`สร้าง bot ผ่าน @BotFather แล้ววาง token ที่นี่ (จะเก็บใน ${appHomePath('gateway', 'config.json')} chmod 600)`);
    token = await askText('Telegram bot token: ');
  }
  if (!allowedRaw) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --allowed-chats <chat_id[,chat_id]> เพื่อ fail-closed');
      process.exit(1);
    }
    allowedRaw = await askText('Allowed private chat IDs (comma-separated): ');
  }

  const { parseAllowedChats } = await import('./gateway/telegram.js');
  const allowedChatIds = parseAllowedChats(allowedRaw);
  if (!token.trim() || !allowedChatIds.length) {
    console.error('Telegram setup ต้องมี bot token และ allowed chat id อย่างน้อย 1 ค่า');
    process.exit(1);
  }

  const { patchGatewayConfig, gatewayConfigPath } = await import('./gateway/config.js');
  await patchGatewayConfig({
    telegram: {
      enabled: true,
      botToken: token.trim(),
      allowedChatIds,
      allowWrite,
    },
  });
  console.log(`บันทึก Telegram gateway config แล้ว: ${gatewayConfigPath()}`);
  console.log(`รัน: ${BRAND.cliName} gateway run`);
}

function parseStringCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runDiscordGatewaySetup(args: string[]): Promise<void> {
  let token = argValue(args, '--bot-token', '--token');
  let defaultChannel = argValue(args, '--channel', '--default-channel');
  let allowedRaw = argValue(args, '--allowed-channels', '--channel-ids');
  const allowWrite = args.includes('--allow-write');

  if (!token) {
    if (!process.stdin.isTTY) {
      console.error(`ใช้: ${BRAND.cliName} gateway setup discord --bot-token <token> --channel <channel_id>`);
      process.exit(1);
    }
    console.log(`${BRAND.productName} Discord setup`);
    console.log('สร้าง bot ใน Discord Developer Portal, เปิด Message Content Intent, แล้ววาง Bot Token ที่นี่');
    token = await askText('Discord bot token: ');
  }
  if (!defaultChannel && !allowedRaw) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --channel <channel_id> หรือ --allowed-channels <id[,id]>');
      process.exit(1);
    }
    defaultChannel = await askText('Default Discord channel ID: ');
  }

  const allowedChannelIds = parseStringCsv(allowedRaw ?? defaultChannel);
  if (!token.trim() || !allowedChannelIds.length) {
    console.error('Discord setup ต้องมี bot token และ channel id อย่างน้อย 1 ค่า');
    process.exit(1);
  }

  const { patchGatewayConfig, gatewayConfigPath } = await import('./gateway/config.js');
  await patchGatewayConfig({
    discord: {
      enabled: true,
      botToken: token.trim(),
      defaultChannelId: (defaultChannel ?? allowedChannelIds[0]).trim(),
      allowedChannelIds,
      allowWrite,
    },
  });
  console.log(`บันทึก Discord gateway config แล้ว: ${gatewayConfigPath()}`);
  console.log(`ส่งทดสอบได้ด้วย: ${BRAND.cliName} send --to discord "hello"`);
}

async function runSlackGatewaySetup(args: string[]): Promise<void> {
  let botToken = argValue(args, '--bot-token', '--token');
  let appToken = argValue(args, '--app-token');
  let defaultChannel = argValue(args, '--channel', '--default-channel');
  let allowedRaw = argValue(args, '--allowed-channels', '--channel-ids');
  const allowWrite = args.includes('--allow-write');

  if (!botToken) {
    if (!process.stdin.isTTY) {
      console.error(`ใช้: ${BRAND.cliName} gateway setup slack --bot-token <xoxb-token> --app-token <xapp-token> --channel <channel_id>`);
      process.exit(1);
    }
    console.log(`${BRAND.productName} Slack setup`);
    console.log('สร้าง Slack app, เปิด Socket Mode, เพิ่ม scopes แล้ววาง Bot Token (xoxb-) ที่นี่');
    botToken = await askText('Slack bot token (xoxb-): ');
  }
  if (!appToken && process.stdin.isTTY) {
    appToken = await askText('Slack app token (xapp-, optional for outbound send but needed for gateway Socket Mode): ');
  }
  if (!defaultChannel && !allowedRaw) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --channel <channel_id> หรือ --allowed-channels <id[,id]>');
      process.exit(1);
    }
    defaultChannel = await askText('Default Slack channel ID: ');
  }

  const allowedChannelIds = parseStringCsv(allowedRaw ?? defaultChannel);
  if (!botToken.trim() || !allowedChannelIds.length) {
    console.error('Slack setup ต้องมี bot token และ channel id อย่างน้อย 1 ค่า');
    process.exit(1);
  }

  const { patchGatewayConfig, gatewayConfigPath } = await import('./gateway/config.js');
  await patchGatewayConfig({
    slack: {
      enabled: true,
      botToken: botToken.trim(),
      appToken: appToken?.trim() || undefined,
      defaultChannelId: (defaultChannel ?? allowedChannelIds[0]).trim(),
      allowedChannelIds,
      allowWrite,
    },
  });
  console.log(`บันทึก Slack gateway config แล้ว: ${gatewayConfigPath()}`);
  console.log(`ส่งทดสอบได้ด้วย: ${BRAND.cliName} send --to slack "hello"`);
}

function parsePort(raw: string | undefined, fallback: number, label: string): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    console.error(`${label} ต้องเป็น port 1-65535`);
    process.exit(1);
  }
  return n;
}

async function runEmailGatewaySetup(args: string[]): Promise<void> {
  let address = argValue(args, '--address', '--email');
  let password = argValue(args, '--password', '--app-password');
  let imapHost = argValue(args, '--imap-host');
  let smtpHost = argValue(args, '--smtp-host');
  let homeAddress = argValue(args, '--home-address', '--to');
  let allowedRaw = argValue(args, '--allowed-users', '--allowed-senders');
  const imapPort = parsePort(argValue(args, '--imap-port'), 993, 'imap port');
  const smtpPort = parsePort(argValue(args, '--smtp-port'), 587, 'smtp port');
  const pollIntervalSeconds = parsePort(argValue(args, '--poll-interval'), 15, 'poll interval');
  const allowAllUsers = args.includes('--allow-all-users');

  if (!address) {
    if (!process.stdin.isTTY) {
      console.error(`ใช้: ${BRAND.cliName} gateway setup email --address bot@example.com --password <app-password> --imap-host imap.example.com --smtp-host smtp.example.com --home-address you@example.com`);
      process.exit(1);
    }
    console.log(`${BRAND.productName} Email setup`);
    console.log('แนะนำให้ใช้ dedicated mailbox + app password ไม่ใช่บัญชีส่วนตัวหลัก');
    address = await askText('Email address ของ bot: ');
  }
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --password <app-password>');
      process.exit(1);
    }
    password = await askText('Email app password: ');
  }
  if (!imapHost) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --imap-host <host>');
      process.exit(1);
    }
    imapHost = await askText('IMAP host (เช่น imap.gmail.com): ');
  }
  if (!smtpHost) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --smtp-host <host>');
      process.exit(1);
    }
    smtpHost = await askText('SMTP host (เช่น smtp.gmail.com): ');
  }
  if (!homeAddress && !allowedRaw && !allowAllUsers) {
    if (!process.stdin.isTTY) {
      console.error('ต้องระบุ --home-address <email> หรือ --allowed-users <email[,email]> เพื่อ fail-closed');
      process.exit(1);
    }
    homeAddress = await askText('Home/allowed email address: ');
  }
  const allowedUsers = parseStringCsv(allowedRaw ?? homeAddress).map((s) => s.toLowerCase());
  if (!allowAllUsers && !allowedUsers.length) {
    console.error('Email setup ต้องมี allowed sender/home address อย่างน้อย 1 ค่า หรือระบุ --allow-all-users');
    process.exit(1);
  }
  const { patchGatewayConfig, gatewayConfigPath } = await import('./gateway/config.js');
  await patchGatewayConfig({
    email: {
      enabled: true,
      address: address.trim(),
      password: password.trim(),
      imapHost: imapHost.trim(),
      imapPort,
      smtpHost: smtpHost.trim(),
      smtpPort,
      homeAddress: homeAddress?.trim() || allowedUsers[0],
      allowedUsers,
      allowAllUsers,
      pollIntervalSeconds,
    },
  });
  console.log(`บันทึก Email gateway config แล้ว: ${gatewayConfigPath()}`);
  console.log(`ส่งทดสอบได้ด้วย: ${BRAND.cliName} send --to email:${homeAddress?.trim() || allowedUsers[0]} "hello"`);
}

async function runGateway(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'status' || action === 'list') return runGatewayStatus();
  if (action === 'setup') return runGatewaySetup(rest);
  if (action === 'run') return runServe(rest);
  if (action === 'start') {
    const { startGatewayService } = await import('./gateway/service.js');
    const res = await startGatewayService({ entrypoint: resolve(process.argv[1]), gatewayArgs: rest });
    console.log(
      res.started
        ? `เริ่ม ${BRAND.cliName} gateway background แล้ว (pid ${res.state.pid})`
        : `${BRAND.cliName} gateway รันอยู่แล้ว (pid ${res.state.pid})`,
    );
    console.log(`log: ${res.state.logPath}`);
    return;
  }
  if (action === 'stop') {
    const { stopGatewayService } = await import('./gateway/service.js');
    const res = await stopGatewayService();
    console.log(res.state ? (res.stopped ? `หยุด gateway pid ${res.state.pid} แล้ว` : `gateway ไม่ได้รันอยู่ (last pid ${res.state.pid})`) : 'ยังไม่มี gateway service state');
    return;
  }
  if (action === 'restart') {
    const { startGatewayService, stopGatewayService } = await import('./gateway/service.js');
    await stopGatewayService();
    const res = await startGatewayService({ entrypoint: resolve(process.argv[1]), gatewayArgs: rest });
    console.log(`restart gateway แล้ว (pid ${res.state.pid})`);
    console.log(`log: ${res.state.logPath}`);
    return;
  }
  if (action === 'install') {
    const { installGatewayService } = await import('./gateway/service.js');
    const res = await installGatewayService(resolve(process.argv[1]));
    console.log(`ติดตั้ง service file แล้ว (${res.kind}): ${res.path}`);
    console.log('เริ่ม service ด้วย:');
    for (const line of res.instructions) console.log(`  ${line}`);
    return;
  }
  if (action === 'uninstall' || action === 'remove-service') {
    const { uninstallGatewayService } = await import('./gateway/service.js');
    const removed = await uninstallGatewayService();
    console.log(removed.length ? `ลบ service files:\n${removed.map((p) => `  ${p}`).join('\n')}` : 'ไม่พบ service file ที่ต้องลบ');
    return;
  }
  console.error(`ไม่รู้จัก: gateway ${action} — ใช้ setup / run / start / stop / restart / install / status`);
  process.exit(1);
}

async function runStatus(): Promise<void> {
  const cfg = await loadConfig({});
  const parsed = parseSpec(cfg.model);
  const provider = PROVIDERS[parsed.provider];
  const keyReady = provider ? (!provider.requiresKey || Boolean(resolveKeyFromEnv(provider.envVar, provider.envFallbacks))) : false;
  const { readGatewayConfig, resolveDiscordConfig, resolveEmailConfig, resolveSlackConfig, resolveTelegramConfig } = await import('./gateway/config.js');
  const gatewayConfig = await readGatewayConfig();
  const telegram = resolveTelegramConfig(gatewayConfig);
  const discord = resolveDiscordConfig(gatewayConfig);
  const slack = resolveSlackConfig(gatewayConfig);
  const email = resolveEmailConfig(gatewayConfig);
  console.log(`${BRAND.productName} status`);
  console.log(`  version:   ${VERSION}`);
  console.log(`  model:     ${cfg.model}`);
  console.log(`  provider:  ${provider?.label ?? parsed.provider}`);
  console.log(`  key:       ${keyReady ? 'ready' : provider?.requiresKey ? `missing (${provider.envVar})` : 'not required'}`);
  console.log(`  brain:     ${cfg.brainPath ?? '(not configured)'}`);
  console.log('  gateway:   HTTP loopback + cron available');
  console.log(
    `  telegram:  ${telegram.token ? `configured (${telegram.allowedChatIds.length} allowed chat${telegram.allowedChatIds.length === 1 ? '' : 's'})` : 'not configured'}`,
  );
  console.log(`  discord:   ${discord.token ? `configured (${discord.allowedChannelIds.length} allowed channel${discord.allowedChannelIds.length === 1 ? '' : 's'})` : 'not configured'}`);
  console.log(`  slack:     ${slack.botToken ? `configured (${slack.allowedChannelIds.length} allowed channel${slack.allowedChannelIds.length === 1 ? '' : 's'})` : 'not configured'}`);
  console.log(`  email:     ${email.address ? `configured (${email.allowedUsers.length} allowed sender${email.allowedUsers.length === 1 ? '' : 's'})` : 'not configured'}`);
  console.log(`  config:    ${appHomePath('config.json')}`);
}

function compactText(raw: string, max = 120): string {
  const text = redactKey(raw).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function messageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
        if (typeof record.type === 'string') return `[${record.type}]`;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function sessionPreview(session: Session): string {
  if (session.title) return compactText(session.title);
  const firstUser = session.messages.find((m) => (m as { role?: string }).role === 'user') ?? session.messages[0];
  return firstUser ? compactText(messageContentText((firstUser as { content?: unknown }).content)) : '';
}

function sessionUsage(): string {
  return `ใช้:
  ${BRAND.cliName} sessions [list] [--all] [--limit N]
  ${BRAND.cliName} sessions latest [--all]
  ${BRAND.cliName} sessions show <id>
  ${BRAND.cliName} sessions export <id> [--format json|markdown] [--output path]
  ${BRAND.cliName} sessions rename <id> <title>
  ${BRAND.cliName} sessions stats [--all]
  ${BRAND.cliName} sessions prune --keep N [--all] [--yes]
  ${BRAND.cliName} sessions rm <id>

resume:
  ${BRAND.cliName} --resume <id> "<task>"
  ${BRAND.cliName} -r <id> "<task>"`;
}

function parseLimit(args: string[], fallback: number): number {
  const raw = argValue(args, '--limit', '-n');
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error('--limit ต้องเป็น integer บวก');
    process.exit(2);
  }
  return n;
}

function printSessionDetails(session: Session): void {
  const users = session.messages.filter((m) => (m as { role?: string }).role === 'user');
  const assistants = session.messages.filter((m) => (m as { role?: string }).role === 'assistant');
  const lastUser = users[users.length - 1];
  const lastAssistant = assistants[assistants.length - 1];
  console.log(`${BRAND.productName} session ${session.id}`);
  if (session.title) console.log(`  title:     ${redactKey(session.title)}`);
  console.log(`  model:     ${session.model}`);
  console.log(`  cwd:       ${session.cwd}`);
  console.log(`  created:   ${session.created}`);
  console.log(`  updated:   ${session.updated}`);
  console.log(`  messages:  ${session.messages.length} (${users.length} user, ${assistants.length} assistant)`);
  console.log(`  preview:   ${sessionPreview(session) || '(empty)'}`);
  if (lastUser) console.log(`  last user: ${compactText(messageContentText((lastUser as { content?: unknown }).content)) || '(empty)'}`);
  if (lastAssistant) console.log(`  last ai:   ${compactText(messageContentText((lastAssistant as { content?: unknown }).content)) || '(empty)'}`);
}

function sessionToMarkdown(session: Session): string {
  const safe = sanitizeSessionForExport(session);
  const lines = [
    `# ${safe.title ? redactKey(safe.title) : `Session ${safe.id}`}`,
    '',
    `- id: ${safe.id}`,
    `- model: ${safe.model}`,
    `- cwd: ${safe.cwd}`,
    `- created: ${safe.created}`,
    `- updated: ${safe.updated}`,
    '',
  ];
  for (const [i, msg] of safe.messages.entries()) {
    const role = (msg as { role?: string }).role ?? 'message';
    const text = compactText(messageContentText((msg as { content?: unknown }).content), 20_000);
    lines.push(`## ${i + 1}. ${role}`, '', text || '(empty)', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function parseDateFlag(args: string[], ...names: string[]): Date | undefined {
  const raw = argValue(args, ...names);
  if (!raw) return undefined;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) {
    console.error(`วันที่ไม่ถูกต้อง: ${raw}`);
    process.exit(2);
  }
  return d;
}

async function loadSessionOrExit(id: string): Promise<Session> {
  const session = await loadSession(id);
  if (!session) {
    console.error(`ไม่เจอ session ${id}`);
    process.exit(1);
  }
  return session;
}

async function requestedResumeSession(rawArgs: string[], resumeId: string | undefined): Promise<Session | null> {
  const requested = rawArgs.includes('--resume') || rawArgs.includes('-r');
  if (!requested) return null;
  if (!resumeId) {
    console.error(`ใช้: ${BRAND.cliName} --resume <session_id> "<task>"`);
    process.exit(2);
  }
  return loadSessionOrExit(resumeId);
}

function printSessionStats(sessions: Session[], scope: string): void {
  const byModel = new Map<string, number>();
  let messages = 0;
  for (const s of sessions) {
    byModel.set(s.model, (byModel.get(s.model) ?? 0) + 1);
    messages += s.messages.length;
  }
  console.log(`${BRAND.productName} session stats (${scope})`);
  console.log(`  sessions: ${sessions.length}`);
  console.log(`  messages: ${messages}`);
  if (sessions[0]) console.log(`  latest:   ${sessions[0].id} (${sessions[0].updated})`);
  if (sessions[sessions.length - 1]) console.log(`  oldest:   ${sessions[sessions.length - 1].id} (${sessions[sessions.length - 1].updated})`);
  console.log('  models:');
  for (const [model, count] of [...byModel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${model}: ${count}`);
  }
}

async function runSessions(args: string[]): Promise<void> {
  if (args.includes('-h') || args.includes('--help') || args[0] === 'help') {
    console.log(sessionUsage());
    return;
  }
  const action = args[0] && !args[0].startsWith('-') ? args[0] : 'list';
  const rest = action === 'list' && (args[0]?.startsWith('-') || args[0] === undefined) ? args : args.slice(1);
  const all = rest.includes('--all') || rest.includes('-a');
  const cwd = all ? null : process.cwd();

  if (action === 'list' || action === 'ls') {
    const sessions = await listSessions({ cwd, limit: parseLimit(rest, 20) });
    if (!sessions.length) {
      console.log(`ยังไม่มี saved sessions${all ? '' : ' สำหรับ project นี้'} — store: ${sessionStorePath()}`);
      return;
    }
    console.log(`${BRAND.productName} sessions (${all ? 'all projects' : 'current project'})`);
    for (const s of sessions) {
      const cwdSuffix = all ? `  ${s.cwd}` : '';
      console.log(`${s.id}  ${s.updated}  ${s.model}  ${s.messages.length} msg  ${sessionPreview(s)}${cwdSuffix}`);
    }
    console.log(`\nstore: ${sessionStorePath()}`);
    return;
  }

  if (action === 'latest') {
    const session = (await listSessions({ cwd, limit: 1 }))[0];
    if (!session) {
      console.log(`ไม่เจอ session${all ? '' : ' สำหรับ project นี้'}`);
      return;
    }
    printSessionDetails(session);
    return;
  }

  if (action === 'show' || action === 'cat') {
    const id = positionalArgs(rest, ['--limit', '-n'])[0];
    if (!id) {
      console.error(`ใช้: ${BRAND.cliName} sessions show <id>`);
      process.exit(2);
    }
    printSessionDetails(await loadSessionOrExit(id));
    return;
  }

  if (action === 'export') {
    const id = positionalArgs(rest, ['--format', '--output', '-o'])[0];
    if (!id) {
      console.error(`ใช้: ${BRAND.cliName} sessions export <id> [--format json|markdown] [--output path]`);
      process.exit(2);
    }
    const format = argValue(rest, '--format') ?? 'markdown';
    if (format !== 'json' && format !== 'markdown' && format !== 'md') {
      console.error('--format ต้องเป็น json หรือ markdown');
      process.exit(2);
    }
    const session = await loadSessionOrExit(id);
    const out = format === 'json' ? `${JSON.stringify(sanitizeSessionForExport(session), null, 2)}\n` : sessionToMarkdown(session);
    const outputPath = argValue(rest, '--output', '-o');
    if (!outputPath || outputPath === '-') {
      process.stdout.write(out);
      return;
    }
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, out, { mode: 0o600 });
    await chmod(outputPath, 0o600).catch(() => {});
    console.log(`exported session ${id} → ${outputPath}`);
    return;
  }

  if (action === 'rename' || action === 'title') {
    const [id, ...titleParts] = positionalArgs(rest, ['--limit', '-n']);
    const title = titleParts.join(' ').trim();
    if (!id || !title) {
      console.error(`ใช้: ${BRAND.cliName} sessions rename <id> <title>`);
      process.exit(2);
    }
    const next = await renameSession(id, title);
    if (!next) {
      console.error(`ไม่เจอ session ${id}`);
      process.exit(1);
    }
    console.log(`ตั้งชื่อ session ${id}: ${redactKey(next.title ?? '')}`);
    return;
  }

  if (action === 'stats') {
    printSessionStats(await listSessions({ cwd }), all ? 'all projects' : 'current project');
    return;
  }

  if (action === 'prune') {
    const keepRaw = argValue(rest, '--keep');
    const before = parseDateFlag(rest, '--before');
    if (!keepRaw && !before) {
      console.error(`ใช้: ${BRAND.cliName} sessions prune --keep N [--before YYYY-MM-DD] [--all] [--yes]`);
      process.exit(2);
    }
    const keep = keepRaw == null ? undefined : Number(keepRaw);
    if (keep != null && (!Number.isInteger(keep) || keep < 0)) {
      console.error('--keep ต้องเป็น integer >= 0');
      process.exit(2);
    }
    const candidates = await listSessions({ cwd });
    const candidateIds = new Set<string>();
    if (keep != null) for (const s of candidates.slice(keep)) candidateIds.add(s.id);
    if (before) {
      const beforeMs = before.getTime();
      for (const s of candidates) {
        const updatedMs = Date.parse(s.updated);
        if (Number.isFinite(updatedMs) && updatedMs < beforeMs) candidateIds.add(s.id);
      }
    }
    if (!candidateIds.size) {
      console.log('ไม่มี session ที่ต้อง prune');
      return;
    }
    if (!rest.includes('--yes') && !rest.includes('-y')) {
      console.log(`จะลบ ${candidateIds.size} sessions (dry-run):`);
      for (const s of candidates.filter((x) => candidateIds.has(x.id))) console.log(`  ${s.id}  ${s.updated}  ${sessionPreview(s)}`);
      console.log(`\nรันซ้ำพร้อม --yes เพื่อยืนยัน`);
      return;
    }
    const removed = await pruneSessions({ cwd, keep, before });
    console.log(`ลบ ${removed.length} sessions แล้ว`);
    return;
  }

  if (action === 'rm' || action === 'remove' || action === 'delete') {
    const id = positionalArgs(rest, ['--limit', '-n'])[0];
    if (!id) {
      console.error(`ใช้: ${BRAND.cliName} sessions rm <id>`);
      process.exit(2);
    }
    const ok = await removeSession(id);
    console.log(ok ? `ลบ session ${id} แล้ว` : `ไม่เจอ session ${id}`);
    return;
  }

  console.error(`ไม่รู้จัก: sessions ${action}\n${sessionUsage()}`);
  process.exit(1);
}

async function runDump(args: string[]): Promise<void> {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`ใช้: ${BRAND.cliName} dump [--show-keys]\n\nสร้าง diagnostic/support dump โดย redact secret เสมอ`);
    return;
  }
  const { buildSupportDump } = await import('./support-dump.js');
  process.stdout.write(
    await buildSupportDump({
      showKeys: args.includes('--show-keys'),
      version: VERSION,
      packageName: PACKAGE_NAME,
      cwd: process.cwd(),
    }),
  );
}

function providerIds(): string {
  return Object.keys(PROVIDERS).join(', ');
}

function findProviderId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (PROVIDERS[lower]) return lower;
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    if (raw === cfg.envVar || cfg.envFallbacks?.includes(raw)) return id;
  }
  return undefined;
}

function authEnvSource(providerId: string): string | undefined {
  const cfg = PROVIDERS[providerId];
  if (!cfg) return undefined;
  for (const name of [cfg.envVar, ...(cfg.envFallbacks ?? [])]) {
    if (process.env[name]?.trim()) return name;
  }
  return undefined;
}

function authUsage(): string {
  return `ใช้:
  ${BRAND.cliName} auth list
  ${BRAND.cliName} auth status <provider>
  ${BRAND.cliName} auth add <provider> --api-key <key> [--use]
  ${BRAND.cliName} auth remove <provider|ENV_VAR>
  ${BRAND.cliName} auth reset [provider|ENV_VAR]

providers: ${providerIds()}`;
}

async function runAuth(args: string[]): Promise<void> {
  const action = args[0] ?? 'list';
  const rest = args.slice(action === 'list' && args[0] !== 'list' ? 0 : 1);
  const { authConfigPath, clearStoredAuth, readStoredAuthRaw, removeStoredKey, saveGlobalConfig, saveKey } = await import('./config.js');

  if (action === '-h' || action === '--help' || action === 'help') {
    console.log(authUsage());
    return;
  }

  if (action === 'list' || action === 'ls' || action === 'status-all') {
    const stored = await readStoredAuthRaw();
    console.log(`${BRAND.productName} auth`);
    console.log(`  store: ${authConfigPath()}`);
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      if (!cfg.requiresKey) {
        console.log(`  ${id.padEnd(10)} ${cfg.label} — no API key required`);
        continue;
      }
      const key = resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks);
      const source = authEnvSource(id);
      const saved = stored[cfg.envVar];
      const state = key ? `ready via ${source ?? cfg.envVar}` : `missing ${cfg.envVar}`;
      const savedText = saved ? ` · stored ${redactKey(saved)}` : '';
      console.log(`  ${id.padEnd(10)} ${cfg.label} — ${state}${savedText}`);
    }
    return;
  }

  if (action === 'status') {
    const providerId = findProviderId(positionalArgs(rest, ['--api-key', '--key', '--token', '--model'])[0]);
    if (!providerId) {
      console.error(`ใช้: ${BRAND.cliName} auth status <provider>\nproviders: ${providerIds()}`);
      process.exit(1);
    }
    const cfg = PROVIDERS[providerId];
    const stored = await readStoredAuthRaw();
    const key = resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks);
    const source = authEnvSource(providerId);
    console.log(`${cfg.label} (${providerId})`);
    console.log(`  key required: ${cfg.requiresKey ? 'yes' : 'no'}`);
    console.log(`  env var:      ${cfg.envVar}${cfg.envFallbacks?.length ? ` (fallback: ${cfg.envFallbacks.join(', ')})` : ''}`);
    console.log(`  stored:       ${stored[cfg.envVar] ? redactKey(stored[cfg.envVar]) : '(not stored)'}`);
    console.log(`  runtime:      ${key ? `${redactKey(key)} via ${source ?? cfg.envVar}` : '(missing)'}`);
    const url = consoleUrl(providerId);
    if (url) console.log(`  console:      ${url}`);
    if (cfg.note) console.log(`  note:         ${cfg.note}`);
    return;
  }

  if (action === 'add' || action === 'login') {
    const providerId = findProviderId(positionalArgs(rest, ['--api-key', '--key', '--token', '--model'])[0]);
    if (!providerId) {
      console.error(`ใช้: ${BRAND.cliName} auth add <provider> --api-key <key>\nproviders: ${providerIds()}`);
      process.exit(1);
    }
    const cfg = PROVIDERS[providerId];
    if (!cfg.requiresKey) {
      console.log(`${cfg.label} ไม่ต้องเก็บ API key ใน Sanook`);
      if (cfg.note) console.log(cfg.note);
      return;
    }

    let key = argValue(rest, '--api-key', '--key', '--token');
    if (!key) {
      if (!process.stdin.isTTY) {
        console.error(`ใช้: ${BRAND.cliName} auth add ${providerId} --api-key <key>`);
        process.exit(1);
      }
      key = await askText(`${cfg.label} API key (${cfg.keyExample ?? cfg.envVar}): `);
    }
    try {
      assertDirectApiKey(cfg, key);
    } catch (e) {
      console.error(redactKey((e as Error).message));
      process.exit(1);
    }
    await saveKey(cfg.envVar, key.trim());
    console.log(`บันทึก ${cfg.label} key แล้ว: ${cfg.envVar}=${redactKey(key.trim())}`);

    if (rest.includes('--use') || rest.includes('--default')) {
      const modelArg = argValue(rest, '--model', '-m') ?? 'default';
      const model = modelArg.includes(':') ? modelArg : `${providerId}:${cfg.models[modelArg] ?? modelArg}`;
      await saveGlobalConfig({ model, provider: providerId });
      console.log(`ตั้ง default model เป็น ${model}`);
    } else {
      console.log(`ใช้เป็น default ได้ด้วย: ${BRAND.cliName} auth add ${providerId} --api-key <key> --use`);
    }
    return;
  }

  if (action === 'remove' || action === 'rm' || action === 'logout') {
    const target = positionalArgs(rest, ['--api-key', '--key', '--token', '--model'])[0];
    if (!target && action !== 'logout') {
      console.error(`ใช้: ${BRAND.cliName} auth remove <provider|ENV_VAR>`);
      process.exit(1);
    }
    if (!target && action === 'logout') {
      await clearStoredAuth();
      console.log('ล้าง key ที่ Sanook เก็บไว้ทั้งหมดแล้ว');
      return;
    }
    const providerId = findProviderId(target);
    const envVar = providerId ? PROVIDERS[providerId].envVar : target;
    const ok = await removeStoredKey(envVar);
    console.log(ok ? `ลบ ${envVar} ออกจาก Sanook auth store แล้ว` : `ไม่เจอ ${envVar} ใน Sanook auth store`);
    return;
  }

  if (action === 'reset' || action === 'clear') {
    const target = positionalArgs(rest, ['--api-key', '--key', '--token', '--model'])[0];
    if (!target) {
      await clearStoredAuth();
      console.log('ล้าง key ที่ Sanook เก็บไว้ทั้งหมดแล้ว');
      return;
    }
    const providerId = findProviderId(target);
    const envVar = providerId ? PROVIDERS[providerId].envVar : target;
    const ok = await removeStoredKey(envVar);
    console.log(ok ? `ลบ ${envVar} ออกจาก Sanook auth store แล้ว` : `ไม่เจอ ${envVar} ใน Sanook auth store`);
    return;
  }

  console.error(`ไม่รู้จัก: auth ${action}\n${authUsage()}`);
  process.exit(1);
}

async function runSetup(args: string[]): Promise<void> {
  const section = args.find((a) => !a.startsWith('-')) ?? 'model';
  const start = args.indexOf(section);
  const rest = start === -1 ? [] : args.slice(start + 1);
  if (section === 'model') return startModelSetup();
  if (section === 'gateway') return runGateway(['setup', ...rest]);
  if (section === 'tools') return runTools(rest);
  if (section === 'agent') return runAgentSetupSummary();
  if (section === 'brain') return runBrain(['init', ...rest]);
  console.error(`ไม่รู้จัก setup section "${section}" — ใช้ model / gateway / tools / agent / brain`);
  process.exit(1);
}

function modelOverrideForProvider(providerArg: string | undefined, modelArg: string | undefined): string | undefined {
  const providerId = findProviderId(providerArg);
  if (!providerArg) return modelArg;
  if (!providerId) {
    console.error(`ไม่รู้จัก provider "${providerArg}" — มี: ${providerIds()}`);
    process.exit(1);
  }
  if (!modelArg) return `${providerId}:${PROVIDERS[providerId].models.default}`;
  if (modelArg.includes(':')) return modelArg;
  return `${providerId}:${PROVIDERS[providerId].models[modelArg] ?? modelArg}`;
}

function appendPipedInput(prompt: string, piped: string): string {
  return piped ? `${prompt}\n\n<stdin>\n${piped}\n</stdin>`.trim() : prompt;
}

async function runChat(args: string[]): Promise<void> {
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`ใช้:
  ${BRAND.cliName} chat -q "<query>" [--provider <provider>] [--model <alias|id>]
  ${BRAND.cliName} chat "<query>" [--provider <provider>]
  ${BRAND.cliName} chat                 เปิด interactive REPL

providers: ${providerIds()}`);
    return;
  }

  let split = extractValue(args, '-q', '--query');
  const query = split.value;
  split = extractValue(split.rest, '--provider');
  const provider = split.value;
  split = extractValue(split.rest, '--toolsets', '--tools');
  const toolsets = split.value;
  const safeMode = split.rest.includes('--safe-mode');
  const yolo = split.rest.includes('--yolo') || split.rest.includes('--dangerously-skip-permissions');
  const cleaned = stripBooleanFlags(split.rest, '--safe-mode', '--yolo', '--dangerously-skip-permissions');
  const parsed = parseArgs(yolo ? [...cleaned, '--yes'] : cleaned);
  const resumeSession = await requestedResumeSession(cleaned, parsed.resume);
  const budgetUsd = Number.isFinite(parsed.budget) ? parsed.budget : undefined;
  const model = modelOverrideForProvider(provider, parsed.model ?? (provider ? undefined : resumeSession?.model));
  const piped = process.stdin.isTTY ? '' : (await readStdin()).trim();
  const prompt = appendPipedInput(query ?? parsed.prompt, piped);

  if (toolsets && !parsed.quiet && !parsed.json) {
    process.stderr.write(`${DIM}(toolsets="${toolsets}" accepted; Sanook currently exposes the configured tool surface)${RESET}\n`);
  }

  if (!prompt) {
    const config = await loadConfig({ model, budgetUsd });
    const { startApp } = await import('./ui/render.js');
    startApp({
      needsSetup: false,
      appProps: {
        initialModel: config.model,
        fallbackModel: config.fallbackModel,
        budgetUsd: config.budgetUsd,
        permissionMode: parsed.yes || yolo ? 'auto' : safeMode ? 'ask' : config.permissionMode,
        initialHistory:
          resumeSession?.messages ??
          (cleaned.includes('--continue') || cleaned.includes('-c') || cleaned.includes('--continue-any')
            ? (await latestSession(cleaned.includes('--continue-any') ? null : process.cwd()))?.messages
            : undefined),
      },
    });
    return;
  }

  const config = await loadConfig({ model, budgetUsd });
  const noKey = headlessKeyHint(config.model);
  if (noKey) {
    process.stderr.write(`${noKey}\n`);
    process.exit(1);
  }
  const wantsContinue = args.includes('--continue') || args.includes('-c') || args.includes('--continue-any');
  const history = resumeSession?.messages ?? (wantsContinue ? (await latestSession(args.includes('--continue-any') ? null : process.cwd()))?.messages : undefined);
  await runHeadless(
    config.model,
    prompt,
    config.budgetUsd,
    config.maxSteps,
    parsed.json,
    history,
    parsed.planMode,
    parsed.yes || yolo ? 'auto' : safeMode ? 'ask' : config.permissionMode,
    parsed.quiet,
    config.fallbackModel,
  );
}

async function runPureOneShot(args: string[]): Promise<void> {
  const rest = args[0] === '--' ? args.slice(1) : args;
  const parsed = parseArgs(rest);
  const resumeSession = await requestedResumeSession(rest, parsed.resume);
  const budgetUsd = Number.isFinite(parsed.budget) ? parsed.budget : undefined;
  const piped = process.stdin.isTTY ? '' : (await readStdin()).trim();
  const prompt = appendPipedInput(parsed.prompt, piped);
  if (!prompt) {
    console.error(`ใช้: ${BRAND.cliName} -z "<task>"`);
    process.exit(1);
  }
  const config = await loadConfig({ model: parsed.model ?? resumeSession?.model, budgetUsd });
  const noKey = headlessKeyHint(config.model);
  if (noKey) {
    process.stderr.write(`${noKey}\n`);
    process.exit(1);
  }
  const wantsContinue = rest.includes('--continue') || rest.includes('-c') || rest.includes('--continue-any');
  const history = resumeSession?.messages ?? (wantsContinue ? (await latestSession(rest.includes('--continue-any') ? null : process.cwd()))?.messages : undefined);
  await runHeadless(
    config.model,
    prompt,
    config.budgetUsd,
    config.maxSteps,
    parsed.json,
    history,
    parsed.planMode,
    parsed.yes ? 'auto' : config.permissionMode,
    true,
    config.fallbackModel,
  );
}

async function runSend(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const quiet = args.includes('--quiet') || args.includes('-q');
  const wantsList = args.includes('--list') || args.includes('-l');
  const valueFlags = ['--to', '-t', '--file', '-f', '--subject', '-s'];
  if (args.includes('-h') || args.includes('--help')) {
    console.log(`ใช้:
  ${BRAND.cliName} send --to telegram[:chat_id[:thread_id]] "message"
  ${BRAND.cliName} send --to discord[:channel_id[:thread_id]] "message"
  ${BRAND.cliName} send --to slack[:channel_id[:thread_ts]] "message"
  ${BRAND.cliName} send --to email[:recipient@example.com] --subject "[CI]" "message"
  ${BRAND.cliName} send --to slack --subject "[CI]" --file build.log
  echo "done" | ${BRAND.cliName} send --to telegram --quiet
  ${BRAND.cliName} send --list [platform] [--json]`);
    return;
  }

  if (wantsList) {
    const { listConfiguredTargets } = await import('./gateway/targets.js');
    const { readGatewayConfig } = await import('./gateway/config.js');
    const filter = positionalArgs(args, valueFlags)[0];
    const targets = listConfiguredTargets(await readGatewayConfig()).filter((t) => !filter || t.platform === filter);
    if (json) {
      console.log(JSON.stringify({ targets }));
      return;
    }
    if (!targets.length) {
      console.log(filter ? `ยังไม่มี target สำหรับ ${filter}` : `ยังไม่มี messaging target — เริ่มด้วย: ${BRAND.cliName} gateway setup`);
      return;
    }
    for (const t of targets) {
      console.log(`${t.target.padEnd(24)} ${t.configured ? 'ready' : 'not-ready'}  ${t.label}`);
    }
    return;
  }

  const to = argValue(args, '--to', '-t');
  if (!to) {
    console.error(`ใช้: ${BRAND.cliName} send --to <telegram|discord|slack|email>[:target] "message"`);
    process.exit(2);
  }
  const file = argValue(args, '--file', '-f');
  const subject = argValue(args, '--subject', '-s');
  let message = positionalArgs(args, valueFlags).join(' ').trim();
  if (!message && file) message = file === '-' ? await readStdin() : await readFile(file, 'utf8');
  if (!message && !process.stdin.isTTY) message = (await readStdin()).trim();
  if (subject && message && !to.startsWith('email')) message = `${subject.trim()}\n\n${message.trim()}`;
  if (!message) {
    console.error('message ว่าง — ใส่ข้อความ, --file <path>, หรือ pipe stdin เข้ามา');
    process.exit(2);
  }

  const { parseSendTarget, formatTarget } = await import('./gateway/targets.js');
  let target;
  try {
    target = parseSendTarget(to);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const { readGatewayConfig, resolveDiscordConfig, resolveEmailConfig, resolveSlackConfig, resolveTelegramConfig } = await import('./gateway/config.js');
  const gatewayConfig = await readGatewayConfig();
  try {
    if (target.platform === 'telegram') {
      const telegram = resolveTelegramConfig(gatewayConfig);
      if (!telegram.token) {
        console.error(`ยังไม่ได้ตั้ง Telegram — รัน: ${BRAND.cliName} gateway setup telegram`);
        process.exit(2);
      }
      const chatId = target.chatId ?? telegram.allowedChatIds[0];
      if (!Number.isInteger(chatId)) {
        console.error('ต้องระบุ chat id หรือมี allowed chat อย่างน้อย 1 ค่าใน gateway config');
        process.exit(2);
      }
      if (telegram.allowedChatIds.length && !telegram.allowedChatIds.includes(chatId)) {
        console.error(`chat ${chatId} ไม่อยู่ใน allowlist (${telegram.allowedChatIds.join(', ')})`);
        process.exit(2);
      }
      const { sendTelegramMessage } = await import('./gateway/telegram.js');
      const result = await sendTelegramMessage(telegram.token, chatId, message, target.threadId);
      const resolvedTarget = formatTarget({ platform: 'telegram', chatId, threadId: target.threadId });
      if (json) console.log(JSON.stringify({ ok: true, target: resolvedTarget, ...result }));
      else if (!quiet) console.log(`sent ${resolvedTarget}`);
      return;
    }

    if (target.platform === 'discord') {
      const discord = resolveDiscordConfig(gatewayConfig);
      if (!discord.token) {
        console.error(`ยังไม่ได้ตั้ง Discord — รัน: ${BRAND.cliName} gateway setup discord`);
        process.exit(2);
      }
      const channelId = target.thread ?? target.address ?? discord.defaultChannelId;
      if (!channelId) {
        console.error('ต้องระบุ Discord channel id หรือ default channel ใน gateway config');
        process.exit(2);
      }
      const baseChannel = target.address ?? channelId;
      if (discord.allowedChannelIds.length && !discord.allowedChannelIds.includes(baseChannel) && !discord.allowedChannelIds.includes(channelId)) {
        console.error(`channel ${baseChannel} ไม่อยู่ใน allowlist (${discord.allowedChannelIds.join(', ')})`);
        process.exit(2);
      }
      const { sendDiscordMessage } = await import('./gateway/discord.js');
      const result = await sendDiscordMessage(discord.token, channelId, message);
      const resolvedTarget = formatTarget({ platform: 'discord', address: target.address ?? channelId, thread: target.thread });
      if (json) console.log(JSON.stringify({ ok: true, target: resolvedTarget, ...result }));
      else if (!quiet) console.log(`sent ${resolvedTarget}`);
      return;
    }

    if (target.platform === 'slack') {
      const slack = resolveSlackConfig(gatewayConfig);
      if (!slack.botToken) {
        console.error(`ยังไม่ได้ตั้ง Slack — รัน: ${BRAND.cliName} gateway setup slack`);
        process.exit(2);
      }
      const channelId = target.address ?? slack.defaultChannelId;
      if (!channelId) {
        console.error('ต้องระบุ Slack channel id หรือ default channel ใน gateway config');
        process.exit(2);
      }
      if (slack.allowedChannelIds.length && !slack.allowedChannelIds.includes(channelId)) {
        console.error(`channel ${channelId} ไม่อยู่ใน allowlist (${slack.allowedChannelIds.join(', ')})`);
        process.exit(2);
      }
      const { sendSlackMessage } = await import('./gateway/slack.js');
      const result = await sendSlackMessage(slack.botToken, channelId, message, target.thread);
      const resolvedTarget = formatTarget({ platform: 'slack', address: channelId, thread: target.thread });
      if (json) console.log(JSON.stringify({ ok: true, target: resolvedTarget, ...result }));
      else if (!quiet) console.log(`sent ${resolvedTarget}`);
      return;
    }

    if (target.platform === 'email') {
      const email = resolveEmailConfig(gatewayConfig);
      if (!email.address || !email.password || !email.smtpHost) {
        console.error(`ยังไม่ได้ตั้ง Email — รัน: ${BRAND.cliName} gateway setup email`);
        process.exit(2);
      }
      const toAddress = target.address ?? email.homeAddress;
      if (!toAddress) {
        console.error('ต้องระบุ email recipient หรือ home address ใน gateway config');
        process.exit(2);
      }
      const lower = toAddress.toLowerCase();
      if (!email.allowAllUsers && email.allowedUsers.length && !email.allowedUsers.includes(lower)) {
        console.error(`email ${toAddress} ไม่อยู่ใน allowlist (${email.allowedUsers.join(', ')})`);
        process.exit(2);
      }
      const { sendEmailMessage } = await import('./gateway/email.js');
      const result = await sendEmailMessage(
        { address: email.address, password: email.password, smtpHost: email.smtpHost, smtpPort: email.smtpPort, fromName: BRAND.productName },
        toAddress,
        message,
        { subject: subject?.trim() || BRAND.productName },
      );
      const resolvedTarget = formatTarget({ platform: 'email', address: toAddress });
      if (json) console.log(JSON.stringify({ ok: true, target: resolvedTarget, ...result }));
      else if (!quiet) console.log(`sent ${resolvedTarget}`);
      return;
    }

    console.error(`ยังไม่รองรับ platform "${target.platform}" — ตอนนี้รองรับ telegram / discord / slack / email`);
    process.exit(2);
  } catch (e) {
    const msg = redactKey((e as Error).message);
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`ส่งไม่สำเร็จ: ${msg}`);
    process.exit(1);
  }
}

/** sanook cron add "<when>" "<task>" | cron list | cron rm <id> */
async function runCron(args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const { listTasks, enqueueTask, removeTask } = await import('./gateway/ledger.js');

  if (action === 'add') {
    const schedule = rest[0];
    const spec = rest.slice(1).join(' ').trim();
    if (!schedule || !spec) {
      console.error('ใช้: sanook cron add "<when>" "<task>"   (when: "every 30m" | "09:00" | ISO | now)');
      console.error('หมายเหตุ: when ที่มีช่องว่างต้องครอบ quote เช่น "every 30m"');
      process.exit(1);
    }
    const { parseSchedule } = await import('./gateway/schedule.js');
    const sched = parseSchedule(schedule, Date.now());
    if (!sched) {
      console.error(`schedule ไม่ถูกต้อง: "${schedule}" — ลอง "every 30m", "09:00", ISO, หรือ "now"`);
      if (rest.length > 1 && /^(every|\d)/.test(schedule)) {
        console.error('(ดูเหมือนลืมครอบ quote — when ที่มีช่องว่างต้องเป็น "every 30m" ทั้งก้อน)');
      }
      process.exit(1);
    }
    const task = await enqueueTask({
      kind: sched.recurring ? 'cron' : 'once',
      spec,
      schedule: sched.recurring ? sched.normalized : undefined,
      runAt: sched.runAt,
    });
    const when = new Date(task.runAt).toLocaleString();
    console.log(`เพิ่ม task ${task.id} — รัน ${when}${sched.recurring ? ` แล้วทุก ${sched.normalized}` : ''}`);
    return;
  }

  if (action === 'rm' || action === 'remove') {
    if (!rest[0]) {
      console.error('ใช้: sanook cron rm <id>');
      process.exit(1);
    }
    const ok = await removeTask(rest[0]);
    console.log(ok ? `ลบ task ${rest[0]} แล้ว` : `ไม่เจอ task ${rest[0]}`);
    return;
  }

  if (action === 'list' || action === undefined) {
    const tasks = await listTasks();
    if (!tasks.length) {
      console.log(`ยังไม่มี task — เพิ่มด้วย: ${BRAND.cliName} cron add "every 1h" "เช็คข่าว AI"`);
      return;
    }
    for (const t of tasks) {
      const next = new Date(t.runAt).toLocaleString();
      console.log(`${t.id}  [${t.status}]  ${t.schedule ?? 'once'}  next:${next}  → ${t.spec.slice(0, 50)}`);
    }
    return;
  }

  console.error(`ไม่รู้จัก: cron ${action} — ใช้ add / list / rm`);
  process.exit(1);
}

/** sanook skill list | add <source> | remove <name> */
async function runSkill(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  if (action === 'add') {
    const source = rest[0];
    if (!source) {
      console.error('ใช้: sanook skill add <github "user/repo" | URL ของ SKILL.md | local path>');
      process.exit(1);
    }
    console.error(`${DIM}⚠ skill = instruction ที่ AI จะทำตาม — ติดตั้งจาก source ที่เชื่อถือเท่านั้น${RESET}`);
    const { installSkill } = await import('./skill-install.js');
    try {
      const installed = await installSkill(source, (m) => process.stderr.write(`${DIM}${m}${RESET}\n`));
      console.log(`ติดตั้ง ${installed.length} skill: ${installed.map((s) => s.name).join(', ')}`);
    } catch (e) {
      console.error(`ติดตั้งไม่สำเร็จ: ${redactKey((e as Error).message)}`);
      process.exit(1);
    }
    return;
  }

  if (action === 'remove' || action === 'rm') {
    if (!rest[0]) {
      console.error('ใช้: sanook skill remove <name>');
      process.exit(1);
    }
    const { removeInstalledSkill } = await import('./skill-install.js');
    const ok = await removeInstalledSkill(rest[0]);
    console.log(ok ? `ลบ skill ${rest[0]} แล้ว` : `ไม่เจอ skill ${rest[0]} ที่ติดตั้งไว้ (bundled ลบไม่ได้)`);
    return;
  }

  // list (default)
  const { loadSkills } = await import('./skills.js');
  const skills = await loadSkills();
  console.log(`${skills.length} skills:`);
  for (const s of skills) {
    const d = s.description.length > 72 ? `${s.description.slice(0, 72)}…` : s.description;
    console.log(`  ${s.name}  —  ${d}`);
  }
}

/** sanook models [provider] — ดู models + verify กับ provider จริง (flag id ที่ stale) */
async function runModels(args: string[]): Promise<void> {
  const { PROVIDERS } = await import('./providers/registry.js');
  const provider = args[0];
  if (!provider) {
    console.log(`providers: ${Object.keys(PROVIDERS).join(' ')}`);
    console.log('ใช้: sanook models <provider>  (ใส่ API key ใน env เพื่อ verify กับของจริง)');
    return;
  }
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    console.error(`ไม่รู้จัก provider "${provider}" — มี: ${Object.keys(PROVIDERS).join(' ')}`);
    process.exit(1);
  }
  console.log(`${cfg.label} — curated (registry):`);
  for (const [alias, id] of Object.entries(cfg.models)) console.log(`  ${alias.padEnd(10)} → ${id}`);

  if (cfg.kind === 'delegate') {
    console.log('\n(delegate provider — ไม่มี /models endpoint; ใช้ curated id ด้านบน)');
    return;
  }
  const { resolveKeyFromEnv } = await import('./providers/keys.js');
  const key = resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks);
  if (!key && cfg.requiresKey) {
    console.log(`\n(ใส่ ${cfg.envVar} เพื่อ verify model id กับ provider จริง)`);
    return;
  }
  const { listRemoteModels } = await import('./providers/models.js');
  const live = await listRemoteModels(cfg, key ?? cfg.localPlaceholderKey);
  if (!live.length) {
    console.log('\n(ดึง live models ไม่ได้ — endpoint/key)');
    return;
  }
  console.log(`\nlive (${live.length} จาก provider):`);
  console.log(`  ${live.slice(0, 30).join('\n  ')}${live.length > 30 ? '\n  …' : ''}`);
  const liveSet = new Set(live);
  const stale = [...new Set(Object.values(cfg.models))].filter((id) => !liveSet.has(id));
  if (stale.length) console.log(`\n⚠ id ใน registry ที่ provider ไม่มีแล้ว (อาจ stale): ${stale.join(', ')}`);
  else console.log('\n✓ ทุก curated id มีใน provider');
}

/** sanook brain init [path] — scaffold second-brain workspace (interactive ถ้าไม่ใส่ path) */
async function runBrain(args: string[]): Promise<void> {
  if (args[0] !== 'init') {
    console.log(`ใช้: sanook brain init [path]   สร้างโครงสร้าง second-brain (Obsidian vault)
  ไม่ใส่ path → wizard ถาม path + ตัวตน
  -y, --yes  ใช้ค่า default ทั้งหมด (ต้องระบุ path)`);
    return;
  }
  const rest = args.slice(1);
  const yes = rest.includes('-y') || rest.includes('--yes');
  const pathArg = rest.find((a) => !a.startsWith('-'));

  // interactive: ไม่มี path และไม่ --yes → render BrainWizard
  if (!pathArg && !yes) {
    const { startBrainSetup } = await import('./ui/render.js');
    await startBrainSetup();
    return;
  }

  const { scaffoldBrain, BRAIN_DEFAULTS, expandHome, wireBrainMcp } = await import('./brain.js');
  const target = expandHome(pathArg ?? join(homedir(), 'Documents', BRAIN_DEFAULTS.vaultName));
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await scaffoldBrain(target, { ...BRAIN_DEFAULTS, today });
    const { saveBrainPath } = await import('./config.js');
    await saveBrainPath(target);
    const wired = await wireBrainMcp(target).catch(() => 'skip');
    console.log(`✅ second-brain — ${target}`);
    console.log(`   สร้าง ${res.created.length} ไฟล์/โฟลเดอร์ · ข้าม ${res.skipped.length} (มีอยู่แล้ว ไม่ทับ)`);
    console.log(`   ${wired === 'added' ? 'wire filesystem MCP เข้า vault แล้ว' : 'MCP: มี server เดิม (ไม่ทับ)'}`);
    console.log(`   เปิดใน Obsidian: Open folder as vault → ${target}`);
  } catch (e) {
    console.error(`สร้างไม่สำเร็จ: ${(e as Error).message}`);
    process.exit(1);
  }
}

/** อ่าน stdin จนจบ (เมื่อถูก pipe เข้ามา เช่น `git diff | sanook "review"`) */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** sanook config [get <k> | set <k> <v>] — ดู/แก้ ~/.sanook/config.json โดยไม่ต้องแก้มือ */
async function runConfig(args: string[]): Promise<void> {
  const { readGlobalConfigRaw, patchGlobalConfig } = await import('./config.js');
  const [action, key, ...rest] = args;
  const ALLOWED = [
    'model',
    'fallbackModel',
    'budgetUsd',
    'maxSteps',
    'permissionMode',
    'brainPath',
    'pricing',
    'cacheTtl',
    'compaction',
    'thinking',
    'summaryModel',
    'embeddingModel',
  ];
  if (action === 'set') {
    if (!key || rest.length === 0) {
      console.error(`ใช้: ${BRAND.cliName} config set <key> <value>   (key: ${ALLOWED.join(' | ')})`);
      process.exit(1);
    }
    if (!ALLOWED.includes(key)) {
      console.error(`ตั้งได้เฉพาะ: ${ALLOWED.join(', ')}`);
      process.exit(1);
    }
    const raw = rest.join(' ');
    let value: unknown = raw;
    if (key === 'budgetUsd') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        console.error('budgetUsd ต้องเป็นตัวเลขบวก เช่น 0.25');
        process.exit(1);
      }
      value = n;
    } else if (key === 'maxSteps') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        console.error('maxSteps ต้องเป็น integer บวก เช่น 20');
        process.exit(1);
      }
      value = n;
    } else if (key === 'permissionMode' && raw !== 'auto' && raw !== 'ask') {
      console.error('permissionMode ต้องเป็น auto หรือ ask');
      process.exit(1);
    } else if (key === 'cacheTtl' && raw !== '5m' && raw !== '1h') {
      console.error('cacheTtl ต้องเป็น 5m หรือ 1h');
      process.exit(1);
    } else if (key === 'compaction' && raw !== 'truncate' && raw !== 'summarize') {
      console.error('compaction ต้องเป็น truncate หรือ summarize');
      process.exit(1);
    } else if (key === 'thinking') {
      // เก็บเป็น number (budget) หรือ boolean ให้ตรง ConfigSchema (ไม่เก็บ string)
      if (raw === 'on' || raw === 'true') value = true;
      else if (raw === 'off' || raw === 'false') value = false;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          console.error('thinking ต้องเป็น on/off หรือ budget tokens (integer บวก เช่น 4000)');
          process.exit(1);
        }
        value = n;
      }
    } else if (key === 'pricing') {
      try {
        value = parsePricingOverride(raw); // { "provider:model": { input, output, cacheRead?, cacheWrite? } }
      } catch (e) {
        console.error(`pricing ต้องเป็น JSON เช่น '{"openai:gpt-5.5":{"input":1.25,"output":10}}' — ${(e as Error).message}`);
        process.exit(1);
      }
    }
    await patchGlobalConfig({ [key]: value });
    console.log(`ตั้ง ${key} = ${raw}`);
    return;
  }
  if (action === 'get') {
    const cfg = await readGlobalConfigRaw();
    console.log(cfg[key] ?? '(ไม่ได้ตั้ง)');
    return;
  }
  console.log(`${appHomePath('config.json')}:\n${JSON.stringify(await readGlobalConfigRaw(), null, 2)}`);
}

/** sanook index — incremental (re)index of vault + memory + sessions + skills */
async function runIndex(_args: string[]): Promise<void> {
  const { reindex } = await import('./search/indexer.js');
  console.log('indexing…');
  const r = await reindex();
  const { resetSearchCaches } = await import('./search/engine.js');
  resetSearchCaches();
  console.log(
    `done: +${r.added} ~${r.updated} -${r.removed} (skipped ${r.skipped}) · ` +
      `memory=${r.memory} sessions=${r.sessions} skills=${r.skills} vectors=${r.vectors}\n` +
      `vault: ${r.vaultPath ?? '(not set — `' + BRAND.cliName + ' brain init` or set config.brainPath)'}`,
  );
}

/** sanook search "<query>" [--mode ..] [--limit N] [--source a,b] — one-shot ranked search */
async function runSearch(args: string[]): Promise<void> {
  const { parseSearchArgs } = await import('./search/cli.js');
  const parsed = parseSearchArgs(args);
  if (!parsed.ok) {
    console.error(parsed.message);
    console.error(`ใช้: ${BRAND.cliName} search "<query>" [--mode auto|fts|semantic|hybrid] [--limit N] [--source vault,memory]`);
    process.exit(1);
  }
  const { query, mode, limit, sources } = parsed.value;
  const { search } = await import('./search/engine.js');
  const res = await search(query, { mode, limit, sources });
  if (res.degraded) console.log(`${DIM}(mode=${res.mode}, degraded: ${res.degraded})${RESET}`);
  else console.log(`${DIM}(mode=${res.mode}, ${res.hits.length} hits)${RESET}`);
  if (!res.hits.length) {
    console.log(`ไม่เจอ "${query}" — ลองรัน ${BRAND.cliName} index ก่อน (ถ้ายังไม่เคย index vault)`);
    return;
  }
  for (const h of res.hits) {
    const title = h.title.trim();
    const head = title ? `${title} — ${h.snippet}` : h.snippet;
    const where = h.path ? ` ${DIM}(${h.path})${RESET}` : '';
    console.log(`${DIM}[${h.source}]${RESET} ${head}${where}`);
  }
}

/** sanook mcp serve — run the stdio MCP server exposing sanook's brain */
async function runMcpServe(): Promise<void> {
  const { runMcpServer } = await import('./mcp-server.js');
  await runMcpServer();
}

/** sanook mcp [list | add <name> <command> [args...] | remove <name>] — จัดการ ~/.sanook/mcp.json */
async function runMcp(args: string[]): Promise<void> {
  const mcpPath = appHomePath('mcp.json');
  type Server = { command?: string; args?: string[]; url?: string };
  let cfg: { mcpServers: Record<string, Server> } = { mcpServers: {} };
  try {
    const parsed = JSON.parse(await readFile(mcpPath, 'utf8')) as { mcpServers?: Record<string, Server> };
    cfg = { mcpServers: parsed.mcpServers ?? {} };
  } catch {
    /* ยังไม่มีไฟล์ */
  }
  const write = async (): Promise<void> => {
    await mkdir(dirname(mcpPath), { recursive: true });
    await writeFile(mcpPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    await chmod(mcpPath, 0o600).catch(() => {});
  };
  const [action, name, command, ...cmdArgs] = args;

  if (action === 'add') {
    if (!name || !command) {
      console.error(`ใช้: ${BRAND.cliName} mcp add <name> <command> [args...]   (เช่น: mcp add fs npx -y @modelcontextprotocol/server-filesystem /path)`);
      console.error(`     remote: ${BRAND.cliName} mcp add <name> https://host/mcp   (Streamable-HTTP)`);
      process.exit(1);
    }
    if (!isValidMcpServerName(name)) {
      console.error('ชื่อ MCP server ต้องเป็น a-z/A-Z/0-9/_/- ความยาวไม่เกิน 64 และห้ามใช้ชื่อพิเศษ');
      process.exit(1);
    }
    // command เป็น http(s):// → remote MCP (Streamable-HTTP), ไม่งั้น stdio
    cfg.mcpServers[name] = /^https?:\/\//.test(command) ? { url: command } : { command, args: cmdArgs };
    await write();
    console.log(`เพิ่ม MCP server "${name}"${/^https?:\/\//.test(command) ? ' (remote http)' : ''}`);
    return;
  }
  if (action === 'remove' || action === 'rm') {
    if (name && cfg.mcpServers[name]) {
      delete cfg.mcpServers[name];
      await write();
      console.log(`ลบ MCP server "${name}" แล้ว`);
    } else console.log(`ไม่เจอ MCP server "${name ?? ''}"`);
    return;
  }
  const names = Object.keys(cfg.mcpServers);
  if (!names.length) {
    console.log(`ยังไม่มี MCP server — เพิ่ม: ${BRAND.cliName} mcp add <name> <command> [args...]`);
    return;
  }
  console.log(`${names.length} MCP servers:`);
  for (const n of names) {
    const s = cfg.mcpServers[n];
    console.log(`  ${n}  —  ${s.url ? `${s.url} (http)` : `${s.command} ${(s.args ?? []).join(' ')}`}`);
  }
}

/** sanook trust [status|add|remove] — trust project .sanook content that can steer/execute code */
async function runTrust(args: string[]): Promise<void> {
  const action = args[0] ?? 'status';
  const { projectTrustStatus, trustProject, untrustProject } = await import('./trust.js');
  if (action === 'status') {
    const s = await projectTrustStatus();
    console.log(`${s.trusted ? 'trusted' : 'untrusted'} — ${s.root}${s.reason === 'env' ? ' (env override)' : ''}`);
    return;
  }
  if (action === 'add') {
    const root = await trustProject();
    console.log(`trusted project: ${root}`);
    return;
  }
  if (action === 'remove' || action === 'rm') {
    const root = await untrustProject();
    console.log(`removed trust: ${root}`);
    return;
  }
  console.error(`ไม่รู้จัก: trust ${action} — ใช้ status / add / remove`);
  process.exit(1);
}

/** sanook update — one-command update path for globally installed CLI */
async function runUpdate(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length) {
    console.error(`ใช้: ${BRAND.cliName} update [--check]`);
    process.exit(1);
  }

  const { checkForUpdate, installLatest } = await import('./update.js');
  try {
    console.log(`เช็กอัปเดต ${PACKAGE_NAME}...`);
    const check = await checkForUpdate({ name: PACKAGE_NAME, version: VERSION });
    if (!check.isOutdated) {
      console.log(`คุณใช้เวอร์ชันล่าสุดแล้ว (${check.currentVersion})`);
      return;
    }

    console.log(`มีเวอร์ชันใหม่: ${check.currentVersion} → ${check.latestVersion}`);
    console.log(`คำสั่งอัปเดต: ${check.installCommand}`);
    if (checkOnly) {
      console.log(`รัน "${BRAND.cliName} update" เพื่ออัปเดต`);
      return;
    }

    const code = await installLatest({ name: PACKAGE_NAME, version: VERSION });
    if (code !== 0) {
      console.error(`อัปเดตไม่สำเร็จ (npm exit ${code}) — ลองรันเอง: ${check.installCommand}`);
      process.exit(code);
    }
    console.log(`อัปเดตสำเร็จ — ตรวจสอบด้วย: ${BRAND.cliName} --version`);
  } catch (e) {
    console.error(`เช็ก/อัปเดตไม่สำเร็จ: ${redactKey((e as Error).message)}`);
    console.error(`ลองรันเอง: npm install -g ${PACKAGE_NAME}@latest`);
    process.exit(1);
  }
}

const UPDATE_CACHE_PATH = appHomePath('update-check.json');

async function readUpdateCache(): Promise<UpdateCache> {
  try {
    const parsed = JSON.parse(await readFile(UPDATE_CACHE_PATH, 'utf8')) as UpdateCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUpdateCache(latestVersion: string): Promise<void> {
  await mkdir(dirname(UPDATE_CACHE_PATH), { recursive: true });
  await writeFile(
    UPDATE_CACHE_PATH,
    `${JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(UPDATE_CACHE_PATH, 0o600).catch(() => {});
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function askText(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function extractValue(args: string[], ...names: string[]): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = names.find((name) => a.startsWith(`${name}=`));
    if (eq) {
      value ??= a.slice(eq.length + 1);
      continue;
    }
    if (names.includes(a)) {
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        value ??= args[i + 1];
        i++;
      }
      continue;
    }
    rest.push(a);
  }
  return { value, rest };
}

function stripBooleanFlags(args: string[], ...names: string[]): string[] {
  return args.filter((a) => !names.includes(a));
}

function positionalArgs(args: string[], valueFlags: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valueFlags.some((name) => a.startsWith(`${name}=`))) continue;
    if (valueFlags.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
}

function argValue(args: string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const eq = args.find((a) => a.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const idx = args.indexOf(name);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  }
  return undefined;
}

async function maybePromptForInteractiveUpdate(): Promise<void> {
  if (envFlag(BRAND_ENV.disableUpdateCheck) || process.env.CI) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const { checkForUpdate, installLatest, shouldCheckForUpdate } = await import('./update.js');
  const cache = await readUpdateCache();
  if (!shouldCheckForUpdate(cache)) return;

  try {
    const check = await checkForUpdate({ name: PACKAGE_NAME, version: VERSION }, { timeoutMs: 2500 });
    await writeUpdateCache(check.latestVersion).catch(() => {});
    if (!check.isOutdated) return;

    process.stdout.write(
      `\nมี ${BRAND.productName} CLI เวอร์ชันใหม่: ${check.currentVersion} → ${check.latestVersion}\n` +
        `อัปเดตตอนนี้ด้วย "${BRAND.cliName} update" ไหม? [Y/n] `,
    );
    const ok = await askYesNo('');
    if (!ok) {
      process.stdout.write(`ข้ามอัปเดตตอนนี้ — อัปเดตภายหลังได้ด้วย: ${BRAND.cliName} update\n\n`);
      return;
    }

    const code = await installLatest({ name: PACKAGE_NAME, version: VERSION });
    if (code !== 0) {
      process.stdout.write(`อัปเดตไม่สำเร็จ (npm exit ${code}) — ลองรันเอง: ${check.installCommand}\n\n`);
      return;
    }
    process.stdout.write(`อัปเดตสำเร็จ — เปิด ${BRAND.cliName} ใหม่เพื่อใช้เวอร์ชันล่าสุด\n\n`);
    process.exit(0);
  } catch {
    // update notifier ต้องไม่ block การเปิด TUI ถ้า offline/registry ล่ม/cache พัง
  }
}

/** headless: model ต้อง key แต่ env ยังไม่มี → คืนข้อความแนะวิธีเริ่ม (null = พร้อมใช้) */
function headlessKeyHint(modelSpec: string): string | null {
  const { provider } = parseSpec(modelSpec);
  const cfg = PROVIDERS[provider];
  if (!cfg?.requiresKey || resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks)) return null;
  const url = consoleUrl(provider);
  const lines = [
    `⚠ ยังไม่มี API key สำหรับ ${cfg.label} (${cfg.envVar})`,
    `เริ่มใช้งาน:`,
    `  • รัน "${BRAND.cliName}" (ไม่ใส่ task) → setup wizard ทีละขั้น (แนะนำ)`,
    `  • หรือ: ${BRAND.cliName} auth add ${provider} --api-key "..." --use${url ? `   ·  เอา key ที่: ${url}` : ''}`,
    `  • หรือ: export ${cfg.envVar}="..."${url ? `   ·  เอา key ที่: ${url}` : ''}`,
  ];
  if (provider === 'openai') {
    lines.push(`  • ถ้าต้องการใช้ ChatGPT plan ไม่ใช้ API key: ใช้ ${BRAND.cliName} -m codex แล้วรัน codex login`);
  }
  const other = detectEnvProvider();
  if (other && other.provider !== provider) {
    lines.push(`  • เจอ key ของ ${other.label} อยู่แล้ว → ใช้เลย: ${BRAND.cliName} -m ${other.provider} "<task>"`);
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  // Node ≥ 22 required (uses node:fs glob, AbortSignal.timeout, ฯลฯ) — บอกชัดแทนปล่อย crash งงๆ
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(nodeMajor) && nodeMajor < 22) {
    console.error(
      `${BRAND.productName} ต้องใช้ Node.js เวอร์ชัน 22 ขึ้นไป — ตอนนี้ใช้ ${process.version}\n` +
        `อัปเดต Node ที่ https://nodejs.org (หรือ nvm/fnm/volta) แล้วลองใหม่`,
    );
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  if (argv.length === 1 && (argv[0] === '-v' || argv[0] === '--version')) {
    console.log(VERSION);
    return;
  }
  if (argv.length === 1 && (argv[0] === '-h' || argv[0] === '--help')) {
    console.log(HELP);
    return;
  }
  if (argv[0] === 'update') return runUpdate(argv.slice(1));
  // doctor — ไม่ต้องโหลด key/mcp; ตรวจ Node/PATH/global-bin แล้วบอกวิธีแก้ "sanook ไม่เจอ"
  if (argv[0] === 'doctor') {
    const { runDoctor } = await import('./doctor.js');
    console.log(await runDoctor(PACKAGE_NAME));
    return;
  }

  // โหลด API key จาก ~/.sanook/auth.json เข้า env (ไม่ override env ที่ตั้งไว้แล้ว)
  await loadKeysIntoEnv();
  process.on('exit', closeMcp); // ปิด MCP server (kill child) ตอนจบ

  // Hermes-style management surfaces (branded for Sanook) — setup/model/gateway/status/tools/send
  if (argv[0] === '-z') return runPureOneShot(argv.slice(1));
  if (argv[0] === 'chat') return runChat(argv.slice(1));
  if (argv[0] === 'setup') return runSetup(argv.slice(1));
  if (argv[0] === 'model' && (argv.length === 1 || argv[1].startsWith('--'))) return startModelSetup();
  if (argv[0] === 'gateway') return runGateway(argv.slice(1));
  if (argv[0] === 'status' && (argv.length === 1 || argv[1].startsWith('--'))) return runStatus();
  if (argv[0] === 'auth') return runAuth(argv.slice(1));
  if (argv[0] === 'sessions' || argv[0] === 'session') return runSessions(argv.slice(1));
  if (argv[0] === 'dump') return runDump(argv.slice(1));
  if (argv[0] === 'tools' && (argv.length === 1 || argv[1].startsWith('--'))) return runTools(argv.slice(1));
  if (argv[0] === 'send') return runSend(argv.slice(1));

  // subcommands: serve · cron — match เฉพาะรูปแบบที่ถูกต้อง กัน prompt unquoted ("serve coffee") misfire
  if (argv[0] === 'serve' && (argv.length === 1 || argv[1].startsWith('--'))) return runServe(argv.slice(1));
  if (argv[0] === 'cron' && ['add', 'list', 'rm', 'remove', undefined].includes(argv[1])) {
    return runCron(argv.slice(1));
  }
  if (argv[0] === 'skill' && ['list', 'add', 'remove', 'rm', undefined].includes(argv[1])) {
    return runSkill(argv.slice(1));
  }
  if (argv[0] === 'models') return runModels(argv.slice(1));
  if (argv[0] === 'brain' && ['init', undefined].includes(argv[1])) return runBrain(argv.slice(1));
  if (argv[0] === 'config' && ['get', 'set', 'list', undefined].includes(argv[1])) return runConfig(argv.slice(1));
  if (argv[0] === 'index' && (argv.length === 1 || argv[1].startsWith('--'))) return runIndex(argv.slice(1));
  if (argv[0] === 'search' && argv.length > 1) return runSearch(argv.slice(1));
  if (argv[0] === 'mcp' && argv[1] === 'serve') return runMcpServe();
  if (argv[0] === 'mcp' && ['add', 'list', 'remove', 'rm', undefined].includes(argv[1])) return runMcp(argv.slice(1));
  if (argv[0] === 'trust' && ['status', 'add', 'remove', 'rm', undefined].includes(argv[1])) return runTrust(argv.slice(1));

  const { model, budget, json, quiet, prompt: argPrompt, planMode, yes, resume } = parseArgs(argv);
  const resumeSession = await requestedResumeSession(argv, resume);
  const budgetUsd = Number.isFinite(budget) ? budget : undefined;
  // stdin piping: `git diff | sanook "review this"` → ผนวก stdin เข้า prompt (headless/CI)
  const piped = process.stdin.isTTY ? '' : (await readStdin()).trim();
  const prompt = piped ? `${argPrompt}\n\n<stdin>\n${piped}\n</stdin>`.trim() : argPrompt;

  if (prompt) {
    const config = await loadConfig({ model: model ?? resumeSession?.model, budgetUsd });
    // headless + ยังไม่มี key → บอกวิธีเริ่มแบบ actionable แทนปล่อยให้ throw error ดิบ (กัน dead-end ของ flow ที่ README แนะนำ)
    const noKey = headlessKeyHint(config.model);
    if (noKey) {
      process.stderr.write(`${noKey}\n`);
      process.exit(1);
    }
    // --continue / -c → โหลด session ล่าสุดมาต่อ (จำว่าทำถึงไหน)
    const wantsContinue = argv.includes('--continue') || argv.includes('-c') || argv.includes('--continue-any');
    const history =
      resumeSession?.messages ??
      (wantsContinue
        ? (await latestSession(argv.includes('--continue-any') ? null : process.cwd()))?.messages
        : undefined);
    await runHeadless(
      config.model,
      prompt,
      config.budgetUsd,
      config.maxSteps,
      json,
      history,
      planMode,
      yes ? 'auto' : config.permissionMode,
      quiet,
      config.fallbackModel,
    );
    return;
  }

  await maybePromptForInteractiveUpdate();

  // interactive — ครั้งแรก (ยังไม่มี config): ถ้าไม่มี key ใช้ได้ใน env → ต้องโชว์ wizard
  let needsSetup = false;
  if (await isFirstRun()) {
    // provider เป้าหมาย: เคารพ -m ที่ user ใส่ก่อน (กันขึ้น "พร้อมใช้" ผิด provider), ไม่งั้น scan env ตามนิยม
    const flagProvider = model ? parseSpec(model).provider : undefined;
    const target = flagProvider ?? detectEnvProvider()?.provider;
    const tcfg = target ? PROVIDERS[target] : undefined;
    const { providerCanSkipSetup } = await import('./first-run.js');
    if (target && tcfg && (await providerCanSkipSetup(target))) {
      // มี key ใช้ได้จริง (ผ่าน policy ไม่ใช่ OAuth) → ข้าม wizard, ตั้ง default, บอกว่าพร้อมใช้
      const { saveGlobalConfig } = await import('./config.js');
      await saveGlobalConfig({ model: model ?? `${target}:${tcfg.models.default}`, provider: target });
      console.log(`✅ ${tcfg.label} พร้อมใช้เลย (ข้าม setup wizard)\n`);
    } else {
      needsSetup = true; // ไม่มี provider ที่ key ใช้ได้ (หรือ -m provider ไม่มี key) → wizard (รัน Ink เดียวกับ REPL)
    }
  }
  const config = await loadConfig({ model: model ?? resumeSession?.model, budgetUsd });
  if (!needsSetup) {
    const { modelNeedsSetup } = await import('./first-run.js');
    needsSetup = await modelNeedsSetup(config.model);
  }
  // --continue / -c → โหลด conversation ล่าสุดเข้า REPL (เดิม resume ได้แค่ headless)
  const initialHistory =
    resumeSession?.messages ??
    (argv.includes('--continue') || argv.includes('-c') || argv.includes('--continue-any')
      ? (await latestSession(argv.includes('--continue-any') ? null : process.cwd()))?.messages
      : undefined);
  const { startApp } = await import('./ui/render.js');
  startApp({
    needsSetup,
    appProps: {
      initialModel: config.model,
      fallbackModel: config.fallbackModel,
      budgetUsd: config.budgetUsd,
      permissionMode: yes ? 'auto' : config.permissionMode,
      initialHistory,
    },
  });
}

main().catch((err) => {
  console.error(redactKey((err as Error).message ?? String(err)));
  process.exit(1);
});
