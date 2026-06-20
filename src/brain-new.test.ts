import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAIN_DEFAULTS, scaffoldBrain } from './brain.js';
import {
  createBrainNote,
  destinationIndexRelPath,
  formatBrainNewReport,
  inferParentRelPath,
  instantiateNoteTemplate,
  parseBrainNewArgs,
  validateNoteOutputPath,
} from './brain-new.js';

describe('parseBrainNewArgs', () => {
  it('parses type, title, output, and force flags', () => {
    expect(parseBrainNewArgs(['session', '--title', 'ship feature', '--force', '--output', 'Sessions/custom.md'])).toEqual({
      ok: true,
      value: { type: 'session', title: 'ship feature', force: true, output: 'Sessions/custom.md' },
    });
    expect(parseBrainNewArgs(['bug', 'login fails'])).toEqual({
      ok: true,
      value: { type: 'bug', title: 'login fails', force: false },
    });
  });

  it('rejects unknown types and ambiguous title input', () => {
    expect(parseBrainNewArgs(['memo']).ok).toBe(false);
    expect(parseBrainNewArgs(['session', '--title', 'one', 'two']).ok).toBe(false);
    expect(parseBrainNewArgs(['session', '--json']).ok).toBe(false);
  });
});

describe('brain new helpers', () => {
  it('infers parent paths and validates destination folders', () => {
    expect(inferParentRelPath('Sessions/2026-06-18-note.md')).toBe('Sessions/_Index');
    expect(inferParentRelPath('Projects/sanook-cli/roadmap.md')).toBe('Projects/sanook-cli/_Index');
    expect(destinationIndexRelPath('project', 'Projects/sanook-cli/overview.md')).toBe('Projects/sanook-cli/_Index');
    expect(validateNoteOutputPath('session', 'Sessions/note.md').ok).toBe(true);
    expect(validateNoteOutputPath('session', 'Bugs/note.md').ok).toBe(false);
  });

  it('instantiates templates with parent, title, and up link', () => {
    const raw = [
      '---',
      'note_type: session-log',
      'created: YYYY-MM-DD',
      'parent: "[[Templates/_Index]]"',
      '---',
      '',
      '# YYYY-MM-DD — <topic>',
      '',
      'up:: [[Templates/_Index]]',
    ].join('\n');
    const content = instantiateNoteTemplate(raw, {
      today: '2026-06-20',
      title: 'ship pack command',
      parent: 'Sessions/_Index',
      type: 'session',
    });
    expect(content).toContain('created: 2026-06-20');
    expect(content).toContain('# 2026-06-20 — ship pack command');
    expect(content).toContain('parent: "[[Sessions/_Index]]"');
    expect(content).toContain('up:: [[Sessions/_Index]]');
  });
});

describe('createBrainNote', () => {
  let dir: string;
  let vault: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-brain-new-'));
    vault = join(dir, 'vault');
    await scaffoldBrain(vault, { ...BRAIN_DEFAULTS, today: '2026-06-20' });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a session note in Sessions and links it from the index', async () => {
    const report = await createBrainNote({
      brainPath: vault,
      type: 'session',
      title: 'implement brain pack',
      today: '2026-06-20',
    });

    expect(report.ok).toBe(true);
    expect(report.relPath).toBe('Sessions/2026-06-20-implement-brain-pack.md');
    expect(report.indexed).toBe(true);
    expect(formatBrainNewReport(report)).toContain('Sanook brain new');

    const content = await readFile(join(vault, report.relPath!), 'utf8');
    expect(content).toContain('note_type: session-log');
    expect(content).toContain('parent: "[[Sessions/_Index]]"');
    expect(content).toContain('up:: [[Sessions/_Index]]');

    const index = await readFile(join(vault, 'Sessions', '_Index.md'), 'utf8');
    expect(index).toContain('[[Sessions/2026-06-20-implement-brain-pack]]');
  });

  it('scaffolds a project workspace under Projects/<slug>/', async () => {
    const repo = join(dir, 'demo-app');
    const report = await createBrainNote({
      brainPath: vault,
      type: 'project',
      title: 'Demo App',
      repo: repo,
      today: '2026-06-20',
    });
    expect(report.ok).toBe(true);
    expect(report.relPath).toBe('Projects/demo-app/overview.md');
    const repoMd = await readFile(join(vault, 'Projects/demo-app/repo.md'), 'utf8');
    expect(repoMd).toContain(`repo_path: ${repo}`);
  });

  it('creates a golden-case note from the Acceptance template fallback', async () => {
    const report = await createBrainNote({
      brainPath: vault,
      type: 'golden-case',
      title: 'search returns roadmap',
      today: '2026-06-20',
      output: 'Acceptance/search-roadmap.md',
    });

    expect(report.ok).toBe(true);
    expect(report.template).toBe('Acceptance/golden-case-template.md');
    const content = await readFile(join(vault, 'Acceptance/search-roadmap.md'), 'utf8');
    expect(content).toContain('note_type: golden-case');
    expect(content).toContain('parent: "[[Acceptance/_Index]]"');
  });

  it('rejects wrong-folder output paths', async () => {
    const report = await createBrainNote({
      brainPath: vault,
      type: 'bug',
      title: 'wrong folder',
      output: 'Sessions/bug.md',
    });

    expect(report.ok).toBe(false);
    expect(report.warnings[0]).toContain('Bugs/');
  });
});
