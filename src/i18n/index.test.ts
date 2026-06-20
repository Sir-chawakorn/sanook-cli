import { describe, expect, it } from 'vitest';
import { detectDefaultLocale, getLocaleCatalog, normalizeLocale } from './index.js';

describe('i18n', () => {
  it('normalizes locale codes', () => {
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('th')).toBe('th');
    expect(normalizeLocale('th-TH')).toBe('th');
    expect(normalizeLocale('fr')).toBe('th');
  });

  it('returns setup strings for both locales', () => {
    expect(getLocaleCatalog('en').setup.stepLanguage).toContain('language');
    expect(getLocaleCatalog('th').setup.stepLanguage).toContain('ภาษา');
  });

  it('detects Thai default from LANG', () => {
    const prev = process.env.LANG;
    process.env.LANG = 'th_TH.UTF-8';
    expect(detectDefaultLocale()).toBe('th');
    process.env.LANG = prev;
  });
});
