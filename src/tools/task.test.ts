import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { agentContext } from '../agentContext.js';
import { taskTool, taskParallelTool, taskSpawnTool, taskCancelTool, taskStatusTool } from './task.js';

const h = vi.hoisted(() => ({
  runAgent: vi.fn(),
}));

vi.mock('../loop.js', () => ({
  runAgent: h.runAgent,
}));

vi.mock('./index.js', () => ({
  tools: {
    read_file: {},
    task: {},
    task_parallel: {},
  },
}));

beforeEach(() => {
  h.runAgent.mockResolvedValue({ text: 'subagent output' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  h.runAgent.mockReset();
});

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

describe('task_cancel', () => {
  it('unknown id → แจ้งไม่พบ', async () => {
    const r = await taskCancelTool.execute!({ id: 'task-nope' }, {} as never);
    expect(String(r)).toContain('ไม่พบ task');
  });
});

describe('subagent model selection', () => {
  it('trims SANOOK_SUBAGENT_MODEL before running a subagent', async () => {
    vi.stubEnv('SANOOK_SUBAGENT_MODEL', '  haiku-test  ');

    await agentContext.run({ model: 'sonnet', depth: 0 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );

    expect(h.runAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'haiku-test' }));
  });

  it('ignores blank SANOOK_SUBAGENT_MODEL and inherits the parent model', async () => {
    vi.stubEnv('SANOOK_SUBAGENT_MODEL', '   ');

    await agentContext.run({ model: 'parent-model', depth: 0 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );

    expect(h.runAgent).toHaveBeenCalledWith(expect.objectContaining({ model: 'parent-model' }));
  });
});
