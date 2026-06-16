import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// isolate ด้วย temp HOME (ไม่แตะ ~/.sanook จริง, ไม่แตะ API key) — import ledger หลัง stub
const TMP = mkdtempSync(join(tmpdir(), 'sanook-ledger-test-'));
type Ledger = typeof import('./ledger.js');

describe('ledger (lock + atomic concurrency)', () => {
  let L: Ledger;
  beforeAll(async () => {
    vi.stubEnv('HOME', TMP);
    L = await import('./ledger.js');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(TMP, { recursive: true, force: true });
  });

  it('concurrent enqueue 10 ตัว → ไม่มี task หาย (lock serialize read-modify-write)', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => L.enqueueTask({ kind: 'once', spec: `t${i}`, runAt: Date.now() })),
    );
    const all = await L.listTasks();
    expect(all.length).toBe(10); // ถ้าไม่มี lock จะ < 10 (lost-write)
    expect(new Set(all.map((t) => t.id)).size).toBe(10); // id ไม่ชนกัน
  });

  it('claimTask = compare-and-set: claim พร้อมกัน 3 → สำเร็จแค่ 1', async () => {
    const t = await L.enqueueTask({ kind: 'once', spec: 'claim-me', runAt: Date.now() });
    const r = await Promise.all([L.claimTask(t.id), L.claimTask(t.id), L.claimTask(t.id)]);
    expect(r.filter(Boolean).length).toBe(1); // กัน double-run
  });

  it('recoverStaleRunning: running → queued', async () => {
    const t = await L.enqueueTask({ kind: 'once', spec: 'r', runAt: Date.now() });
    await L.claimTask(t.id); // → running
    expect(await L.recoverStaleRunning()).toBeGreaterThanOrEqual(1);
    expect((await L.getTask(t.id))?.status).toBe('queued');
  });

  it('removeTask: ลบได้ครั้งเดียว', async () => {
    const t = await L.enqueueTask({ kind: 'once', spec: 'rm', runAt: Date.now() });
    expect(await L.removeTask(t.id)).toBe(true);
    expect(await L.removeTask(t.id)).toBe(false);
  });

  it('enqueueTask trims model overrides and drops blanks', async () => {
    const blank = await L.enqueueTask({ kind: 'once', spec: 'blank-model', model: '   ', runAt: Date.now() });
    const named = await L.enqueueTask({
      kind: 'once',
      spec: 'trim-model',
      model: '  openai:gpt-5.5  ',
      runAt: Date.now(),
    });

    expect(blank.model).toBeUndefined();
    expect((await L.getTask(blank.id))?.model).toBeUndefined();
    expect(named.model).toBe('openai:gpt-5.5');
    expect((await L.getTask(named.id))?.model).toBe('openai:gpt-5.5');
  });

  it('dueTasks: คืนเฉพาะ queued ที่ถึงเวลา', async () => {
    await L.enqueueTask({ kind: 'once', spec: 'future', runAt: Date.now() + 1_000_000 });
    const due = await L.dueTasks(Date.now());
    expect(due.every((t) => t.status === 'queued' && t.runAt <= Date.now())).toBe(true);
    expect(due.some((t) => t.spec === 'future')).toBe(false);
  });
});
