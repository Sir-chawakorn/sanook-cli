import { describe, it, expect } from 'vitest';
import { agentContext } from '../agentContext.js';
import { taskTool, taskParallelTool, taskSpawnTool, taskStatusTool } from './task.js';

describe('subagent depth guard (กัน spawn ไม่จบ) — return ก่อน import loop (no network)', () => {
  it('task: depth >= MAX_DEPTH (2) → ปฏิเสธ', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 2 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });

  it('task: depth 3 (ลึกเกิน) → ปฏิเสธเช่นกัน', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 3 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });

  it('task_parallel: depth limit → ปฏิเสธ ทั้ง batch', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 2 }, () =>
      taskParallelTool.execute!({ tasks: [{ description: 'a', prompt: 'pa' }, { description: 'b', prompt: 'pb' }] }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });

  it('task_spawn: depth limit → ปฏิเสธ (ไม่ spawn background)', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 2 }, () =>
      taskSpawnTool.execute!({ description: 'bg', prompt: 'p' }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });
});

describe('task_status', () => {
  it('ไม่มี background task → ข้อความว่าง', async () => {
    const r = await taskStatusTool.execute!({}, {} as never);
    expect(String(r)).toContain('ยังไม่มี background task');
  });
});
