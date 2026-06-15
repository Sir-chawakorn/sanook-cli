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
