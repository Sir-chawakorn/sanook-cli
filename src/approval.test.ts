import { describe, it, expect } from 'vitest';
import { wrapToolsWithApproval, approvalContext, summarizeToolCall, MUTATE_TOOLS } from './approval.js';
import type { ToolSet } from 'ai';

const mkTools = (): ToolSet =>
  ({
    write_file: { execute: async () => 'wrote' },
    read_file: { execute: async () => 'read' },
  }) as unknown as ToolSet;

describe('approval gate', () => {
  it('ask + deny → mutate ถูกปฏิเสธ, read (non-mutate) ผ่าน', async () => {
    const w = wrapToolsWithApproval(mkTools());
    await approvalContext.run({ mode: 'ask', approve: async () => false }, async () => {
      expect(await w.write_file.execute!({ path: 'x' }, {} as never)).toContain('ปฏิเสธ');
      expect(await w.read_file.execute!({}, {} as never)).toBe('read');
    });
  });

  it('ask + approve → ผ่าน', async () => {
    const w = wrapToolsWithApproval(mkTools());
    await approvalContext.run({ mode: 'ask', approve: async () => true }, async () => {
      expect(await w.write_file.execute!({ path: 'x' }, {} as never)).toBe('wrote');
    });
  });

  it('auto → ผ่านเลย ไม่เรียก approve (act-first)', async () => {
    const w = wrapToolsWithApproval(mkTools());
    let called = false;
    await approvalContext.run(
      {
        mode: 'auto',
        approve: async () => {
          called = true;
          return false;
        },
      },
      async () => {
        expect(await w.write_file.execute!({ path: 'x' }, {} as never)).toBe('wrote');
      },
    );
    expect(called).toBe(false);
  });

  it('ask แต่ไม่มี approve (headless) → ปฏิเสธ (ปลอดภัย)', async () => {
    const w = wrapToolsWithApproval(mkTools());
    await approvalContext.run({ mode: 'ask' }, async () => {
      expect(await w.write_file.execute!({ path: 'x' }, {} as never)).toContain('ปฏิเสธ');
    });
  });

  it('summarizeToolCall', () => {
    expect(summarizeToolCall('run_bash', { cmd: 'ls -la' })).toBe('$ ls -la');
    expect(summarizeToolCall('git_commit', { message: 'fix bug' })).toContain('fix bug');
    expect(summarizeToolCall('write_file', { path: '/x.ts' })).toContain('/x.ts');
  });

  it('mutating tools ที่รู้จักถูก gate ครบ (guard — กันลืม gate ตัวใหม่)', () => {
    for (const t of [
      'write_file',
      'edit_file',
      'run_bash',
      'git_commit',
      'schedule_task',
      'cancel_scheduled',
      'remember',
      'create_skill',
      'ha_call_service',
    ]) {
      expect(MUTATE_TOOLS.has(t)).toBe(true);
    }
  });

  it('remember/create_skill ถูก gate (regression — เขียน state ถาวร)', async () => {
    const w = wrapToolsWithApproval({
      remember: { execute: async () => 'saved' },
      create_skill: { execute: async () => 'made' },
    } as unknown as ToolSet);
    await approvalContext.run({ mode: 'ask', approve: async () => false }, async () => {
      expect(await w.remember.execute!({ fact: 'x' }, {} as never)).toContain('ปฏิเสธ');
      expect(await w.create_skill.execute!({ name: 'y' }, {} as never)).toContain('ปฏิเสธ');
    });
  });
});
