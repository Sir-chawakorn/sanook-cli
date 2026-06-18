import { afterEach, describe, it, expect, vi } from 'vitest';
import { runParallel, TaskRegistry, globalSubagentRunningCount, withGlobalSubagentSlot, type SubagentRunner, type SubagentSpec } from './orchestrate.js';

const spec = (description: string, prompt = description): SubagentSpec => ({ description, prompt });

afterEach(() => {
  vi.unstubAllEnvs();
});

/** a runner whose resolution we control + that tracks peak concurrency. */
function gatedRunner() {
  let inFlight = 0;
  let peak = 0;
  const resolvers: ((v: string) => void)[] = [];
  const runner: SubagentRunner = (s) =>
    new Promise<string>((resolve) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      resolvers.push((v) => {
        inFlight--;
        resolve(v);
      });
      // resolve immediately on a microtask so order/peak are observable but the test stays fast
      queueMicrotask(() => resolvers.shift()?.(`done:${s.description}`));
    });
  return { runner, peak: () => peak };
}

describe('runParallel', () => {
  it('returns one outcome per spec, in input order', async () => {
    const { runner } = gatedRunner();
    const out = await runParallel([spec('a'), spec('b'), spec('c')], runner);
    expect(out.map((o) => o.description)).toEqual(['a', 'b', 'c']);
    expect(out.every((o) => o.ok)).toBe(true);
    expect(out[1].text).toBe('done:b');
  });

  it('isolates per-item errors — one failure does not sink the batch', async () => {
    const runner: SubagentRunner = async (s) => {
      if (s.description === 'boom') throw new Error('kaboom');
      return `ok:${s.description}`;
    };
    const out = await runParallel([spec('a'), spec('boom'), spec('c')], runner);
    expect(out[0]).toMatchObject({ ok: true, text: 'ok:a' });
    expect(out[1]).toMatchObject({ ok: false, error: 'kaboom' });
    expect(out[2]).toMatchObject({ ok: true, text: 'ok:c' });
  });

  it('keeps non-Error thrown values readable', async () => {
    const runner: SubagentRunner = async (s) => {
      if (s.description === 'string') throw 'plain failure';
      throw { code: 'E_SUBAGENT', detail: s.description };
    };
    const out = await runParallel([spec('string'), spec('object')], runner);
    expect(out[0]).toMatchObject({ ok: false, error: 'plain failure' });
    expect(out[1]).toMatchObject({ ok: false, error: '{"code":"E_SUBAGENT","detail":"object"}' });
  });

  it('keeps circular thrown values debuggable', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const runner: SubagentRunner = async () => {
      throw circular;
    };

    const [out] = await runParallel([spec('circular')], runner);

    expect(out).toMatchObject({ ok: false, description: 'circular' });
    expect(out.error).toContain('Circular');
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const runner: SubagentRunner = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return 'x';
    };
    const specs = Array.from({ length: 10 }, (_, i) => spec(`s${i}`));
    await runParallel(specs, runner, { concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('empty spec list → empty result', async () => {
    const { runner } = gatedRunner();
    expect(await runParallel([], runner)).toEqual([]);
  });
});

describe('global subagent concurrency gate', () => {
  it('caps concurrent subagent slots across independent callers', async () => {
    vi.stubEnv('SANOOK_SUBAGENT_CONCURRENCY', '2');
    let inFlight = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        withGlobalSubagentSlot(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('releases a global slot when the guarded work rejects', async () => {
    await expect(
      withGlobalSubagentSlot(async () => {
        expect(globalSubagentRunningCount()).toBe(1);
        throw new Error('slot failed');
      }),
    ).rejects.toThrow('slot failed');

    expect(globalSubagentRunningCount()).toBe(0);
  });

  it('ignores malformed global concurrency env values instead of accepting numeric prefixes', async () => {
    vi.stubEnv('SANOOK_SUBAGENT_CONCURRENCY', '2abc');
    let inFlight = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        withGlobalSubagentSlot(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        }),
      ),
    );

    expect(peak).toBe(6);
    expect(globalSubagentRunningCount()).toBe(0);
  });
});

describe('TaskRegistry — background subagents', () => {
  it('spawn returns an id immediately; the task starts in running and settles to done', async () => {
    const reg = new TaskRegistry({ now: () => 1000 });
    let resolve!: (v: string) => void;
    const runner: SubagentRunner = () => new Promise<string>((r) => (resolve = r));
    const id = reg.spawn(spec('research'), runner);
    expect(reg.get(id)).toMatchObject({ state: 'running', description: 'research', startedMs: 1000 });
    resolve('the findings');
    const rec = await reg.collect(id);
    expect(rec).toMatchObject({ state: 'done', text: 'the findings' });
  });

  it('captures a failing background task as error state, not an unhandled rejection', async () => {
    const reg = new TaskRegistry();
    const runner: SubagentRunner = async () => {
      throw new Error('subagent died');
    };
    const id = reg.spawn(spec('flaky'), runner);
    const rec = await reg.collect(id);
    expect(rec).toMatchObject({ state: 'error', error: 'subagent died' });
  });

  it('records non-Error background failures as readable text', async () => {
    const reg = new TaskRegistry();
    const runner: SubagentRunner = async () => {
      throw 'background failed';
    };
    const id = reg.spawn(spec('odd failure'), runner);
    const rec = await reg.collect(id);
    expect(rec).toMatchObject({ state: 'error', error: 'background failed' });
  });

  it('collect with a timeout returns the running record without blocking forever', async () => {
    const reg = new TaskRegistry();
    const runner: SubagentRunner = () => new Promise<string>(() => {}); // never resolves
    const id = reg.spawn(spec('slow'), runner);
    const rec = await reg.collect(id, 10);
    expect(rec?.state).toBe('running');
  });

  it('cancel aborts a running task and signals the runner', async () => {
    const reg = new TaskRegistry();
    let aborted = false;
    const runner: SubagentRunner = (_s, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    const id = reg.spawn(spec('cancelme'), runner);
    expect(reg.runningCount()).toBe(1);
    expect(reg.cancel(id)).toBe(true);
    expect(aborted).toBe(true);
    expect(reg.get(id)?.state).toBe('canceled');
    expect(reg.cancel(id)).toBe(false); // already settled
  });

  it('collect returns a canceled task immediately even if the runner ignores abort', async () => {
    const reg = new TaskRegistry();
    const runner: SubagentRunner = () => new Promise<string>(() => {});
    const id = reg.spawn(spec('stubborn'), runner);

    expect(reg.cancel(id)).toBe(true);
    const rec = await Promise.race([
      reg.collect(id),
      new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), 20)),
    ]);

    expect(rec).toMatchObject({ id, state: 'canceled', description: 'stubborn' });
  });

  it('list reflects all spawned tasks; collect on an unknown id is undefined', async () => {
    const reg = new TaskRegistry();
    const runner: SubagentRunner = async () => 'x';
    reg.spawn(spec('one'), runner);
    reg.spawn(spec('two'), runner);
    expect(reg.list().map((t) => t.description).sort()).toEqual(['one', 'two']);
    expect(await reg.collect('nope')).toBeUndefined();
  });
});
