import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSummarizer } from './summarize.js';
import { fastSibling, resolveModel } from './providers/registry.js';
import { generateText } from 'ai';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('./providers/registry.js', () => ({
  fastSibling: vi.fn((model: string) => `${model}:fast`),
  resolveModel: vi.fn((spec: string) => ({ spec })),
}));

describe('makeSummarizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateText).mockResolvedValue({ text: '- compact summary' } as never);
  });

  it('uses the fast sibling of the main model when no summary model is configured', async () => {
    const summarize = makeSummarizer('openai:gpt-main');

    await expect(summarize('user: finish the refactor')).resolves.toBe('- compact summary');

    expect(fastSibling).toHaveBeenCalledWith('openai:gpt-main');
    expect(resolveModel).toHaveBeenCalledWith('openai:gpt-main:fast');
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { spec: 'openai:gpt-main:fast' },
        prompt: expect.stringContaining('user: finish the refactor'),
        maxOutputTokens: 1024,
      }),
    );
  });

  it('honors an explicit summary model and resolves it lazily at summarize time', async () => {
    const summarize = makeSummarizer('openai:gpt-main', 'openai:gpt-mini');

    expect(resolveModel).not.toHaveBeenCalled();

    await summarize('assistant: changed src/loop.ts');

    expect(fastSibling).not.toHaveBeenCalled();
    expect(resolveModel).toHaveBeenCalledWith('openai:gpt-mini');
  });
});
