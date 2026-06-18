import { describe, expect, it } from 'vitest';
import {
  optionalString,
  parseBearerToken,
  parseOptionalDeliverTarget,
  parseOptionalSchedule,
  parseOptionalTaskModel,
  parseRequiredTaskSpec,
  parseWebhookRouteName,
} from './server.js';

describe('gateway server input normalization', () => {
  it('accepts bearer auth schemes case-insensitively while preserving the token', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('Bearer   abc123')).toBe('abc123');
    expect(parseBearerToken('bearer abc123')).toBe('abc123');
    expect(parseBearerToken('BEARER AbC123')).toBe('AbC123');
    expect(parseBearerToken('Basic abc123')).toBeUndefined();
    expect(parseBearerToken('Bearer')).toBeUndefined();
    expect(parseBearerToken('Bearer ')).toBeUndefined();
    expect(parseBearerToken('Bearer   ')).toBeUndefined();
    expect(parseBearerToken('Bearer abc123 ')).toBeUndefined();
    expect(parseBearerToken('Bearer abc 123')).toBeUndefined();
    expect(parseBearerToken(undefined)).toBeUndefined();
  });

  it('decodes valid webhook route paths and rejects malformed route paths', () => {
    expect(parseWebhookRouteName('/webhooks/issues')).toBe('issues');
    expect(parseWebhookRouteName('/webhooks/%2Fdeploy-prod%2F')).toBe('deploy-prod');
    expect(parseWebhookRouteName('/tasks')).toBeUndefined();
    expect(parseWebhookRouteName('/webhooks/')).toBeUndefined();
    expect(parseWebhookRouteName('/webhooks/bad/route')).toBeUndefined();
    expect(parseWebhookRouteName('/webhooks/%E0%A4%A')).toBeUndefined();
  });

  it('trims optional strings and drops blanks', () => {
    expect(optionalString('  openai:gpt-5.5  ')).toBe('openai:gpt-5.5');
    expect(optionalString('   ')).toBeUndefined();
    expect(optionalString(undefined)).toBeUndefined();
    expect(optionalString(123)).toBeUndefined();
  });

  it('requires task specs to be nonblank strings', () => {
    expect(parseRequiredTaskSpec('  ship the build  ')).toEqual({ spec: 'ship the build' });
    expect(parseRequiredTaskSpec('   ')).toEqual({ invalid: 'ต้องมี spec' });
    expect(parseRequiredTaskSpec(undefined)).toEqual({ invalid: 'ต้องมี spec' });
    expect(parseRequiredTaskSpec(null)).toEqual({ invalid: 'ต้องมี spec' });
  });

  it('rejects explicit non-string task specs instead of stringifying them', () => {
    for (const value of [0, false, [], {}]) {
      expect(parseRequiredTaskSpec(value)).toEqual({ invalid: 'spec ต้องเป็นข้อความ' });
    }
  });

  it('treats blank schedule strings as absent but rejects invalid nonblank schedules', () => {
    const now = Date.UTC(2026, 5, 14, 12, 0, 0);

    expect(parseOptionalSchedule('   ', now)).toEqual({ schedule: null });
    expect(parseOptionalSchedule(undefined, now)).toEqual({ schedule: null });
    expect(parseOptionalSchedule(null, now)).toEqual({ schedule: null });
    expect(parseOptionalSchedule('not a schedule', now)).toEqual({
      schedule: null,
      invalid: 'not a schedule',
    });
    expect(parseOptionalSchedule('  not a schedule  ', now)).toEqual({
      schedule: null,
      invalid: 'not a schedule',
    });
    expect(parseOptionalSchedule(' every 5m ', now).schedule?.normalized).toBe('every 5m');
  });

  it('rejects explicit non-string schedules instead of dropping them', () => {
    const now = Date.UTC(2026, 5, 14, 12, 0, 0);

    for (const value of [0, false, [], {}]) {
      expect(parseOptionalSchedule(value, now)).toEqual({ schedule: null, invalid: 'ต้องเป็นข้อความ' });
    }
  });

  it('normalizes optional delivery targets for /tasks', () => {
    expect(parseOptionalDeliverTarget('   ')).toEqual({});
    expect(parseOptionalDeliverTarget(undefined)).toEqual({});
    expect(parseOptionalDeliverTarget(null)).toEqual({});
    expect(parseOptionalDeliverTarget(' Slack : C01ABC ')).toEqual({ deliver: 'slack:C01ABC' });
    expect(parseOptionalDeliverTarget('line:U1234567890abcdef')).toEqual({ deliver: 'line:U1234567890abcdef' });
    expect(parseOptionalDeliverTarget('sms:+15551234567')).toEqual({ deliver: 'sms:+15551234567' });
    expect(parseOptionalDeliverTarget('whatsapp:+1 (555) 123-4567')).toEqual({ deliver: 'whatsapp:15551234567' });
  });

  it('rejects explicit non-string delivery targets instead of dropping them', () => {
    for (const value of [0, false, [], {}]) {
      expect(parseOptionalDeliverTarget(value)).toEqual({ invalid: 'deliver ต้องเป็นข้อความ' });
    }
  });

  it('normalizes optional task models and rejects explicit non-string models', () => {
    expect(parseOptionalTaskModel('   ')).toEqual({});
    expect(parseOptionalTaskModel(undefined)).toEqual({});
    expect(parseOptionalTaskModel(null)).toEqual({});
    expect(parseOptionalTaskModel(' openai:gpt-5.5 ')).toEqual({ model: 'openai:gpt-5.5' });

    for (const value of [0, false, [], {}]) {
      expect(parseOptionalTaskModel(value)).toEqual({ invalid: 'model ต้องเป็นข้อความ' });
    }
  });
});
