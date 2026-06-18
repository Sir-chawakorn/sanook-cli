import { describe, expect, it } from 'vitest';
import { footerStatus } from './status.js';

describe('footerStatus', () => {
  it('shows richer hints on wide terminals', () => {
    expect(footerStatus({ columns: 100, costHint: '$0.01', model: 'openai:gpt-5.5', mode: 'ask' })).toContain('/hotkeys');
    expect(footerStatus({ columns: 100, costHint: '$0.01', model: 'openai:gpt-5.5', mode: 'ask' })).toContain('$0.01');
  });

  it('drops lower-priority hints on narrow terminals', () => {
    const status = footerStatus({ columns: 36, costHint: '$0.01', model: 'openai:gpt-5.5', mode: 'auto' });
    expect(status).toContain('openai:gpt-5.5');
    expect(status).toContain('auto');
    expect(status).not.toContain('/hotkeys');
    expect(status).not.toContain('$0.01');
  });
});
