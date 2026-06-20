import { describe, expect, it } from 'vitest';
import { BRAND } from './brand.js';
import { formatPlanExecuteHandoff, shellQuoteDouble } from './plan-handoff.js';

describe('plan execute handoff', () => {
  it('escapes quotes and newlines for shell hints', () => {
    expect(shellQuoteDouble('say "hi"')).toBe('"say \\"hi\\""');
    expect(shellQuoteDouble('line1\nline2')).toBe('"line1\\nline2"');
  });

  it('includes --yes and pipe recipes', () => {
    const msg = formatPlanExecuteHandoff('add web_fetch tool');
    expect(msg).toContain('Plan complete');
    expect(msg).toContain(`${BRAND.cliName} --yes`);
    expect(msg).toContain(`${BRAND.cliName} plan`);
    expect(msg).toContain('pipe');
  });
});
