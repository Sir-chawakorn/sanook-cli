import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import { collectBrainMetrics, formatBrainMetricsReport } from './brain-metrics.js';

describe('collectBrainMetrics', () => {
  let dir: string;
  let vault: string;
  let indexPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-metrics-'));
    vault = join(dir, 'vault');
    indexPath = join(dir, 'search', 'index.json');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
    await writeIndexManifest();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeIndexManifest(): Promise<void> {
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify({ v: 1, index: {}, manifest: {} })}\n`, 'utf8');
  }

  it('reports vault counts for a scaffolded vault', async () => {
    const report = await collectBrainMetrics({ brainPath: vault, indexPath, runRetrievalEval: false });
    expect(report.counts.markdownTotal).toBeGreaterThan(20);
    expect(report.counts.contextPacks).toBe(3);
    expect(formatBrainMetricsReport(report)).toContain('Sanook brain metrics');
  });

  it('flags stale notes past stale_after', async () => {
    const stalePath = join(vault, 'Projects', 'stale.md');
    await writeFile(
      stalePath,
      '---\ntags: [project]\nnote_type: project-overview\nstale_after: 2020-01-01\n---\n\n# Stale\n\nup:: [[Projects/_Index]]\n',
    );
    const old = new Date(Date.parse('2026-06-18') - 30 * 24 * 60 * 60 * 1000);
    await utimes(stalePath, old, old);
    const report = await collectBrainMetrics({
      brainPath: vault,
      indexPath,
      nowMs: Date.parse('2026-06-18'),
      runRetrievalEval: false,
      staleTouchGraceDays: 14,
    });
    expect(report.staleNotes.some((n) => n.relPath === 'Projects/stale.md')).toBe(true);
  });
});
