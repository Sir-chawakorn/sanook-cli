import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupWizard } from './setup.js';

const tick = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ENTER = '\r';
const ESC = '\x1b';

// fixes: empty key must not advance setup; Esc must escape a wrong-provider dead-end
describe('setup wizard — key step guards', () => {
  it('pressing Enter on an EMPTY key does not advance — stays on key step + shows error', async () => {
    const { stdin, lastFrame } = render(<SetupWizard onComplete={() => {}} />);
    await tick();
    stdin.write(ENTER); // pick Anthropic (first, requiresKey) → key step
    await tick();
    expect(lastFrame()).toContain('วาง API key ของ Anthropic');

    stdin.write(ENTER); // empty submit
    await tick();
    expect(lastFrame()).toContain('วาง API key ของ Anthropic'); // STILL on key step (didn't jump to model)
    expect(lastFrame()).toContain('วาง API key ก่อน'); // inline error shown
  });

  it('Esc on the key step returns to provider selection (no Ctrl+C restart needed)', async () => {
    const { stdin, lastFrame } = render(<SetupWizard onComplete={() => {}} />);
    await tick();
    stdin.write(ENTER); // → key step
    await tick();
    expect(lastFrame()).toContain('วาง API key');

    stdin.write(ESC); // back
    await tick();
    expect(lastFrame()).toContain('เลือก AI provider'); // back at provider list
  });
});
