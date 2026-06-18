import { inspect } from 'node:util';

// ============================================================================
// src/orchestrate.ts — subagent ORCHESTRATION (parallel fan-out + background).
//
// The single Task subagent (src/tools/task.ts) is one-shot and synchronous. This
// module adds the two missing orchestration primitives a frontier harness needs:
//   1. runParallel() — fan a list of subagents out concurrently with a real
//      concurrency cap and PER-ITEM error isolation (one failure never sinks the
//      batch), results returned in input order.
//   2. TaskRegistry — fire-and-forget BACKGROUND subagents: spawn() returns an id
//      immediately, the work runs detached, and collect()/list()/cancel() let the
//      main agent keep working and gather results later in the same session.
//
// Everything is PURE w.r.t. the actual agent: the subagent runner is INJECTED
// (SubagentRunner), and the clock + id generator are injectable, so the whole
// orchestration layer unit-tests with a fake runner — zero model calls, zero
// network — exactly like the search subsystem injects its fs.
// ============================================================================

export interface SubagentSpec {
  description: string; // 3-5 word label
  prompt: string; // self-contained instruction
  readonly?: boolean; // true = read/search only; false = may edit files / run bash
  model?: string; // optional model override (else inherit)
  cwd?: string; // optional working dir — set to an isolated git worktree to sandbox this subagent's file ops
}

export interface SubagentOutcome {
  ok: boolean;
  description: string;
  text: string;
  error?: string;
}

export function formatSubagentError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  if (e == null) return String(e);
  try {
    const json = JSON.stringify(e);
    if (json) return json;
  } catch {
    return inspect(e, { breakLength: Infinity, depth: 2 });
  }
  return String(e);
}

/** the thing that actually runs a subagent. Real impl wraps runAgent; tests pass a fake. */
export type SubagentRunner = (spec: SubagentSpec, signal?: AbortSignal) => Promise<string>;

export interface ParallelOptions {
  concurrency?: number; // max in-flight (default 5; subagents are API-bound, not CPU-bound)
  signal?: AbortSignal;
}

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_GLOBAL_SUBAGENT_CONCURRENCY = 16;

let globalInFlight = 0;
const globalWaiters: (() => void)[] = [];

function globalSubagentLimit(): number {
  const raw = process.env.SANOOK_SUBAGENT_CONCURRENCY?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_GLOBAL_SUBAGENT_CONCURRENCY;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 64) : DEFAULT_GLOBAL_SUBAGENT_CONCURRENCY;
}

export function globalSubagentRunningCount(): number {
  return globalInFlight;
}

export async function withGlobalSubagentSlot<R>(fn: () => Promise<R>): Promise<R> {
  while (globalInFlight >= globalSubagentLimit()) {
    await new Promise<void>((resolve) => globalWaiters.push(resolve));
  }
  globalInFlight++;
  try {
    return await fn();
  } finally {
    globalInFlight--;
    globalWaiters.shift()?.();
  }
}

/**
 * Run thunks concurrently, capped at `concurrency`, results in input order.
 * The generic concurrency primitive both runParallel and worktree isolation use.
 */
export async function runThunks<R>(thunks: (() => Promise<R>)[], concurrency = DEFAULT_CONCURRENCY): Promise<R[]> {
  const cap = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(thunks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= thunks.length) return;
      results[i] = await thunks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(cap, thunks.length) }, worker));
  return results;
}

async function runOne(spec: SubagentSpec, runner: SubagentRunner, signal?: AbortSignal): Promise<SubagentOutcome> {
  try {
    const text = await runner(spec, signal);
    return { ok: true, description: spec.description, text };
  } catch (e) {
    return { ok: false, description: spec.description, text: '', error: formatSubagentError(e) };
  }
}

/**
 * Run subagents concurrently, capped at `concurrency`, results in input order.
 * Never rejects: a thrown subagent becomes an {ok:false,error} outcome so the
 * caller always gets one outcome per spec.
 */
export async function runParallel(
  specs: SubagentSpec[],
  runner: SubagentRunner,
  opts: ParallelOptions = {},
): Promise<SubagentOutcome[]> {
  return runThunks(
    specs.map((s) => () => runOne(s, runner, opts.signal)),
    opts.concurrency ?? DEFAULT_CONCURRENCY,
  );
}

export type TaskState = 'running' | 'done' | 'error' | 'canceled';

export interface TaskRecord {
  id: string;
  description: string;
  state: TaskState;
  text?: string;
  error?: string;
  startedMs: number;
  endedMs?: number;
}

export interface TaskRegistryOptions {
  now?: () => number;
  idGen?: () => string;
}

/**
 * In-process registry of BACKGROUND subagents. spawn() launches detached work and
 * returns an id; collect() awaits (optionally with a timeout so the agent can poll
 * instead of block); cancel() aborts via the runner's AbortSignal. Lives for the
 * process — background work dies when the CLI exits, so it is for within-session
 * fan-out ("kick off research, keep coding, gather it later"), not durable jobs
 * (use `schedule_task` / the gateway for those).
 */
export class TaskRegistry {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly settles = new Map<string, Promise<TaskRecord>>();
  private readonly controllers = new Map<string, AbortController>();
  private counter = 0;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(opts: TaskRegistryOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.idGen = opts.idGen ?? (() => `t${++this.counter}`);
  }

  /** launch a detached subagent; returns its id immediately. */
  spawn(spec: SubagentSpec, runner: SubagentRunner): string {
    const id = this.idGen();
    const ac = new AbortController();
    this.controllers.set(id, ac);
    const rec: TaskRecord = { id, description: spec.description, state: 'running', startedMs: this.now() };
    this.tasks.set(id, rec);

    const settle = (async (): Promise<TaskRecord> => {
      try {
        const text = await runner(spec, ac.signal);
        const cur = this.tasks.get(id)!;
        if (cur.state !== 'canceled') Object.assign(cur, { state: 'done', text, endedMs: this.now() });
        return cur;
      } catch (e) {
        const cur = this.tasks.get(id)!;
        if (cur.state !== 'canceled') Object.assign(cur, { state: 'error', error: formatSubagentError(e), endedMs: this.now() });
        return cur;
      } finally {
        this.controllers.delete(id);
      }
    })();
    // swallow at the source — collect() is the consumer; an uncollected reject must not crash the process
    settle.catch(() => {});
    this.settles.set(id, settle);
    return id;
  }

  get(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  /**
   * Await a background task. With timeoutMs, resolves to the current (possibly
   * still-running) record if it hasn't settled in time, so the caller can poll.
   * Returns undefined for an unknown id.
   */
  async collect(id: string, timeoutMs?: number): Promise<TaskRecord | undefined> {
    const settle = this.settles.get(id);
    if (!settle) return undefined;
    const current = this.tasks.get(id);
    if (current && current.state !== 'running') return current;
    if (timeoutMs == null) return settle;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<TaskRecord>((resolve) => {
      timer = setTimeout(() => resolve(this.tasks.get(id)!), Math.max(0, timeoutMs));
    });
    try {
      return await Promise.race([settle, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** abort a running task (best-effort via its AbortSignal). Returns false if not running. */
  cancel(id: string): boolean {
    const rec = this.tasks.get(id);
    if (!rec || rec.state !== 'running') return false;
    this.controllers.get(id)?.abort();
    Object.assign(rec, { state: 'canceled', endedMs: this.now() });
    return true;
  }

  /** number of tasks still running — used to gate runaway fan-out. */
  runningCount(): number {
    let n = 0;
    for (const r of this.tasks.values()) if (r.state === 'running') n++;
    return n;
  }
}
