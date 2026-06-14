#!/usr/bin/env node
import { runAgent, type AgentEvent } from './loop.js';
import { redactKey } from './providers/keys.js';
import type { ModelMessage } from 'ai';
import { loadConfig, isFirstRun, loadKeysIntoEnv } from './config.js';
import { saveSession, latestSession, newSessionId } from './session.js';
import { closeMcp } from './mcp.js';
import { readFileSync } from 'node:fs';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

interface Args {
  model?: string;
  budget?: number;
  json: boolean;
  prompt: string;
  planMode: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): Args {
  let model: string | undefined;
  let budget: number | undefined;
  let json = false;
  let planMode = false;
  let yes = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' || a === '-m') model = argv[++i];
    else if (a === '--budget' || a === '-b') budget = Number.parseFloat(argv[++i] ?? '');
    else if (a === '--json') json = true;
    else if (a === '--plan') planMode = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else if (a === '-p' || a === '--print' || a === '-c' || a === '--continue') {
      /* -p headless flag · -c/--continue resume (handled in main) */
    } else rest.push(a);
  }
  return { model, budget, json, prompt: rest.join(' ').trim(), planMode, yes };
}

async function runHeadless(
  model: string,
  prompt: string,
  budgetUsd: number | undefined,
  maxSteps: number,
  json: boolean,
  history?: ModelMessage[],
  planMode = false,
  permissionMode: 'auto' | 'ask' = 'auto',
): Promise<void> {
  const controller = new AbortController();
  process.on('SIGINT', () => {
    controller.abort();
    process.exit(130);
  });
  try {
    const { cost, messages } = await runAgent({
      model,
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
        else if (e.type === 'tool-call') process.stdout.write(`\n${DIM}→ ${e.tool}${RESET}\n`);
      },
    });
    if (!json) process.stdout.write(`\n${DIM}${cost.summary()}${RESET}\n`);
    // จำ session ไว้ทำงานต่อได้ (sanook --continue "...") — แก้ concern AI ลืมว่าทำถึงไหน
    const now = new Date().toISOString();
    await saveSession({ id: newSessionId(), created: now, updated: now, model, cwd: process.cwd(), messages });
  } catch (err) {
    const msg = redactKey((err as Error).message);
    if (json) process.stdout.write(`${JSON.stringify({ type: 'error', message: msg })}\n`);
    else console.error(`\nERROR: ${msg}`);
    process.exit(1);
  }
}

// อ่านจาก package.json (single source of truth) — กัน version constant drift
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;
const HELP = `Sanook — a terminal AI coding agent (BYOK)

usage:
  sanook "<task>"            run one task (headless)
  sanook                     interactive REPL
  sanook --json "<task>"     headless, JSONL output (for CI/scripts)

gateway (อยู่ยาว 24/7 — HTTP loopback + cron):
  sanook serve [--port 8787]            เปิด gateway (OpenAI-compat /v1/chat/completions + scheduler)
  sanook cron add "<when>" "<task>"     ตั้งงานล่วงหน้า (when: "every 30m" | "09:00" | ISO | now)
  sanook cron list                      ดู task ทั้งหมด
  sanook cron rm <id>                   ลบ task

skills (69 built-in + ติดตั้งเพิ่มได้):
  sanook skill list                     ดู skill ทั้งหมด
  sanook skill add <user/repo|url|path> ติดตั้ง skill จาก GitHub / URL / local
  sanook skill remove <name>            ลบ skill ที่ติดตั้ง
  sanook models [provider]              ดู/verify model id (เทียบ provider จริงถ้ามี key)

flags:
  -m, --model <spec>   sonnet/opus/haiku/fable · gpt/codex · gemini · grok · deepseek · mistral · groq · ollama/lmstudio
                       or "provider:model-id" (e.g. openai:gpt-5-codex, groq:fast, google:gemini-2.5-flash)
  -b, --budget <usd>   stop when estimated cost exceeds this
  -c, --continue       resume the latest session (จำว่าทำถึงไหน → ทำต่อ)
      --plan           plan mode — สำรวจ+วางแผนเท่านั้น ไม่แก้ไฟล์ (read-only)
  -y, --yes            อนุมัติ tool อัตโนมัติ (ข้าม ask-mode permission)
      --json           machine-readable JSONL output
  -v, --version
  -h, --help

env (BYOK — direct API key only):
  ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY`;

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
  process.stdout.write(`${DIM}Sanook gateway — model: ${config.model}${RESET}\n`);
  const stop = await startGateway({
    port,
    model: config.model,
    budgetUsd: config.budgetUsd,
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
      console.log('ยังไม่มี task — เพิ่มด้วย: sanook cron add "every 1h" "เช็คข่าว AI"');
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('-v') || argv.includes('--version')) {
    console.log(VERSION);
    return;
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP);
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

  const { model, budget, json, prompt, planMode, yes } = parseArgs(argv);
  const budgetUsd = Number.isFinite(budget) ? budget : undefined;

  if (prompt) {
    const config = await loadConfig({ model, budgetUsd });
    // --continue / -c → โหลด session ล่าสุดมาต่อ (จำว่าทำถึงไหน)
    const history =
      argv.includes('--continue') || argv.includes('-c') ? (await latestSession())?.messages : undefined;
    await runHeadless(
      config.model,
      prompt,
      config.budgetUsd,
      config.maxSteps,
      json,
      history,
      planMode,
      yes ? 'auto' : config.permissionMode,
    );
    return;
  }

  // interactive — ครั้งแรก (ยังไม่มี config) → setup wizard ก่อนเข้า REPL
  if (await isFirstRun()) {
    const { startSetup } = await import('./ui/render.js');
    await startSetup();
  }
  const config = await loadConfig({ model, budgetUsd });
  const { startRepl } = await import('./ui/render.js');
  startRepl({
    initialModel: config.model,
    budgetUsd: config.budgetUsd,
    permissionMode: yes ? 'auto' : config.permissionMode,
  });
}

main().catch((err) => {
  console.error(redactKey((err as Error).message ?? String(err)));
  process.exit(1);
});
