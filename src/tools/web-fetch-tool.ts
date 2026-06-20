import { tool } from 'ai';
import { z } from 'zod';
import { fetchWeb, renderWebFetchResult } from '../web-fetch.js';

async function resolveTavilyKey(): Promise<string | undefined> {
  if (process.env.TAVILY_API_KEY?.trim()) return process.env.TAVILY_API_KEY.trim();
  try {
    const { loadMcpConfig } = await import('../mcp.js');
    const cfg = await loadMcpConfig();
    for (const server of Object.values(cfg)) {
      const key = server.env?.TAVILY_API_KEY?.trim();
      if (key) return key;
    }
  } catch {
    /* no mcp config */
  }
  return undefined;
}

/** Built-in ethical web fetch — same ladder as `sanook web fetch <url>`. */
export const webFetchTool = tool({
  description:
    'Fetch a public web page through Sanook\'s ethical fallback ladder (direct HTML → reader → Tavily extract → Wayback). ' +
    'Honours robots.txt and SSRF guards; never bypasses CAPTCHAs, logins, paywalls, or anti-bot controls. ' +
    'Use for official docs, API references, and volatile external facts — cite the URL in your answer.',
  inputSchema: z.object({
    url: z.string().describe('http(s) URL of a public page to fetch'),
  }),
  execute: async ({ url }) => {
    const result = await fetchWeb(url, { tavilyApiKey: await resolveTavilyKey() });
    return renderWebFetchResult(result);
  },
});
