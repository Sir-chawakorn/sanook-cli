#!/usr/bin/env node
import { runAgent, type AgentEvent } from './loop.js';
import { redactKey } from './providers/keys.js';
import { specKey, parseSpec, PROVIDERS, consoleUrl, detectEnvProvider } from './providers/registry.js';
import { resolveKeyFromEnv } from './providers/keys.js';
import { hasPricingForKey } from './cost.js';
import type { ModelMessage } from 'ai';
import { loadConfig, isFirstRun, loadKeysIntoEnv, parsePricingOverride } from './config.js';
import { saveSession, latestSession, newSessionId } from './session.js';
import { closeMcp, isValidMcpServerName } from './mcp.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
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
  ${BRAND.cliName}                     interactive REPL
  ${BRAND.cliName} --json "<task>"     headless, JSONL output (for CI/scripts)
  ${BRAND.cliName} update              update ${BRAND.cliName} to the latest npm release
  ${BRAND.cliName} doctor              ตรวจการติดตั้ง + วิธีแก้ PATH (เมื่อพิมพ์ "${BRAND.cliName}" แล้วไม่เจอ)

gateway (อยู่ยาว 24/7 — HTTP loopback + cron):
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
  ${BRAND.cliName} config [get|set <k> <v>]       ดู/แก้ ${appHomePath('config.json')} (model/budgetUsd/permissionMode/cacheTtl/compaction/thinking/embeddingModel)
  ${BRAND.cliName} mcp [list|add <name> <cmd> …|remove <name>]   จัดการ MCP servers
  ${BRAND.cliName} trust [status|add|remove]      อนุญาต/ยกเลิก project .sanook mcp/hooks/skills/commands

flags:
  -m, --model <spec>   sonnet/opus/haiku/fable · gpt/codex · gemini · grok · deepseek · mistral · groq · ollama/lmstudio
                       or "provider:model-id" (e.g. openai:gpt-5.3-codex, groq:fast, google:gemini-2.5-flash)
  -b, --budget <usd>   stop when estimated cost exceeds this
  -c, --continue       resume the latest session ของ project นี้
      --continue-any   resume latest session ข้าม project (explicit)
      --plan           plan mode — สำรวจ+วางแผนเท่านั้น ไม่แก้ไฟล์ (read-only)
  -y, --yes            อนุมัติ tool อัตโนมัติ (ข้าม ask-mode permission)
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
  console.log(
    `done: +${r.added} ~${r.updated} -${r.removed} (skipped ${r.skipped}) · ` +
      `memory=${r.memory} sessions=${r.sessions} skills=${r.skills}\nvault: ${r.vaultPath ?? '(not set — `' + BRAND.cliName + ' brain init` or set config.brainPath)'}`,
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
    `  • หรือ: export ${cfg.envVar}="..."${url ? `   ·  เอา key ที่: ${url}` : ''}`,
  ];
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

  const { model, budget, json, quiet, prompt: argPrompt, planMode, yes } = parseArgs(argv);
  const budgetUsd = Number.isFinite(budget) ? budget : undefined;
  // stdin piping: `git diff | sanook "review this"` → ผนวก stdin เข้า prompt (headless/CI)
  const piped = process.stdin.isTTY ? '' : (await readStdin()).trim();
  const prompt = piped ? `${argPrompt}\n\n<stdin>\n${piped}\n</stdin>`.trim() : argPrompt;

  if (prompt) {
    const config = await loadConfig({ model, budgetUsd });
    // headless + ยังไม่มี key → บอกวิธีเริ่มแบบ actionable แทนปล่อยให้ throw error ดิบ (กัน dead-end ของ flow ที่ README แนะนำ)
    const noKey = headlessKeyHint(config.model);
    if (noKey) {
      process.stderr.write(`${noKey}\n`);
      process.exit(1);
    }
    // --continue / -c → โหลด session ล่าสุดมาต่อ (จำว่าทำถึงไหน)
    const wantsContinue = argv.includes('--continue') || argv.includes('-c') || argv.includes('--continue-any');
    const history = wantsContinue
      ? (await latestSession(argv.includes('--continue-any') ? null : process.cwd()))?.messages
      : undefined;
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
  const config = await loadConfig({ model, budgetUsd });
  // --continue / -c → โหลด conversation ล่าสุดเข้า REPL (เดิม resume ได้แค่ headless)
  const initialHistory =
    argv.includes('--continue') || argv.includes('-c') || argv.includes('--continue-any')
      ? (await latestSession(argv.includes('--continue-any') ? null : process.cwd()))?.messages
      : undefined;
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
