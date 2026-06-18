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
});

