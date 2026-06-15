import { describe, it, expect } from 'vitest';
import { isOnPath, formatReport, type DoctorReport } from './doctor.js';

const sep = process.platform === 'win32' ? ';' : ':';
const base = (over: Partial<DoctorReport> = {}): DoctorReport => ({
  node: 'v22.5.0',
  nodeOk: true,
  binDir: '/usr/local/bin',
  globalInstalled: true,
  onPath: true,
  localInstall: false,
  isWin: false,
  ...over,
});

describe('isOnPath', () => {
  it('true when binDir is a PATH entry', () => {
    expect(isOnPath('/usr/local/bin', ['/bin', '/usr/local/bin', '/opt'].join(sep))).toBe(true);
  });
  it('false when absent', () => {
    expect(isOnPath('/usr/local/bin', ['/bin', '/opt'].join(sep))).toBe(false);
  });
  it('ignores trailing slash differences', () => {
    expect(isOnPath('/usr/local/bin/', ['/usr/local/bin'].join(sep))).toBe(true);
  });
  it('empty binDir → false', () => {
    expect(isOnPath('', '/usr/local/bin')).toBe(false);
  });
  it('undefined PATH → false', () => {
    expect(isOnPath('/usr/local/bin', undefined)).toBe(false);
  });
});

describe('formatReport', () => {
  it('ready state → "พร้อมใช้", no remedy', () => {
    const out = formatReport(base(), 'sanook-cli');
    expect(out).toContain('พร้อมใช้');
    expect(out).not.toContain('npm install -g');
  });

  it('not installed globally → suggests -g install', () => {
    const out = formatReport(base({ globalInstalled: false, onPath: false }), 'sanook-cli');
    expect(out).toContain('npm install -g sanook-cli');
  });

  it('installed but not on PATH (Windows) → safe PowerShell remedy, not setx %PATH%', () => {
    const out = formatReport(
      base({ isWin: true, onPath: false, binDir: 'C:\\Users\\me\\AppData\\Roaming\\npm' }),
      'sanook-cli',
    );
    expect(out).toContain('SetEnvironmentVariable');
    expect(out).toContain('C:\\Users\\me\\AppData\\Roaming\\npm');
    expect(out).not.toContain('setx'); // footgun ห้ามแนะนำ
  });

  it('installed but not on PATH (Unix) → export PATH remedy', () => {
    const out = formatReport(base({ onPath: false, binDir: '/home/me/.npm-global/bin' }), 'sanook-cli');
    expect(out).toContain('export PATH=');
    expect(out).toContain('/home/me/.npm-global/bin');
  });

  it('local install present → offers npx', () => {
    const out = formatReport(base({ globalInstalled: false, onPath: false, localInstall: true }), 'sanook-cli');
    expect(out).toContain('npx sanook');
  });

  it('old Node → flags version', () => {
    const out = formatReport(base({ node: 'v18.0.0', nodeOk: false }), 'sanook-cli');
    expect(out).toContain('≥ 22');
  });
});
