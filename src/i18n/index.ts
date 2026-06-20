import { en } from './en.js';
import { th } from './th.js';
import type { AppLocale, LocaleCatalog } from './types.js';

export type { AppLocale, LocaleCatalog, SetupMessages, DashboardMessages } from './types.js';

const CATALOGS: Record<AppLocale, LocaleCatalog> = { en, th };

export const SUPPORTED_LOCALES: AppLocale[] = ['en', 'th'];

export function normalizeLocale(raw: unknown): AppLocale {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === 'en' || v.startsWith('en-')) return 'en';
  if (v === 'th' || v.startsWith('th-')) return 'th';
  return 'th';
}

export function getLocaleCatalog(locale: AppLocale): LocaleCatalog {
  return CATALOGS[locale] ?? CATALOGS.th;
}

export function detectDefaultLocale(): AppLocale {
  const lang = process.env.LANG ?? process.env.LC_ALL ?? process.env.LC_MESSAGES ?? '';
  return lang.toLowerCase().includes('th') ? 'th' : 'en';
}
