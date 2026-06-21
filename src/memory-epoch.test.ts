import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rm } from 'node:fs/promises';

import { MEMORY_DIR, saveStore, loadStore, mergeFact, memoryStoreEpoch } from './memory-store.js';

// The loop's per-session prompt snapshot keys on (sessionId, memoryStoreEpoch()). A store write must
// bump the epoch so the snapshot invalidates and a name/goal set mid-session is reflected next turn.
describe('memoryStoreEpoch', () => {
  beforeEach(async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    await rm(MEMORY_DIR, { recursive: true, force: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(MEMORY_DIR, { recursive: true, force: true });
  });

  it('bumps after a successful saveStore', async () => {
    const before = memoryStoreEpoch();
    const store = mergeFact(await loadStore(), { text: 'เจ้าของชื่อ ปิ๊ก', trust: 'owner' }).store;
    await saveStore(store);
    expect(memoryStoreEpoch()).toBe(before + 1);
    await saveStore(store);
    expect(memoryStoreEpoch()).toBe(before + 2);
  });

  it('does NOT bump when persistence is disabled (no write happened)', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    const before = memoryStoreEpoch();
    await saveStore(await loadStore());
    expect(memoryStoreEpoch()).toBe(before);
  });
});
