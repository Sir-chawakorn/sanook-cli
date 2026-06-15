import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHooksConfig, matches } from './hooks.js';

describe('hooks matcher', () => {
  it('"*" และ "" → match ทุก tool', () => {
    expect(matches('*', 'write_file')).toBe(true);
    expect(matches('', 'anything')).toBe(true);
  });
  it('regex alternation → match เฉพาะที่ตรง', () => {
    expect(matches('write_file|edit_file', 'write_file')).toBe(true);
    expect(matches('write_file|edit_file', 'edit_file')).toBe(true);
    expect(matches('write_file|edit_file', 'read_file')).toBe(false);
  });
  it('anchor เต็มชื่อ — ไม่ partial match', () => {
    expect(matches('write', 'write_file')).toBe(false); // ^write$ ไม่ match write_file
    expect(matches('write_file', 'write_file')).toBe(true);
  });
  it('regex พัง → เทียบตรงๆ (ไม่ throw)', () => {
    expect(matches('[invalid', 'write_file')).toBe(false);
    expect(matches('[invalid', '[invalid')).toBe(true);
  });
});

describe('loadHooksConfig', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'sanook-hooks-home-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('ข้าม malformed hook entries แทนที่จะทำให้ tool run crash', async () => {
    await mkdir(join(home, '.sanook'), { recursive: true });
    await writeFile(
      join(home, '.sanook', 'hooks.json'),
      JSON.stringify({
        PreToolUse: [
          { matcher: 'write_file', command: 'echo ok' },
          { matcher: 'edit_file' },
          null,
          { matcher: 123, command: 'echo bad' },
        ],
      }),
    );

    const cfg = await loadHooksConfig(home);
    expect(cfg.PreToolUse).toEqual([{ matcher: 'write_file', command: 'echo ok' }]);
  });
});
