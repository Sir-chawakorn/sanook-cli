import type { ProviderConfig } from './registry.js';

export interface ModelOption {
  label: string;
  value: string; // model id จริงที่ส่งให้ provider
}

/**
 * ดึงรายชื่อ model จริงจาก provider (GET /models) — "เลือกโมเดลที่เจ้าของมี" แบบ Hermes
 * - provider เป็นคน authoritative เรื่อง id (เราไม่ต้อง hardcode/เดา id ที่อาจ stale)
 * - คืน [] ถ้า fail/timeout/local/ไม่มี endpoint → caller fallback เป็น curated alias
 * - shape ต่าง 3 แบบ: google (?key=, models[].name) · anthropic (x-api-key) · OpenAI-compat (Bearer, data[].id)
 */
export async function listRemoteModels(
  cfg: ProviderConfig,
  key?: string,
  timeoutMs = 6000,
): Promise<string[]> {
  if (cfg.kind === 'delegate') return []; // codex = subprocess, ไม่มี /models
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Google — endpoint + shape คนละแบบ (query key, models[].name, มี supportedGenerationMethods)
    if (cfg.id === 'google') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key ?? '')}`;
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) return [];
      const j = (await r.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };
      return (j.models ?? [])
        .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    }

    const base = process.env[`${cfg.id.toUpperCase()}_BASE_URL`] ?? cfg.baseURL;
    if (!base) return []; // ไม่มี baseURL = ดึงไม่ได้
    const headers: Record<string, string> =
      cfg.id === 'anthropic'
        ? { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${key ?? cfg.localPlaceholderKey ?? ''}` };

    const r = await fetch(`${base.replace(/\/+$/, '')}/models`, { headers, signal: ctrl.signal });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: { id?: string }[] };
    return (j.data ?? []).map((m) => m.id ?? '').filter(Boolean);
  } catch {
    return []; // network / timeout / abort / JSON พัง → เงียบ, fallback curated
  } finally {
    clearTimeout(timer);
  }
}

/**
 * merge: curated alias (registry — มี label สื่อความหมาย) นำหน้า + remote id ที่เหลือต่อท้าย
 * dedup ด้วย model id (ไม่โชว์ id ซ้ำสองครั้ง). ใช้ทั้ง setup wizard และ /model picker
 */
export function mergeModelOptions(cfg: ProviderConfig, remote: string[] = []): ModelOption[] {
  const curated = Object.entries(cfg.models)
    .filter(([alias]) => alias !== 'default')
    .map(([alias, id]) => ({ id, label: `${alias} — ${id}` }));
  const seen = new Set(curated.map((c) => c.id));
  const extra = remote.filter((id) => !seen.has(id)).map((id) => ({ id, label: id }));
  return [...curated, ...extra].map((o) => ({ label: o.label, value: o.id }));
}
