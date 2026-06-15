import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, isValidSkillName, renderAvailableSkills, loadSkills, getSkillBody } from './skills.js';

describe('parseFrontmatter', () => {
  it('ดึง key: value จาก --- block + คืน body', () => {
    const { meta, body } = parseFrontmatter('---\nname: deploy\ndescription: "ship it"\n---\nStep 1\nStep 2');
    expect(meta.name).toBe('deploy');
    expect(meta.description).toBe('ship it'); // strip quotes
    expect(body.trim()).toBe('Step 1\nStep 2');
  });
  it('ไม่มี frontmatter → meta ว่าง, body = ทั้งหมด', () => {
    const { meta, body } = parseFrontmatter('just text');
    expect(meta).toEqual({});
    expect(body).toBe('just text');
  });
  it('รองรับ CRLF', () => {
    const { meta } = parseFrontmatter('---\r\nname: x\r\n---\r\nbody');
    expect(meta.name).toBe('x');
  });
});

describe('isValidSkillName (กัน path traversal)', () => {
  it('slug ถูกต้อง → true', () => {
    expect(isValidSkillName('deploy-vercel')).toBe(true);
    expect(isValidSkillName('fix123')).toBe(true);
  });
  it('อันตราย/ผิด format → false', () => {
    expect(isValidSkillName('../etc')).toBe(false);
    expect(isValidSkillName('a/b')).toBe(false);
    expect(isValidSkillName('Deploy')).toBe(false); // uppercase
    expect(isValidSkillName('')).toBe(false);
    expect(isValidSkillName('-lead')).toBe(false); // ขึ้นต้นด้วย -
  });
});

describe('renderAvailableSkills', () => {
  it('ว่าง → string ว่าง', () => expect(renderAvailableSkills([])).toBe(''));
  it('มี skill → block + name/desc', () => {
    const out = renderAvailableSkills([{ name: 'd', description: 'deploy', path: '/x' }]);
    expect(out).toContain('available_skills');
    expect(out).toContain('d: deploy');
  });
});

describe('project skills trust gate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sanook-skill-project-'));
    await writeFile(join(dir, 'package.json'), '{}');
    await mkdir(join(dir, '.sanook', 'skills', 'repo-skill'), { recursive: true });
    await writeFile(
      join(dir, '.sanook', 'skills', 'repo-skill', 'SKILL.md'),
      '---\nname: repo-skill\ndescription: project-controlled\n---\n\n## Steps\n1. from project',
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('ไม่โหลด project skill จนกว่า project จะ trusted', async () => {
    expect((await loadSkills(dir)).some((s) => s.name === 'repo-skill')).toBe(false);
    expect(await getSkillBody('repo-skill', dir)).toBeNull();

    vi.stubEnv('SANOOK_TRUST_PROJECT', '1');
    expect((await loadSkills(dir)).some((s) => s.name === 'repo-skill')).toBe(true);
    expect(await getSkillBody('repo-skill', dir)).toContain('from project');
  });

  it('ไม่ใช้ frontmatter name ที่ไม่ปลอดภัยเป็น injected skill name', async () => {
    await writeFile(
      join(dir, '.sanook', 'skills', 'repo-skill', 'SKILL.md'),
      '---\nname: ../../bad\ndescription: project-controlled\n---\n\nbody',
    );
    vi.stubEnv('SANOOK_TRUST_PROJECT', '1');
    const skills = await loadSkills(dir);
    expect(skills.some((s) => s.name === '../../bad')).toBe(false);
    expect(skills.some((s) => s.name === 'repo-skill')).toBe(true);
  });
});
