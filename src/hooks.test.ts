import { describe, it, expect } from 'vitest';
import { matches } from './hooks.js';

describe('hooks matcher', () => {
  it('"*" และ "" → match ทุก tool', () => {
    expect(matches('*', 'write_file')).toBe(true);
    expect(matches('', 'anything')).toBe(true);
  });
  it('regex alternation → match เฉพาะที่ตรง', () => {
    expect(matches('write_file|edit_file', 'write_file')).toBe(true);
    expect(matches('write_file|edit_file', 'edit_file')).toBe(true);
    expect(matches('write_file|edit_file', 'read_file')).toBe(false);
  });
  it('anchor เต็มชื่อ — ไม่ partial match', () => {
    expect(matches('write', 'write_file')).toBe(false); // ^write$ ไม่ match write_file
    expect(matches('write_file', 'write_file')).toBe(true);
  });
  it('regex พัง → เทียบตรงๆ (ไม่ throw)', () => {
    expect(matches('[invalid', 'write_file')).toBe(false);
    expect(matches('[invalid', '[invalid')).toBe(true);
  });
});
