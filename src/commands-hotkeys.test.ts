import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands.js';

describe('/hotkeys', () => {
  it('prints Sanook REPL hotkeys', () => {
    const result = parseCommand('/hotkeys', { model: 'sonnet' });

    expect(result.handled).toBe(true);
    expect(result.action).toBe('hotkeys');
    expect(result.message).toContain('hotkeys:');
    expect(result.message).toContain('Ctrl+C');
    expect(result.message).toContain('@file');
    expect(result.message).toContain('/model <spec>');
  });

  it('is discoverable from /help', () => {
    const result = parseCommand('/help', { model: 'sonnet' });

    expect(result.message).toContain('/hotkeys');
  });
});
