import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fetchWeb: vi.fn(),
  renderWebFetchResult: vi.fn(),
}));

vi.mock('../web-fetch.js', () => ({
  fetchWeb: h.fetchWeb,
  renderWebFetchResult: h.renderWebFetchResult,
}));

vi.mock('../mcp.js', () => ({
  loadMcpConfig: vi.fn(async () => ({})),
}));

import { webFetchTool } from './web-fetch-tool.js';

beforeEach(() => {
  h.fetchWeb.mockReset();
  h.renderWebFetchResult.mockReset();
  h.fetchWeb.mockResolvedValue({ url: 'https://example.com', ok: true, attempts: [], refused: [] });
  h.renderWebFetchResult.mockReturnValue('web fetch: https://example.com\nresult: OK');
});

describe('web_fetch agent tool', () => {
  it('calls fetchWeb and returns rendered result', async () => {
    const out = await webFetchTool.execute!({ url: 'https://example.com/docs' }, {} as never);
    expect(h.fetchWeb).toHaveBeenCalledWith('https://example.com/docs', expect.objectContaining({ tavilyApiKey: undefined }));
    expect(h.renderWebFetchResult).toHaveBeenCalled();
    expect(String(out)).toContain('OK');
  });
});
