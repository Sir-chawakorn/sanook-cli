import { describe, expect, it } from 'vitest';
import {
  fetchWeb,
  extractStructure,
  isPrivateHost,
  isAllowedByRobots,
  looksBlocked,
  tavilySearch,
  renderWebFetchResult,
  REFUSED_TECHNIQUES,
  type FetchHttpResponse,
  type FetchImpl,
} from './web-fetch.js';

function res(opts: { status?: number; body?: string; contentType?: string; headers?: Record<string, string>; url?: string }): FetchHttpResponse {
  const status = opts.status ?? 200;
  const h = new Map<string, string>();
  if (opts.contentType) h.set('content-type', opts.contentType);
  for (const [k, v] of Object.entries(opts.headers ?? {})) h.set(k.toLowerCase(), v);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => h.get(n.toLowerCase()) ?? null },
    text: async () => opts.body ?? '',
    url: opts.url,
  };
}

const EVASION_RE = /2captcha|anticaptcha|capsolver|brightdata|smartproxy|oxylabs|residential|premium_proxy|stealth/i;

describe('web-fetch ladder', () => {
  it('SIMULATION: high-security site (Cloudflare 403) falls through to the reader tier without any evasion', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.startsWith('https://r.jina.ai/')) {
        return res({ status: 200, contentType: 'text/plain', body: 'Title: Secure Co Portal\n\nWelcome to the compliance portal for enterprise customers.' });
      }
      // origin returns a Cloudflare-style bot challenge
      return res({ status: 403, contentType: 'text/html', body: '<html><body>Attention Required! | Cloudflare</body></html>' });
    };

    const result = await fetchWeb('https://secure.example.com/portal?ref=1', { fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.winningTier).toBe('reader');
    expect(result.attempts.find((a) => a.tier === 'direct')?.ok).toBe(false);
    expect(result.attempts.find((a) => a.tier === 'reader')?.ok).toBe(true);
    expect(result.structure?.title).toContain('Secure Co');
    // The whole point: refused techniques are advertised and NONE were attempted.
    expect(result.refused).toContain('CAPTCHA solving');
    expect(calls.some((u) => EVASION_RE.test(u))).toBe(false);
    // reader receives the full URL incl. query string, un-mangled
    expect(calls.some((u) => u === 'https://r.jina.ai/https://secure.example.com/portal?ref=1')).toBe(true);
  });

  it('direct tier extracts structure from normal public HTML', async () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>Acme Robotics</title>
      <meta name="description" content="We build warehouse robots for logistics.">
      <meta property="og:site_name" content="Acme">
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      </head><body>
      <h1>Warehouse Automation</h1><h2>Products</h2>
      <a href="/about">About us</a><a href="https://x.com/acme">Twitter</a><a href="#top">skip</a>
      <p>Acme builds robots for logistics and fulfilment centres.</p>
      </body></html>`;
    const fetchImpl: FetchImpl = async (url) =>
      url.endsWith('/robots.txt') ? res({ status: 404 }) : res({ status: 200, contentType: 'text/html', body: html, url: 'https://acme.example.com/' });

    const r = await fetchWeb('https://acme.example.com/', { fetchImpl });

    expect(r.ok).toBe(true);
    expect(r.winningTier).toBe('direct');
    expect(r.structure?.title).toBe('Acme Robotics');
    expect(r.structure?.description).toContain('warehouse robots');
    expect(r.structure?.siteName).toBe('Acme');
    expect(r.structure?.lang).toBe('en');
    expect(r.structure?.headings).toContain('Warehouse Automation');
    expect(r.structure?.jsonLdTypes).toContain('Organization');
    expect(r.structure?.links.map((l) => l.href)).toContain('https://acme.example.com/about');
    expect(r.structure?.links.map((l) => l.href)).not.toContain('#top');
    expect(renderWebFetchResult(r)).toContain('never attempted (policy)');
  });

  it('treats a 200 bot-challenge interstitial as a failure and falls through (not a bypass)', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 200, contentType: 'text/plain', body: '# Real Article\n\nThe actual content lives here.' });
      // origin returns HTTP 200 but a Cloudflare "Just a moment..." challenge body
      return res({ status: 200, contentType: 'text/html', body: '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. Enable JavaScript and cookies to continue.</body></html>' });
    };

    const r = await fetchWeb('https://protected.example.com/article', { fetchImpl });

    expect(r.ok).toBe(true);
    expect(r.winningTier).toBe('reader');
    expect(r.attempts.find((a) => a.tier === 'direct')?.ok).toBe(false);
    expect(r.attempts.find((a) => a.tier === 'direct')?.detail).toMatch(/interstitial/i);
    expect(r.structure?.title).toBe('Real Article');
  });

  it('falls all the way to archive when both direct and reader hit challenge pages', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('archive.org/wayback/available')) {
        return res({ status: 200, contentType: 'application/json', body: JSON.stringify({ archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/web/2021/https://walled.example.com/', timestamp: '20210101' } } }) });
      }
      if (url.startsWith('https://web.archive.org/')) return res({ status: 200, contentType: 'text/html', body: '<html><head><title>Walled Co</title></head><body><h1>Public archived copy</h1></body></html>' });
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 200, contentType: 'text/plain', body: 'Attention Required! | Cloudflare\nPlease verify you are a human.' });
      return res({ status: 200, contentType: 'text/html', body: '<title>Just a moment...</title>' });
    };

    const r = await fetchWeb('https://walled.example.com/', { fetchImpl });

    expect(r.winningTier).toBe('archive');
    expect(r.attempts.find((a) => a.tier === 'reader')?.ok).toBe(false);
    expect(r.structure?.title).toBe('Walled Co');
  });

  it('uses the Tavily extract tier when a key is present and earlier tiers fail', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('api.tavily.com/extract')) {
        return res({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ raw_content: '# Tavily Doc\n\nExtracted body text here.' }] }) });
      }
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 500 });
      return res({ status: 403, contentType: 'text/html' });
    };

    const r = await fetchWeb('https://blocked.example.com/doc', { fetchImpl, tavilyApiKey: 'tvly-test', timeoutMs: 100 });

    expect(r.winningTier).toBe('tavily');
    expect(r.content).toContain('Extracted body text');
  });

  it('falls back to a Wayback snapshot when the origin is gone', async () => {
    const snapHtml = '<html><head><title>Old Page (archived)</title></head><body><h1>Gone but archived</h1></body></html>';
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('archive.org/wayback/available')) {
        return res({ status: 200, contentType: 'application/json', body: JSON.stringify({ archived_snapshots: { closest: { available: true, url: 'https://web.archive.org/web/2020/https://dead.example.com/', timestamp: '20200101' } } }) });
      }
      if (url.startsWith('https://web.archive.org/')) return res({ status: 200, contentType: 'text/html', body: snapHtml });
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 502 });
      return res({ status: 503 }); // origin down
    };

    const r = await fetchWeb('https://dead.example.com/', { fetchImpl });

    expect(r.ok).toBe(true);
    expect(r.winningTier).toBe('archive');
    expect(r.finalUrl).toContain('web.archive.org');
    expect(r.structure?.title).toContain('archived');
  });

  it('reports BLOCKED (no ethical tier) and refuses evasion when everything fails', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('archive.org/wayback/available')) return res({ status: 200, body: JSON.stringify({ archived_snapshots: {} }) });
      return res({ status: 403, contentType: 'text/html' });
    };

    const r = await fetchWeb('https://locked.example.com/', { fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/evasion|ไม่ทำ/);
    expect(r.refused).toEqual(REFUSED_TECHNIQUES);
  });

  it('respects a robots.txt Disallow and never fetches the disallowed path', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return res({ status: 200, body: 'User-agent: *\nDisallow: /private' });
      return res({ status: 200, contentType: 'text/html', body: '<html><title>secret</title></html>' });
    };

    const r = await fetchWeb('https://site.example.com/private/page', { fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/robots/i);
    expect(r.attempts.find((a) => a.tier === 'robots')?.ok).toBe(false);
    expect(calls).not.toContain('https://site.example.com/private/page');
  });

  it('blocks internal/loopback hosts to prevent SSRF before any network call', async () => {
    let called = false;
    const fetchImpl: FetchImpl = async () => {
      called = true;
      return res({ status: 200 });
    };

    const r = await fetchWeb('http://169.254.169.254/latest/meta-data/', { fetchImpl });

    expect(r.ok).toBe(false);
    expect(called).toBe(false);
    expect(r.attempts[0].detail).toMatch(/SSRF/);
  });

  it('rejects non-http(s) protocols', async () => {
    const r = await fetchWeb('file:///etc/passwd', { fetchImpl: async () => res({ status: 200 }) });
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/http/);
  });
});

describe('web-fetch hardening', () => {
  it('does NOT follow a redirect into a private/metadata host (redirect SSRF)', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('archive.org/wayback/available')) return res({ status: 200, body: JSON.stringify({ archived_snapshots: {} }) });
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 500 });
      if (url.startsWith('http://169.254.169.254')) return res({ status: 200, contentType: 'text/plain', body: 'SECRET-CREDENTIALS' });
      return res({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/iam/' } }); // origin redirects to metadata
    };

    const r = await fetchWeb('https://innocent.example.com/', { fetchImpl });

    expect(r.ok).toBe(false);
    expect(r.content).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('SECRET-CREDENTIALS');
    expect(calls.some((u) => u.startsWith('http://169.254.169.254'))).toBe(false); // never even requested
  });

  it('rejects an over-cap response by Content-Length before buffering', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) return res({ status: 404 });
      if (url.includes('archive.org/wayback/available')) return res({ status: 200, body: JSON.stringify({ archived_snapshots: {} }) });
      if (url.startsWith('https://r.jina.ai/')) return res({ status: 500 });
      return res({ status: 200, contentType: 'text/html', headers: { 'content-length': '99999999' }, body: '<html>huge</html>' });
    };

    const r = await fetchWeb('https://big.example.com/', { fetchImpl, maxBytes: 1000 });

    expect(r.ok).toBe(false);
    expect(r.attempts.find((a) => a.tier === 'direct')?.detail).toMatch(/too large/);
  });
});

describe('isPrivateHost', () => {
  it('flags loopback, private, link-local and metadata hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.5.5', '169.254.169.254', '::1', 'foo.local']) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });
  it('flags IPv4-mapped IPv6 and trailing-dot evasions', () => {
    for (const h of ['::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', 'localhost.', '127.0.0.1.']) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });
  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', 'sub.acme.io', '172.15.0.1', '11.0.0.1']) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});

describe('looksBlocked', () => {
  it('flags short interstitials and strong markers, not long legit prose', () => {
    expect(looksBlocked('<title>Just a moment...</title>')).toBe(true);
    expect(looksBlocked('Attention Required! | Cloudflare')).toBe(true);
    expect(looksBlocked(`Just a moment ${'word '.repeat(300)}`)).toBe(false); // weak marker but real content
  });
});

describe('isAllowedByRobots', () => {
  it('allows everything with no rules', () => {
    expect(isAllowedByRobots('', '/anything')).toBe(true);
  });
  it('honours a global Disallow', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /', '/page')).toBe(false);
    expect(isAllowedByRobots('User-agent: *\nDisallow: /private', '/private/x')).toBe(false);
    expect(isAllowedByRobots('User-agent: *\nDisallow: /private', '/public')).toBe(true);
  });
  it('lets a longer Allow override a Disallow', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok', '/private/ok')).toBe(true);
  });
  it('prefers the group that matches our UA token', () => {
    const txt = 'User-agent: sanook\nDisallow: /\n\nUser-agent: *\nAllow: /';
    expect(isAllowedByRobots(txt, '/page', 'sanook')).toBe(false);
  });
  it('does not let a group named after a UA substring (web/cli/fetch) falsely apply', () => {
    expect(isAllowedByRobots('User-agent: web\nDisallow: /\n\nUser-agent: *\nAllow: /', '/x', 'sanook')).toBe(true);
  });
  it('honours * wildcard and $ end-anchor in path rules', () => {
    expect(isAllowedByRobots('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf', 'sanook')).toBe(false);
    expect(isAllowedByRobots('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf?x=1', 'sanook')).toBe(true);
  });
});

describe('extractStructure', () => {
  it('pulls title, headings, links and JSON-LD types from raw HTML', () => {
    const s = extractStructure(
      '<html><head><title>Hi</title></head><body><h1>One</h1><h3>Two</h3><a href="/a">A</a><script type="application/ld+json">{"@graph":[{"@type":"WebSite"}]}</script></body></html>',
      'https://e.com/p',
    );
    expect(s.title).toBe('Hi');
    expect(s.headings).toEqual(['One', 'Two']);
    expect(s.links[0].href).toBe('https://e.com/a');
    expect(s.jsonLdTypes).toContain('WebSite');
    expect(s.summary.length).toBeGreaterThan(0);
  });
});

describe('tavilySearch', () => {
  it('posts to /search and returns hits', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      expect(url).toContain('/search');
      return res({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ title: 'Acme', url: 'https://acme.com', content: 'robots' }] }) });
    };
    const hits = await tavilySearch('acme robotics', { apiKey: 'tvly', fetchImpl, timeoutMs: 100 });
    expect(hits[0].url).toBe('https://acme.com');
  });
});
