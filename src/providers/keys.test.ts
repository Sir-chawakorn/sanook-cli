import { afterEach, describe, it, expect, vi } from 'vitest';
import { assertDirectApiKey, redactKey, redactUnknown, resolveKeyFromEnv } from './keys.js';

const anthropic = { label: 'Anthropic', keyFormat: /^sk-ant-api\d{2}-/, oauthRejectPrefixes: ['sk-ant-oat'] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveKeyFromEnv', () => {
  it('trims env values and skips whitespace-only values before trying fallbacks', () => {
    vi.stubEnv('SANOOK_PRIMARY_KEY', '   ');
    vi.stubEnv('SANOOK_FALLBACK_KEY', '  sk-from-fallback  ');

    expect(resolveKeyFromEnv('SANOOK_PRIMARY_KEY', ['SANOOK_FALLBACK_KEY'])).toBe('sk-from-fallback');
  });
});

describe('assertDirectApiKey (BYOK / OAuth-reject compliance)', () => {
  it('reject OAuth/subscription token (กันบัญชีโดนแบน)', () => {
    expect(() => assertDirectApiKey(anthropic, 'sk-ant-oat01-xxxxxxxx')).toThrow(/OAuth|subscription/i);
  });
  it('accept API key ที่ format ถูก', () => {
    expect(() => assertDirectApiKey(anthropic, 'sk-ant-api03-abcdefghij')).not.toThrow();
  });
  it('reject format ผิด', () => {
    expect(() => assertDirectApiKey(anthropic, 'not-a-real-key')).toThrow(/format/i);
  });
  it('opaque provider (keyFormat null) ผ่าน', () => {
    expect(() => assertDirectApiKey({ label: 'OpaqueProvider', keyFormat: null }, '2b40.xyz')).not.toThrow();
  });
});

describe('redactKey (กัน key รั่วใน log/error/telegram)', () => {
  it('redact key ทุกค่าย รวม opaque', () => {
    expect(redactKey('err sk-ant-api03-secretsecret123 x')).not.toContain('secretsecret123');
    expect(redactKey('AIzaSyABCDEFGH1234567890')).not.toContain('AIzaSyABCDEFGH1234567890');
    expect(redactKey('xai-abcdefghij1234567890')).not.toContain('abcdefghij1234567890');
    expect(redactKey('gsk_abcdefghij1234567890')).not.toContain('abcdefghij1234567890');
    // opaque key (ไม่มี prefix) ต้องโดน catch-all redact ด้วย
    expect(redactKey('2b4057ac80224b6b829330f7c90d2135')).not.toContain('2b4057ac80224b6b829330f7c90d2135');
  });
  it('ไม่ทำลาย prose ปกติ', () => {
    expect(redactKey('hello world this task failed')).toBe('hello world this task failed');
  });
  it('redacts nested object keys and values', () => {
    const redacted = redactUnknown({
      safe: ['keep', { 'sk-test1234567890abcdef': 'key sk-test1234567890abcdef' }],
    });
    const safeJson = JSON.stringify(redacted);

    expect(safeJson).toContain('sk-t…ef');
    expect(safeJson).not.toContain('sk-test1234567890abcdef');
  });
  it('redacts circular object graphs without recursing forever', () => {
    const circular: Record<string, unknown> = {
      'sk-test1234567890abcdef': 'key sk-test1234567890abcdef',
    };
    circular.self = circular;

    const safeJson = JSON.stringify(redactUnknown(circular));

    expect(safeJson).toContain('[Circular]');
    expect(safeJson).toContain('sk-t…ef');
    expect(safeJson).not.toContain('sk-test1234567890abcdef');
  });
  it('does not treat repeated acyclic objects as circular references', () => {
    const shared = {
      'sk-test1234567890abcdef': 'key sk-test1234567890abcdef',
    };

    const safeJson = JSON.stringify(redactUnknown({ first: shared, second: shared }));

    expect(safeJson).not.toContain('[Circular]');
    expect(safeJson).toContain('sk-t…ef');
    expect(safeJson).not.toContain('sk-test1234567890abcdef');
  });
});
