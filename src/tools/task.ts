import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { SharedBudget } from '../cost.js';
import { agentContext, agentCwd } from '../agentContext.js';
import { approvalContext, type ApprovalFn } from '../approval.js';
import {
  runParallel,
  runThunks,
  TaskRegistry,
  formatSubagentError,
  withGlobalSubagentSlot,
  type SubagentRunner,
  type SubagentSpec,
  type SubagentOutcome,
} from '../orchestrate.js';
import { runInWorktrees, getRepoRoot } from '../worktree.js';

// task = มอบงานย่อยให้ sub-agent ทำใน context แยก (เลียน Claude Code Task tool)
// depth/model/budget thread ผ่าน AsyncLocalStorage (parallel-safe, ไม่ใช่ process.env)
// orchestration: task (single) · task_parallel (fan-out) · task_spawn/collect/cancel/status (background)
const MAX_DEPTH = 2;
const MAX_FANOUT = 16; // กัน fan-out ระเบิด: 1 task_parallel call สูงสุด 16 subagents
const DEFAULT_CONCURRENCY = 5; // subagent = API-bound → คุม concurrency กัน rate-limit
const SUB_MAX_STEPS = 15;

// read-only = อ่าน/ค้นเท่านั้น — ตัด run_bash ออก (shell = เลี่ยง read-only contract ได้)
// 'task'/'task_parallel' อยู่ใน set → nested orchestration ได้ (depth cap กันไม่จบ)
const READ_TOOLS = ['read_file', 'list_dir', 'glob', 'grep', 'git_status', 'git_diff', 'git_log', 'recall', 'skill', 'find_skills', 'task', 'task_parallel'];
// sub-agent ห้ามมี: scheduling + background orchestration (เป็น side-effect ของ main agent — detached task ที่ subagent spawn จะ outlive มันงงๆ)
const SUBAGENT_EXCLUDE = ['schedule_task', 'list_scheduled', 'cancel_scheduled', 'task_spawn', 'task_collect', 'task_cancel', 'task_status'];

// registry ของ background task — อยู่ระดับ process (อยู่ข้าม tool call ใน session เดียว)
const registry = new TaskRegistry();

function trimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const clean = v.trim();
  return clean ? clean : undefined;
}

interface ParentCtx {
  model?: string;
  budgetUsd?: number;
  sharedBudget?: SharedBudget;
  depth: number;
  cwd?: string;
  mode: 'auto' | 'ask';
  approve?: ApprovalFn;
}

/** snapshot ของ parent context ตอนเรียก tool (sync, ก่อน await) — ส่งต่อให้ subagent ทั้ง parallel + background */
function parentCtx(): ParentCtx {
  const ctx = agentContext.getStore();
  const appr = approvalContext.getStore();
  return {
    model: ctx?.model,
    budgetUsd: ctx?.budgetUsd,
    sharedBudget: ctx?.sharedBudget,
    depth: ctx?.depth ?? 0,
    cwd: ctx?.cwd,
    mode: appr?.mode ?? 'ask',
    approve: appr?.approve,
  };
}

/**
 * real subagent runner — รัน runAgent ใน context แยก. ครอบด้วย agentContext.run() ให้
 * แต่ละ subagent (parallel/nested) มี ALS context ของตัวเอง ไม่ bleed ข้ามกัน
 * (enterWith ของ runAgent อย่างเดียวไม่ isolate พอตอนรัน concurrent จาก parent เดียวกัน)
 */
function makeRunner(parent: ParentCtx): SubagentRunner {
  return async (spec: SubagentSpec, signal?: AbortSignal): Promise<string> => {
    const { runAgent } = await import('../loop.js');
    const { tools } = await import('./index.js');
    const entries = Object.entries(tools as Record<string, unknown>);
    const readonly = spec.readonly ?? true;
    const picked = readonly
      ? entries.filter(([k]) => READ_TOOLS.includes(k))
      : entries.filter(([k]) => !SUBAGENT_EXCLUDE.includes(k));
    // model: explicit spec ก่อน → SANOOK_SUBAGENT_MODEL (opt-in: route งาน subagent ไป model ถูกกว่า เช่น haiku
    // สำหรับ exploration/search ที่เป็นงานกลไก — ประหยัด cost มาก โดย quality หลักไม่กระทบ) → inherit จาก parent
    const model = trimmedString(spec.model) ?? trimmedString(process.env.SANOOK_SUBAGENT_MODEL) ?? parent.model ?? 'sonnet';
    const depth = parent.depth + 1;
    const cwd = spec.cwd ?? parent.cwd; // worktree ของ subagent นี้ (ถ้า isolate) ไม่งั้น inherit
    const childStore = { model, budgetUsd: parent.budgetUsd, sharedBudget: parent.sharedBudget, depth, cwd };
    const { text } = await withGlobalSubagentSlot(() =>
      agentContext.run(childStore, () =>
        runAgent({
          model,
          budgetUsd: parent.budgetUsd, // cap เดียวกับ main (กัน subagent วิ่ง uncapped)
          subagentDepth: depth,
          cwd, // file ops ของ subagent ผูกกับ worktree นี้ (isolation)
          permissionMode: parent.mode, // inherit ask-mode (กัน subagent เลี่ยง approval)
          approve: parent.approve,
          prompt: spec.prompt,
          maxSteps: SUB_MAX_STEPS,
          signal,
          tools: Object.fromEntries(picked) as unknown as ToolSet,
        }),
      ),
    );
    return text || '(sub-agent ไม่มีผลลัพธ์)';
  };
}

const atDepthLimit = (parent: ParentCtx): boolean => parent.depth >= MAX_DEPTH;
const DEPTH_MSG = 'ถึงขีดจำกัดความลึก sub-agent แล้ว (กัน spawn ไม่จบ) — ทำงานนี้เองแทน';

const taskInput = {
  description: z.string().describe('สรุปงาน 3-5 คำ'),
  prompt: z.string().describe('คำสั่งเต็ม self-contained ให้ sub-agent (มันไม่เห็น context นี้)'),
  readonly: z.boolean().optional().describe('true (default) = อ่าน/ค้นเท่านั้น; false = แก้ไฟล์/bash ได้'),
};

export const taskTool = tool({
  description:
    'มอบงานย่อย 1 ชิ้นให้ sub-agent ทำใน context แยก — ใช้ตอนต้องสำรวจหลายไฟล์/ค้นหาเยอะแล้วอยากได้แค่บทสรุป ' +
    '(กัน context หลักบวม). sub-agent เริ่มสะอาด ไม่เห็น conversation นี้ → เขียน prompt ให้ครบในตัว. ' +
    'default read-only (อ่าน/ค้น); readonly=false ให้แก้ไฟล์/รัน bash ได้. หลายชิ้นพร้อมกัน → ใช้ task_parallel',
  inputSchema: z.object(taskInput),
  execute: async ({ description, prompt, readonly = true }) => {
    const parent = parentCtx();
    if (atDepthLimit(parent)) return DEPTH_MSG;
    const runner = makeRunner(parent);
    const [outcome] = await runParallel([{ description, prompt, readonly }], runner);
    return outcome.ok ? outcome.text : `sub-agent ล้มเหลว: ${outcome.error}`;
  },
});

/** จัดรูปผลของ subagent หลายตัว */
function formatOutcomes(outcomes: { ok: boolean; description: string; text: string; error?: string }[]): string {
  const okN = outcomes.filter((o) => o.ok).length;
  const head = `${outcomes.length} subagents (${okN} สำเร็จ, ${outcomes.length - okN} ล้มเหลว):`;
  const body = outcomes
    .map((o, i) => `\n## [${i + 1}] ${o.description} ${o.ok ? '✓' : '✗'}\n${o.ok ? o.text : `error: ${o.error}`}`)
    .join('\n');
  return `${head}\n${body}`;
}

/**
 * isolate mode — subagent ที่ "เขียนไฟล์" รันใน git worktree ของตัวเอง (จาก HEAD) ไม่ชนกัน
 * แล้ว capture diff แต่ละ worktree → apply กลับ main tree แบบ sequential (ชน = รายงาน ไม่ทับเงียบ).
 * worktree lifecycle อยู่ใน worktree.ts (testable); ตรงนี้แค่ผูก subagent runner เข้าไป
 */
async function runIsolated(specs: SubagentSpec[], parent: ParentCtx, concurrency: number): Promise<string> {
  const root = await getRepoRoot(parent.cwd ?? agentCwd());
  if (!root) return 'isolate=worktree ต้องอยู่ใน git repo — ใช้ task_parallel แบบปกติแทน (ไม่มี worktree)';
  // isolate=true has one coarse approval at the task_parallel tool boundary. Inside
  // the temporary worktree, subagents run auto so the REPL is not spammed with
  // per-file approvals from hidden child turns; only the captured diff is merged.
  const runner = makeRunner({ ...parent, mode: 'auto', approve: undefined });

  const runs = await runInWorktrees<SubagentSpec, SubagentOutcome>(
    specs,
    root,
    // งานต่อ subagent: รันใน worktree (cwd) ของมัน, readonly=false (isolate มีไว้ให้แก้ไฟล์)
    (spec, cwd) =>
      runner({ ...spec, cwd, readonly: spec.readonly ?? false }, undefined)
        .then((text) => ({ ok: true, description: spec.description, text }))
        .catch((e: unknown) => ({ ok: false, description: spec.description, text: '', error: formatSubagentError(e) })),
    (thunks) => runThunks(thunks, concurrency),
  );
  if (!runs) return 'สร้าง git worktree ไม่สำเร็จ (หรือไม่ใช่ git repo) — ยกเลิก isolate';

  const outcomes = runs.map((r) => r.result);
  const mergeNotes = runs.map((r, i) => {
    const m = r.merge;
    if (!m.changed.length) return `[${i + 1}] ${m.description}: ไม่มีการแก้ไฟล์`;
    return m.applied
      ? `[${i + 1}] ${m.description}: merge แล้ว — ${m.changed.length} ไฟล์ (${m.changed.slice(0, 8).join(', ')})`
      : `[${i + 1}] ${m.description}: ⚠ merge ชน — ${m.reason}; ไฟล์: ${m.changed.join(', ')} (แก้ conflict เอง)`;
  });
  return `${formatOutcomes(outcomes)}\n\n--- worktree merge → main tree ---\n${mergeNotes.join('\n')}`;
}

export const taskParallelTool = tool({
  description:
    'มอบงานย่อยหลายชิ้นให้ sub-agent ทำ "พร้อมกัน" (fan-out) — ใช้เมื่องานแตกเป็นส่วนๆ ที่ไม่ขึ้นต่อกัน ' +
    '(เช่น สำรวจหลายโมดูล / review หลายมิติ / ค้นหลายมุม). คืนผลรวมทุกตัว (ตัวล้มไม่ทำให้ทั้ง batch ล้ม). ' +
    `สูงสุด ${MAX_FANOUT} ชิ้น/ครั้ง. แต่ละชิ้นเขียน prompt ให้ครบในตัว (subagent ไม่เห็น context นี้). ` +
    'isolate=true → subagent ที่แก้ไฟล์รันใน git worktree แยกกัน (ไม่ชนไฟล์) แล้ว merge กลับให้',
  inputSchema: z.object({
    tasks: z.array(z.object(taskInput)).min(1).max(MAX_FANOUT).describe('รายการงานย่อยที่จะรันพร้อมกัน'),
    concurrency: z.number().int().min(1).max(MAX_FANOUT).optional().describe(`จำนวนที่รันพร้อมกันสูงสุด (default ${DEFAULT_CONCURRENCY})`),
    isolate: z.boolean().optional().describe('true = รัน subagent ที่เขียนไฟล์ใน git worktree แยก (กันชนไฟล์) แล้ว merge กลับ — ต้องอยู่ใน git repo'),
  }),
  execute: async ({ tasks, concurrency, isolate }) => {
    const parent = parentCtx();
    if (atDepthLimit(parent)) return DEPTH_MSG;
    const specs: SubagentSpec[] = tasks.map((t) => ({ description: t.description, prompt: t.prompt, readonly: t.readonly ?? true }));
    const cc = concurrency ?? DEFAULT_CONCURRENCY;
    if (isolate) return runIsolated(specs, parent, cc);
    const outcomes = await runParallel(specs, makeRunner(parent), { concurrency: cc });
    return formatOutcomes(outcomes);
  },
});

export const taskSpawnTool = tool({
  description:
    'เริ่มงานย่อยแบบ "background" — คืน task id ทันที แล้ว sub-agent ทำต่อเบื้องหลัง ขณะที่ main agent ทำอย่างอื่นต่อได้ ' +
    'เก็บผลภายหลังด้วย task_collect, ดูสถานะด้วย task_status, ยกเลิกด้วย task_cancel. เหมาะกับงานยาว (research ลึก, สแกนทั้ง repo) ที่ไม่อยากบล็อก. ' +
    '(อยู่แค่ใน session นี้ — งานข้าม session ใช้ schedule_task)',
  inputSchema: z.object(taskInput),
  execute: async ({ description, prompt, readonly = true }) => {
    const parent = parentCtx();
    if (atDepthLimit(parent)) return DEPTH_MSG;
    const id = registry.spawn({ description, prompt, readonly }, makeRunner(parent));
    return `เริ่ม background task "${description}" แล้ว — id: ${id}. เก็บผลด้วย task_collect("${id}") · ยกเลิกด้วย task_cancel("${id}") · ดูสถานะ task_status`;
  },
});

export const taskCollectTool = tool({
  description:
    'เก็บผลของ background task (จาก task_spawn) — ส่ง id เดียวหรือหลาย id. ' +
    'default รอจนเสร็จ; ใส่ timeoutSec เพื่อ poll แบบไม่บล็อก (ยังไม่เสร็จจะคืนสถานะ running)',
  inputSchema: z.object({
    ids: z.union([z.string(), z.array(z.string())]).describe('task id เดียว หรือ array ของ id'),
    timeoutSec: z.number().min(0).optional().describe('รอสูงสุดกี่วินาที (ไม่ใส่ = รอจนเสร็จ)'),
  }),
  execute: async ({ ids, timeoutSec }) => {
    const idList = Array.isArray(ids) ? ids : [ids];
    const timeoutMs = timeoutSec == null ? undefined : Math.round(timeoutSec * 1000);
    const recs = await Promise.all(idList.map((id) => registry.collect(id, timeoutMs)));
    return recs
      .map((r, i) => {
        if (!r) return `[${idList[i]}] ไม่พบ task นี้`;
        if (r.state === 'done') return `## ${r.id} ${r.description} ✓\n${r.text ?? ''}`;
        if (r.state === 'error') return `## ${r.id} ${r.description} ✗ error: ${r.error}`;
        if (r.state === 'canceled') return `## ${r.id} ${r.description} (ยกเลิกแล้ว)`;
        return `## ${r.id} ${r.description} (ยังทำงานอยู่ — collect อีกครั้งภายหลัง)`;
      })
      .join('\n\n');
  },
});

export const taskCancelTool = tool({
  description: 'ยกเลิก background task ที่ยัง running อยู่ (จาก task_spawn) ด้วย AbortSignal',
  inputSchema: z.object({
    id: z.string().describe('task id จาก task_spawn'),
  }),
  execute: async ({ id }) => {
    const rec = registry.get(id);
    if (!rec) return `[${id}] ไม่พบ task นี้`;
    if (rec.state !== 'running') return `[${id}] ยกเลิกไม่ได้ — สถานะปัจจุบัน: ${rec.state}`;
    const ok = registry.cancel(id);
    if (ok) return `[${id}] ยกเลิกแล้ว — ${rec.description}`;
    return `[${id}] ยกเลิกไม่ได้ — สถานะปัจจุบัน: ${registry.get(id)?.state ?? rec.state}`;
  },
});

export const taskStatusTool = tool({
  description: 'ดูสถานะ background task ทั้งหมดใน session นี้ (running/done/error/canceled)',
  inputSchema: z.object({}),
  execute: async () => {
    const all = registry.list();
    if (!all.length) return 'ยังไม่มี background task';
    return all
      .map((r) => {
        const elapsed = r.endedMs ? `${((r.endedMs - r.startedMs) / 1000).toFixed(1)}s` : 'running…';
        return `${r.id}  ${r.state.padEnd(8)} ${elapsed}  — ${r.description}`;
      })
      .join('\n');
  },
});
