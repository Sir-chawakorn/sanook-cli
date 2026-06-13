import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';

describe('App (Ink REPL)', () => {
  it('mount + render prompt cursor ได้ (ไม่ crash)', () => {
    const { lastFrame, unmount } = render(<App initialModel="sonnet" />);
    expect(lastFrame()).toContain('›');
    unmount();
  });
});
