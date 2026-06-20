import { describe, it, expect } from 'vitest';
import { describeToolCall, diffLines } from './tool-activity.js';

describe('diffLines', () => {
  it('marks removed lines red (-) and added lines green (+), trimming common context', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d).toEqual([
      { sign: '-', text: 'b' },
      { sign: '+', text: 'B' },
    ]);
  });

  it('caps long diffs with a summary marker', () => {
    const big = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const d = diffLines('', big, 5);
    const added = d.filter((l) => l.sign === '+');
    expect(added.length).toBe(5);
    expect(d.some((l) => l.sign === ' ' && l.text.includes('บรรทัด'))).toBe(true);
  });
});

describe('describeToolCall', () => {
  it('edit_file → green/red diff + title', () => {
    const a = describeToolCall('edit_file', { path: 'src/app.tsx', old_string: 'foo', new_string: 'bar' });
    expect(a.title).toContain('แก้ไฟล์');
    expect(a.title).toContain('src/app.tsx');
    expect(a.diff).toEqual([
      { sign: '-', text: 'foo' },
      { sign: '+', text: 'bar' },
    ]);
  });

  it('write_file → all additions (green) + line count', () => {
    const a = describeToolCall('write_file', { path: 'a.ts', content: 'x\ny\nz' });
    expect(a.title).toContain('เขียนไฟล์');
    expect(a.diff?.every((l) => l.sign === '+')).toBe(true);
    expect(a.diff?.length).toBe(3);
  });

  it('run_bash → shows the command', () => {
    expect(describeToolCall('run_bash', { cmd: 'npm test' }).title).toBe('$ npm test');
  });

  it('grep / git_commit / remember → friendly titles', () => {
    expect(describeToolCall('grep', { pattern: 'TODO' }).title).toContain('TODO');
    expect(describeToolCall('git_commit', { message: 'fix bug' }).title).toContain('git commit');
    expect(describeToolCall('remember', { fact: 'likes dark mode' }).title).toContain('🧠');
  });

  it('replace_all edit notes it applies everywhere', () => {
    const a = describeToolCall('edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true });
    expect(a.title).toContain('ทุกที่');
  });

  it('unknown tool falls back to name + a useful detail', () => {
    expect(describeToolCall('mystery_tool', { id: 'abc' }).title).toBe('mystery_tool abc');
    expect(describeToolCall('bare_tool', {}).title).toBe('bare_tool');
  });
});
