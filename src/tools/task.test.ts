import { describe, it, expect } from 'vitest';
import { agentContext } from '../agentContext.js';
import { taskTool } from './task.js';

describe('taskTool depth guard (กัน sub-agent spawn ไม่จบ)', () => {
  it('depth >= MAX_DEPTH (2) → ปฏิเสธ + ไม่ spawn (return ก่อน import loop)', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 2 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });

  it('depth 3 (ลึกเกิน) → ปฏิเสธเช่นกัน', async () => {
    const r = await agentContext.run({ model: 'sonnet', depth: 3 }, () =>
      taskTool.execute!({ description: 'd', prompt: 'p' }, {} as never),
    );
    expect(String(r)).toContain('ขีดจำกัด');
  });
});
