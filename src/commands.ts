import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSpec, consoleUrl, hasUsableEnvKey, PROVIDERS, parseSpec } from './providers/registry.js';
import { appHomePath, BRAND } from './brand.js';
import { parseFrontmatter } from './skills.js';
import { projectConfigPathIfTrusted } from './trust.js';
import { normalizePersonalityName, personalityListText } from './personality.js';
import { parseInsightsArgs } from './insights-args.js';

export interface CommandResult {
  /** true = เป็น slash command (ไม่ส่งเข้า agent) */
  handled: boolean;
  action?: 'clear' | 'compact' | 'quit' | 'help' | 'diff' | 'undo' | 'rewind' | 'retry' | 'stop' | 'personality' | 'insights';
  /** ข้อความแสดงกลับ (help / cost / model / unknown) */
  message?: string;
  /** /model <spec> — เปลี่ยน model */
  modelChange?: string;
  /** /personality <name> — persist named personality overlay */
  personalityChange?: string;
  /** /insights [--days N] */
  insightsDays?: number;
  /** /insights --all */
  insightsAll?: boolean;
}

const HELP_TEXT = `คำสั่ง:
  /help            แสดงคำสั่งทั้งหมด
  /new, /reset      เริ่มบทสนทนาใหม่
  /status          ดูสถานะ session ปัจจุบัน
  /model [spec]    ดู/เปลี่ยน model (เช่น /model opus, /model openai:gpt-5)
  /personality [name]
                   ดู/ตั้ง personality overlay
  /platforms       ดู providers + messaging platforms ที่รองรับ
  /tools           ดู tools ที่ agent ใช้ได้
  /skills          ดูจำนวน skills (จัดการ: ${BRAND.cliName} skill list)
  /diff            ดู git diff (สิ่งที่ agent แก้ในรอบนี้)
  /retry           รัน prompt ล่าสุดอีกครั้ง
  /stop            หยุด turn ที่กำลังรัน
  /undo            stash การแก้ไฟล์ล่าสุด (กู้คืนด้วย git stash pop)
  /rewind          ย้อนกลับ 1 turn (คืนไฟล์ git + ตัดบทสนทนา, recoverable)
  /cost, /usage     ดู token + cost รอบล่าสุด
  /insights [--days N] [--all]
                   ดู usage/session insights ในเครื่อง
  ↑/↓ ประวัติ · @ไฟล์ แนบ context/รูป · \\ ลงท้าย = บรรทัดใหม่
  /clear           ล้าง conversation (เริ่มใหม่)
  /compact, /compress
                   บีบ context (truncate · หรือ summarize ถ้าตั้ง compaction)
  /quit            ออก

นอก REPL (พิมพ์ใน shell):
  ${BRAND.cliName} search "<q>" · index · brain init · serve · mcp serve · config set <k> <v>
  ดูทั้งหมด: ${BRAND.cliName} --help

custom commands:
  ~/.sanook/commands/<name>.md และ .sanook/commands/<name>.md (project ต้อง trust ก่อน)
  args: ใช้ $ARGUMENTS หรือ {{ args }}; ถ้าไม่มี placeholder จะ append args ต่อท้าย`;

const TOOLS_LIST = [
  'read_file (offset/limit) write_file edit_file (replace_all) list_dir glob grep run_bash',
  'git_status git_diff git_log git_commit',
  'remember recall · skill find_skills create_skill',
  'schedule_task list_scheduled cancel_scheduled',
  'task task_parallel task_spawn task_collect task_cancel task_status   ← sub-agent (ขนาน/background)',
  'diagnostics   ← type error/lint จาก language server (LSP)',
].join('\n  ');

const MESSAGING_PLATFORMS = [
  'telegram',
  'discord',
  'slack',
  'mattermost',
  'homeassistant',
  'email',
  'line',
  'sms',
  'ntfy',
  'signal',
  'whatsapp',
  'matrix',
  'googlechat',
  'bluebubbles',
  'teams',
  'webhooks',
];

export interface CommandContext {
  model: string;
  costSummary?: string;
}

export interface SlashInvocation {
  name: string;
  args: string;
}

export function parseSlashInvocation(input: string): SlashInvocation | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (name !== '?' && !isValidCommandName(name)) return null;
  return { name, args: match[2] ?? '' };
}

/** /model (ไม่มี arg) — โชว์ model ปัจจุบัน + ตัวเลือกของ provider นั้น (alias จาก registry) */
function modelMenu(current: string): string {
  const { provider } = parseSpec(current);
  const cfg = PROVIDERS[provider];
  const list = cfg
    ? Object.entries(cfg.models)
        .filter(([alias]) => alias !== 'default')
        .map(([alias, id]) => `  ${provider}:${alias}  →  ${id}`)
        .join('\n')
    : '';
  return [
    `model ปัจจุบัน: ${current}`,
    cfg ? `\nเลือกของ ${cfg.label}:\n${list}` : '',
    `\nเปลี่ยน: /model <spec>  (เช่น /model sonnet, /model openai:gpt-5.5)`,
    `provider อื่น: ${Object.keys(PROVIDERS).join(' · ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function missingKeyHint(provider: string): string | undefined {
  const cfg = PROVIDERS[provider];
  if (!cfg?.requiresKey || hasUsableEnvKey(provider)) return undefined;
  const url = consoleUrl(provider);
  const lines = [
    `⚠ ยังไม่มี API key ของ ${cfg.label} (${cfg.envVar}) — model นี้จะยังรันไม่ได้จนกว่าจะตั้ง key`,
    url ? `  • เอา key ที่: ${url}` : undefined,
    `  • ตั้ง: export ${cfg.envVar}="..." หรือรัน ${BRAND.cliName} เพื่อเข้า setup wizard`,
  ].filter(Boolean);
  if (provider === 'openai') {
    lines.push('  • ถ้าต้องการใช้ ChatGPT plan ไม่ใช้ API key: /model codex แล้วรัน codex login');
  }
  return lines.join('\n');
}

function platformMenu(): string {
  return [
    `providers: ${Object.keys(PROVIDERS).join(' · ')}`,
    `messaging: ${MESSAGING_PLATFORMS.join(' · ')}`,
    `setup: ${BRAND.cliName} setup หรือ ${BRAND.cliName} gateway setup <platform>`,
  ].join('\n');
}

function statusMenu(ctx: CommandContext): string {
  const { provider } = parseSpec(ctx.model);
  const cfg = PROVIDERS[provider];
  return [
    `session: REPL`,
    `model: ${ctx.model}`,
    `provider: ${cfg?.label ?? provider}`,
    `usage: ${ctx.costSummary ?? '(ยังไม่มี usage รอบนี้)'}`,
    `platforms: พิมพ์ /platforms`,
    `system status: ${BRAND.cliName} status`,
  ].join('\n');
}

function modelChange(spec: string): CommandResult {
  const canonical = canonicalSpec(spec);
  const { provider, model } = parseSpec(canonical);
  if (!PROVIDERS[provider]) {
    return {
      handled: true,
      message: `provider ไม่รองรับ: "${provider}" — รองรับ: ${Object.keys(PROVIDERS).join(' · ')}`,
    };
  }
  if (!model) {
    return {
      handled: true,
      message: `model spec ไม่ครบ: "${spec}" — ใช้ /model <alias> หรือ /model <provider:model>`,
    };
  }
  const hint = missingKeyHint(provider);
  return {
    handled: true,
    modelChange: canonical,
    message: [`เปลี่ยน model → ${canonical}`, hint].filter(Boolean).join('\n'),
  };
}

/** parse input — ถ้าขึ้นต้น / = slash command, ไม่งั้น handled=false (ส่งเข้า agent) */
export function parseCommand(input: string, ctx: CommandContext): CommandResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const [rawCmd, ...args] = trimmed.slice(1).split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  switch (cmd) {
    case 'help':
    case '?':
      return { handled: true, action: 'help', message: HELP_TEXT };
    case 'clear':
    case 'new':
    case 'reset':
      return { handled: true, action: 'clear', message: 'ล้าง conversation แล้ว' };
    case 'status':
      return { handled: true, message: statusMenu(ctx) };
    case 'compact':
    case 'compress':
      return { handled: true, action: 'compact', message: 'บีบ context แล้ว' };
    case 'quit':
    case 'exit':
      return { handled: true, action: 'quit' };
    case 'model':
      if (!args[0]) return { handled: true, message: modelMenu(ctx.model) };
      return modelChange(args[0]);
    case 'personality': {
      const raw = args.join(' ').trim();
      if (!raw) return { handled: true, message: personalityListText() };
      const name = normalizePersonalityName(raw);
      if (!name) return { handled: true, message: `ไม่รู้จัก personality: ${raw}\n\n${personalityListText()}` };
      return {
        handled: true,
        action: 'personality',
        personalityChange: name === 'none' ? '' : name,
        message: name === 'none' ? 'ปิด personality overlay แล้ว' : `ตั้ง personality → ${name}`,
      };
    }
    case 'tools':
      return { handled: true, message: `tools ที่ agent ใช้ได้ (+ MCP ที่ตั้งไว้):\n  ${TOOLS_LIST}` };
    case 'platforms':
      return { handled: true, message: platformMenu() };
    case 'skills':
      return { handled: true, message: `skills โหลดจาก built-in + ${appHomePath('skills')} — จัดการด้วย "${BRAND.cliName} skill list/add/remove"` };
    case 'diff':
      return { handled: true, action: 'diff' };
    case 'retry':
      return { handled: true, action: 'retry' };
    case 'stop':
      return { handled: true, action: 'stop', message: 'ไม่มี turn ที่กำลังทำงาน' };
    case 'undo':
      return { handled: true, action: 'undo' };
    case 'rewind':
      return { handled: true, action: 'rewind' };
    case 'cost':
    case 'usage':
      return { handled: true, message: ctx.costSummary ?? '(ยังไม่มี usage รอบนี้)' };
    case 'insights': {
      const parsed = parseInsightsArgs(args);
      if (parsed === null) return { handled: true, message: 'ใช้: /insights [--days N] [--all] (N ต้องเป็นจำนวนวันบวก)' };
      return { handled: true, action: 'insights', insightsDays: parsed.days, insightsAll: parsed.all };
    }
    default:
      return { handled: true, message: `ไม่รู้จักคำสั่ง /${cmd} — พิมพ์ /help` };
  }
}

// ── custom slash commands: .sanook/commands/<name>.md → /<name> ──────────────
// ไฟล์ markdown (frontmatter optional) = prompt template ที่ส่งเข้า agent. $ARGUMENTS = ส่วนหลังชื่อคำสั่ง
// (เลียน Claude Code .claude/commands) — global ~/.sanook/commands + project .sanook/commands (project ทับ)
export const BUILTIN_COMMANDS = new Set([
  'help',
  '?',
  'clear',
  'new',
  'reset',
  'status',
  'compact',
  'compress',
  'quit',
  'exit',
  'model',
  'personality',
  'platforms',
  'tools',
  'skills',
  'diff',
  'retry',
  'stop',
  'undo',
  'rewind',
  'cost',
  'usage',
  'insights',
]);

export interface CustomCommand {
  name: string;
  description: string;
  body: string;
}

function isValidCommandName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,40}$/.test(name);
}

function compareCommandFiles(a: string, b: string): number {
  const an = a.toLowerCase();
  const bn = b.toLowerCase();
  if (an !== bn) return an.localeCompare(bn);
  if (a === an && b !== bn) return 1;
  if (a !== an && b === bn) return -1;
  return a.localeCompare(b);
}

/** scan custom commands จาก global + project (project override). ข้าม built-in ชื่อซ้ำ */
export async function loadCustomCommands(cwd: string = process.cwd()): Promise<Map<string, CustomCommand>> {
  const out = new Map<string, CustomCommand>();
  const dirs = [appHomePath('commands')];
  const projectCommands = await projectConfigPathIfTrusted('commands', cwd);
  if (projectCommands) dirs.push(projectCommands);

  for (const dir of dirs) {
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue; // ไม่มีโฟลเดอร์ = ข้าม
    }
    for (const f of files.sort(compareCommandFiles)) {
      const normalizedFile = f.toLowerCase();
      if (!normalizedFile.endsWith('.md')) continue;
      const name = normalizedFile.slice(0, -3);
      if (!isValidCommandName(name) || BUILTIN_COMMANDS.has(name)) continue;
      try {
        const { meta, body } = parseFrontmatter(await readFile(join(dir, f), 'utf8'));
        out.set(name, { name, description: meta.description ?? '', body: body.trim() });
      } catch {
        // อ่านไม่ได้ = ข้าม
      }
    }
  }
  return out;
}

/** แทน $ARGUMENTS / {{args}} ด้วย args; ถ้า template ไม่มี placeholder ก็ append args ต่อท้าย */
export function expandCustomCommand(cmd: CustomCommand, args: string): string {
  const a = args.trim();
  if (/\$ARGUMENTS|\{\{\s*args\s*\}\}/.test(cmd.body)) {
    return cmd.body.replace(/\$ARGUMENTS|\{\{\s*args\s*\}\}/g, () => a);
  }
  return a ? `${cmd.body}\n\n${a}` : cmd.body;
}
