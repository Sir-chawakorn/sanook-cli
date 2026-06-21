import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '../brand.js';
import { loadConfig, readGlobalConfigRaw } from '../config.js';
import { listSessions } from '../session.js';
import { loadMcpConfig } from '../mcp.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface DashboardServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  onLog?: (message: string) => void;
}

function dashboardStaticDir(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, 'static');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body)}\n`);
}

async function packageVersion(): Promise<string> {
  if (process.env.npm_package_version) return process.env.npm_package_version;
  try {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'dev';
  } catch {
    return 'dev';
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/status') {
    const config = await loadConfig({});
    const raw = await readGlobalConfigRaw();
    json(res, 200, {
      product: 'Sanook Dashboard',
      cli: BRAND.cliName,
      version: await packageVersion(),
      model: config.model,
      locale: config.locale,
      brainPath: config.brainPath ?? null,
      permissionMode: config.permissionMode,
      gatewayHint: `${BRAND.cliName} serve`,
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    json(res, 200, await readGlobalConfigRaw());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    const sessions = await listSessions({});
    json(res, 200, { sessions });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/mcp') {
    const servers = await loadMcpConfig();
    json(res, 200, { servers });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/brain') {
    const config = await loadConfig({});
    json(res, 200, { brainPath: config.brainPath ?? null });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/cron') {
    const { dashboardCronTasks } = await import('./api-helpers.js');
    json(res, 200, await dashboardCronTasks());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/channels') {
    const { dashboardChannels } = await import('./api-helpers.js');
    json(res, 200, await dashboardChannels());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/logs') {
    const { dashboardLogsTail } = await import('./api-helpers.js');
    json(res, 200, await dashboardLogsTail());
    return true;
  }

  if (req.method === 'GET' && pathname.startsWith('/api/files')) {
    const url = new URL(req.url ?? '/', 'http://local');
    const sub = url.searchParams.get('path') ?? '';
    if (pathname === '/api/files/read') {
      const { dashboardReadFile } = await import('./api-helpers.js');
      json(res, 200, await dashboardReadFile(sub));
      return true;
    }
    const { dashboardListFiles } = await import('./api-helpers.js');
    json(res, 200, await dashboardListFiles(sub));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/skills') {
    const { dashboardSkills } = await import('./api-helpers.js');
    json(res, 200, await dashboardSkills());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/memory') {
    const { dashboardMemory } = await import('./api-helpers.js');
    json(res, 200, await dashboardMemory());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/usage') {
    const { dashboardUsage } = await import('./api-helpers.js');
    json(res, 200, await dashboardUsage());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/self-improve') {
    const { dashboardSelfImprove } = await import('./api-helpers.js');
    json(res, 200, await dashboardSelfImprove());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/install') {
    const { dashboardInstall } = await import('./api-helpers.js');
    json(res, 200, dashboardInstall());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/persona') {
    const { dashboardPersona } = await import('./api-helpers.js');
    json(res, 200, await dashboardPersona());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/terminal/run') {
    const { handleTerminalRun } = await import('./terminal.js');
    await handleTerminalRun(req, res);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/terminal/reset') {
    const url = new URL(req.url ?? '/', 'http://local');
    const { resetTerminalSession } = await import('./terminal.js');
    resetTerminalSession(url.searchParams.get('session') ?? 'web');
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/terminal/shell-status') {
    const { shellStatus } = await import('./terminal.js');
    json(res, 200, await shellStatus());
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/chat/status') {
    json(res, 200, {
      hint: `Use ${BRAND.cliName} in terminal, or start ${BRAND.cliName} serve for HTTP chat`,
      gateway: `${BRAND.cliName} serve`,
    });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const raw = await readBody(req);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || '{}');
    } catch {
      json(res, 400, { error: 'invalid JSON' });
      return true;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      json(res, 400, { error: 'body must be an object' });
      return true;
    }
    const { saveGlobalConfig } = await import('../config.js');
    await saveGlobalConfig(parsed as Record<string, unknown>);
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function serveStatic(res: ServerResponse, staticDir: string, pathname: string): Promise<void> {
  const filePath = dashboardStaticFilePath(staticDir, pathname);
  if (!filePath) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = extname(filePath);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    try {
      const fallback = await readFile(join(staticDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fallback);
    } catch {
      res.writeHead(503);
      res.end('Sanook Dashboard assets missing — run npm run build:dashboard');
    }
  }
}

async function serveInstallScript(res: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname !== '/install.sh' && pathname !== '/install.ps1') return false;
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const name = pathname === '/install.sh' ? 'install.sh' : 'install.ps1';
  try {
    const body = await readFile(join(root, 'scripts', name), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('install script not found');
  }
  return true;
}

export async function startDashboardServer(opts: DashboardServerOptions = {}): Promise<() => void> {
  const port = opts.port ?? 9119;
  const host = opts.host ?? '127.0.0.1';
  const staticDir = opts.staticDir ?? dashboardStaticDir();
  const log = opts.onLog ?? (() => {});

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res, url.pathname);
        if (handled) return;
        json(res, 404, { error: 'not found' });
        return;
      }
      if (req.method === 'GET' && (await serveInstallScript(res, url.pathname))) return;
      await serveStatic(res, staticDir, url.pathname);
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  // raw shell over ws (no-op if node-pty/ws not installed)
  try {
    const { attachShell } = await import('./terminal.js');
    await attachShell(server);
  } catch {
    /* optional */
  }

  log(`Sanook Dashboard — http://${host}:${port}`);
  return () => server.close();
}

export function dashboardStaticRoot(): string {
  return dashboardStaticDir();
}

export function dashboardStaticFilePath(staticDir: string, pathname: string): string | null {
  let safePath: string;
  try {
    safePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    return null;
  }
  const root = resolve(staticDir);
  const filePath = resolve(root, safePath.replace(/^[/\\]+/, ''));
  const rel = relative(root, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return filePath;
}
