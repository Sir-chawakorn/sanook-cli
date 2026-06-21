import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  capturedPrompt: '' as string,
}));

vi.mock('./providers/codex.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./providers/codex.js')>();
  return {
    ...actual,
    runCodex: vi.fn(async (opts: { prompt: string }) => {
      h.capturedPrompt = opts.prompt;
      return { text: 'จำได้ครับ คุณชวกร' };
    }),
  };
});

import { runAgent } from './loop.js';
import { seedPersonaMemory } from './memory.js';
import { MEMORY_DIR, loadStore, activeFacts } from './memory-store.js';

describe('runAgent codex delegate context', () => {
  let tmpHome: string;
  beforeEach(async () => {
    h.capturedPrompt = '';
    tmpHome = await mkdtemp(join(tmpdir(), 'sanook-delegate-'));
    vi.stubEnv('HOME', tmpHome); // isolate from the real second-brain vault (getBrainPath → undefined)
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    await rm(MEMORY_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(MEMORY_DIR, { recursive: true, force: true });
    await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
  });

  it('prepends owner persona + auto-memory into codex exec prompt', async () => {
    const n = await seedPersonaMemory({
      ownerName: 'ชวกร',
      language: 'ไทย + tech-en',
    });
    expect(n).toBeGreaterThan(0);

    const result = await runAgent({
      model: 'codex:gpt-5.5',
      prompt: 'จำฉันได้มั้ย',
      permissionMode: 'auto',
    });

    expect(result.text).toContain('ชวกร');
    expect(h.capturedPrompt).toContain('<owner_persona');
    expect(h.capturedPrompt).toContain('เจ้าของชื่อ ชวกร');
    expect(h.capturedPrompt).toContain('<auto_memory');
    expect(h.capturedPrompt).toContain('Now: จำฉันได้มั้ย');
    expect(activeFacts(await loadStore()).some((f) => f.text.includes('ชวกร'))).toBe(true);
  });
});
