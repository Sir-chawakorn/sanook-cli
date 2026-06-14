import { describe, it, expect } from 'vitest';
import { renderEditDiff, summarizeWrite } from './diff.js';

describe('renderEditDiff', () => {
  it('โชว์เฉพาะส่วนที่เปลี่ยน (ตัด common prefix/suffix)', () => {
    const d = renderEditDiff('a\nB\nc', 'a\nQ\nc');
    expect(d).toBe('- B\n+ Q');
  });
  it('เพิ่มบรรทัด', () => {
    const d = renderEditDiff('x', 'x\ny');
    expect(d).toContain('+ y');
  });
});

describe('summarizeWrite', () => {
  it('ไฟล์ใหม่', () => {
    expect(summarizeWrite('a\nb\nc')).toContain('เขียนใหม่ 3 บรรทัด');
  });
  it('เขียนทับ → before→after', () => {
    expect(summarizeWrite('x', 'a\nb')).toContain('2 → 1');
  });
});
