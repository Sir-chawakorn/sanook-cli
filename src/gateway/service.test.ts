import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('gateway service manager', () => {
  let home: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    vi.resetModules();
    realHome = process.env.HOME;
    home = await mkdtemp(join(tmpdir(), 'sanook-service-'));
    process.env.HOME = home;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (realHome !== undefined) process.env.HOME = realHome;
    else delete process.env.HOME;
    await rm(home, { recursive: true, force: true });
  });

  it('starts a detached gateway run process and writes service state', async () => {
    const { gatewayServiceLogPath, gatewayServiceStatus, startGatewayService } = await import('./service.js');
    const child = { pid: 4242, unref: vi.fn() };
    const spawnFn = vi.fn(() => child);
    vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
      if (pid === 4242 && signal === 0) return true;
      return true;
    });

    const res = await startGatewayService({
      command: process.execPath,
      entrypoint: '/tmp/sanook/dist/bin.js',
      gatewayArgs: ['--port', '9999'],
      spawnFn: spawnFn as never,
    });

    expect(res.started).toBe(true);
    expect(res.state.pid).toBe(4242);
    expect(res.state.args).toEqual(['/tmp/sanook/dist/bin.js', 'gateway', 'run', '--port', '9999']);
    expect(res.state.logPath).toBe(gatewayServiceLogPath());
    expect(child.unref).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledWith(
      process.execPath,
      ['/tmp/sanook/dist/bin.js', 'gateway', 'run', '--port', '9999'],
      expect.objectContaining({ detached: true }),
    );
    await expect(gatewayServiceStatus()).resolves.toMatchObject({ running: true });
  });

  it('writes a platform service file for install', async () => {
    const { installGatewayService } = await import('./service.js');
    const entrypoint = join(home, 'Project & Stuff', 'dist', 'bin.js');
    const res = await installGatewayService(entrypoint);
    const contents = await readFile(res.path, 'utf8');
    expect(res.path.startsWith(home)).toBe(true);
    expect(res.instructions.length).toBeGreaterThan(0);
    if (res.kind === 'launchd') {
      expect(contents).toContain('Project &amp; Stuff');
      expect(contents).not.toContain('Project & Stuff');
    } else if (res.kind === 'systemd') {
      expect(contents).toContain(`"${entrypoint}"`);
    } else {
      expect(contents).toContain(`"${entrypoint}"`);
    }
  });
});
