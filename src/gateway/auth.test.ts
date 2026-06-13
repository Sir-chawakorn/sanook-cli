import { describe, it, expect } from 'vitest';
import { tokenMatches } from './auth.js';

describe('tokenMatches (constant-time)', () => {
  const tok = 'a'.repeat(64);
  it('token ตรง → true', () => expect(tokenMatches(tok, tok)).toBe(true));
  it('token ผิด (len เท่า) → false', () => expect(tokenMatches(tok, 'b'.repeat(64))).toBe(false));
  it('length ต่าง → false', () => expect(tokenMatches(tok, 'a'.repeat(32))).toBe(false));
  it('undefined → false', () => expect(tokenMatches(tok, undefined)).toBe(false));
  it('empty string → false', () => expect(tokenMatches(tok, '')).toBe(false));
});
