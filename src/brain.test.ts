import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldBrain, substitute, expandHome, FOLDERS, BRAIN_DEFAULTS, type BrainConfig } from './brain.js';

const CFG: BrainConfig = { ...BRAIN_DEFAULTS, ownerName: 'ปิ๊ก', aiName: 'หนู', today: '2026-06-14' };

describe('scaffoldBrain', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brain-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('สร้างโฟลเดอร์ core + _Index ครบทุกโฟลเดอร์', async () => {
    const target = join(dir, 'vault');
    const res = await scaffoldBrain(target, CFG);
    for (const f of ['Projects', 'Sessions', 'Shared', 'Goals', 'Shared/User-Memory', 'Shared/Operating-State']) {
      expect((await stat(join(target, f))).isDirectory()).toBe(true);
      expect((await stat(join(target, f, '_Index.md'))).isFile()).toBe(true);
    }
    expect(res.created.length).toBeGreaterThan(30);
    expect(res.skipped.length).toBe(0);
  });

  it('seed core files + constitution + .obsidian มีจริง', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    for (const f of [
      'Home.md',
      'USER.md',
      'CLAUDE.md',
      'GEMINI.md',
      'AGENTS.md',
      'Shared/AI-Context-Index.md',
      'Shared/Operating-State/current-state.md',
      'Templates/session.md',
      '.obsidian/app.json',
    ]) {
      expect((await stat(join(target, f))).isFile()).toBe(true);
    }
  });

  it('SOTA upgrades — folders + rules/runbooks ใหม่มีจริง', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    for (const d of ['Skills', 'Intake/_Quarantine', 'Shared/Provenance', 'Shared/Archive']) {
      expect((await stat(join(target, d))).isDirectory()).toBe(true);
      expect((await stat(join(target, d, '_Index.md'))).isFile()).toBe(true);
    }
    for (const f of [
      'Shared/Rules/context-assembly-policy.md',
      'Shared/Rules/frontmatter-standard.md',
      'Shared/Rules/skills-admission.md',
      'Runbooks/ingest-quarantine.md',
      'Runbooks/sleep-time-consolidation.md',
      'Shared/Provenance/ingest-log.md',
      'Evals/retrieval-eval.md',
    ]) {
      expect((await stat(join(target, f))).isFile()).toBe(true);
    }
    // nested _Index parent ถูก (Intake/_Quarantine → Intake/_Index)
    const q = await readFile(join(target, 'Intake', '_Quarantine', '_Index.md'), 'utf8');
    expect(q).toContain('up:: [[Intake/_Index]]');
  });

  it('Vault Structure Map ครอบทุกโฟลเดอร์ใน FOLDERS (กัน drift) + Raw Sources มีจริง', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    // central map มีจริง + เป็น root file
    const map = await readFile(join(target, 'Vault Structure Map.md'), 'utf8');
    // ทุกโฟลเดอร์ใน manifest ต้องถูกพูดถึงในแผนที่ (map ↔ FOLDERS sync)
    for (const { dir: d } of FOLDERS) {
      expect(map, `Vault Structure Map ขาดโฟลเดอร์ ${d}`).toContain(d);
    }
    // โฟลเดอร์ใหม่ที่ rule อื่นอ้างถึง
    expect((await stat(join(target, 'Intake', 'Raw Sources'))).isDirectory()).toBe(true);
    expect((await stat(join(target, 'Intake', 'Raw Sources', '_Index.md'))).isFile()).toBe(true);
  });

  it('แทน placeholder หมด (ไม่เหลือ {{KEY}} ของเรา) + owner ถูกแทน', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    for (const f of ['Home.md', 'USER.md', 'CLAUDE.md', 'Shared/AI-Context-Index.md', 'Shared/Core-Facts/protected-facts.md']) {
      const content = await readFile(join(target, f), 'utf8');
      expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(content).toContain('ปิ๊ก');
    }
  });

  it('_Index มี frontmatter + up:: ชี้ parent ถูก', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    const idx = await readFile(join(target, 'Projects', '_Index.md'), 'utf8');
    expect(idx.startsWith('---')).toBe(true);
    expect(idx).toContain('note_type: moc');
    expect(idx).toContain('up:: [[Home]]');
    const sub = await readFile(join(target, 'Shared', 'User-Memory', '_Index.md'), 'utf8');
    expect(sub).toContain('up:: [[Shared/_Index]]');
  });

  it('create-if-missing — ไม่ทับไฟล์เดิม (อยู่ใน skipped)', async () => {
    const target = join(dir, 'vault');
    await mkdir(join(target, 'Projects'), { recursive: true });
    const own = join(target, 'Projects', '_Index.md');
    await writeFile(own, 'MY OWN CONTENT', 'utf8');
    const res = await scaffoldBrain(target, CFG);
    expect(await readFile(own, 'utf8')).toBe('MY OWN CONTENT');
    expect(res.skipped).toContain(own);
  });

  it('substitute แทนเฉพาะ key ที่รู้จัก (เว้น unknown)', () => {
    expect(substitute('{{OWNER_NAME}} / {{unknown}}', CFG)).toBe('ปิ๊ก / {{unknown}}');
  });

  it('expandHome ขยาย ~ เป็น home', () => {
    expect(expandHome('~/x')).not.toContain('~');
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });
});
