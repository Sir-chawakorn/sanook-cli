import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parsePricingOverride } from './config.js';

// ใช้ cwd = temp dir (ไม่แตะ process.env) — test project/CLI layering แบบ relative
describe('loadConfig layering', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-cfg-'));
    await mkdir(join(dir, '.sanook'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('project config override default', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'opus-test', maxSteps: 33 }));
    const c = await loadConfig({}, dir);
    expect(c.model).toBe('opus-test');
    expect(c.maxSteps).toBe(33);
  });

  it('อ่าน project config จาก root แม้รันจาก subfolder', async () => {
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'root-model' }));
    const subdir = join(dir, 'packages', 'app');
    await mkdir(subdir, { recursive: true });
    expect((await loadConfig({}, subdir)).model).toBe('root-model');
  });

  it('CLI override ชนะ project config', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'opus-test' }));
    expect((await loadConfig({ model: 'haiku-test' }, dir)).model).toBe('haiku-test');
  });

  it('strip undefined override (ไม่ทับ project)', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'proj-model' }));
    expect((await loadConfig({ model: undefined }, dir)).model).toBe('proj-model');
  });

  it('invalid json → ไม่ throw (fallback)', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), 'not valid json {');
    const c = await loadConfig({}, dir);
    expect(c.model).toBeDefined();
  });

  it('budgetUsd ผ่าน CLI override', async () => {
    expect((await loadConfig({ budgetUsd: 0.5 }, dir)).budgetUsd).toBe(0.5);
  });

  it('SANOOK_MODEL override ชนะ project config แต่แพ้ CLI override', async () => {
    vi.stubEnv('SANOOK_MODEL', 'env-model');
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'proj-model' }));
    expect((await loadConfig({}, dir)).model).toBe('env-model');
    expect((await loadConfig({ model: 'cli-model' }, dir)).model).toBe('cli-model');
  });

  it('untrusted project config ลด permissionMode เป็น auto ไม่ได้', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ permissionMode: 'auto' }));
    expect((await loadConfig({}, dir)).permissionMode).toBe('ask');
  });

  it('trusted project config override permissionMode ได้', async () => {
    vi.stubEnv('SANOOK_TRUST_PROJECT', '1');
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ permissionMode: 'auto' }));
    expect((await loadConfig({}, dir)).permissionMode).toBe('auto');
  });

  it('pricing override ต้องเป็น numeric object ที่ schema รองรับ', () => {
    expect(parsePricingOverride('{"openai:gpt-x":{"input":1,"output":3}}')).toEqual({
      'openai:gpt-x': { input: 1, output: 3 },
    });
    expect(() => parsePricingOverride('{"openai:gpt-x":{"input":"1"}}')).toThrow();
    expect(() => parsePricingOverride('{"openai:gpt-x":{"input":-1}}')).toThrow();
    expect(() => parsePricingOverride('{"openai:gpt-x":{"unknown":1}}')).toThrow();
  });
});

import { agentTuning } from './config.js';
describe('agentTuning (env overrides)', () => {
  let home: string;
  let realHome: string | undefined;
  beforeEach(async () => {
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    process.env.HOME = home; // no ~/.sanook/config.json → pure defaults + env
  });
  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    for (const k of ['SANOOK_CACHE_TTL', 'SANOOK_COMPACTION', 'SANOOK_THINKING', 'SANOOK_SUMMARY_MODEL']) delete process.env[k];
    await rm(home, { recursive: true, force: true });
  });

  it('defaults: 5m cache, truncate, no thinking', async () => {
    expect(await agentTuning()).toMatchObject({ cacheTtl: '5m', compaction: 'truncate', thinkingBudget: undefined });
  });
  it('env overrides apply', async () => {
    process.env.SANOOK_CACHE_TTL = '1h';
    process.env.SANOOK_COMPACTION = 'summarize';
    process.env.SANOOK_THINKING = '2000';
    process.env.SANOOK_SUMMARY_MODEL = 'haiku';
    expect(await agentTuning()).toEqual({ cacheTtl: '1h', compaction: 'summarize', thinkingBudget: 2000, summaryModel: 'haiku' });
  });
  it('SANOOK_THINKING=on → default budget', async () => {
    process.env.SANOOK_THINKING = 'on';
    expect((await agentTuning()).thinkingBudget).toBe(4096);
  });
});
