import { describe, it, expect } from 'vitest';
import { diagnose } from './index.js';

// these paths exercise the GRACEFUL branches only — no language server is spawned
// (unsupported extension / not-installed server resolve before any child process).
describe('diagnose — graceful degradation (no server spawned)', () => {
  it('unsupported extension → ok:false with a clear reason', async () => {
    const r = await diagnose('notes.md');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('นามสกุล');
  });

  it('a configured-but-uninstalled server → ok:false with an install hint (or real result if it happens to be installed)', async () => {
    const r = await diagnose('phantom-file.rs'); // rust-analyzer almost never present in CI
    if (!r.ok) {
      expect(r.reason).toMatch(/rust-analyzer|ติดตั้ง/);
    } else {
      expect(r.serverId).toBe('rust'); // if it IS installed, we got a real (possibly empty) result
    }
  });
});
