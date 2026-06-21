import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedPersonaMemory, loadPersonaAnswers, persistPersonaPatch } from './memory.js';
import { MEMORY_DIR, loadStore, activeFacts } from './memory-store.js';
import { personaAnswersFromFacts } from './persona.js';

// Regression coverage for the "sanook setup ลืมชื่อ" bug: seedPersonaMemory must persist any name the
// user actually typed (even one equal to the old 'Owner' placeholder) and must NOT persist a blank
// name. HOME is stubbed to a throwaway dir so getBrainPath() returns undefined — these tests never read
// or write the real second-brain vault (loadPersonaAnswers/persistPersonaPatch otherwise would).
let tmpHome: string;
async function isolate(): Promise<void> {
  tmpHome = await mkdtemp(join(tmpdir(), 'sanook-persona-'));
  vi.stubEnv('HOME', tmpHome); // getBrainPath → appHomePath('config.json') under temp home → undefined
  vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
  await rm(MEMORY_DIR, { recursive: true, force: true });
}
async function cleanup(): Promise<void> {
  vi.unstubAllEnvs();
  await rm(MEMORY_DIR, { recursive: true, force: true });
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
}

describe('seedPersonaMemory name gate', () => {
  beforeEach(isolate);
  afterEach(cleanup);

  it('seeds a typed name and round-trips it through the store', async () => {
    const n = await seedPersonaMemory({ ownerName: 'ปิ๊ก' });
    expect(n).toBe(1);
    const factTexts = activeFacts(await loadStore()).map((f) => f.text);
    expect(factTexts).toContain('เจ้าของชื่อ ปิ๊ก — เรียกเจ้าของด้วยชื่อนี้');
    expect(personaAnswersFromFacts(factTexts).ownerName).toBe('ปิ๊ก');
  });

  it('does NOT seed a blank/skipped name', async () => {
    const n = await seedPersonaMemory({ ownerName: '', aiName: '   ' });
    expect(n).toBe(0);
    expect(activeFacts(await loadStore())).toHaveLength(0);
  });

  it('seeds a name even when it equals the legacy default sentinel "Owner"', async () => {
    const n = await seedPersonaMemory({ ownerName: 'Owner' });
    expect(n).toBe(1);
    const factTexts = activeFacts(await loadStore()).map((f) => f.text);
    expect(personaAnswersFromFacts(factTexts).ownerName).toBe('Owner');
  });
});

describe('persistPersonaPatch (partial /goal update)', () => {
  beforeEach(isolate);
  afterEach(cleanup);

  it('merges a single field over existing answers without clobbering the rest', async () => {
    await seedPersonaMemory({ ownerName: 'ปิ๊ก' });
    await persistPersonaPatch({ goals: 'สร้าง sanook-cli ให้จำ persona ได้' });
    const answers = await loadPersonaAnswers(); // no vault (HOME stubbed) → store only
    expect(answers.ownerName).toBe('ปิ๊ก'); // name survives the goal-only update
    expect(answers.goals).toBe('สร้าง sanook-cli ให้จำ persona ได้');
  });
});
