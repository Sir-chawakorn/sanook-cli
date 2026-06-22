import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SkillDraft, TaskFamily } from './self-improve.js';

type SelfImproveModule = typeof import('./self-improve.js');

let tmpHome: string;
let signatureTerms: SelfImproveModule['signatureTerms'];
let signatureKey: SelfImproveModule['signatureKey'];
let jaccard: SelfImproveModule['jaccard'];
let recordTask: SelfImproveModule['recordTask'];
let markSkillCreated: SelfImproveModule['markSkillCreated'];
let emptyLedger: SelfImproveModule['emptyLedger'];
let slugifySkillName: SelfImproveModule['slugifySkillName'];
let uniqueSkillName: SelfImproveModule['uniqueSkillName'];
let maybeAutoSkill: SelfImproveModule['maybeAutoSkill'];
let loadLedger: SelfImproveModule['loadLedger'];
let saveLedger: SelfImproveModule['saveLedger'];
let LEDGER_PATH: SelfImproveModule['LEDGER_PATH'];

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), 'sanook-self-improve-'));
  vi.stubEnv('HOME', tmpHome);
  vi.stubEnv('USERPROFILE', tmpHome);
  vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
  vi.stubEnv('SANOOK_DISABLE_SELF_IMPROVE', '');
  vi.resetModules();
  ({
    signatureTerms,
    signatureKey,
    jaccard,
    recordTask,
    markSkillCreated,
    emptyLedger,
    slugifySkillName,
    uniqueSkillName,
    maybeAutoSkill,
    loadLedger,
    saveLedger,
    LEDGER_PATH,
  } = await import('./self-improve.js'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(tmpHome, { recursive: true, force: true }).catch(() => {});
});

describe('signatureTerms / signatureKey', () => {
  it('strips slash-command and @mention noise, dedups, caps length', () => {
    const terms = signatureTerms('/run deploy the frontend to vercel @src/app.tsx deploy deploy');
    expect(terms).toContain('deploy');
    expect(terms).toContain('vercel');
    expect(terms.filter((t) => t === 'deploy').length).toBe(1); // deduped
    expect(terms.length).toBeLessThanOrEqual(12);
  });

  it('signatureKey is order-independent', () => {
    expect(signatureKey(['b', 'a', 'c'])).toBe(signatureKey(['c', 'a', 'b']));
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], ['a'])).toBe(0);
  });
  it('is fractional for partial overlap', () => {
    expect(jaccard(['a', 'b', 'c'], ['a', 'b', 'd'])).toBeCloseTo(2 / 4);
  });
});

describe('recordTask', () => {
  it('ignores too-short/generic prompts (no family tracked)', () => {
    const r = recordTask(emptyLedger(), 'ok', 1000);
    expect(r.shouldCreateSkill).toBe(false);
    expect(r.ledger.families.length).toBe(0);
  });

  it('opens a new family on first sight and bumps count on similar repeats', () => {
    let led = emptyLedger();
    const p = 'deploy the frontend app to vercel production';
    let r = recordTask(led, p, 1, 3);
    led = r.ledger;
    expect(led.families.length).toBe(1);
    expect(r.family.count).toBe(1);
    expect(r.shouldCreateSkill).toBe(false);

    r = recordTask(led, 'please deploy frontend app to vercel again', 2, 3);
    led = r.ledger;
    expect(led.families.length).toBe(1); // matched same family
    expect(r.family.count).toBe(2);
    expect(r.shouldCreateSkill).toBe(false);

    r = recordTask(led, 'deploy the frontend to vercel one more time', 3, 3);
    expect(r.family.count).toBe(3);
    expect(r.shouldCreateSkill).toBe(true); // threshold reached
  });

  it('keeps unrelated tasks in separate families', () => {
    let led = emptyLedger();
    led = recordTask(led, 'deploy frontend app to vercel production', 1, 3).ledger;
    led = recordTask(led, 'write unit tests for the parser module logic', 2, 3).ledger;
    expect(led.families.length).toBe(2);
  });

  it('does not re-fire once a skill is created for the family', () => {
    let led = emptyLedger();
    const p = 'deploy frontend app to vercel production now';
    led = recordTask(led, p, 1, 3).ledger;
    led = recordTask(led, p, 2, 3).ledger;
    const r3 = recordTask(led, p, 3, 3);
    expect(r3.shouldCreateSkill).toBe(true);
    led = markSkillCreated(r3.ledger, r3.family.sig, 'deploy-frontend-vercel');
    const r4 = recordTask(led, p, 4, 3);
    expect(r4.shouldCreateSkill).toBe(false);
    expect(r4.family.skillCreated).toBe(true);
  });

  it('caps samples per family', () => {
    let led = emptyLedger();
    for (let i = 0; i < 12; i += 1) {
      led = recordTask(led, `deploy frontend app to vercel run number ${i}`, i, 99).ledger;
    }
    expect(led.families[0].samples.length).toBeLessThanOrEqual(6);
  });
});

describe('slugifySkillName / uniqueSkillName', () => {
  it('slugifies to a-z0-9-', () => {
    expect(slugifySkillName('Deploy Frontend → Vercel!!')).toBe('deploy-frontend-vercel');
  });
  it('falls back when empty', () => {
    expect(slugifySkillName('???')).toMatch(/^auto-skill-/);
  });
  it('avoids collisions with existing names', () => {
    const existing = new Set(['deploy-vercel', 'deploy-vercel-2']);
    expect(uniqueSkillName('Deploy Vercel', existing)).toBe('deploy-vercel-3');
  });
});

describe('maybeAutoSkill (orchestrator)', () => {
  const synth: (d: SkillDraft) => (f: TaskFamily) => Promise<SkillDraft> = (d) => async () => d;

  beforeEach(async () => {
    vi.stubEnv('SANOOK_SELF_IMPROVE_THRESHOLD', '3');
    await rm(dirname(LEDGER_PATH), { recursive: true, force: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dirname(LEDGER_PATH), { recursive: true, force: true });
  });

  it('keeps the test ledger under the stubbed HOME', () => {
    expect(LEDGER_PATH).toBe(join(tmpHome, '.sanook', 'self-improve', 'ledger.json'));
  });

  it('does not read an existing ledger when persistence is disabled', async () => {
    await mkdir(dirname(LEDGER_PATH), { recursive: true });
    await writeFile(
      LEDGER_PATH,
      JSON.stringify({
        version: 1,
        families: [
          {
            sig: 'deploy frontend vercel',
            terms: ['deploy', 'frontend', 'vercel'],
            samples: ['deploy frontend app to vercel production'],
            count: 3,
            skillCreated: false,
            skillName: null,
            firstSeen: 1,
            lastSeen: 2,
          },
        ],
      }),
    );

    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');

    expect(await loadLedger()).toEqual(emptyLedger());
  });

  it('does not write a ledger when persistence is disabled', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');

    await saveLedger(recordTask(emptyLedger(), 'deploy frontend app to vercel production', 1, 3).ledger);

    await expect(readFile(LEDGER_PATH, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does nothing before threshold, then creates skill on the Nth repeat', async () => {
    vi.stubEnv('SANOOK_SELF_IMPROVE_THRESHOLD', '3');
    const saved: { name: string; body: string }[] = [];
    const deps = {
      synthesize: synth({ name: 'deploy-vercel', description: 'd', body: 'b', whenToUse: 'w' }),
      saveSkill: async (name: string, _desc: string, body: string) => {
        saved.push({ name, body });
        return `/tmp/${name}/SKILL.md`;
      },
      existingSkillNames: new Set<string>(),
    };
    const prompt = 'deploy the frontend app to vercel production environment';
    expect((await maybeAutoSkill(prompt, deps)).created).toBe(false);
    expect((await maybeAutoSkill(prompt, deps)).created).toBe(false);
    const third = await maybeAutoSkill(prompt, deps);
    expect(third.created).toBe(true);
    expect(third.skillName).toBe('deploy-vercel');
    expect(third.announcement).toContain('Self-improvement');
    expect(saved.length).toBe(1);

    // does not duplicate after creation
    const fourth = await maybeAutoSkill(prompt, deps);
    expect(fourth.created).toBe(false);
    expect(saved.length).toBe(1);
  });

  it('is disabled by SANOOK_DISABLE_SELF_IMPROVE', async () => {
    vi.stubEnv('SANOOK_DISABLE_SELF_IMPROVE', '1');
    const deps = { synthesize: synth({ name: 'x', description: 'd', body: 'b' }), saveSkill: async () => '/x' };
    const prompt = 'deploy the frontend app to vercel production environment';
    for (let i = 0; i < 5; i += 1) expect((await maybeAutoSkill(prompt, deps)).created).toBe(false);
    const led = await loadLedger();
    expect(led.families.length).toBe(0); // nothing recorded when disabled
  });

  it('does not synthesize or write a ledger when persistence is disabled', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    const synthesize = vi.fn(async () => ({ name: 'x', description: 'd', body: 'b' }));
    const saveSkill = vi.fn(async () => '/x');
    const deps = { synthesize, saveSkill };
    const prompt = 'deploy the frontend app to vercel production environment';

    for (let i = 0; i < 5; i += 1) expect((await maybeAutoSkill(prompt, deps)).created).toBe(false);

    expect(synthesize).not.toHaveBeenCalled();
    expect(saveSkill).not.toHaveBeenCalled();
    await expect(readFile(LEDGER_PATH, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips when synthesizer returns null', async () => {
    vi.stubEnv('SANOOK_SELF_IMPROVE_THRESHOLD', '2');
    const deps = { synthesize: async () => null, saveSkill: async () => '/x', existingSkillNames: new Set<string>() };
    const prompt = 'refactor the database access layer into a repository pattern';
    await maybeAutoSkill(prompt, deps);
    const second = await maybeAutoSkill(prompt, deps);
    expect(second.created).toBe(false);
  });
});
