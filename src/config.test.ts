import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parsePricingOverride } from './config.js';
import { hasPricingForKey, PRICING } from './cost.js';

// ใช้ cwd = temp dir (ไม่แตะ process.env) — test project/CLI layering แบบ relative
describe('loadConfig layering', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-cfg-'));
    await mkdir(join(dir, '.sanook'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const key of Object.keys(PRICING)) {
      if (key.startsWith('test:')) delete PRICING[key];
    }
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

  it('malformed config FIELDS degrade to defaults instead of throwing on boot', async () => {
    // valid JSON, but several fields violate the schema (would have crashed ConfigSchema.parse)
    await writeFile(
      join(dir, '.sanook', 'config.json'),
      JSON.stringify({ model: 'keep-me', maxSteps: 'abc', permissionMode: 'banana', budgetUsd: -3 }),
    );
    const c = await loadConfig({}, dir);
    expect(c.model).toBe('keep-me'); // good field preserved
    expect(c.maxSteps).toBe(20); // bad field → default
    expect(c.permissionMode).toBe('ask'); // bad field → default
    expect(c.budgetUsd).toBeUndefined(); // bad budget dropped (no silent cap), surfaced via stderr warn
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

  it('trims SANOOK_MODEL and ignores blank values', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'proj-model' }));

    vi.stubEnv('SANOOK_MODEL', '  env-model  ');
    expect((await loadConfig({}, dir)).model).toBe('env-model');

    vi.stubEnv('SANOOK_MODEL', '   ');
    expect((await loadConfig({}, dir)).model).toBe('proj-model');
  });

  it('keeps embeddingModel for semantic search config', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ embeddingModel: 'openai:text-embedding-3-small' }));
    expect((await loadConfig({}, dir)).embeddingModel).toBe('openai:text-embedding-3-small');
  });

  it('untrusted project config ลด permissionMode เป็น auto ไม่ได้', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ permissionMode: 'auto' }));
    expect((await loadConfig({}, dir)).permissionMode).toBe('ask');
  });

  it('untrusted project ปิด budget cap (budgetUsd) ไม่ได้ — กัน repo อันตรายเปลืองเงิน user', async () => {
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ model: 'ok', budgetUsd: 999999 }));
    const c = await loadConfig({}, dir);
    expect(c.budgetUsd).toBeUndefined(); // budgetUsd ของ repo ถูก strip
    expect(c.model).toBe('ok'); // แต่ model (preference) ยัง apply ได้
  });

  it('untrusted project ตั้ง pricing ปลอมไม่ได้', async () => {
    await writeFile(
      join(dir, '.sanook', 'config.json'),
      JSON.stringify({ pricing: { 'test:untrusted-pricing': { input: 0.001, output: 0.001 } } }),
    );
    await loadConfig({}, dir);
    expect(hasPricingForKey('test:untrusted-pricing')).toBe(false);
  });

  it('trusted project ตั้ง budgetUsd ได้', async () => {
    vi.stubEnv('SANOOK_TRUST_PROJECT', '1');
    await writeFile(join(dir, '.sanook', 'config.json'), JSON.stringify({ budgetUsd: 2.5 }));
    expect((await loadConfig({}, dir)).budgetUsd).toBe(2.5);
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
    expect(() => parsePricingOverride('{bad json')).toThrow(/pricing JSON parse ไม่สำเร็จ/);
    expect(() => parsePricingOverride('{"openai:gpt-x":{"input":"1"}}')).toThrow(/openai:gpt-x.input/);
    expect(() => parsePricingOverride('{"openai:gpt-x":{"input":-1}}')).toThrow(/openai:gpt-x.input/);
    expect(() => parsePricingOverride('{"openai:gpt-x":{"unknown":1}}')).toThrow(/openai:gpt-x/);
    expect(() => parsePricingOverride('{"openai-gpt-x":{"input":1}}')).toThrow(/provider:model/);
  });

  it('SANOOK_PRICING ใช้ parser เดียวกับ CLI แต่ invalid env ไม่ทำ boot พัง', async () => {
    vi.stubEnv('SANOOK_PRICING', '{bad json');
    await expect(loadConfig({}, dir)).resolves.toBeDefined();

    vi.stubEnv('SANOOK_PRICING', '{"test:env-pricing":{"input":1,"output":2}}');
    await loadConfig({}, dir);
    expect(hasPricingForKey('test:env-pricing')).toBe(true);
  });
});

async function freshAgentTuning() {
  return (await import('./config.js')).agentTuning;
}

describe('agentTuning (env overrides)', () => {
  let home: string;
  let realHome: string | undefined;
  beforeEach(async () => {
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    process.env.HOME = home; // no ~/.sanook/config.json → pure defaults + env
    vi.resetModules();
  });
  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    for (const k of ['SANOOK_CACHE_TTL', 'SANOOK_COMPACTION', 'SANOOK_CONTEXT_COMPRESSION', 'SANOOK_THINKING', 'SANOOK_SUMMARY_MODEL']) delete process.env[k];
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  it('defaults: 5m cache, truncate, no thinking', async () => {
    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toMatchObject({ cacheTtl: '5m', compaction: 'truncate', contextCompression: 'selective', thinkingBudget: undefined });
  });
  it('env overrides apply', async () => {
    process.env.SANOOK_CACHE_TTL = '1h';
    process.env.SANOOK_COMPACTION = 'summarize';
    process.env.SANOOK_CONTEXT_COMPRESSION = 'headroom';
    process.env.SANOOK_THINKING = '2000';
    process.env.SANOOK_SUMMARY_MODEL = 'haiku';
    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toEqual({
      cacheTtl: '1h',
      compaction: 'summarize',
      contextCompression: 'headroom',
      thinkingBudget: 2000,
      summaryModel: 'haiku',
    });
  });
  it('trims enum-style env overrides before applying agent tuning', async () => {
    process.env.SANOOK_CACHE_TTL = ' 1h ';
    process.env.SANOOK_COMPACTION = ' summarize ';
    process.env.SANOOK_CONTEXT_COMPRESSION = ' selective ';
    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toMatchObject({ cacheTtl: '1h', compaction: 'summarize', contextCompression: 'selective' });
  });
  it('trims summary model env override before applying agent tuning', async () => {
    process.env.SANOOK_SUMMARY_MODEL = ' haiku ';
    const runAgentTuning = await freshAgentTuning();

    expect((await runAgentTuning()).summaryModel).toBe('haiku');
  });
  it('SANOOK_THINKING=on → default budget', async () => {
    process.env.SANOOK_THINKING = 'on';
    const runAgentTuning = await freshAgentTuning();

    expect((await runAgentTuning()).thinkingBudget).toBe(4096);
  });
  it('trims SANOOK_THINKING before parsing flags and budgets', async () => {
    const runAgentTuning = await freshAgentTuning();

    process.env.SANOOK_THINKING = '  yes  ';
    expect((await runAgentTuning()).thinkingBudget).toBe(4096);

    process.env.SANOOK_THINKING = '  3000  ';
    expect((await runAgentTuning()).thinkingBudget).toBe(3000);
  });
  it('ignores non-positive and unsafe thinking budgets from env', async () => {
    const runAgentTuning = await freshAgentTuning();

    process.env.SANOOK_THINKING = '0';
    expect((await runAgentTuning()).thinkingBudget).toBeUndefined();

    process.env.SANOOK_THINKING = '0.5';
    expect((await runAgentTuning()).thinkingBudget).toBeUndefined();

    process.env.SANOOK_THINKING = '9'.repeat(400);
    expect((await runAgentTuning()).thinkingBudget).toBeUndefined();
  });
});

describe('agentTuning (global config)', () => {
  let home: string;
  let realHome: string | undefined;
  const tuningEnvKeys = ['SANOOK_CACHE_TTL', 'SANOOK_COMPACTION', 'SANOOK_CONTEXT_COMPRESSION', 'SANOOK_THINKING', 'SANOOK_SUMMARY_MODEL'];

  beforeEach(async () => {
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-home-'));
    process.env.HOME = home;
    await mkdir(join(home, '.sanook'), { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    for (const key of tuningEnvKeys) delete process.env[key];
    vi.resetModules();
    await rm(home, { recursive: true, force: true });
  });

  it('trims raw global config tuning strings', async () => {
    await writeFile(
      join(home, '.sanook', 'config.json'),
      JSON.stringify({ cacheTtl: ' 1h ', compaction: ' summarize ', contextCompression: ' off ', summaryModel: ' haiku ' }),
    );

    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toMatchObject({ cacheTtl: '1h', compaction: 'summarize', contextCompression: 'off', summaryModel: 'haiku' });
  });

  it('treats array-shaped global config as empty', async () => {
    await writeFile(join(home, '.sanook', 'config.json'), JSON.stringify([{ cacheTtl: '1h' }]));

    const { agentTuning: runAgentTuning, readGlobalConfigRaw } = await import('./config.js');

    await expect(readGlobalConfigRaw()).resolves.toEqual({});
    expect(await runAgentTuning()).toMatchObject({ cacheTtl: '5m', compaction: 'truncate', contextCompression: 'selective' });
  });

  it('ignores blank env overrides when global config has tuning values', async () => {
    await writeFile(
      join(home, '.sanook', 'config.json'),
      JSON.stringify({ cacheTtl: '1h', compaction: 'summarize', thinking: true, summaryModel: 'haiku' }),
    );
    process.env.SANOOK_CACHE_TTL = ' ';
    process.env.SANOOK_COMPACTION = ' ';
    process.env.SANOOK_CONTEXT_COMPRESSION = ' ';
    process.env.SANOOK_THINKING = ' ';
    process.env.SANOOK_SUMMARY_MODEL = ' ';

    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toMatchObject({
      cacheTtl: '1h',
      compaction: 'summarize',
      contextCompression: 'selective',
      thinkingBudget: 4096,
      summaryModel: 'haiku',
    });
  });

  it('ignores malformed enum env overrides when global config has valid tuning values', async () => {
    await writeFile(join(home, '.sanook', 'config.json'), JSON.stringify({ cacheTtl: '1h', compaction: 'summarize', contextCompression: 'headroom' }));
    process.env.SANOOK_CACHE_TTL = 'daily';
    process.env.SANOOK_COMPACTION = 'compress';
    process.env.SANOOK_CONTEXT_COMPRESSION = 'magic';

    const runAgentTuning = await freshAgentTuning();

    expect(await runAgentTuning()).toMatchObject({ cacheTtl: '1h', compaction: 'summarize', contextCompression: 'headroom' });
  });
});
