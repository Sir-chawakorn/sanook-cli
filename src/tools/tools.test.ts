import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exactMatch, whitespaceFlexMatch, findMatch, editFileTool } from './edit.js';
import { checkBash, checkReadPath, checkWritePath } from './permission.js';
import { readFileTool } from './read.js';
import { writeFileTool } from './write.js';
import { listDirTool } from './list.js';
import { globTool } from './search.js';

// stub ToolCallOptions พอให้ execute ทำงานใน test
const opts = { toolCallId: 't', messages: [], abortSignal: undefined } as never;

describe('edit matcher (pure functions)', () => {
  it('exactMatch หา substring + offset ถูก', () => {
    expect(exactMatch('a foo b', 'foo')).toEqual({ start: 2, end: 5, count: 1 });
  });
  it('exactMatch นับจำนวนซ้ำ', () => {
    expect(exactMatch('foo foo foo', 'foo')?.count).toBe(3);
  });
  it('exactMatch นับ overlapping ถูก (aaa/aa = 2, \\n\\n\\n/\\n\\n = 2)', () => {
    expect(exactMatch('aaa', 'aa')?.count).toBe(2);
    expect(exactMatch('\n\n\n', '\n\n')?.count).toBe(2);
  });
  it('exactMatch คืน null เมื่อ needle ว่าง (กัน infinite loop)', () => {
    expect(exactMatch('abc', '')).toBeNull();
  });
  it('exactMatch คืน null เมื่อไม่เจอ', () => {
    expect(exactMatch('abc', 'xyz')).toBeNull();
  });
  it('whitespaceFlexMatch ครอบบรรทัดเต็ม (รวม indent เดิม)', () => {
    const content = 'line1\n    foo();\nline3';
    const m = whitespaceFlexMatch(content, 'foo();');
    expect(content.slice(m!.start, m!.end)).toBe('    foo();');
  });
  it('whitespaceFlexMatch จับ multi-line ที่ indent ต่างกัน', () => {
    const content = '  if (x) {\n    return;\n  }';
    const m = whitespaceFlexMatch(content, 'if (x) {\nreturn;\n}');
    expect(content.slice(m!.start, m!.end)).toBe('  if (x) {\n    return;\n  }');
  });
  it('findMatch ใช้ exact ก่อน, fallback whitespace-flex', () => {
    // exact fail (indent ต่าง), flex เจอ
    const content = '  if (x) {\n    return;\n  }';
    const m = findMatch(content, 'if (x) {\nreturn;\n}');
    expect(m).not.toBeNull();
    expect(m!.count).toBe(1);
  });
});

describe('permission gate', () => {
  it('block rm -rf', () => expect(checkBash('rm -rf /tmp/x').ok).toBe(false));
  it('block rm -fr และ rm -r -f', () => {
    expect(checkBash('rm -fr /tmp/x').ok).toBe(false);
    expect(checkBash('rm -r -f /tmp/x').ok).toBe(false);
  });
  it('block rm --recursive --force', () => {
    expect(checkBash('rm --recursive --force /tmp/x').ok).toBe(false);
    expect(checkBash('rm --force --recursive /tmp/x').ok).toBe(false);
  });
  it('block git reset --hard', () => expect(checkBash('git reset --hard HEAD~2').ok).toBe(false));
  it('block git push --force', () => expect(checkBash('git push origin main --force').ok).toBe(false));
  it('allow safe cmd', () => expect(checkBash('ls -la && grep foo bar').ok).toBe(true));
  it('block write to .env', async () => expect((await checkWritePath('.env')).ok).toBe(false));
  it('block write inside .git', async () => expect((await checkWritePath('repo/.git/config')).ok).toBe(false));
  it('block write inside .sanook', async () => expect((await checkWritePath('.sanook/hooks.json')).ok).toBe(false));
  it('block write inside node_modules', async () => expect((await checkWritePath('node_modules/x/y.js')).ok).toBe(false));
  it('allow normal path', async () => expect((await checkWritePath('src/foo.ts')).ok).toBe(true));
  it('block read outside workspace by default', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sanook-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'nope');
      expect((await checkReadPath(join(outside, 'secret.txt'))).ok).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('editFileTool (integration)', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    dir = await mkdtemp(join(tmpdir(), 'sanook-'));
    file = join(dir, 'f.ts');
    await writeFile(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('แก้สำเร็จเมื่อ old_string unique + เนื้อหารอบข้างคงเดิม', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const b = 2;', new_string: 'const b = 99;' }, opts);
    expect(out).toMatch(/OK/);
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\nconst b = 99;\nconst c = 3;\n');
  });
  it('ERROR เมื่อไม่เจอ old_string (self-heal hint)', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const z = 0;', new_string: 'x' }, opts);
    expect(out).toMatch(/ERROR.*ไม่พบ/);
  });
  it('ERROR เมื่อ ambiguous (พบ >1)', async () => {
    await writeFile(file, 'x();\nx();\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'x();', new_string: 'y();' }, opts);
    expect(out).toMatch(/พบ 2/);
  });
  it('ERROR เมื่อ old_string === new_string', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const a = 1;', new_string: 'const a = 1;' }, opts);
    expect(out).toMatch(/ERROR/);
  });
  it('BLOCKED เมื่อแก้ path ที่ป้องกัน (.env)', async () => {
    const out = await editFileTool.execute!({ path: '.env', old_string: 'a', new_string: 'b' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });
  it('ERROR เมื่อ old_string ว่าง (กัน infinite loop / CLI แฮงค์)', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: '', new_string: 'x' }, opts);
    expect(out).toMatch(/ERROR/);
  });
  it('แก้ไฟล์ CRLF โดยไม่ทำลาย line ending', async () => {
    const f = join(dir, 'crlf.ts');
    await writeFile(f, 'a();\r\nb();\r\nc();\r\n');
    const out = await editFileTool.execute!({ path: f, old_string: 'b();', new_string: 'B();' }, opts);
    expect(out).toMatch(/OK/);
    expect(await readFile(f, 'utf8')).toBe('a();\r\nB();\r\nc();\r\n');
  });

  it('flex match (indent ต่าง) → คง indentation เดิม ไม่ de-indent code', async () => {
    const f = join(dir, 'indent.ts');
    await writeFile(f, 'function g() {\n    const x = 1;\n    const y = 2;\n}\n');
    // model ส่ง old/new แบบไม่มี indent → flex tier match แต่ต้อง re-apply 4-space indent ของไฟล์
    const out = await editFileTool.execute!(
      { path: f, old_string: 'const x = 1;\nconst y = 2;', new_string: 'const x = 10;\nconst y = 20;' },
      opts,
    );
    expect(out).toMatch(/OK/);
    expect(await readFile(f, 'utf8')).toBe('function g() {\n    const x = 10;\n    const y = 20;\n}\n');
  });

  it('replace_all: แทนที่ทุกที่ด้วย old_string สั้นๆ (rename) — ไม่ต้อง unique, ประหยัด token', async () => {
    await writeFile(file, 'let total = 0;\ntotal = total + 1;\nreturn total;\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'total', new_string: 'sum', replace_all: true }, opts);
    expect(out).toMatch(/OK/);
    expect(out).toMatch(/4 ที่/); // 4 occurrences replaced
    expect(await readFile(file, 'utf8')).toBe('let sum = 0;\nsum = sum + 1;\nreturn sum;\n');
  });

  it('replace_all: ไม่เจอ → ERROR (match ตรงเป๊ะเท่านั้น)', async () => {
    await writeFile(file, 'const a = 1;\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'zzz', new_string: 'y', replace_all: true }, opts);
    expect(out).toMatch(/ERROR.*ไม่พบ/);
  });

  it('ambiguous (ไม่มี replace_all) → ERROR แนะนำ replace_all', async () => {
    await writeFile(file, 'x();\nx();\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'x();', new_string: 'y();' }, opts);
    expect(out).toMatch(/พบ 2/);
    expect(out).toMatch(/replace_all/); // suggest the token-cheap path instead of padding context
  });
});

describe('write / read / list tools', () => {
  let dir: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    dir = await mkdtemp(join(tmpdir(), 'sanook-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('write สร้างไฟล์ (mkdir recursive) + read อ่านกลับได้', async () => {
    const f = join(dir, 'a/b/new.txt');
    expect(await writeFileTool.execute!({ path: f, content: 'hello' }, opts)).toMatch(/OK/);
    expect(await readFileTool.execute!({ path: f }, opts)).toBe('hello');
  });
  it('write block protected path', async () => {
    const out = await writeFileTool.execute!({ path: join(dir, '.git/x'), content: 'x' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });
  it('read คืน ERROR (ไม่ throw) เมื่อไฟล์ไม่มี', async () => {
    expect(await readFileTool.execute!({ path: join(dir, 'nope.txt') }, opts)).toMatch(/ERROR/);
  });
  it('read offset/limit อ่านเฉพาะช่วงบรรทัด (ประหยัด token)', async () => {
    const f = join(dir, 'big.txt');
    await writeFile(f, 'L1\nL2\nL3\nL4\nL5\n');
    const out = String(await readFileTool.execute!({ path: f, offset: 2, limit: 2 }, opts));
    expect(out).toContain('[บรรทัด 2-3'); // header กำกับช่วง
    expect(out).toContain('L2\nL3');
    expect(out).not.toContain('L1');
    expect(out).not.toContain('L5');
  });
  it('read offset เกินช่วง → บอกชัด ไม่ throw', async () => {
    const f = join(dir, 'small.txt');
    await writeFile(f, 'only\n');
    expect(String(await readFileTool.execute!({ path: f, offset: 99 }, opts))).toContain('เกินช่วง');
  });
  it('list คืนชื่อไฟล์ในโฟลเดอร์', async () => {
    await writeFile(join(dir, 'a.txt'), '');
    expect(await listDirTool.execute!({ path: dir }, opts)).toContain('a.txt');
  });
  it('glob block traversal/absolute pattern แม้ cwd อยู่ใน workspace', async () => {
    expect(await globTool.execute!({ pattern: '../*', cwd: '.' }, opts)).toMatch(/BLOCKED/);
    expect(await globTool.execute!({ pattern: '/tmp/*', cwd: '.' }, opts)).toMatch(/BLOCKED/);
  });
});
