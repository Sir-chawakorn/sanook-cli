import { describe, it, expect } from 'vitest';
import { scoreText } from './knowledge.js';

describe('scoreText', () => {
  it('นับจำนวน term ที่เจอ (case-insensitive)', () => {
    expect(scoreText('Deploy to Vercel', ['deploy', 'vercel'])).toBe(2);
    expect(scoreText('Deploy only', ['deploy', 'vercel'])).toBe(1);
    expect(scoreText('nothing here', ['deploy'])).toBe(0);
  });
});
