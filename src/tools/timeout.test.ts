import { describe, it, expect } from 'vitest';
import type { ToolSet } from 'ai';
import { wrapToolsWithTimeout } from './timeout.js';

const mk = (tools: Record<string, { execute?: unknown }>): ToolSet => tools as unknown as ToolSet;
const exec = (t: ToolSet, name: string): ((i: unknown, o: unknown) => Promise<unknown>) =>
  (t as unknown as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>)[name].execute;

describe('wrapToolsWithTimeout', () => {
  it('tool ค้าง → คืน ERROR หลัง timeout (ไม่แขวน loop)', async () => {
    const wrapped = wrapToolsWithTimeout(mk({ slow: { execute: () => new Promise(() => {}) } }), 30);
    const res = await exec(wrapped, 'slow')({}, {});
    expect(String(res)).toContain('ค้างเกิน');
  });

  it('ผลลัพธ์ปกติส่งผ่านได้เมื่อไม่ timeout', async () => {
    const wrapped = wrapToolsWithTimeout(mk({ fast: { execute: async () => 'ok' } }), 1000);
    expect(await exec(wrapped, 'fast')({}, {})).toBe('ok');
  });

  it('ไม่ครอบ run_bash / task (จัดการ timeout เอง)', () => {
    const bash = { execute: async () => 'x' };
    const task = { execute: async () => 'y' };
    const wrapped = wrapToolsWithTimeout(mk({ run_bash: bash, task }));
    expect((wrapped as unknown as Record<string, unknown>).run_bash).toBe(bash);
    expect((wrapped as unknown as Record<string, unknown>).task).toBe(task);
  });
});
