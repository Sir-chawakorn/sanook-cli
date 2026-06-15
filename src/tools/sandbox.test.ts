import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeSandbox } from './sandbox.js';

describe('maybeSandbox', () => {
  let home: string;

  beforeEach(() => {
    // HOME = temp ว่าง → getBrainPath คืน null (ไม่แตะ config จริงของ user)
    home = mkdtempSync(join(tmpdir(), 'sanook-sbhome-'));
    vi.stubEnv('HOME', home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it('ปิดด้วย SANOOK_NO_SANDBOX=1 → null', async () => {
    vi.stubEnv('SANOOK_NO_SANDBOX', '1');
    expect(await maybeSandbox('ls', process.cwd())).toBeNull();
  });

  it('SANOOK_ALLOW_OUTSIDE_WORKSPACE=1 → null (อนุญาตนอก workspace แล้ว = ไม่ sandbox)', async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    expect(await maybeSandbox('ls', process.cwd())).toBeNull();
  });

  it('darwin ที่มี sandbox-exec → seatbelt args ที่ confine cwd + ส่ง cmd เข้า /bin/sh', async () => {
    if (process.platform !== 'darwin') return;
    const sb = await maybeSandbox('echo hi', process.cwd());
    if (!sb) return; // CI อาจไม่มี sandbox-exec
    expect(sb.file).toContain('sandbox-exec');
    expect(sb.args).toContain('echo hi');
    expect(sb.args).toContain('-c');
    expect(sb.args.join('\n')).toContain('file-write'); // มี write-confinement profile
    expect(sb.args.join('\n')).toContain(process.cwd());
  });
});
