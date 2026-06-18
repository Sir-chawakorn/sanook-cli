import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldBrain, substitute, expandHome, FOLDERS, BRAIN_DEFAULTS, wireBrainMcp, type BrainConfig } from './brain.js';

const CFG: BrainConfig = { ...BRAIN_DEFAULTS, ownerName: 'ปิ๊ก', aiName: 'หนู', today: '2026-06-14' };

async function walkFiles(root: string, base: string = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(full, base)));
    } else {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

function folderName(dir: string): string {
  return dir.split('/').pop() ?? dir;
}

function folderParent(dir: string): string {
  return dir.includes('/') ? `${dir.split('/').slice(0, -1).join('/')}/_Index` : 'Home';
}

describe('scaffoldBrain', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brain-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
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
      'SANOOK.md',
      'Shared/AI-Context-Index.md',
      'Shared/Operating-State/current-state.md',
      'Templates/session.md',
      '.obsidian/app.json',
    ]) {
      expect((await stat(join(target, f))).isFile()).toBe(true);
    }
  });

  it('scaffold เขียน markdown seed ทุกไฟล์จาก bundled second-brain template', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    const templateRoot = join(process.cwd(), 'second-brain');
    const seedMarkdown = (await walkFiles(templateRoot))
      .filter((f) => f.endsWith('.md'))
      .filter((f) => folderName(f) !== '_Index.md');
    expect(seedMarkdown.length).toBeGreaterThan(20);
    for (const f of seedMarkdown) {
      expect((await stat(join(target, f))).isFile(), `ไม่ได้เขียน seed markdown ${f}`).toBe(true);
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

  it('full parity (GEMINI.md) — โฟลเดอร์ครบ + Evals/Rules seed files + _Index มี put/avoid', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    // โฟลเดอร์ที่เพิ่มให้ตรง GEMINI.md §B
    for (const d of [
      'Bugs/System-OS',
      'Shared/Scripts',
      'Shared/Scripts-Archive',
      'Shared/mcp-servers',
      'Shared/Context-Packs',
      'Shared/AI-Threads',
      'Shared/Prompting',
      'Shared/Glossary',
      'Shared/Assets',
      'Shared/Coordination/task-board',
      '.agents/skills',
      '.agents/workflows',
      'copilot',
      'Tools',
    ]) {
      expect((await stat(join(target, d))).isDirectory(), `ขาดโฟลเดอร์ ${d}`).toBe(true);
    }
    // seed files ที่ทำให้ frontier loops ทำงาน
    for (const f of [
      'Evals/failure-taxonomy.md',
      'Evals/self-eval-rubric.md',
      'Evals/golden-set.md',
      'Evals/correction-pairs.md',
      'Evals/quality-ledger.md',
      'Runbooks/eval-loop.md',
      'Shared/Rules/memory-write-protocol.md',
      'Shared/Rules/review-and-staleness-policy.md',
      'Playbooks/playbook-template.md',
    ]) {
      expect((await stat(join(target, f))).isFile(), `ขาด seed file ${f}`).toBe(true);
    }
    // _Index ละเอียด: มี put/avoid
    const idx = await readFile(join(target, 'Projects', '_Index.md'), 'utf8');
    expect(idx).toContain('## ใส่ที่นี่');
    expect(idx).toContain('## ไม่ใส่ที่นี่');
    const packs = await readFile(join(target, 'Shared', 'Context-Packs', '_Index.md'), 'utf8');
    expect(packs).toContain('[[Shared/Context-Packs/second-brain-maintenance]]');
    expect(packs).toContain('[[Shared/Context-Packs/coding-release]]');
    expect(packs).toContain('[[Shared/Context-Packs/research-to-framework]]');
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
    const fullReferenceRows = map
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    for (const row of fullReferenceRows) {
      expect(row.length, `Vault Structure Map row shape ผิด: ${row.join(' | ')}`).toBeGreaterThanOrEqual(4);
      expect(row[1], `Vault Structure Map role ว่าง: ${row[0]}`).not.toBe('');
      expect(row[2], `Vault Structure Map ใส่ที่นี่ว่าง: ${row[0]}`).not.toBe('');
      expect(row[3], `Vault Structure Map ห้ามใส่ว่าง: ${row[0]}`).not.toBe('');
    }
    for (const fastPath of [
      'priority/current focus เปลี่ยน',
      'finding ที่มี source',
      'scratch ชั่วคราวระหว่างงาน',
      'fixture expected output',
      'pre/postflight gate',
    ]) {
      expect(map, `Quick Routing ขาด ${fastPath}`).toContain(fastPath);
    }
    // โฟลเดอร์ใหม่ที่ rule อื่นอ้างถึง
    expect((await stat(join(target, 'Intake', 'Raw Sources'))).isDirectory()).toBe(true);
    expect((await stat(join(target, 'Intake', 'Raw Sources', '_Index.md'))).isFile()).toBe(true);
  });

  it('bundled second-brain template source มีทุกโฟลเดอร์ + _Index ตาม FOLDERS', async () => {
    const templateRoot = join(process.cwd(), 'second-brain');
    for (const { dir: d } of FOLDERS) {
      expect((await stat(join(templateRoot, d))).isDirectory(), `template ขาดโฟลเดอร์ ${d}`).toBe(true);
      expect((await stat(join(templateRoot, d, '_Index.md'))).isFile(), `template ขาด _Index ${d}`).toBe(true);
      const idx = await readFile(join(templateRoot, d, '_Index.md'), 'utf8');
      expect(idx, `template _Index ไม่มี AI Routing Contract: ${d}`).toContain('## AI Routing Contract');
    }
  });

  it('bundled second-brain template source มี consumer rules/seeds สำหรับโฟลเดอร์สำคัญ', async () => {
    const templateRoot = join(process.cwd(), 'second-brain');
    for (const f of [
      'Shared/Rules/rules-formatting.md',
      'Shared/Rules/procedural-runbook-header.md',
      'Shared/Rules/contextual-note-rule.md',
      'Shared/Tech-Standards/verification-standard.md',
      'Shared/Coordination/task-board.md',
      'Shared/Coordination/task-board/task-template.md',
      'Shared/Coordination/agent-registry.md',
      'Shared/User-Persona/owner-profile.md',
      'Acceptance/golden-case-template.md',
      'Checklists/preflight-postflight-template.md',
      'Entities/entity-template.md',
    ]) {
      expect((await stat(join(templateRoot, f))).isFile(), `template ขาด seed file ${f}`).toBe(true);
    }
  });

  it('bundled markdown ทุกไฟล์มี purpose สำหรับ AI และ graph link ที่เหมาะสม', async () => {
    const templateRoot = join(process.cwd(), 'second-brain');
    const rootFilesWithoutUp = new Set(['Home.md', 'README.md', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md', 'SANOOK.md']);
    const markdownFiles = (await walkFiles(templateRoot)).filter((f) => f.endsWith('.md'));
    expect(markdownFiles.length).toBeGreaterThan(90);
    for (const f of markdownFiles) {
      const content = await readFile(join(templateRoot, f), 'utf8');
      expect(content.trimEnd().split('\n').length, `markdown สั้นเกินจน AI ไม่มี context: ${f}`).toBeGreaterThanOrEqual(10);
      expect(content, `markdown ไม่มี purpose blockquote ให้ AI scan: ${f}`).toMatch(/^>\s+/m);
      if (f.endsWith('/_Index.md')) {
        expect(content, `_Index ไม่มี AI Routing Contract: ${f}`).toContain('## AI Routing Contract');
      }
      if (!rootFilesWithoutUp.has(f)) {
        expect(content, `markdown ไม่มี up:: graph link: ${f}`).toContain('up:: [[');
      }
    }
  });

  it('แทน placeholder หมด (ไม่เหลือ {{KEY}} ของเรา) + owner ถูกแทน', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    for (const f of ['Home.md', 'USER.md', 'CLAUDE.md', 'SANOOK.md', 'Shared/AI-Context-Index.md', 'Shared/Core-Facts/protected-facts.md']) {
      const content = await readFile(join(target, f), 'utf8');
      expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(content).toContain('ปิ๊ก');
    }
    const aiContext = await readFile(join(target, 'Shared', 'AI-Context-Index.md'), 'utf8');
    expect(aiContext).toContain('## Default Write Path');
    expect(aiContext).toContain('AI Routing Contract');
    expect(aiContext).toContain('priority/current focus เปลี่ยน');
    expect(aiContext).toContain('session checkpoint / งานจบ');
    for (const f of ['Home.md', 'README.md', 'CLAUDE.md', 'GEMINI.md', 'AGENTS.md', 'SANOOK.md']) {
      const content = await readFile(join(target, f), 'utf8');
      expect(content, `${f} ไม่บอกให้ใช้ target _Index`).toContain('_Index');
      expect(content, `${f} ไม่บอก AI Routing Contract`).toContain('AI Routing Contract');
    }
  });

  it('ทุกโฟลเดอร์จาก manifest มี _Index.md ที่บอก role และ routing ครบ', async () => {
    const target = join(dir, 'vault');
    await scaffoldBrain(target, CFG);
    for (const f of FOLDERS) {
      expect(f.role.trim(), `role ว่าง: ${f.dir}`).not.toBe('');
      const put = f.put ?? '';
      const avoid = f.avoid ?? '';
      expect(put.trim(), `ใส่ที่นี่ว่าง: ${f.dir}`).toBeTruthy();
      expect(avoid.trim(), `ไม่ใส่ที่นี่ว่าง: ${f.dir}`).toBeTruthy();

      const parent = folderParent(f.dir);
      const idx = await readFile(join(target, f.dir, '_Index.md'), 'utf8');
      expect(idx.startsWith('---'), `_Index ไม่มี frontmatter: ${f.dir}`).toBe(true);
      expect(idx, `_Index ไม่มี note_type: ${f.dir}`).toContain('note_type: moc');
      expect(idx, `_Index ไม่มี parent frontmatter: ${f.dir}`).toContain(`parent: "[[${parent}]]"`);
      expect(idx, `_Index ไม่มี heading: ${f.dir}`).toContain(`# ${folderName(f.dir)}`);
      expect(idx, `_Index ไม่มี role: ${f.dir}`).toContain(`> ${f.role}`);
      expect(idx, `_Index ไม่มีหัวข้อใส่ที่นี่: ${f.dir}`).toContain('## ใส่ที่นี่');
      expect(idx, `_Index ไม่มีรายละเอียดใส่ที่นี่: ${f.dir}`).toContain(put);
      expect(idx, `_Index ไม่มีหัวข้อไม่ใส่ที่นี่: ${f.dir}`).toContain('## ไม่ใส่ที่นี่');
      expect(idx, `_Index ไม่มีรายละเอียดไม่ใส่ที่นี่: ${f.dir}`).toContain(avoid);
      expect(idx, `_Index ไม่มี AI Routing Contract: ${f.dir}`).toContain('## AI Routing Contract');
      expect(idx, `_Index ไม่บังคับ search/merge: ${f.dir}`).toContain('ค้นหาโน้ตเดิม');
      expect(idx, `_Index ไม่บอก parent ของโน้ตใหม่: ${f.dir}`).toContain(`parent: "[[${f.dir}/_Index]]"`);
      expect(idx, `_Index ไม่บอก up ของโน้ตใหม่: ${f.dir}`).toContain(`up:: [[${f.dir}/_Index]]`);
      expect(idx, `_Index ไม่ลิงก์ Vault Structure Map: ${f.dir}`).toContain('[[Vault Structure Map]]');
      expect(idx, `_Index ไม่มี up:: ที่ชี้ parent ถูก: ${f.dir}`).toContain(`up:: [[${parent}]]`);
    }
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

  it('wireBrainMcp เขียน mcp.json ด้วย permission 0600', async () => {
    vi.stubEnv('HOME', dir);
    expect(await wireBrainMcp('/tmp/sanook-vault')).toBe('added');
    const mcpPath = join(dir, '.sanook', 'mcp.json');
    expect((await stat(mcpPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(mcpPath, 'utf8')).toContain('@modelcontextprotocol/server-filesystem');
  });
});
