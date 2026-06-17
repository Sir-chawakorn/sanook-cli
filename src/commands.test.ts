import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expandCustomCommand,
  loadCustomCommands,
  parseCommand,
  parseSlashInvocation,
} from './commands.js';

const ctx = { model: 'sonnet' };

describe('parseCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ข้อความปกติ (ไม่ขึ้นต้น /) → handled=false (ส่งเข้า agent)', () => {
    expect(parseCommand('hello world', ctx).handled).toBe(false);
  });
  it('/help → action help + รายการคำสั่ง', () => {
    const r = parseCommand('/help', ctx);
    expect(r.action).toBe('help');
    expect(r.message).toContain('/model');
  });
  it('builtin slash commands are case-insensitive', () => {
    expect(parseCommand('/HELP', ctx).action).toBe('help');
    expect(parseCommand('/Model opus', ctx).modelChange).toBe('anthropic:claude-opus-4-8');
  });
  it('/quit + /exit → action quit', () => {
    expect(parseCommand('/quit', ctx).action).toBe('quit');
    expect(parseCommand('/exit', ctx).action).toBe('quit');
  });
  it('/clear → action clear', () => {
    expect(parseCommand('/clear', ctx).action).toBe('clear');
  });
  it('/new + /reset → clear conversation aliases', () => {
    expect(parseCommand('/new', ctx).action).toBe('clear');
    expect(parseCommand('/reset', ctx).action).toBe('clear');
  });
  it('/status → แสดง session/model/provider status แบบ Hermes-style', () => {
    const msg = parseCommand('/status', { model: 'sonnet', costSummary: 'tokens: 100' }).message ?? '';
    expect(msg).toContain('session: REPL');
    expect(msg).toContain('model: sonnet');
    expect(msg).toContain('usage: tokens: 100');
    expect(msg).toContain('/platforms');
  });
  it('/diff + /undo → action diff/undo (git-backed)', () => {
    expect(parseCommand('/diff', ctx).action).toBe('diff');
    expect(parseCommand('/undo', ctx).action).toBe('undo');
  });
  it('/retry → action retry', () => {
    expect(parseCommand('/retry', ctx).action).toBe('retry');
  });
  it('/stop → action stop', () => {
    const r = parseCommand('/stop', ctx);
    expect(r.action).toBe('stop');
    expect(r.message).toContain('ไม่มี turn');
  });
  it('/rewind → action rewind', () => {
    expect(parseCommand('/rewind', ctx).action).toBe('rewind');
  });
  it('/compress → Hermes-style alias ของ /compact', () => {
    expect(parseCommand('/compress', ctx).action).toBe('compact');
  });
  it('/model ไม่มี arg → แสดง model ปัจจุบัน', () => {
    expect(parseCommand('/model', ctx).message).toContain('sonnet');
  });
  it('/model opus → modelChange', () => {
    const r = parseCommand('/model opus', ctx);
    expect(r.modelChange).toBe('anthropic:claude-opus-4-8');
    expect(r.message).toContain('anthropic:claude-opus-4-8');
  });
  it('/model gpt → resolve เป็น OpenAI canonical spec และเตือนเรื่อง key/ChatGPT plan', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const r = parseCommand('/model gpt', ctx);
    expect(r.modelChange).toBe('openai:gpt-5.5');
    expect(r.message).toContain('เปลี่ยน model → openai:gpt-5.5');
    expect(r.message).toContain('OPENAI_API_KEY');
    expect(r.message).toContain('/model codex');
  });
  it('/model provider:alias → resolve alias ก่อนเก็บ state', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
    const r = parseCommand('/model openai:gpt', ctx);
    expect(r.modelChange).toBe('openai:gpt-5.5');
    expect(r.message).toBe('เปลี่ยน model → openai:gpt-5.5');
  });
  it('/model provider ที่ไม่มีใน registry → ไม่เปลี่ยน state', () => {
    const r = parseCommand('/model nope:model', ctx);
    expect(r.modelChange).toBeUndefined();
    expect(r.message).toContain('provider ไม่รองรับ');
  });
  it('/model provider: ที่ไม่มี model id → ไม่เปลี่ยน state', () => {
    const r = parseCommand('/model openai:', ctx);
    expect(r.modelChange).toBeUndefined();
    expect(r.message).toContain('model spec ไม่ครบ');
  });
  it('/personality → list/set/clear personality overlay', () => {
    expect(parseCommand('/personality', ctx).message).toContain('concise');
    expect(parseCommand('/personality concise', ctx)).toMatchObject({
      action: 'personality',
      personalityChange: 'concise',
    });
    expect(parseCommand('/personality none', ctx)).toMatchObject({
      action: 'personality',
      personalityChange: '',
    });
    expect(parseCommand('/personality mystery', ctx).message).toContain('ไม่รู้จัก');
  });
  it('/cost → คืน cost summary จาก ctx', () => {
    expect(parseCommand('/cost', { model: 'sonnet', costSummary: 'tokens: 100' }).message).toBe('tokens: 100');
  });
  it('/usage → Hermes-style alias ของ /cost', () => {
    expect(parseCommand('/usage', { model: 'sonnet', costSummary: 'tokens: 100' }).message).toBe('tokens: 100');
  });
  it('/insights → Hermes-style local insights command', () => {
    expect(parseCommand('/insights', ctx)).toMatchObject({ action: 'insights', insightsDays: 30 });
    expect(parseCommand('/insights --days 7', ctx)).toMatchObject({ action: 'insights', insightsDays: 7 });
    expect(parseCommand('/insights --days=8', ctx)).toMatchObject({ action: 'insights', insightsDays: 8 });
    expect(parseCommand('/insights -d 14', ctx)).toMatchObject({ action: 'insights', insightsDays: 14 });
    expect(parseCommand('/insights 21', ctx)).toMatchObject({ action: 'insights', insightsDays: 21 });
    expect(parseCommand('/insights --all', ctx)).toMatchObject({ action: 'insights', insightsDays: 30, insightsAll: true });
    expect(parseCommand('/insights --all --days 7', ctx)).toMatchObject({
      action: 'insights',
      insightsDays: 7,
      insightsAll: true,
    });
    expect(parseCommand('/insights nope', ctx).message).toContain('/insights');
    expect(parseCommand('/insights --days 0', ctx).message).toContain('/insights');
  });
  it('/platforms → แสดง provider/messaging surface แบบไม่มี China integrations', () => {
    const msg = parseCommand('/platforms', ctx).message ?? '';
    expect(msg).toContain('anthropic');
    expect(msg).toContain('googlechat');
    expect(msg).toContain('bluebubbles');
    const blocked = [
      'deep' + 'seek',
      'g' + 'lm',
      'mini' + 'max',
      'fei' + 'shu',
      'ding' + 'talk',
      'we' + 'com',
      'wei' + 'xin',
      'yuan' + 'bao',
      'qq' + 'bot',
    ];
    for (const name of blocked) expect(msg.toLowerCase()).not.toContain(name);
  });
  it('/tools → แสดง orchestration tools ครบ', () => {
    const msg = parseCommand('/tools', ctx).message ?? '';
    expect(msg).toContain('task_spawn');
    expect(msg).toContain('task_collect');
    expect(msg).toContain('task_cancel');
    expect(msg).toContain('task_status');
  });
  it('คำสั่งไม่รู้จัก → แนะนำ /help', () => {
    expect(parseCommand('/wat', ctx).message).toContain('/help');
  });
});

describe('custom slash commands', () => {
  let dir: string;
  let home: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-cmd-'));
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it('parseSlashInvocation เก็บ args หลังชื่อคำสั่งไว้ครบ', () => {
    expect(parseSlashInvocation('/review file a.ts --deep')).toEqual({
      name: 'review',
      args: 'file a.ts --deep',
    });
    expect(parseSlashInvocation('hello')).toBeNull();
  });

  it('expandCustomCommand แทน placeholder หรือ append args', () => {
    expect(expandCustomCommand({ name: 'x', description: '', body: 'Review:\n$ARGUMENTS' }, 'a.ts')).toBe(
      'Review:\na.ts',
    );
    expect(expandCustomCommand({ name: 'x', description: '', body: 'Review repo' }, 'a.ts')).toBe(
      'Review repo\n\na.ts',
    );
  });

  it('โหลด global commands แต่ project commands ต้อง trust ก่อน', async () => {
    await mkdir(join(home, '.sanook', 'commands'), { recursive: true });
    await writeFile(
      join(home, '.sanook', 'commands', 'global-review.md'),
      '---\ndescription: global\n---\n\nReview globally',
    );

    await mkdir(join(dir, '.sanook', 'commands'), { recursive: true });
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(
      join(dir, '.sanook', 'commands', 'project-review.md'),
      '---\ndescription: project\n---\n\nReview project',
    );

    const untrusted = await loadCustomCommands(dir);
    expect(untrusted.has('global-review')).toBe(true);
    expect(untrusted.has('project-review')).toBe(false);

    vi.stubEnv('SANOOK_TRUST_PROJECT', '1');
    const trusted = await loadCustomCommands(dir);
    expect(trusted.get('project-review')?.body).toBe('Review project');
  });
});
