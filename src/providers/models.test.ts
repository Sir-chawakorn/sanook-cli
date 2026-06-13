import { describe, it, expect } from 'vitest';
import { mergeModelOptions, listRemoteModels } from './models.js';
import { PROVIDERS } from './registry.js';

describe('mergeModelOptions', () => {
  it('curated alias นำหน้า + remote id ใหม่ต่อท้าย, dedup ด้วย model id', () => {
    const opts = mergeModelOptions(PROVIDERS.anthropic, ['claude-opus-4-8', 'claude-brand-new']);
    const values = opts.map((o) => o.value);
    expect(values).toContain('claude-brand-new'); // remote ใหม่ → เพิ่มเข้ามา
    // claude-opus-4-8 มีใน curated (opus) แล้ว → remote ไม่เพิ่มซ้ำ
    expect(values.filter((v) => v === 'claude-opus-4-8').length).toBe(1);
  });

  it('ไม่มี remote → curated alias อย่างเดียว (ตัด default ออก)', () => {
    const opts = mergeModelOptions(PROVIDERS.anthropic);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.label.startsWith('opus'))).toBe(true);
  });
});

describe('listRemoteModels', () => {
  it('delegate provider (codex) → [] โดยไม่ยิง network', async () => {
    expect(await listRemoteModels(PROVIDERS.codex, 'whatever')).toEqual([]);
  });
});
