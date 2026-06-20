import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupWizard } from './setup.js';

const tick = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
const waitForFrame = async (lastFrame: () => string | undefined, text: string): Promise<void> => {
  const deadline = Date.now() + 750;
  do {
    if ((lastFrame() ?? '').includes(text)) return;
    await tick(25);
  } while (Date.now() < deadline);
};
const ENTER = '\r';
const ESC = '\x1b';

// fixes: empty key must not advance setup; Esc must escape a wrong-provider dead-end
describe('setup wizard — key step guards', () => {
  const ENTER = '\r';

  async function reachKeyStep(stdin: { write: (s: string) => void }, lastFrame: () => string | undefined): Promise<void> {
    await tick();
    stdin.write(ENTER); // language
    await tick();
    stdin.write(ENTER); // welcome
    await tick();
    stdin.write(ENTER); // provider (first = anthropic)
    await tick();
    await waitForFrame(lastFrame, 'API key');
  }

  it('pressing Enter on an EMPTY key does not advance — stays on key step + shows error', async () => {
    const { stdin, lastFrame } = render(<SetupWizard onComplete={() => {}} />);
    await reachKeyStep(stdin, lastFrame);

    stdin.write(ENTER); // empty submit
    await waitForFrame(lastFrame, 'API key');
    expect(lastFrame()).toMatch(/API key|วาง API key/);
  });

  it('Esc on the key step returns to provider selection (no Ctrl+C restart needed)', async () => {
    const { stdin, lastFrame } = render(<SetupWizard onComplete={() => {}} />);
    await reachKeyStep(stdin, lastFrame);
    expect(lastFrame()).toMatch(/API key|วาง API key/);

    stdin.write('\x1b'); // Esc
    await tick();
    expect(lastFrame()).toMatch(/Choose AI provider|เลือก AI provider/);
  });
});
