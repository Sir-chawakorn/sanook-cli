import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { findStableMarkdownBoundary, MarkdownText, StreamingMarkdownText } from './markdown.js';

describe('markdown renderer', () => {
  it('finds stable blank-line boundaries outside fenced code blocks', () => {
    expect(findStableMarkdownBoundary('one\n\ntwo')).toBe(5);
    expect(findStableMarkdownBoundary('```ts\none\n\ntwo')).toBe(-1);
    expect(findStableMarkdownBoundary('```ts\none\n```\n\ntwo')).toBe(15);
  });

  it('renders common markdown blocks without raw fence markers', () => {
    const { lastFrame } = render(
      <MarkdownText columns={80} text={'# Title\n\n- use `sanook`\n\n```ts\nconst ok = true;\n```\n\n> remembered'} />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Title');
    expect(frame).toContain('- use sanook');
    expect(frame).toContain('const ok = true;');
    expect(frame).toContain('> remembered');
    expect(frame).not.toContain('```');
  });

  it('renders streaming markdown with a stable prefix and live tail', () => {
    const { lastFrame, rerender } = render(<StreamingMarkdownText columns={80} text={'# Plan\n\n- first'} />);

    expect(lastFrame()).toContain('Plan');
    expect(lastFrame()).toContain('- first');

    rerender(<StreamingMarkdownText columns={80} text={'# Plan\n\n- first\n- second'} />);

    expect(lastFrame()).toContain('- second');
  });
});
