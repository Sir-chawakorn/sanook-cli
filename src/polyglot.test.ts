import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPolyglotRuntimes, renderPolyglotReport } from './polyglot.js';

describe('polyglot runtime report', () => {
  it('detects optional runtimes through injectable probes', async () => {
    const installed = new Map<string, string>([
      ['python3', '/usr/bin/python3'],
      ['rustc', '/usr/bin/rustc'],
      ['rust-analyzer', '/usr/bin/rust-analyzer'],
    ]);

    const report = await inspectPolyglotRuntimes({
      cwd: '/repo',
      findBinaryImpl: async (command) => installed.get(command) ?? null,
      versionImpl: async (command) => `${command.split('/').pop()} 1.2.3`,
    });

    expect(report.cwd).toBe('/repo');
    expect(report.runtimes.find((runtime) => runtime.id === 'typescript')).toMatchObject({ status: 'core' });
    expect(report.runtimes.find((runtime) => runtime.id === 'python')).toMatchObject({
      status: 'ready',
      command: '/usr/bin/python3',
      version: 'python3 1.2.3',
    });
    expect(report.runtimes.find((runtime) => runtime.id === 'rustc')).toMatchObject({
      status: 'ready',
      command: '/usr/bin/rustc',
    });
    expect(report.runtimes.find((runtime) => runtime.id === 'uv')).toMatchObject({ status: 'missing' });
  });

  it('normalizes noisy version probe output', async () => {
    const report = await inspectPolyglotRuntimes({
      cwd: '/repo',
      findBinaryImpl: async (command) => (command === 'python3' ? '/usr/bin/python3' : null),
      versionImpl: async () => `  python ${'x'.repeat(300)}\nthis line should not appear`,
    });

    const python = report.runtimes.find((runtime) => runtime.id === 'python');
    expect(python?.version).toContain('... [truncated]');
    expect(python?.version).not.toContain('\n');
    expect(python?.version).not.toContain('this line should not appear');
    expect(python?.version?.length).toBeLessThanOrEqual(160);
  });

  it('falls back to stderr when default version probe stdout is blank', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sanook-polyglot-'));
    const fakePython = join(dir, 'python3');

    try {
      await writeFile(fakePython, '#!/bin/sh\nprintf "   \\n"\nprintf "Python 3.12.1\\n" >&2\n');
      await chmod(fakePython, 0o755);

      const report = await inspectPolyglotRuntimes({
        cwd: dir,
        findBinaryImpl: async (command) => (command === 'python3' ? fakePython : null),
      });

      expect(report.runtimes.find((runtime) => runtime.id === 'python')?.version).toBe('Python 3.12.1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renders role map and install hints', async () => {
    const report = await inspectPolyglotRuntimes({
      cwd: '/repo',
      findBinaryImpl: async () => null,
      versionImpl: async () => 'unused',
    });

    const text = renderPolyglotReport(report);
    expect(text).toContain('Sanook runtimes');
    expect(text).toContain('TypeScript stays the control plane');
    expect(text).toContain('Python');
    expect(text).toContain('Rust compiler');
    expect(text).toContain('Missing install hints');
  });

  it('renders an explicit empty state when no install hints are missing', async () => {
    const report = await inspectPolyglotRuntimes({
      cwd: '/repo',
      findBinaryImpl: async (command) => `/usr/bin/${command}`,
      versionImpl: async (command) => `${command} 1.2.3`,
    });

    const text = renderPolyglotReport(report);
    expect(text).toContain('Missing install hints:\n  - None');
  });
});
