import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';

// ใช้ cwd = temp dir (ไม่แตะ process.env) — test project/CLI layering แบบ relative
describe('loadConfig layering', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-cfg-'));
    await mkdir(join(dir, '.sanook'), { recursive: true });
  });
  afterEach(async () => {
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
});
