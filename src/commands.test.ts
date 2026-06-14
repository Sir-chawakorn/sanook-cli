import { describe, it, expect } from 'vitest';
import { parseCommand } from './commands.js';

const ctx = { model: 'sonnet' };

describe('parseCommand', () => {
  it('ข้อความปกติ (ไม่ขึ้นต้น /) → handled=false (ส่งเข้า agent)', () => {
    expect(parseCommand('hello world', ctx).handled).toBe(false);
  });
  it('/help → action help + รายการคำสั่ง', () => {
    const r = parseCommand('/help', ctx);
    expect(r.action).toBe('help');
    expect(r.message).toContain('/model');
  });
  it('/quit + /exit → action quit', () => {
    expect(parseCommand('/quit', ctx).action).toBe('quit');
    expect(parseCommand('/exit', ctx).action).toBe('quit');
  });
  it('/clear → action clear', () => {
    expect(parseCommand('/clear', ctx).action).toBe('clear');
  });
  it('/diff + /undo → action diff/undo (git-backed)', () => {
    expect(parseCommand('/diff', ctx).action).toBe('diff');
    expect(parseCommand('/undo', ctx).action).toBe('undo');
  });
  it('/model ไม่มี arg → แสดง model ปัจจุบัน', () => {
    expect(parseCommand('/model', ctx).message).toContain('sonnet');
  });
  it('/model opus → modelChange', () => {
    const r = parseCommand('/model opus', ctx);
    expect(r.modelChange).toBe('opus');
  });
  it('/cost → คืน cost summary จาก ctx', () => {
    expect(parseCommand('/cost', { model: 'sonnet', costSummary: 'tokens: 100' }).message).toBe('tokens: 100');
  });
  it('คำสั่งไม่รู้จัก → แนะนำ /help', () => {
    expect(parseCommand('/wat', ctx).message).toContain('/help');
  });
});
