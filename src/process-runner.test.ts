import { describe, expect, it } from 'vitest';
import { formatProcessResult, runProcess, safeProcessEnv } from './process-runner.js';

describe('process runner', () => {
  it('runs a process without shell expansion and captures output', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'ok'], {
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(formatProcessResult(result)).toBe('ok');
  });

  it('passes stdin input to the child process', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
      input: 'hello from stdin',
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(true);
    expect(formatProcessResult(result)).toBe('hello from stdin');
  });

  it('returns a structured error for non-zero exit', async () => {
    const result = await runProcess(process.execPath, ['-e', 'console.error("bad"); process.exit(7)'], {
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    expect(formatProcessResult(result)).toContain('exit 7');
    expect(formatProcessResult(result)).toContain('bad');
  });

  it('keeps only safe environment keys', () => {
    expect(safeProcessEnv({ PATH: '/bin', SECRET_TOKEN: 'nope', HOME: '/home/me' })).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
    });
  });

  it('keeps runtime discovery variables needed by spawned language tools', () => {
    expect(
      safeProcessEnv({
        NODE_PATH: '/opt/node_modules',
        NVM_DIR: '/home/me/.nvm',
        TMP: '/tmp',
        API_KEY: 'nope',
      }),
    ).toEqual({
      TMP: '/tmp',
      NODE_PATH: '/opt/node_modules',
      NVM_DIR: '/home/me/.nvm',
    });
  });

  it('keeps Windows runtime variables needed to spawn tools', () => {
    expect(
      safeProcessEnv({
        Path: 'C:\\Windows\\System32',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        SystemRoot: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        USERPROFILE: 'C:\\Users\\pick',
        APPDATA: 'C:\\Users\\pick\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\pick\\AppData\\Local',
        PROGRAMDATA: 'C:\\ProgramData',
        SECRET_TOKEN: 'nope',
        SystemDrive: 'C:',
      }),
    ).toEqual({
      Path: 'C:\\Windows\\System32',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      USERPROFILE: 'C:\\Users\\pick',
      APPDATA: 'C:\\Users\\pick\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\pick\\AppData\\Local',
      PROGRAMDATA: 'C:\\ProgramData',
      SystemDrive: 'C:',
    });
  });

  it('matches safe environment keys case-insensitively', () => {
    expect(
      safeProcessEnv({
        path: '/bin',
        appdata: 'C:\\Users\\pick\\AppData\\Roaming',
        secret_token: 'nope',
      }),
    ).toEqual({
      path: '/bin',
      appdata: 'C:\\Users\\pick\\AppData\\Roaming',
    });
  });
});
