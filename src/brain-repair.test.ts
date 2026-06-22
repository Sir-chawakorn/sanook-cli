import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import {
  applyContextPackIndexFix,
  applyMarkdownRepairs,
  collectRepairActions,
  formatBrainRepairReport,
  parseBrainRepairArgs,
  planContextPackIndexFix,
  repairBrain,
} from './brain-repair.js';

describe('parseBrainRepairArgs', () => {
  it('parses dry-run', () => {
    expect(parseBrainRepairArgs([])).toEqual({ ok: true, dryRun: false });
    expect(parseBrainRepairArgs(['--dry-run'])).toEqual({ ok: true, dryRun: true });
  });

  it('rejects unknown flags', () => {
    expect(parseBrainRepairArgs(['--force']).ok).toBe(false);
  });
});

describe('brain repair helpers', () => {
  it('plans and applies markdown one-line fixes', () => {
    const raw = ['---', 'note_type: note', '---', '', '# Title', ''].join('\n');
    const repaired = applyMarkdownRepairs('Sessions/note.md', raw);
    expect(repaired.applied).toEqual(['purpose-blockquote', 'parent-frontmatter', 'up-link']);
    expect(repaired.content).toContain('> _(purpose pending');
    expect(repaired.content).toContain('parent: "[[Sessions/_Index]]"');
    expect(repaired.content).toContain('up:: [[Sessions/_Index]]');
  });

  it('does not mistake later quoted content for the note purpose blockquote', () => {
    const raw = [
      '---',
      'note_type: session-log',
      'parent: "[[Sessions/_Index]]"',
      '---',
      '',
      '# Quoted Evidence',
      '',
      '## Evidence',
      '> user said this later',
      '',
      'up:: [[Sessions/_Index]]',
    ].join('\n');

    const repaired = applyMarkdownRepairs('Sessions/quoted-evidence.md', raw);

    expect(repaired.applied).toEqual(['purpose-blockquote']);
    expect(repaired.content).toContain('> _(purpose pending');
    expect(repaired.content).toContain('> user said this later');
  });

  it('adds parent frontmatter inside existing CRLF frontmatter', () => {
    const raw = [
      '---',
      'note_type: session-log',
      '---',
      '',
      '> Session purpose.',
      '',
      '# CRLF Note',
      '',
      'up:: [[Sessions/_Index]]',
      '',
    ].join('\r\n');

    const repaired = applyMarkdownRepairs('Sessions/crlf-note.md', raw);

    expect(repaired.applied).toEqual(['parent-frontmatter']);
    expect(repaired.content).toContain('---\r\nparent: "[[Sessions/_Index]]"\r\nnote_type: session-log\r\n---');
    expect(repaired.content).not.toContain('---\nparent: "[[Sessions/_Index]]"\n---\n\n---');
  });

  it('adds missing context pack links to the index', () => {
    const index = ['## Context Packs', '', '## Use Rule', 'rule', '', 'up:: [[Shared/_Index]]'].join('\n');
    const pack = ['> Pack for tests.', '', '## Load Order', '- a', '', '## Done Criteria', '- b'].join('\n');
    const next = applyContextPackIndexFix(index, 'orphan-pack', pack);
    expect(next).toContain('[[Shared/Context-Packs/orphan-pack]]');
    expect(planContextPackIndexFix('orphan-pack', next)).toBeUndefined();
  });

  it('writes a pack purpose with $-sequences literally (no String.replace pattern expansion)', () => {
    const index = ['## Context Packs', '', '## Use Rule', 'rule', '', 'up:: [[Shared/_Index]]'].join('\n');
    const pack = ['> กำไร $$ การันตี $& และ $1 เสมอ', '', '## Load Order', '- a'].join('\n');
    const next = applyContextPackIndexFix(index, 'dollar-pack', pack);
    expect(next).toContain('กำไร $$ การันตี $& และ $1 เสมอ'); // literal — ไม่ถูก expand เป็น match/backref
    expect(next).not.toContain('## Use Rule\n## Use Rule'); // $& ไม่ได้ splice marker ซ้ำ
    expect((next.match(/## Use Rule/g) || []).length).toBe(1);
  });
});

describe('repairBrain', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-repair-'));
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-20' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('plans fixes for hygiene and missing pack index links', async () => {
    await writeFile(
      join(vault, 'Sessions', 'broken-note.md'),
      ['---', 'note_type: session-log', '---', '', '# Broken', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      join(vault, 'Shared', 'Context-Packs', 'orphan-pack.md'),
      [
        '---',
        'note_type: context-pack',
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

    const actions = await collectRepairActions(vault);
    expect(actions.some((action) => action.relPath === 'Sessions/broken-note.md')).toBe(true);
    expect(actions.some((action) => action.id === 'repair.context-pack-index')).toBe(true);

    const dry = await repairBrain({ brainPath: vault, dryRun: true });
    expect(dry.actions.length).toBeGreaterThan(0);
    expect(formatBrainRepairReport(dry)).toContain('dry-run');
  });

  it('applies markdown and context-pack index repairs', async () => {
    await writeFile(
      join(vault, 'Sessions', 'broken-note.md'),
      ['---', 'note_type: session-log', '---', '', '# Broken', ''].join('\n'),
      'utf8',
    );
    await writeFile(
      join(vault, 'Shared', 'Context-Packs', 'orphan-pack.md'),
      [
        '---',
        'note_type: context-pack',
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

    const report = await repairBrain({ brainPath: vault });
    expect(report.ok).toBe(true);
    expect(report.applied.some((item) => item.startsWith('Sessions/broken-note.md'))).toBe(true);
    expect(report.applied.some((item) => item.includes('orphan-pack'))).toBe(true);

    const fixed = await readFile(join(vault, 'Sessions', 'broken-note.md'), 'utf8');
    expect(fixed).toContain('parent: "[[Sessions/_Index]]"');
    expect(fixed).toContain('up:: [[Sessions/_Index]]');

    const index = await readFile(join(vault, 'Shared', 'Context-Packs', '_Index.md'), 'utf8');
    expect(index).toContain('[[Shared/Context-Packs/orphan-pack]]');
  });

  it('creates missing scaffold folders reported by doctor', async () => {
    await rm(join(vault, 'Handoffs'), { recursive: true, force: true });
    const report = await repairBrain({ brainPath: vault, expectedFolders: ['Handoffs', 'Sessions'] });
    expect(report.applied.some((item) => item.includes('Handoffs'))).toBe(true);
  });
});
