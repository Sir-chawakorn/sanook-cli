import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToVaultInbox, appendBrainWorklog, buildBrainContext } from './memory.js';

describe('appendToVaultInbox (remember → second brain)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Shared', 'Memory-Inbox'), { recursive: true });
    await writeFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), '# Inbox\n\n## New Candidates\n');
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('เขียน fact ใต้ New Candidates', async () => {
    expect(await appendToVaultInbox(vault, 'ปิ๊กชอบคำตอบสั้นๆ')).toBe(true);
    const c = await readFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), 'utf8');
    expect(c).toContain('- ปิ๊กชอบคำตอบสั้นๆ');
    expect(c.indexOf('- ปิ๊กชอบ')).toBeGreaterThan(c.indexOf('## New Candidates'));
  });

  it('dedup ไม่เขียนซ้ำ', async () => {
    await appendToVaultInbox(vault, 'fact ก');
    expect(await appendToVaultInbox(vault, 'fact ก')).toBe(false);
  });

  it('ไม่เขียนถ้าไม่ใช่ vault (ไม่มี memory-inbox.md)', async () => {
    const notVault = await mkdtemp(join(tmpdir(), 'x-'));
    expect(await appendToVaultInbox(notVault, 'x')).toBe(false);
    await rm(notVault, { recursive: true, force: true });
  });
});

describe('buildBrainContext (closed loop — remembered fact กลับเข้า context)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Shared', 'Memory-Inbox'), { recursive: true });
    await mkdir(join(vault, 'Shared', 'Operating-State'), { recursive: true });
    await writeFile(join(vault, 'Shared', 'AI-Context-Index.md'), '# Index\npointers');
    await writeFile(join(vault, 'Shared', 'Operating-State', 'current-state.md'), '# state\nกำลังทำ launch sanook-cli');
    await writeFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), '# Inbox\n\n## New Candidates\n');
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('fact ที่ remember (inbox) กลับเข้า brain context + มี current-state', async () => {
    await appendToVaultInbox(vault, 'ปิ๊กชอบ dark mode');
    const ctx = await buildBrainContext(vault);
    expect(ctx).toContain('brain_vault');
    expect(ctx).toContain('ปิ๊กชอบ dark mode'); // ← loop ปิด: remembered fact กลับมา
    expect(ctx).toContain('launch sanook-cli'); // ← current-state เนื้อจริง
  });

  it('vault ว่าง (ไม่มีไฟล์) → คืน ""', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'e-'));
    expect(await buildBrainContext(empty)).toBe('');
    await rm(empty, { recursive: true, force: true });
  });
});

describe('appendBrainWorklog (auto worklog → vault Sessions)', () => {
  let vault: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.stubEnv('SANOOK_DISABLE_WORKLOG', '');
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Sessions'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(vault, { recursive: true, force: true });
  });

  it('สร้าง worklog รายวัน + frontmatter + up::', async () => {
    expect(
      await appendBrainWorklog(vault, { prompt: 'fix the failing test', summary: 'done', model: 'google:flash', today: '2026-06-15' }),
    ).toBe(true);
    const c = await readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8');
    expect(c).toContain('note_type: session-log');
    expect(c).toContain('fix the failing test');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('append turn ที่ 2 เข้าไฟล์เดิม (up:: ยังอยู่ท้าย)', async () => {
    await appendBrainWorklog(vault, { prompt: 'task one', summary: 's1', model: 'm', today: '2026-06-15' });
    await appendBrainWorklog(vault, { prompt: 'task two', summary: 's2', model: 'm', today: '2026-06-15' });
    const c = await readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8');
    expect(c).toContain('task one');
    expect(c).toContain('task two');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
    expect((c.match(/up:: \[\[Sessions/g) || []).length).toBe(1); // up:: ไม่ซ้ำ
  });

  it('ไม่เขียนถ้าไม่มี Sessions/ (ไม่ใช่ vault)', async () => {
    const notVault = await mkdtemp(join(tmpdir(), 'x-'));
    expect(await appendBrainWorklog(notVault, { prompt: 'x', summary: 'y', model: 'm', today: '2026-06-15' })).toBe(false);
    await rm(notVault, { recursive: true, force: true });
  });

  it('ไม่เขียน worklog เมื่อปิด persistence ทั้งหมด', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    expect(await appendBrainWorklog(vault, { prompt: 'private task', summary: 'done', model: 'm', today: '2026-06-15' })).toBe(false);
    await expect(readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8')).rejects.toThrow();
  });
});
