import { BRAND } from './brand.js';

// Honest, identifying User-Agent. Sanook does NOT impersonate a human browser to evade detection.
export const SANOOK_USER_AGENT = `${BRAND.cliName}-cli (+web-fetch; respects robots.txt)`;

// Techniques Sanook will NEVER attempt. Surfaced on every fetch result for transparency.
// (See second-brain/Shared/Tech-Standards/web-search-grounding-policy.md)
export const REFUSED_TECHNIQUES: readonly string[] = [
  'CAPTCHA solving',
  'login / authentication bypass',
  'paywall / metered-content circumvention',
  'WAF / bot-challenge (Cloudflare etc.) defeat',
  'browser-fingerprint / TLS spoofing',
  'residential-proxy rotation to evade blocks',
];

export type FetchTierName = 'direct' | 'reader' | 'tavily' | 'archive';

export interface FetchTierInfo {
  tier: number;
  name: string;
  solves: string;
}

// Ordered, cheapest + most-polite first. Documents the ladder for `web status` and docs.
export const WEB_FETCH_LADDER: FetchTierInfo[] = [
  { tier: 0, name: 'preflight', solves: 'SSRF guard + robots.txt + honest UA + timeout/size caps (cross-cutting, always on)' },
  { tier: 1, name: 'direct', solves: 'normal public HTML — extract title/meta/headings/links/JSON-LD to understand the site' },
  { tier: 2, name: 'reader', solves: 'messy or JS-shell HTML — clean markdown via a reader service (Jina r.jina.ai)' },
  { tier: 3, name: 'tavily', solves: 'origin blocks a plain fetch — provider-side extract/search (needs TAVILY_API_KEY)' },
  { tier: 4, name: 'archive', solves: 'origin is down or removed — public archived snapshot (Wayback Machine)' },
];

export interface WebLink {
  text: string;
  href: string;
}

export interface WebStructure {
  title?: string;
  description?: string;
  siteName?: string;
  lang?: string;
  headings: string[];
  links: WebLink[];
  jsonLdTypes: string[];
  wordCount: number;
  summary: string;
}

export interface FetchAttempt {
  tier: FetchTierName | 'preflight' | 'robots';
  ok: boolean;
  detail: string;
  status?: number;
}

export interface WebFetchResult {
  url: string;
  ok: boolean;
  winningTier?: FetchTierName;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  structure?: WebStructure;
  /** Clean text/markdown body from reader/tavily/archive tiers (truncated to maxBytes). */
  content?: string;
  attempts: FetchAttempt[];
  /** Techniques deliberately not attempted — always REFUSED_TECHNIQUES, for transparency. */
  refused: readonly string[];
  /** Guidance when every ethical tier is exhausted. */
  note?: string;
}

// Minimal response shape so the real global fetch and test doubles both satisfy it.
export interface FetchHttpResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  url?: string;
}

export type FetchImpl = (url: string, init?: Record<string, unknown>) => Promise<FetchHttpResponse>;

export interface WebFetchOptions {
  fetchImpl?: FetchImpl;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  respectRobots?: boolean;
  allowReader?: boolean;
  readerBase?: string;
  allowArchive?: boolean;
  allowPrivateHosts?: boolean;
  tavilyApiKey?: string;
  tavilyBase?: string;
  maxLinks?: number;
  maxHeadings?: number;
}

interface ResolvedOptions extends Required<Omit<WebFetchOptions, 'tavilyApiKey'>> {
  tavilyApiKey?: string;
}

const DEFAULTS: ResolvedOptions = {
  fetchImpl: ((url, init) => fetch(url as string, init as RequestInit)) as FetchImpl,
  userAgent: SANOOK_USER_AGENT,
  timeoutMs: 15_000,
  maxBytes: 600_000,
  respectRobots: true,
  allowReader: true,
  readerBase: 'https://r.jina.ai/',
  allowArchive: true,
  allowPrivateHosts: false,
  tavilyBase: 'https://api.tavily.com',
  maxLinks: 25,
  maxHeadings: 20,
};

function resolveOptions(options: WebFetchOptions): ResolvedOptions {
  return { ...DEFAULTS, ...options, fetchImpl: options.fetchImpl ?? DEFAULTS.fetchImpl };
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// Block loopback / private / link-local / metadata hosts by default so an agent
// fetching an arbitrary URL can't reach internal services.
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  // IPv4
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 unique-local / link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

// ── robots.txt ──────────────────────────────────────────────────────────────
// Minimal but correct-enough parser: honour the most specific matching group for
// our UA token, falling back to `*`. Returns whether `path` is allowed to fetch.
export function isAllowedByRobots(robotsTxt: string, path: string, uaToken = BRAND.cliName): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      current.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const ua = uaToken.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const group = specific ?? wildcard;
  if (!group) return true;
  // Longest-match wins; an empty Disallow means "allow all".
  let decision = true;
  let best = -1;
  for (const rule of group.rules) {
    if (!rule.path) {
      if (!rule.allow) continue; // empty Disallow = allow all, no-op
      continue;
    }
    if (path.startsWith(rule.path) && rule.path.length > best) {
      best = rule.path.length;
      decision = rule.allow;
    }
  }
  return decision;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────
function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)));
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function withoutNoise(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

function getAttr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : undefined;
}

function collectMeta(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (getAttr(tag, 'name') ?? getAttr(tag, 'property') ?? getAttr(tag, 'itemprop'))?.toLowerCase();
    const content = getAttr(tag, 'content');
    if (key && content && !out.has(key)) out.set(key, content);
  }
  return out;
}

function extractLinks(html: string, baseUrl: string, max: number): WebLink[] {
  const seen = new Set<string>();
  const out: WebLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^(javascript|mailto|tel):/i.test(rawHref)) continue;
    let href: string;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ text: stripTags(m[5]).slice(0, 120) || href, href });
    if (out.length >= max) break;
  }
  return out;
}

function extractJsonLdTypes(html: string): string[] {
  const types = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const t = rec['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    if (Array.isArray(rec['@graph'])) (rec['@graph'] as unknown[]).forEach(visit);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* malformed JSON-LD — skip */
    }
  }
  return [...types].slice(0, 12);
}

export function extractStructure(html: string, baseUrl: string, options: WebFetchOptions = {}): WebStructure {
  const opts = resolveOptions(options);
  const meta = collectMeta(html);
  const metaOf = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v) return v;
    }
    return undefined;
  };
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleTag ? stripTags(titleTag[1]) : undefined) || metaOf('og:title', 'twitter:title');
  const description = metaOf('description', 'og:description', 'twitter:description');
  const siteName = metaOf('og:site_name', 'application-name');
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1];
  const headings: string[] = [];
  for (const m of withoutNoise(html).matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    const text = stripTags(m[1]);
    if (text && !headings.includes(text)) headings.push(text);
    if (headings.length >= opts.maxHeadings) break;
  }
  const wordCount = withoutNoise(html)
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* keep raw */
  }
  return {
    title,
    description,
    siteName,
    lang,
    headings,
    links: extractLinks(html, baseUrl, opts.maxLinks),
    jsonLdTypes: extractJsonLdTypes(html),
    wordCount,
    summary: buildSummary({ title, description, siteName, headings, host }),
  };
}

function buildSummary(parts: { title?: string; description?: string; siteName?: string; headings: string[]; host: string }): string {
  const lead = parts.title || parts.siteName || parts.host;
  const tail = parts.description || parts.headings[0] || '';
  const text = tail ? `${lead} — ${tail}` : lead;
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

// Markers of a bot-challenge / JS-required interstitial. If we see one we treat the
// tier as a FAILURE and fall through — this is RECOGNISING a block, never bypassing it.
const CHALLENGE_MARKERS = [
  'just a moment',
  'attention required',
  'cf-browser-verification',
  'challenge-platform',
  'checking your browser before accessing',
  'enable javascript and cookies to continue',
  'verifying you are human',
  'please verify you are a human',
  'requiring captcha',
  'ddos protection by',
];

export function looksBlocked(text: string): boolean {
  const head = text.slice(0, 3000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker));
}

function looksHtml(contentType: string | undefined, body: string): boolean {
  if (contentType && /(text\/html|application\/xhtml)/i.test(contentType)) return true;
  if (contentType && /(json|pdf|image\/|application\/octet)/i.test(contentType)) return false;
  return /<html[\s>]|<!doctype html|<head[\s>]|<body[\s>]/i.test(body.slice(0, 4000));
}

// ── single GET with timeout + size cap ───────────────────────────────────────
async function doGet(
  url: string,
  opts: ResolvedOptions,
  extraHeaders: Record<string, string> = {},
): Promise<{ res: FetchHttpResponse; body: string } | { error: string; status?: number; retryAfter?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await opts.fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/xhtml+xml,text/plain,*/*', ...extraHeaders },
    });
    if (!res.ok) {
      return { error: `${res.status}`, status: res.status, retryAfter: res.headers.get('retry-after') ?? undefined };
    }
    const body = (await res.text()).slice(0, opts.maxBytes);
    return { res, body };
  } catch (e) {
    return { error: (e as Error).name === 'AbortError' ? `timeout >${opts.timeoutMs}ms` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

type TierOutcome = Pick<WebFetchResult, 'winningTier' | 'finalUrl' | 'status' | 'contentType' | 'structure' | 'content'> | null;

async function checkRobots(parsed: URL, opts: ResolvedOptions, attempts: FetchAttempt[]): Promise<boolean> {
  const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  const got = await doGet(robotsUrl, { ...opts, respectRobots: false });
  if ('error' in got) {
    // No robots.txt (or unreachable) → not disallowed.
    attempts.push({ tier: 'robots', ok: true, detail: `no robots.txt readable (${got.error}) — treated as allowed` });
    return true;
  }
  const allowed = isAllowedByRobots(got.body, parsed.pathname + parsed.search, opts.userAgent);
  attempts.push({ tier: 'robots', ok: allowed, detail: allowed ? 'allowed by robots.txt' : `disallowed by robots.txt for ${parsed.pathname}` });
  return allowed;
}

async function tierDirect(parsed: URL, opts: ResolvedOptions, attempts: FetchAttempt[]): Promise<TierOutcome> {
  const got = await doGet(parsed.href, opts);
  if ('error' in got) {
    const extra = got.retryAfter ? ` (retry-after: ${got.retryAfter})` : '';
    attempts.push({ tier: 'direct', ok: false, detail: `direct fetch failed: ${got.error}${extra}`, status: got.status });
    return null;
  }
  const contentType = got.res.headers.get('content-type') ?? undefined;
  if (looksBlocked(got.body)) {
    attempts.push({ tier: 'direct', ok: false, detail: 'got a bot-challenge/JS interstitial — not bypassing, falling through', status: got.res.status });
    return null;
  }
  if (looksHtml(contentType, got.body)) {
    const structure = extractStructure(got.body, got.res.url ?? parsed.href, opts);
    attempts.push({ tier: 'direct', ok: true, detail: `direct HTML — ${structure.wordCount} words, ${structure.headings.length} headings`, status: got.res.status });
    return { winningTier: 'direct', finalUrl: got.res.url ?? parsed.href, status: got.res.status, contentType, structure };
  }
  attempts.push({ tier: 'direct', ok: true, detail: `direct non-HTML (${contentType ?? 'unknown'}) — returned as text`, status: got.res.status });
  return { winningTier: 'direct', finalUrl: got.res.url ?? parsed.href, status: got.res.status, contentType, content: stripTags(got.body).slice(0, opts.maxBytes) };
}

async function tierReader(parsed: URL, opts: ResolvedOptions, attempts: FetchAttempt[]): Promise<TierOutcome> {
  // Jina reader takes the full target URL appended to its base; do NOT pre-encode the whole URL
  // (encodeURI/encodeURIComponent would break r.jina.ai's path parsing of query strings).
  const readerUrl = `${opts.readerBase.replace(/\/$/, '')}/${parsed.href}`;
  const got = await doGet(readerUrl, opts, { accept: 'text/plain', 'x-return-format': 'markdown' });
  if ('error' in got) {
    attempts.push({ tier: 'reader', ok: false, detail: `reader (${opts.readerBase}) failed: ${got.error}`, status: got.status });
    return null;
  }
  const content = got.body.trim();
  if (!content) {
    attempts.push({ tier: 'reader', ok: false, detail: 'reader returned empty body' });
    return null;
  }
  if (looksBlocked(content)) {
    attempts.push({ tier: 'reader', ok: false, detail: 'reader returned a bot-challenge interstitial — not bypassing, falling through', status: got.res.status });
    return null;
  }
  attempts.push({ tier: 'reader', ok: true, detail: `reader markdown — ${content.length} chars`, status: got.res.status });
  return { winningTier: 'reader', finalUrl: parsed.href, status: got.res.status, contentType: 'text/markdown', content, structure: structureFromMarkdown(content, parsed.host) };
}

function structureFromMarkdown(markdown: string, host: string): WebStructure {
  const titleLine = markdown.match(/^Title:\s*(.+)$/im)?.[1] ?? markdown.match(/^#\s+(.+)$/m)?.[1];
  const headings = [...markdown.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 20);
  const firstPara = markdown.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#') && !/^(title|url source):/i.test(p));
  const title = titleLine?.trim();
  return {
    title,
    description: firstPara?.slice(0, 280),
    headings,
    links: [],
    jsonLdTypes: [],
    wordCount: markdown.split(/\s+/).filter((w) => w.length > 1).length,
    summary: buildSummary({ title, description: firstPara, headings, host }),
  };
}

async function tierTavily(parsed: URL, opts: ResolvedOptions, attempts: FetchAttempt[]): Promise<TierOutcome> {
  if (!opts.tavilyApiKey) return null;
  try {
    const res = await opts.fetchImpl(`${opts.tavilyBase.replace(/\/$/, '')}/extract`, {
      method: 'POST',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.tavilyApiKey}` },
      body: JSON.stringify({ urls: [parsed.href] }),
    });
    if (!res.ok) {
      attempts.push({ tier: 'tavily', ok: false, detail: `tavily extract failed: ${res.status}`, status: res.status });
      return null;
    }
    const json = JSON.parse(await res.text()) as { results?: { raw_content?: string; content?: string }[] };
    const content = json.results?.[0]?.raw_content || json.results?.[0]?.content;
    if (!content) {
      attempts.push({ tier: 'tavily', ok: false, detail: 'tavily extract returned no content' });
      return null;
    }
    if (looksBlocked(content)) {
      attempts.push({ tier: 'tavily', ok: false, detail: 'tavily returned a bot-challenge interstitial — not bypassing, falling through', status: res.status });
      return null;
    }
    attempts.push({ tier: 'tavily', ok: true, detail: `tavily extract — ${content.length} chars`, status: res.status });
    return { winningTier: 'tavily', finalUrl: parsed.href, status: res.status, contentType: 'text/plain', content: content.slice(0, opts.maxBytes), structure: structureFromMarkdown(content, parsed.host) };
  } catch (e) {
    attempts.push({ tier: 'tavily', ok: false, detail: `tavily extract error: ${(e as Error).message}` });
    return null;
  }
}

async function tierArchive(parsed: URL, opts: ResolvedOptions, attempts: FetchAttempt[]): Promise<TierOutcome> {
  const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(parsed.href)}`;
  const avail = await doGet(availUrl, { ...opts, respectRobots: false }, { accept: 'application/json' });
  if ('error' in avail) {
    attempts.push({ tier: 'archive', ok: false, detail: `wayback lookup failed: ${avail.error}` });
    return null;
  }
  let snapshotUrl: string | undefined;
  let timestamp: string | undefined;
  try {
    const json = JSON.parse(avail.body) as { archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } } };
    const closest = json.archived_snapshots?.closest;
    if (closest?.available && closest.url) {
      snapshotUrl = closest.url;
      timestamp = closest.timestamp;
    }
  } catch {
    /* fall through */
  }
  if (!snapshotUrl) {
    attempts.push({ tier: 'archive', ok: false, detail: 'no Wayback snapshot available' });
    return null;
  }
  const snap = await doGet(snapshotUrl, { ...opts, respectRobots: false });
  if ('error' in snap) {
    attempts.push({ tier: 'archive', ok: false, detail: `snapshot fetch failed: ${snap.error}`, status: snap.status });
    return null;
  }
  if (looksBlocked(snap.body)) {
    attempts.push({ tier: 'archive', ok: false, detail: 'archived snapshot is itself a challenge page', status: snap.res.status });
    return null;
  }
  const structure = extractStructure(snap.body, snapshotUrl, opts);
  attempts.push({ tier: 'archive', ok: true, detail: `Wayback snapshot ${timestamp ?? ''} — ${structure.wordCount} words`, status: snap.res.status });
  return { winningTier: 'archive', finalUrl: snapshotUrl, status: snap.res.status, contentType: snap.res.headers.get('content-type') ?? undefined, structure };
}

function blockedNote(opts: ResolvedOptions): string {
  const tried = ['direct fetch', opts.allowReader ? 'reader service' : '', opts.tavilyApiKey ? 'Tavily extract' : '', opts.allowArchive ? 'Wayback archive' : '']
    .filter(Boolean)
    .join(', ');
  return `ดึงไม่ได้ด้วยวิธีที่ถูกกติกา (${tried}). หน้านี้อาจต้อง JS render, login, หรือมี anti-bot. Sanook จะไม่ทำ evasion (${REFUSED_TECHNIQUES.join(', ')}) — ลองหา official API / RSS / sitemap หรือขออนุญาตเจ้าของเว็บแทน`;
}

/**
 * Fetch a public web page through an ordered, ethical fallback ladder and return
 * a rough structural understanding of it. Never attempts any REFUSED_TECHNIQUES.
 */
export async function fetchWeb(rawUrl: string, options: WebFetchOptions = {}): Promise<WebFetchResult> {
  const opts = resolveOptions(options);
  const attempts: FetchAttempt[] = [];
  const result: WebFetchResult = { url: rawUrl, ok: false, attempts, refused: REFUSED_TECHNIQUES };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    attempts.push({ tier: 'preflight', ok: false, detail: 'invalid URL' });
    result.note = 'URL ไม่ถูกต้อง';
    return result;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    attempts.push({ tier: 'preflight', ok: false, detail: `unsupported protocol: ${parsed.protocol}` });
    result.note = 'รองรับเฉพาะ http/https';
    return result;
  }
  if (!opts.allowPrivateHosts && isPrivateHost(parsed.hostname)) {
    attempts.push({ tier: 'preflight', ok: false, detail: `blocked internal/loopback host: ${parsed.hostname} (SSRF guard)` });
    result.note = 'host ภายใน/loopback ถูกบล็อกกัน SSRF — ใช้ allowPrivateHosts ถ้าตั้งใจจริง';
    return result;
  }

  if (opts.respectRobots) {
    const allowed = await checkRobots(parsed, opts, attempts);
    if (!allowed) {
      result.note = `robots.txt ของ ${parsed.host} ห้าม fetch path นี้ — เคารพ robots, ไม่ดึงต่อ. ใช้ official API/ขออนุญาตแทน`;
      return result;
    }
  }

  const ladder: ((p: URL, o: ResolvedOptions, a: FetchAttempt[]) => Promise<TierOutcome>)[] = [tierDirect];
  if (opts.allowReader) ladder.push(tierReader);
  if (opts.tavilyApiKey) ladder.push(tierTavily);
  if (opts.allowArchive) ladder.push(tierArchive);

  for (const tier of ladder) {
    const outcome = await tier(parsed, opts, attempts);
    if (outcome) return { ...result, ok: true, ...outcome };
  }

  result.note = blockedNote(opts);
  return result;
}

// ── Tavily search (find sites / front pages) ─────────────────────────────────
export interface TavilySearchHit {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export async function tavilySearch(
  query: string,
  options: { apiKey: string; maxResults?: number; fetchImpl?: FetchImpl; tavilyBase?: string; timeoutMs?: number },
): Promise<TavilySearchHit[]> {
  const fetchImpl = options.fetchImpl ?? DEFAULTS.fetchImpl;
  const base = (options.tavilyBase ?? DEFAULTS.tavilyBase).replace(/\/$/, '');
  const res = await fetchImpl(`${base}/search`, {
    method: 'POST',
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({ query, max_results: options.maxResults ?? 5 }),
  });
  if (!res.ok) throw new Error(`tavily search ${res.status}`);
  const json = JSON.parse(await res.text()) as { results?: TavilySearchHit[] };
  return (json.results ?? []).slice(0, options.maxResults ?? 5);
}

// ── rendering ────────────────────────────────────────────────────────────────
export function renderWebFetchResult(result: WebFetchResult): string {
  const lines: string[] = [`web fetch: ${result.url}`];
  if (result.finalUrl && result.finalUrl !== result.url) lines.push(`final url: ${result.finalUrl}`);
  lines.push(`result: ${result.ok ? `OK via tier "${result.winningTier}"` : 'BLOCKED (no ethical tier succeeded)'}`);
  if (result.status) lines.push(`status: ${result.status}${result.contentType ? ` · ${result.contentType}` : ''}`);

  if (result.structure) {
    const s = result.structure;
    lines.push('', 'structure:');
    if (s.title) lines.push(`  title: ${s.title}`);
    if (s.siteName) lines.push(`  site: ${s.siteName}`);
    if (s.description) lines.push(`  description: ${s.description}`);
    if (s.lang) lines.push(`  lang: ${s.lang}`);
    lines.push(`  words: ${s.wordCount}`);
    if (s.jsonLdTypes.length) lines.push(`  schema.org types: ${s.jsonLdTypes.join(', ')}`);
    if (s.headings.length) {
      lines.push(`  headings (${s.headings.length}):`);
      for (const h of s.headings.slice(0, 10)) lines.push(`    - ${h}`);
    }
    if (s.links.length) {
      lines.push(`  links (${s.links.length}):`);
      for (const l of s.links.slice(0, 10)) lines.push(`    - ${l.text} → ${l.href}`);
    }
    lines.push('', `summary: ${s.summary}`);
  } else if (result.content) {
    lines.push('', `content (${result.content.length} chars), first 600:`, result.content.slice(0, 600));
  }

  lines.push('', 'attempts:');
  for (const a of result.attempts) lines.push(`  ${a.ok ? '✓' : '✗'} ${a.tier}: ${a.detail}`);
  if (result.note) lines.push('', `note: ${result.note}`);
  lines.push('', `never attempted (policy): ${result.refused.join(', ')}`);
  return lines.join('\n');
}
