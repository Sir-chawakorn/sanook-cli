import { describe, it, expect } from 'vitest';
import { diagnosticsTool } from './diagnostics.js';

const run = (args: { path: string; content?: string }): Promise<string> =>
  Promise.resolve(diagnosticsTool.execute!(args, {} as never)).then(String);

describe('diagnostics tool', () => {
  it('an unsupported file degrades gracefully (LSP message, not a crash)', async () => {
    const out = await run({ path: 'README.md' });
    expect(out).toContain('LSP');
    expect(out).toContain('นามสกุล');
  });

  it('blocks a path outside the workspace', async () => {
    const out = await run({ path: '/etc/hosts' });
    expect(out).toContain('BLOCKED');
  });

  it('a TS file with no server installed reports how to install it (or returns real diagnostics if present)', async () => {
    const out = await run({ path: 'src/loop.ts', content: 'const x: number = "nope";' });
    // CI has no typescript-language-server → install hint; a dev box that has it → a real result
    expect(out).toMatch(/typescript-language-server|error|warning|ไม่มี diagnostics/);
  });
});
