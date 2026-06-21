import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToVaultInbox, appendBrainWorklog, appendBrainTranscript, brainTranscriptEnabled, buildBrainContext, buildBrainContextParts, seedPersonaMemory } from './memory.js';
import { MEMORY_DIR, loadStore, activeFacts } from './memory-store.js';

describe('appendToVaultInbox (remember → second brain)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Shared', 'Memory-Inbox'), { recursive: true });
    await writeFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), '# Inbox\n\n## New Candidates\n');
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('เขียน fact ใต้ New Candidates', async () => {
    expect(await appendToVaultInbox(vault, 'ปิ๊กชอบคำตอบสั้นๆ')).toBe(true);
    const c = await readFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), 'utf8');
    expect(c).toContain('- ปิ๊กชอบคำตอบสั้นๆ');
    expect(c.indexOf('- ปิ๊กชอบ')).toBeGreaterThan(c.indexOf('## New Candidates'));
  });

  it('dedup ไม่เขียนซ้ำ', async () => {
    await appendToVaultInbox(vault, 'fact ก');
    expect(await appendToVaultInbox(vault, 'fact ก')).toBe(false);
  });

  it('เขียน fact ที่มี $-sequence แบบ literal (ไม่ตีความเป็น String.replace pattern)', async () => {
    expect(await appendToVaultInbox(vault, 'ราคา $5 ใช้ $& และ $1 กับ $$')).toBe(true);
    const c = await readFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), 'utf8');
    expect(c).toContain('- ราคา $5 ใช้ $& และ $1 กับ $$'); // ตรงตามที่พิมพ์ ไม่ถูก expand
    // เขียนซ้ำ fact เดิม → dedup ได้ (ถ้า $ ถูก expand บรรทัดที่เก็บจะเพี้ยน แล้ว dedup จะพัง)
    expect(await appendToVaultInbox(vault, 'ราคา $5 ใช้ $& และ $1 กับ $$')).toBe(false);
  });

  it('ไม่เขียนถ้าไม่ใช่ vault (ไม่มี memory-inbox.md)', async () => {
    const notVault = await mkdtemp(join(tmpdir(), 'x-'));
    expect(await appendToVaultInbox(notVault, 'x')).toBe(false);
    await rm(notVault, { recursive: true, force: true });
  });
});

describe('buildBrainContext (closed loop — remembered fact กลับเข้า context)', () => {
  let vault: string;
  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Shared', 'Memory-Inbox'), { recursive: true });
    await mkdir(join(vault, 'Shared', 'Operating-State'), { recursive: true });
    await writeFile(join(vault, 'Shared', 'AI-Context-Index.md'), '# Index\npointers');
    await writeFile(join(vault, 'Shared', 'Operating-State', 'current-state.md'), '# state\nกำลังทำ launch sanook-cli');
    await writeFile(join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'), '# Inbox\n\n## New Candidates\n');
  });
  afterEach(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('fact ที่ remember (inbox) กลับเข้า brain context + มี current-state', async () => {
    await appendToVaultInbox(vault, 'ปิ๊กชอบ dark mode');
    const ctx = await buildBrainContext(vault);
    expect(ctx).toContain('brain_vault');
    expect(ctx).toContain('ปิ๊กชอบ dark mode'); // ← loop ปิด: remembered fact กลับมา
    expect(ctx).toContain('launch sanook-cli'); // ← current-state เนื้อจริง
  });

  it('ดึงเฉพาะ bullet ใต้ New Candidates ก่อน heading ถัดไป', async () => {
    await writeFile(
      join(vault, 'Shared', 'Memory-Inbox', 'memory-inbox.md'),
      '# Inbox\n\n## New Candidates\n- keep this candidate\n- _(skip internal note)\n\n## Accepted\n- do not inject accepted fact\n',
    );

    const ctx = await buildBrainContext(vault);

    expect(ctx).toContain('keep this candidate');
    expect(ctx).not.toContain('skip internal note');
    expect(ctx).not.toContain('do not inject accepted fact');
  });

  it('vault ว่าง (ไม่มีไฟล์) → คืน ""', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'e-'));
    expect(await buildBrainContext(empty)).toBe('');
    await rm(empty, { recursive: true, force: true });
  });

  it('auto-selects a context pack when taskQuery matches coding-release', async () => {
    await mkdir(join(vault, 'Shared', 'Context-Packs'), { recursive: true });
    await writeFile(
      join(vault, 'Shared', 'Context-Packs', 'coding-release.md'),
      '---\nnote_type: context-pack\n---\n\n# Coding\n\n> Use when changing code/tests/build/release.\n\n## Load Order\n1. index\n\n## Done Criteria\n- tests pass\n',
    );
    const parts = await buildBrainContextParts(vault, { taskQuery: 'fix unit test and ship cli release build' });
    const pack = parts.find((p) => p.id === 'context-pack');
    expect(pack?.relPath).toBe('Shared/Context-Packs/coding-release.md');
    expect(pack?.content).toContain('Coding');
  });

  it('injects project workspace when cwd matches repo_path', async () => {
    const repo = join(vault, 'repo-x');
    await mkdir(repo, { recursive: true });
    await mkdir(join(vault, 'Projects', 'app-x'), { recursive: true });
    await writeFile(join(vault, 'Projects', 'app-x', 'repo.md'), `repo_path: ${repo}\n`, 'utf8');
    await writeFile(join(vault, 'Projects', 'app-x', 'current-state.md'), '# State\n\nFocus: app-x milestone\n', 'utf8');
    const ctx = await buildBrainContext(vault, { cwd: repo });
    expect(ctx).toContain('<project_workspace');
    expect(ctx).toContain('app-x milestone');
  });
});

describe('appendBrainWorklog (auto worklog → vault Sessions)', () => {
  let vault: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.stubEnv('SANOOK_DISABLE_WORKLOG', '');
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Sessions'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(vault, { recursive: true, force: true });
  });

  it('สร้าง worklog รายวัน + frontmatter + up::', async () => {
    expect(
      await appendBrainWorklog(vault, { prompt: 'fix the failing test', summary: 'done', model: 'google:flash', today: '2026-06-15' }),
    ).toBe(true);
    const c = await readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8');
    expect(c).toContain('note_type: session-log');
    expect(c).toContain('fix the failing test');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('append turn ที่ 2 เข้าไฟล์เดิม (up:: ยังอยู่ท้าย)', async () => {
    await appendBrainWorklog(vault, { prompt: 'task one', summary: 's1', model: 'm', today: '2026-06-15' });
    await appendBrainWorklog(vault, { prompt: 'task two', summary: 's2', model: 'm', today: '2026-06-15' });
    const c = await readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8');
    expect(c).toContain('task one');
    expect(c).toContain('task two');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
    expect((c.match(/up:: \[\[Sessions/g) || []).length).toBe(1); // up:: ไม่ซ้ำ
  });

  it('repair ไฟล์ worklog ที่มีอยู่แต่ว่าง/malformed ก่อน append', async () => {
    const file = join(vault, 'Sessions', '2026-06-15-worklog.md');
    await writeFile(file, '\n\n## old malformed block\n- prompt: before\n');
    await appendBrainWorklog(vault, { prompt: 'after', summary: 'done', model: 'm', today: '2026-06-15' });
    const c = await readFile(file, 'utf8');
    expect(c).toContain('note_type: session-log');
    expect(c).toContain('old malformed block');
    expect(c).toContain('after');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('ไม่ลบเนื้อหา user ที่บังเอิญมีบรรทัด up:: [[Sessions/_Index]] (กัน data loss — ยอม footer ซ้ำได้)', async () => {
    const file = join(vault, 'Sessions', '2026-06-15-worklog.md');
    // ผู้ใช้ paste เนื้อหาที่มีบรรทัด canonical footer กลาง body (ไม่มี trailing footer)
    await writeFile(file, '---\nnote_type: session-log\n---\n\n# old\nup:: [[Sessions/_Index]]\n\n## stray\nBODYTEXT\n');
    await appendBrainWorklog(vault, { prompt: 'new task', summary: 'done', model: 'm', today: '2026-06-15' });
    const c = await readFile(file, 'utf8');
    expect(c).toContain('BODYTEXT'); // เนื้อหา user ไม่หาย (สำคัญสุด — กัน data loss)
    expect(c).toContain('new task'); // turn ใหม่ต่อท้าย
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true); // จบด้วย footer เสมอ
  });

  it('ไม่เขียนถ้าไม่มี Sessions/ (ไม่ใช่ vault)', async () => {
    const notVault = await mkdtemp(join(tmpdir(), 'x-'));
    expect(await appendBrainWorklog(notVault, { prompt: 'x', summary: 'y', model: 'm', today: '2026-06-15' })).toBe(false);
    await rm(notVault, { recursive: true, force: true });
  });

  it('ไม่เขียน worklog เมื่อปิด persistence ทั้งหมด', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    expect(await appendBrainWorklog(vault, { prompt: 'private task', summary: 'done', model: 'm', today: '2026-06-15' })).toBe(false);
    await expect(readFile(join(vault, 'Sessions', '2026-06-15-worklog.md'), 'utf8')).rejects.toThrow();
  });
});

describe('appendBrainTranscript (full conversation → vault Sessions)', () => {
  let vault: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    vi.stubEnv('SANOOK_BRAIN_TRANSCRIPT', '1'); // env force ON (ไม่ต้องพึ่ง config.json)
    vault = await mkdtemp(join(tmpdir(), 'vault-'));
    await mkdir(join(vault, 'Sessions'), { recursive: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(vault, { recursive: true, force: true });
  });

  const chatFile = (sid: string, day = '2026-06-15') => join(vault, 'Sessions', `${day}-${sid.slice(-6)}-chat.md`);

  it('เก็บทั้ง prompt และคำตอบ AI ลงไฟล์ chat ต่อ session', async () => {
    expect(
      await appendBrainTranscript(vault, {
        sessionId: 'sess_abc123',
        prompt: 'อธิบาย memory ของ sanook',
        answer: 'memory มีหลายชั้น...',
        model: 'codex:gpt-5',
        createdIso: '2026-06-15T03:00:00.000Z',
      }),
    ).toBe(true);
    const c = await readFile(chatFile('sess_abc123'), 'utf8');
    expect(c).toContain('tags: [session, transcript, chat]');
    expect(c).toContain('**You:**');
    expect(c).toContain('## 03:00 · codex:gpt-5');
    expect(c).toContain('อธิบาย memory ของ sanook');
    expect(c).toContain('memory มีหลายชั้น...');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('append turn ที่ 2 เข้าไฟล์เดิม (up:: ไม่ซ้ำ)', async () => {
    await appendBrainTranscript(vault, { sessionId: 's_xyz999', prompt: 'q1', answer: 'a1', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' });
    await appendBrainTranscript(vault, { sessionId: 's_xyz999', prompt: 'q2', answer: 'a2', model: 'm', createdIso: '2026-06-15T03:05:00.000Z' });
    const c = await readFile(chatFile('s_xyz999'), 'utf8');
    expect(c).toContain('q1');
    expect(c).toContain('a1');
    expect(c).toContain('q2');
    expect(c).toContain('a2');
    expect((c.match(/up:: \[\[Sessions/g) || []).length).toBe(1);
  });

  it('repair ไฟล์ chat ที่มีอยู่แต่ว่าง/malformed ก่อน append', async () => {
    const file = chatFile('s_empty');
    await writeFile(file, '\n## old chat block\nlegacy text\n');
    await appendBrainTranscript(vault, {
      sessionId: 's_empty',
      prompt: 'new question',
      answer: 'new answer',
      model: 'm',
      createdIso: '2026-06-15T04:10:00.000Z',
    });
    const c = await readFile(file, 'utf8');
    expect(c).toContain('tags: [session, transcript, chat]');
    expect(c).toContain('old chat block');
    expect(c).toContain('new question');
    expect(c).toContain('## 04:10 · m');
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('redact API key ออกจากบทสนทนา', async () => {
    await appendBrainTranscript(vault, {
      sessionId: 's_redact',
      prompt: 'ใช้ key sk-ant-api03-SECRETSECRETSECRET ได้ไหม',
      answer: 'ได้',
      model: 'm',
      createdIso: '2026-06-15T03:00:00.000Z',
    });
    const c = await readFile(chatFile('s_redact'), 'utf8');
    expect(c).not.toContain('SECRETSECRETSECRET');
  });

  it('ปิดไว้โดย default (ไม่มี env / config) → ไม่เขียน', async () => {
    vi.stubEnv('SANOOK_BRAIN_TRANSCRIPT', '');
    vi.stubEnv('HOME', vault); // config.json ไม่มี → brainTranscript undefined
    expect(await brainTranscriptEnabled()).toBe(false);
    expect(await appendBrainTranscript(vault, { sessionId: 's_off', prompt: 'q', answer: 'a', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' })).toBe(false);
    await expect(readFile(chatFile('s_off'), 'utf8')).rejects.toThrow();
  });

  it('ไม่เขียนถ้าไม่มี Sessions/ (ไม่ใช่ vault)', async () => {
    const notVault = await mkdtemp(join(tmpdir(), 'x-'));
    expect(await appendBrainTranscript(notVault, { sessionId: 's', prompt: 'q', answer: 'a', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' })).toBe(false);
    await rm(notVault, { recursive: true, force: true });
  });

  it('ปิด persistence ทั้งหมด → ไม่เขียนแม้ env force', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    expect(await appendBrainTranscript(vault, { sessionId: 's_p', prompt: 'q', answer: 'a', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' })).toBe(false);
  });

  it('ไม่ truncate turn เก่าเมื่อ prompt/answer มีบรรทัดขึ้นต้น "up:: " (กัน data loss)', async () => {
    // turn 1: คำตอบมีบรรทัด up:: กลางเนื้อหา (เช่น user paste เนื้อหา vault note เข้ามา)
    await appendBrainTranscript(vault, { sessionId: 's_up', prompt: 'q1', answer: 'see note\nup:: [[Sessions/Foo]]\nMORETEXT', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' });
    // turn 2: ต้องไม่ลบเนื้อหา turn 1 (regex เก่า /\nup:: .*$/s จะลบจาก up:: แรกถึง EOF)
    await appendBrainTranscript(vault, { sessionId: 's_up', prompt: 'q2', answer: 'a2', model: 'm', createdIso: '2026-06-15T03:05:00.000Z' });
    const c = await readFile(chatFile('s_up'), 'utf8');
    expect(c).toContain('q1');
    expect(c).toContain('see note');
    expect(c).toContain('up:: [[Sessions/Foo]]'); // body up:: ยังอยู่
    expect(c).toContain('MORETEXT'); // ข้อความหลัง body up:: ไม่ถูกตัดทิ้ง (จุดที่ regex เก่าลบ)
    expect(c).toContain('q2'); // turn 2 ต่อท้ายได้
    expect(c).toContain('a2');
    expect((c.match(/up:: \[\[Sessions\/_Index/g) || []).length).toBe(1); // footer เดียว ไม่ซ้ำ
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });

  it('เขียน $-sequence ใน prompt/answer แบบ literal (ไม่ตีความเป็น String.replace pattern)', async () => {
    await appendBrainTranscript(vault, { sessionId: 's_dollar', prompt: 'turn one', answer: 'a1', model: 'm', createdIso: '2026-06-15T03:00:00.000Z' });
    // turn 2 hits the replace-before-footer branch where $-sequences mattered
    await appendBrainTranscript(vault, { sessionId: 's_dollar', prompt: 'ใช้ $& และ $1 กับ $$ ยังไง', answer: 'ตอบ $`x', model: 'm', createdIso: '2026-06-15T03:05:00.000Z' });
    const c = await readFile(chatFile('s_dollar'), 'utf8');
    expect(c).toContain('ใช้ $& และ $1 กับ $$ ยังไง'); // literal — ไม่ถูก expand เป็น match/backref
    expect(c).toContain('ตอบ $`x');
    expect(c).toContain('turn one'); // turn 1 ยังอยู่
    expect(c.trimEnd().endsWith('up:: [[Sessions/_Index]]')).toBe(true);
  });
});

describe('seedPersonaMemory (persona ตอน setup → durable memory ขั้นที่ 9)', () => {
  beforeEach(async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '');
    await rm(MEMORY_DIR, { recursive: true, force: true });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(MEMORY_DIR, { recursive: true, force: true });
  });

  it('เขียน owner/AI/language/autonomy เป็น durable fact', async () => {
    const n = await seedPersonaMemory({
      ownerName: 'ปิ๊ก',
      aiName: 'น้องสนุก',
      language: 'ไทย + tech-en',
      autonomy: 'ask-on-risk',
      defaults: { ownerName: 'Owner', aiName: 'ผู้ช่วย' },
    });
    expect(n).toBe(4);
    const facts = activeFacts(await loadStore());
    const text = facts.map((f) => f.text).join('\n');
    expect(text).toContain('ปิ๊ก');
    expect(text).toContain('น้องสนุก');
    expect(text).toContain('ask-on-risk');
    expect(facts.some((f) => f.tier === 'protected' && f.trust === 'owner')).toBe(true);
  });

  it('ข้ามค่า default (ownerName/aiName เท่า default = ไม่เขียน)', async () => {
    const n = await seedPersonaMemory({
      ownerName: 'Owner',
      aiName: 'ผู้ช่วย',
      defaults: { ownerName: 'Owner', aiName: 'ผู้ช่วย' },
    });
    expect(n).toBe(0);
  });

  it('idempotent — เรียกซ้ำไม่เพิ่ม fact ใหม่', async () => {
    const input = { ownerName: 'เอก', aiName: 'มะนาว', defaults: { ownerName: 'Owner', aiName: 'ผู้ช่วย' } };
    await seedPersonaMemory(input);
    await seedPersonaMemory(input);
    const facts = activeFacts(await loadStore());
    expect(facts).toHaveLength(2);
  });

  it('ปิด persistence → ไม่เขียน (คืน 0)', async () => {
    vi.stubEnv('SANOOK_DISABLE_PERSISTENCE', '1');
    expect(await seedPersonaMemory({ ownerName: 'x', defaults: { ownerName: 'Owner' } })).toBe(0);
  });
});
