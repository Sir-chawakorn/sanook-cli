import type { ToolSet } from 'ai';
import { BRAND } from './brand.js';
import { loadConfig, type Config } from './config.js';
import { gitContext } from './git.js';
import { SYSTEM } from './loop.js';
import { loadAutoMemory, loadBrainContext, loadMemory, loadOwnerPersonaBlock } from './memory.js';
import { personalityPrompt } from './personality.js';
import { loadRepoMap } from './repomap.js';
import { loadSkills, renderAvailableSkills, type Skill } from './skills.js';
import { tools as builtInTools } from './tools/index.js';

const CHARS_PER_TOKEN = 4;

export interface PromptSizeSection {
  id: string;
  label: string;
  chars: number;
  bytes: number;
  approxTokens: number;
  empty: boolean;
}

export interface PromptSizeBreakdown {
  cwd: string;
  model: string;
  planMode: boolean;
  skillsCount: number;
  builtInToolsCount: number;
  sections: PromptSizeSection[];
  systemPrompt: PromptSizeSection;
  toolSchemas: PromptSizeSection;
  total: PromptSizeSection;
  notes: string[];
}

export interface PromptSizeOptions {
  cwd?: string;
  planMode?: boolean;
  tools?: ToolSet;
  loadConfigImpl?: (overrides: Record<string, unknown>, cwd: string) => Promise<Config>;
  loadMemoryImpl?: (cwd: string) => Promise<string>;
  loadAutoMemoryImpl?: () => Promise<string>;
  loadOwnerPersonaBlockImpl?: () => Promise<string>;
  loadSkillsImpl?: (cwd: string) => Promise<Skill[]>;
  gitContextImpl?: (cwd: string) => Promise<string>;
  loadBrainContextImpl?: () => Promise<string>;
  loadRepoMapImpl?: (cwd: string) => Promise<string>;
}

interface JsonSafeOptions {
  maxDepth?: number;
  maxStringLength?: number;
}

export function approximateTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / CHARS_PER_TOKEN);
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function measurePromptSection(id: string, label: string, text: string): PromptSizeSection {
  return {
    id,
    label,
    chars: text.length,
    bytes: utf8Bytes(text),
    approxTokens: approximateTokens(text.length),
    empty: text.length === 0,
  };
}

function joinPromptBlocks(blocks: readonly string[]): string {
  return blocks.filter(Boolean).join('\n\n');
}

function toJsonSafe(value: unknown, options: JsonSafeOptions = {}, depth = 0, seen = new WeakSet<object>()): unknown {
  const maxDepth = options.maxDepth ?? 6;
  const maxStringLength = options.maxStringLength ?? 2_000;
  if (value == null) return value;
  if (typeof value === 'string') return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}...[truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
  if (depth >= maxDepth) return '[MaxDepth]';
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, options, depth + 1, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
    if (key === 'execute' || key === 'experimental_toToolResultContent') continue;
    const safe = toJsonSafe(child, options, depth + 1, seen);
    if (safe !== undefined) out[key] = safe;
  }
  seen.delete(value);
  return out;
}

export function serializeToolSchemas(tools: ToolSet): string {
  const payload = Object.entries(tools)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tool]) => {
      const t = tool as { description?: unknown; inputSchema?: unknown; parameters?: unknown };
      return {
        name,
        description: typeof t.description === 'string' ? t.description : '',
        inputSchema: toJsonSafe(t.inputSchema ?? t.parameters),
      };
    });
  return JSON.stringify(payload, null, 2);
}

export async function buildPromptSizeBreakdown(options: PromptSizeOptions = {}): Promise<PromptSizeBreakdown> {
  const cwd = options.cwd ?? process.cwd();
  const planMode = options.planMode ?? false;
  const [
    config,
    memory,
    autoMemory,
    ownerPersona,
    skills,
    git,
    brain,
    repoMap,
  ] = await Promise.all([
    (options.loadConfigImpl ?? loadConfig)({}, cwd),
    (options.loadMemoryImpl ?? loadMemory)(cwd),
    (options.loadAutoMemoryImpl ?? loadAutoMemory)(),
    (options.loadOwnerPersonaBlockImpl ?? loadOwnerPersonaBlock)(),
    (options.loadSkillsImpl ?? loadSkills)(cwd),
    (options.gitContextImpl ?? gitContext)(cwd),
    (options.loadBrainContextImpl ?? loadBrainContext)(),
    (options.loadRepoMapImpl ?? loadRepoMap)(cwd),
  ]);

  const planSuffix = planMode
    ? '\n\nPLAN MODE: สำรวจและวางแผนเท่านั้น — ห้ามแก้ไฟล์หรือรันคำสั่งที่เปลี่ยน state. จบด้วยแผนเป็นขั้นตอนให้ user อนุมัติก่อนลงมือ.'
    : '';
  const brainNudge = brain
    ? '\n- second-brain vault โหลดอยู่ (ดู <brain_vault>) — อ่าน current-state + โน้ตที่เกี่ยวก่อนงานไม่ trivial · เจอ preference/decision สำคัญ → remember (เข้า vault) · งานเสร็จควร route/บันทึกตาม Vault Structure Map ของ vault'
    : '';
  const baseSystem = SYSTEM + planSuffix + brainNudge;
  const personality = personalityPrompt(config.personality);
  const skillsBlock = renderAvailableSkills(skills);
  const staticSystem = joinPromptBlocks([baseSystem, personality, ownerPersona, autoMemory, skillsBlock, brain, memory, repoMap]);
  const systemPromptText = joinPromptBlocks([staticSystem, git]);
  const toolSchemaText = serializeToolSchemas(options.tools ?? builtInTools);

  const sections = [
    measurePromptSection('base-system', 'Base system', baseSystem),
    measurePromptSection('personality', 'Personality overlay', personality),
    measurePromptSection('owner-persona', 'Owner persona', ownerPersona),
    measurePromptSection('auto-memory', 'Auto memory', autoMemory),
    measurePromptSection('skills-index', 'Skills index', skillsBlock),
    measurePromptSection('brain-context', 'Second-brain context', brain),
    measurePromptSection('project-memory', 'Project memory', memory),
    measurePromptSection('repo-map', 'Repo map', repoMap),
    measurePromptSection('git-context', 'Git context', git),
  ];
  const systemPrompt = measurePromptSection('system-prompt', 'System prompt total', systemPromptText);
  const toolSchemas = measurePromptSection('tool-schemas', 'Built-in tool schemas', toolSchemaText);
  const totalText = `${systemPromptText}\n\n${toolSchemaText}`;

  return {
    cwd,
    model: config.model,
    planMode,
    skillsCount: skills.length,
    builtInToolsCount: Object.keys(options.tools ?? builtInTools).length,
    sections,
    systemPrompt,
    toolSchemas,
    total: measurePromptSection('total-fixed-payload', 'Total fixed payload', totalText),
    notes: [
      'Counts are approximate; model tokenizers vary.',
      'MCP tools are intentionally not spawned here. Use `sanook mcp list --tools` for live MCP catalog details.',
      'The runtime sends git context as a separate system message so the static prompt cache stays useful.',
    ],
  };
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function formatSection(section: PromptSizeSection): string {
  const empty = section.empty ? ' (empty)' : '';
  return `${section.label.padEnd(22)} ${formatNumber(section.chars).padStart(8)} chars  ~${formatNumber(section.approxTokens).padStart(6)} tokens  ${formatNumber(section.bytes).padStart(8)} bytes${empty}`;
}

export function renderPromptSizeBreakdown(report: PromptSizeBreakdown): string {
  const lines = [
    `${BRAND.productName} prompt-size`,
    `cwd: ${report.cwd}`,
    `model: ${report.model}${report.planMode ? '  plan-mode: on' : ''}`,
    `skills: ${report.skillsCount}  built-in tools: ${report.builtInToolsCount}`,
    '',
    formatSection(report.systemPrompt),
    formatSection(report.toolSchemas),
    formatSection(report.total),
    '',
    'Breakdown:',
    ...report.sections.map((section) => `  ${formatSection(section)}`),
    '',
    'Notes:',
    ...report.notes.map((note) => `  - ${note}`),
  ];
  return `${lines.join('\n')}\n`;
}

