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

  it('tool error คืน ERROR string แทนการ throw เข้า loop', async () => {
    const wrapped = wrapToolsWithTimeout(
      mk({
        fail: {
          execute: async () => {
            throw new Error('boom');
          },
        },
      }),
      1000,
    );

    await expect(exec(wrapped, 'fail')({}, {})).resolves.toBe('ERROR: boom');
  });

  it('จับ synchronous throw จาก execute เป็น ERROR string', async () => {
    const wrapped = wrapToolsWithTimeout(
      mk({
        syncFail: {
          execute: () => {
            throw new TypeError('sync boom');
          },
        },
      }),
      1000,
    );

    await expect(exec(wrapped, 'syncFail')({}, {})).resolves.toBe('ERROR: sync boom');
  });

  it('รองรับ tool ที่ throw ค่าไม่ใช่ Error', async () => {
    const wrapped = wrapToolsWithTimeout(
      mk({
        textFail: {
          execute: async () => {
            throw 'plain failure';
          },
        },
        objectFail: {
          execute: async () => {
            throw { code: 'E_TOOL', retry: false };
          },
        },
      }),
      1000,
    );

    await expect(exec(wrapped, 'textFail')({}, {})).resolves.toBe('ERROR: plain failure');
    await expect(exec(wrapped, 'objectFail')({}, {})).resolves.toBe('ERROR: {"code":"E_TOOL","retry":false}');
  });

  it('redacts API keys from thrown errors and object payloads', async () => {
    const wrapped = wrapToolsWithTimeout(
      mk({
        errorFail: {
          execute: async () => {
            throw new Error('boom sk-test1234567890abcdef');
          },
        },
        objectFail: {
          execute: async () => {
            throw { 'sk-test1234567890abcdef': 'value sk-test1234567890abcdef' };
          },
        },
      }),
      1000,
    );

    const error = String(await exec(wrapped, 'errorFail')({}, {}));
    const object = String(await exec(wrapped, 'objectFail')({}, {}));

    expect(error).toContain('sk-t…ef');
    expect(error).not.toContain('sk-test1234567890abcdef');
    expect(object).toContain('sk-t…ef');
    expect(object).not.toContain('sk-test1234567890abcdef');
  });

  it('แสดง thrown object ที่ stringify ไม่ได้ให้พอ debug ได้', async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const wrapped = wrapToolsWithTimeout(
      mk({
        circularFail: {
          execute: async () => {
            throw circular;
          },
        },
      }),
      1000,
    );

    const res = await exec(wrapped, 'circularFail')({}, {});
    expect(String(res)).toContain('ERROR:');
    expect(String(res)).toContain('Circular');
  });

  it('ไม่ครอบ run_bash / sub-agent orchestration tools (จัดการ timeout เอง)', () => {
    const bash = { execute: async () => 'x' };
    const task = { execute: async () => 'y' };
    const taskParallel = { execute: async () => 'parallel' };
    const taskCollect = { execute: async () => 'collect' };
    const wrapped = wrapToolsWithTimeout(mk({ run_bash: bash, task, task_parallel: taskParallel, task_collect: taskCollect }));
    expect((wrapped as unknown as Record<string, unknown>).run_bash).toBe(bash);
    expect((wrapped as unknown as Record<string, unknown>).task).toBe(task);
    expect((wrapped as unknown as Record<string, unknown>).task_parallel).toBe(taskParallel);
    expect((wrapped as unknown as Record<string, unknown>).task_collect).toBe(taskCollect);
  });
});
