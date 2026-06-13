import { describe, it, expect } from 'vitest';
import { readFileTool, bashTool } from './tools.js';

// helper: tool.execute ต้องการ (args, ToolCallOptions) — ใส่ stub options พอ
const opts = { toolCallId: 't1', messages: [], abortSignal: undefined } as never;

describe('read_file tool', () => {
  it('อ่านไฟล์จริงได้ (package.json)', async () => {
    const out = await readFileTool.execute!({ path: 'package.json' }, opts);
    expect(out).toContain('sanook-cli');
  });

  it('คืน ERROR (ไม่ throw) เมื่อไฟล์ไม่มี', async () => {
    const out = await readFileTool.execute!({ path: 'does-not-exist-xyz.txt' }, opts);
    expect(out).toMatch(/ERROR/);
  });
});

describe('run_bash tool', () => {
  it('รันคำสั่งปลอดภัยได้', async () => {
    const out = await bashTool.execute!({ cmd: 'echo hello-sanook' }, opts);
    expect(out).toContain('hello-sanook');
  });

  it('block คำสั่งทำลายล้าง (rm -rf)', async () => {
    const out = await bashTool.execute!({ cmd: 'rm -rf /tmp/whatever' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });

  it('block git reset --hard', async () => {
    const out = await bashTool.execute!({ cmd: 'git reset --hard HEAD~3' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });

  it('คืน ERROR เมื่อคำสั่งล้มเหลว (ไม่ throw)', async () => {
    const out = await bashTool.execute!({ cmd: 'nonexistent-cmd-xyz' }, opts);
    expect(out).toMatch(/ERROR/);
  });
});
