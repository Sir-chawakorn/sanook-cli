import type { ProviderConfig } from './registry.js';
import { isCodexChatGptSupportedModel, normalizeCodexChatGptModel } from './codex.js';

function curatedModels(cfg: ProviderConfig): Record<string, string> {
  if (cfg.id !== 'codex') return cfg.models;
  const out: Record<string, string> = {};
  for (const [alias, id] of Object.entries(cfg.models)) {
    const model = normalizeCodexChatGptModel(id).model;
    if (isCodexChatGptSupportedModel(model)) out[alias] = model;
  }
  return out;
}

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

    const base = process.env[`${cfg.id.toUpperCase()}_BASE_URL`]?.trim() || cfg.baseURL?.trim();
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
 * dedup ด้วย model id — alias หลายตัวที่ชี้ id เดียวกัน (เช่น haiku/fast → claude-haiku-4-5,
 * smart/gpt → gpt-5.5) ต้องรวมเป็น "haiku / fast — id" บรรทัดเดียว ไม่งั้น value ซ้ำ → React key ชน
 * → ตัวเลือกโผล่ซ้ำ/หาย (bug "มีตัวเลือกสองตัวเลือกเป็น model เดียวกัน"). ใช้ทั้ง setup wizard และ /model picker
 */
export function mergeModelOptions(cfg: ProviderConfig, remote: string[] = []): ModelOption[] {
  const models = curatedModels(cfg);
  // group alias ทั้งหมดตาม id (รวม 'default' ด้วย — กัน id ที่มีแต่ alias 'default' เช่น lmstudio:local-model,
  // ollama:llama3.3 หายไปจนเลือกไม่ได้/Select ว่าง). ตอนทำ label ค่อยซ่อนคำ "default" ถ้ามีชื่ออื่นอยู่แล้ว
  const aliasesById = new Map<string, string[]>();
  const order: string[] = []; // คง first-seen order ของ id
  for (const [alias, id] of Object.entries(models)) {
    if (!aliasesById.has(id)) {
      aliasesById.set(id, []);
      order.push(id);
    }
    aliasesById.get(id)?.push(alias);
  }
  const curated = order.map((id) => {
    const aliases = aliasesById.get(id) ?? [];
    const named = aliases.filter((a) => a !== 'default');
    const shown = named.length ? named : aliases; // มีแต่ 'default' → โชว์ 'default' (ดีกว่าซ่อน id หายไป)
    return { id, label: `${shown.join(' / ')} — ${id}` };
  });
  const seen = new Set(order);
  const extra =
    cfg.id === 'codex'
      ? []
      : [...new Set(remote)].filter((id) => id && !seen.has(id)).map((id) => ({ id, label: id }));
  return [...curated, ...extra].map((o) => ({ label: o.label, value: o.id }));
}
