import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { checkForUpdate, compareVersions, installLatest, isNewerVersion, shouldCheckForUpdate } from './update.js';

describe('CLI update', () => {
  it('compareVersions handles semver core and prerelease ordering', () => {
    expect(compareVersions('0.4.1', '0.4.0')).toBe(1);
    expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
    expect(compareVersions('0.4.0', '0.4.1')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(isNewerVersion('0.5.0', '0.4.0')).toBe(true);
    expect(isNewerVersion('0.4.0', '0.4.0')).toBe(false);
  });

  it('checkForUpdate reads npm latest dist-tag and builds the update command', async () => {
    const seen: { url?: string; accept?: string } = {};
    const check = await checkForUpdate(
      { name: 'sanook-cli', version: '0.4.0' },
      {
        registry: 'https://registry.example.test/',
        fetchImpl: async (url, init) => {
          seen.url = url;
          seen.accept = init?.headers?.accept;
          return {
            ok: true,
            status: 200,
            json: async () => ({ 'dist-tags': { latest: '0.5.0' } }),
          };
        },
      },
    );

    expect(seen.url).toBe('https://registry.example.test/sanook-cli');
    expect(seen.accept).toBe('application/vnd.npm.install-v1+json');
    expect(check).toEqual({
      packageName: 'sanook-cli',
      currentVersion: '0.4.0',
      latestVersion: '0.5.0',
      isOutdated: true,
      installCommand: 'npm install -g sanook-cli@latest',
    });
  });

  it('checkForUpdate reports current when latest is not newer', async () => {
    const check = await checkForUpdate(
      { name: 'sanook-cli', version: '0.5.0' },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ 'dist-tags': { latest: '0.5.0' } }),
        }),
      },
    );

    expect(check.isOutdated).toBe(false);
  });

  it('checkForUpdate encodes scoped package names for npm registry lookups', async () => {
    const seen: { url?: string } = {};
    await checkForUpdate(
      { name: '@scope/sanook-cli', version: '0.4.0' },
      {
        registry: 'https://registry.example.test/',
        fetchImpl: async (url) => {
          seen.url = url;
          return {
            ok: true,
            status: 200,
            json: async () => ({ 'dist-tags': { latest: '0.5.0' } }),
          };
        },
      },
    );

    expect(seen.url).toBe('https://registry.example.test/@scope%2Fsanook-cli');
  });

  it('shouldCheckForUpdate throttles interactive notifier checks', () => {
    const now = Date.parse('2026-06-15T12:00:00Z');
    expect(shouldCheckForUpdate(undefined, now)).toBe(true);
    expect(shouldCheckForUpdate({}, now)).toBe(true);
    expect(shouldCheckForUpdate({ checkedAt: 'not-a-date' }, now)).toBe(true);
    expect(shouldCheckForUpdate({ checkedAt: '2026-06-16T00:00:00Z' }, now)).toBe(true);
    expect(shouldCheckForUpdate({ checkedAt: '2026-06-15T00:30:00Z' }, now)).toBe(false);
    expect(shouldCheckForUpdate({ checkedAt: '2026-06-14T11:59:59Z' }, now)).toBe(true);
  });

  it('installLatest runs npm install -g package@latest', async () => {
    const calls: { command: string; args: string[]; stdio: string }[] = [];
    const codePromise = installLatest(
      { name: 'sanook-cli', version: '0.4.0' },
      {
        spawnImpl: (command, args, options) => {
          calls.push({ command, args, stdio: options.stdio });
          const child = new EventEmitter() as ChildProcess;
          queueMicrotask(() => child.emit('close', 0));
          return child;
        },
      },
    );

    await expect(codePromise).resolves.toBe(0);
    expect(calls).toEqual([{ command: 'npm', args: ['install', '-g', 'sanook-cli@latest'], stdio: 'inherit' }]);
  });
});
