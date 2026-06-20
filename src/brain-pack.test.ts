import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import {
  buildContextPackDetail,
  extractPackDescription,
  formatBrainPackListReport,
  formatBrainPackShowReport,
  listContextPacks,
  normalizePackName,
  parseBrainPackArgs,
  showContextPack,
} from './brain-pack.js';

describe('parseBrainPackArgs', () => {
  it('parses list and show subcommands', () => {
    expect(parseBrainPackArgs(['list'])).toEqual({ ok: true, action: 'list' });
    expect(parseBrainPackArgs(['show', 'coding-release'])).toEqual({ ok: true, action: 'show', name: 'coding-release' });
    expect(parseBrainPackArgs(['show', 'Shared/Context-Packs/coding-release.md'])).toEqual({
      ok: true,
      action: 'show',
      name: 'Shared/Context-Packs/coding-release.md',
    });
  });

  it('rejects unknown subcommands and extra list args', () => {
    expect(parseBrainPackArgs([]).ok).toBe(false);
    expect(parseBrainPackArgs(['list', '--json']).ok).toBe(false);
    expect(parseBrainPackArgs(['show']).ok).toBe(false);
    expect(parseBrainPackArgs(['delete']).ok).toBe(false);
  });
});

describe('context pack helpers', () => {
  it('normalizes pack names and reads index descriptions', () => {
    expect(normalizePackName('Shared/Context-Packs/coding-release.md')).toBe('coding-release');
    const index = '- [[Shared/Context-Packs/coding-release]] — release work';
    expect(extractPackDescription(index, 'coding-release')).toBe('release work');
  });

  it('builds pack detail sections from markdown', () => {
    const content = [
      '> Use when shipping code.',
      '',
      '## Load Order',
      '- [[Shared/AI-Context-Index]]',
      '- [[Runbooks/ai-second-brain-operating-sequence]]',
      '',
      '## Done Criteria',
      '- Tests pass',
    ].join('\n');
    const detail = buildContextPackDetail('coding-release', content, '- [[Shared/Context-Packs/coding-release]] — release work');
    expect(detail.description).toBe('release work');
    expect(detail.loadOrder).toHaveLength(2);
    expect(detail.doneCriteria).toEqual(['Tests pass']);
    expect(detail.sources).toEqual(['Runbooks/ai-second-brain-operating-sequence', 'Shared/AI-Context-Index']);
  });
});

describe('listContextPacks/showContextPack', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-pack-'));
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-18' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists bundled context packs from a scaffolded vault', async () => {
    const report = await listContextPacks(vault);

    expect(report.ok).toBe(true);
    expect(report.packs.map((pack) => pack.name)).toEqual([
      'coding-release',
      'research-to-framework',
      'second-brain-maintenance',
    ]);
    expect(report.packs.every((pack) => pack.indexed && pack.hasLoadOrder && pack.hasDoneCriteria)).toBe(true);
    expect(formatBrainPackListReport(report)).toContain('Sanook brain pack list');
  });

  it('shows one context pack with load order and done criteria', async () => {
    const report = await showContextPack(vault, 'coding-release');

    expect(report.ok).toBe(true);
    expect(report.pack?.name).toBe('coding-release');
    expect(report.pack?.loadOrder.length).toBeGreaterThan(0);
    expect(report.pack?.doneCriteria.length).toBeGreaterThan(0);
    expect(formatBrainPackShowReport(report)).toContain('use-case:');
  });

  it('reports missing packs clearly', async () => {
    const report = await showContextPack(vault, 'missing-pack');
    expect(report.ok).toBe(false);
    expect(report.warnings[0]).toContain('missing-pack');
  });

  it('warns when a pack is not linked from the index', async () => {
    await writeFile(
      join(vault, 'Shared', 'Context-Packs', 'orphan-pack.md'),
      [
        '---',
        'parent: "[[Shared/Context-Packs/_Index]]"',
        '---',
        '',
        '> Orphan pack.',
        '',
        '## Load Order',
        '- [[Shared/AI-Context-Index]]',
        '',
        '## Done Criteria',
        '- Done',
        '',
        'up:: [[Shared/Context-Packs/_Index]]',
      ].join('\n'),
      'utf8',
    );

    const list = await listContextPacks(vault);
    const orphan = list.packs.find((pack) => pack.name === 'orphan-pack');
    expect(orphan?.indexed).toBe(false);

    const show = await showContextPack(vault, 'orphan-pack');
    expect(show.warnings.some((warning) => warning.includes('not linked'))).toBe(true);
  });
});
