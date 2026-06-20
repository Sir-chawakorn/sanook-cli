import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { SetupWizard } from './setup.js';

describe('SetupWizard', () => {
  it('mount + แสดง step เลือก provider (ไม่ crash)', () => {
    const { lastFrame, unmount } = render(<SetupWizard onComplete={() => {}} />);
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Sanook|ตั้งค่า Sanook/);
    expect(frame).toMatch(/language|ภาษา|provider/i);
    unmount();
  });
});
