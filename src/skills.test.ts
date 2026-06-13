import { describe, it, expect } from 'vitest';
import { parseFrontmatter, isValidSkillName, renderAvailableSkills } from './skills.js';

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
