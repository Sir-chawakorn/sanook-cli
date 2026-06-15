import type { EmbeddingModel, LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { resolveKeyFromEnv, assertDirectApiKey, type KeyPolicy } from './keys.js';

export interface ProviderConfig extends KeyPolicy {
  id: string;
  label: string;
  /** 'sdk' (default) = ผ่าน Vercel AI SDK loop · 'delegate' = spawn subprocess agent (codex) */
  kind?: 'sdk' | 'delegate';
  envVar: string;
  envFallbacks?: readonly string[];
  baseURL?: string;
  /** cloud BYOK = true; local (ollama/lmstudio) = false */
  requiresKey: boolean;
  /** key ปลอมสำหรับ local server ที่ client บังคับมี key */
  localPlaceholderKey?: string;
  /** alias → model id จริง (ต้องมี key 'default') — model id ตาม provider docs ล่าสุด, user override ด้วย "provider:full-id" ได้เสมอ */
  models: Record<string, string>;
  /** factory: (key, baseURL) → (modelId) → LanguageModel */
  create: (key: string, baseURL?: string) => (modelId: string) => LanguageModel;
  note?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// PROVIDER TABLE — เพิ่มค่าย = เพิ่ม 1 entry (loop/cost/keys ไม่ต้องแตะ)
// auth/format/OAuth-reject verify มิ.ย. 2026 (ดู Research/provider-connect-matrix)
// ────────────────────────────────────────────────────────────────────────────
export const PROVIDERS: Record<string, ProviderConfig> = {
  // ── ToS-sensitive: Anthropic/Google แบน OAuth/subscription reuse ────────────
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1',
    requiresKey: true,
    keyFormat: /^sk-ant-api\d{2}-/,
    oauthRejectPrefixes: ['sk-ant-oat'], // Claude.ai subscription OAuth → banned
    models: {
      default: 'claude-opus-4-8',
      opus: 'claude-opus-4-8',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
      fast: 'claude-haiku-4-5',
      fable: 'claude-fable-5',
    },
    create: (key, baseURL) => createAnthropic({ apiKey: key, baseURL }),
    note: 'API key only (x-api-key, sk-ant-api03-). ห้าม reuse Claude.ai OAuth — banned',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    envFallbacks: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    requiresKey: true,
    keyFormat: /^AIza[0-9A-Za-z_-]{35}$/,
    oauthRejectPrefixes: ['ya29.', 'AQ.'], // Google OAuth / restricted token → banned
    models: {
      default: 'gemini-2.5-pro',
      pro: 'gemini-2.5-pro',
      flash: 'gemini-2.5-flash',
      gemini: 'gemini-2.5-pro',
    },
    create: (key) => createGoogleGenerativeAI({ apiKey: key }),
    note: 'AI Studio key (AIza). restrict เป็น Gemini-only. ห้าม reuse Gemini CLI OAuth',
  },

  // ── Cloud BYOK: commercial OK, ไม่มี OAuth landmine ─────────────────────────
  openai: {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    requiresKey: true,
    keyFormat: /^sk-/,
    models: {
      default: 'gpt-5.5',
      smart: 'gpt-5.5',
      fast: 'gpt-5.4-mini',
      gpt: 'gpt-5.5',
      codex: 'gpt-5.3-codex', // coding-tuned (gpt-5-codex deprecated มิ.ย. 2026 — doc audit); เรียกผ่าน OpenAI API ปกติ
    },
    create: (key, baseURL) => createOpenAI({ apiKey: key, baseURL }),
    note: 'Bearer key. org/project ผ่าน env. ห้าม reuse ChatGPT/Codex OAuth',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    requiresKey: true,
    keyFormat: null, // opaque sk- → ข้าม format check
    // V4 ids (doc audit มิ.ย. 2026): deepseek-chat/deepseek-reasoner เลิกใช้ 2026-07-24 → redirect มา V4 (dual thinking-mode)
    models: { default: 'deepseek-v4-flash', smart: 'deepseek-v4-pro', fast: 'deepseek-v4-flash' },
    create: (key) => createDeepSeek({ apiKey: key }),
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    envVar: 'XAI_API_KEY',
    requiresKey: true,
    keyFormat: /^xai-[A-Za-z0-9]{16,}$/,
    // grok-4 (snapshot grok-4-0709) retired 2026-05-15 → redirect grok-4.3 (doc audit มิ.ย. 2026)
    models: { default: 'grok-4.3', smart: 'grok-4.3', grok: 'grok-4.3' },
    create: (key) => createXai({ apiKey: key }),
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    envVar: 'MISTRAL_API_KEY',
    requiresKey: true,
    keyFormat: null,
    models: { default: 'mistral-large-latest', smart: 'mistral-large-latest', fast: 'mistral-small-latest' },
    create: (key) => createMistral({ apiKey: key }),
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    requiresKey: true,
    keyFormat: /^gsk_[A-Za-z0-9]{20,}$/,
    models: { default: 'llama-3.3-70b-versatile', fast: 'llama-3.3-70b-versatile' },
    create: (key) => createGroq({ apiKey: key }),
  },

  // ── Local: OpenAI-compatible, ไม่ต้อง key (placeholder ถ้า client บังคับ) ────
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    envVar: 'OLLAMA_BASE_URL',
    baseURL: 'http://localhost:11434/v1', // /v1 (generic OpenAI-compat) ไม่ใช่ /api
    requiresKey: false,
    localPlaceholderKey: 'ollama',
    keyFormat: null,
    models: { default: 'qwen3', llama: 'llama3.3' },
    create: (key, baseURL) =>
      createOpenAICompatible({ name: 'ollama', apiKey: key, baseURL: baseURL ?? 'http://localhost:11434/v1' }),
    note: 'OpenAI-compat /v1 endpoint. ไม่ต้อง key',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    envVar: 'LMSTUDIO_BASE_URL',
    baseURL: 'http://localhost:1234/v1',
    requiresKey: false,
    localPlaceholderKey: 'lm-studio',
    keyFormat: null,
    models: { default: 'local-model' },
    create: (key, baseURL) =>
      createOpenAICompatible({ name: 'lmstudio', apiKey: key, baseURL: baseURL ?? 'http://localhost:1234/v1' }),
    note: 'ต้อง Start Server ในแอปก่อน; โหลด model เดียว ใส่ id อะไรก็ serve ตัวนั้น',
  },

  // ── Cloud BYOK (OpenAI-compatible, จีน — data residency, ไม่มี OAuth landmine) ──
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    envVar: 'MINIMAX_API_KEY',
    baseURL: 'https://api.minimax.io/v1',
    requiresKey: true,
    keyFormat: null, // opaque
    models: { default: 'MiniMax-M2.7', smart: 'MiniMax-M3', fast: 'MiniMax-M2.7' },
    create: (key, baseURL) =>
      createOpenAICompatible({ name: 'minimax', apiKey: key, baseURL: baseURL ?? 'https://api.minimax.io/v1' }),
    note: 'OpenAI-compat /v1. data จีน. MINIMAX_BASE_URL override (intl ↔ api.minimaxi.com/v1)',
  },
  glm: {
    id: 'glm',
    label: 'GLM (z.ai / Zhipu Coding Plan)',
    envVar: 'ZHIPU_API_KEY',
    envFallbacks: ['ZAI_API_KEY', 'GLM_API_KEY'],
    // Coding Plan (subscription) ใช้ Anthropic Messages API — เหมือนที่ต่อกับ Claude Code.
    // pay-as-you-go /paas/v4 (OpenAI-compat) มีแค่ glm-4.5-flash ฟรี ที่เหลือ 429 ถ้าไม่มี balance
    baseURL: 'https://api.z.ai/api/anthropic/v1',
    requiresKey: true,
    keyFormat: null, // opaque ({id}.{secret})
    models: { default: 'glm-4.6', smart: 'glm-5.1', air: 'glm-4.5-air', glm: 'glm-4.6' },
    create: (key, baseURL) =>
      createAnthropic({ apiKey: key, baseURL: baseURL ?? 'https://api.z.ai/api/anthropic/v1' }),
    note: 'z.ai Coding Plan ผ่าน Anthropic Messages API. GLM_BASE_URL override → open.bigmodel.cn/api/anthropic/v1 (จีน)',
  },

  // ── Delegate: OpenAI Codex ผ่าน ChatGPT plan quota (wrap official codex CLI, ToS-safe) ──
  codex: {
    id: 'codex',
    label: 'OpenAI Codex (ChatGPT plan)',
    kind: 'delegate',
    envVar: 'CODEX_HOME', // ไม่ใช้ API key — codex login จัดการ auth เอง
    requiresKey: false,
    localPlaceholderKey: 'codex',
    keyFormat: null,
    models: { default: 'gpt-5-codex', codex: 'gpt-5-codex' },
    create: () => {
      throw new Error('codex เป็น delegate provider — ใช้ผ่าน codex subprocess ไม่ใช่ Vercel AI SDK');
    },
    note: 'ใช้ ChatGPT plan quota ผ่าน official codex CLI (ToS-safe, ไม่เก็บ credential). ต้อง codex login ก่อน',
  },
};

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDERS);

// alias สั้นข้าม provider — bare word (ไม่มี ':') map ไป provider+alias
const GLOBAL_ALIAS: Record<string, { provider: string; alias: string }> = {
  opus: { provider: 'anthropic', alias: 'opus' },
  sonnet: { provider: 'anthropic', alias: 'sonnet' },
  haiku: { provider: 'anthropic', alias: 'haiku' },
  fast: { provider: 'anthropic', alias: 'fast' },
  fable: { provider: 'anthropic', alias: 'fable' },
  gpt: { provider: 'openai', alias: 'gpt' },
  codex: { provider: 'codex', alias: 'default' }, // bare "codex" = ChatGPT quota (delegate); "openai:codex" = API key

  gemini: { provider: 'google', alias: 'gemini' },
  flash: { provider: 'google', alias: 'flash' },
  grok: { provider: 'xai', alias: 'grok' },
  deepseek: { provider: 'deepseek', alias: 'default' },
  mistral: { provider: 'mistral', alias: 'default' },
  groq: { provider: 'groq', alias: 'default' },
  ollama: { provider: 'ollama', alias: 'default' },
  lmstudio: { provider: 'lmstudio', alias: 'default' },
  glm: { provider: 'glm', alias: 'default' },
  minimax: { provider: 'minimax', alias: 'default' },
};

export interface ParsedSpec {
  provider: string;
  model: string;
}

/** parse "provider:model" | "provider:alias" | alias | "model" (default anthropic) */
export function parseSpec(spec: string): ParsedSpec {
  const idx = spec.indexOf(':');
  if (idx !== -1) {
    const provider = spec.slice(0, idx);
    const rest = spec.slice(idx + 1);
    const cfg = PROVIDERS[provider];
    // ถ้าเป็น alias ของ provider นั้น → map เป็น model id จริง, ไม่งั้นใช้ rest เป็น raw model id
    const model = cfg?.models[rest] ?? rest;
    return { provider, model };
  }
  const g = GLOBAL_ALIAS[spec];
  if (g) return { provider: g.provider, model: PROVIDERS[g.provider].models[g.alias] };
  // bare model id → default provider anthropic
  return { provider: 'anthropic', model: spec };
}

/** normalized key สำหรับ lookup pricing เช่น "anthropic:claude-sonnet-4-6" */
export function specKey(spec: string): string {
  const { provider, model } = parseSpec(spec);
  return `${provider}:${model}`;
}

/**
 * model ที่ "ถูก/เร็วกว่า" ในค่ายเดียวกับ spec (สำหรับงานกลไก เช่น summarize/compaction) —
 * ใช้ key เดียวกัน ไม่ต้องตั้ง key ใหม่. ไม่มี fast tier → คืน spec เดิม (ทำงานได้แต่ไม่ประหยัด)
 */
export function fastSibling(spec: string): string {
  const { provider } = parseSpec(spec);
  const cfg = PROVIDERS[provider];
  if (!cfg) return spec;
  const fast = cfg.models.fast ?? cfg.models.flash ?? cfg.models.haiku ?? cfg.models.air;
  return fast ? `${provider}:${fast}` : spec;
}

/** resolve spec → LanguageModel (throw ถ้าไม่มี key / provider ผิด / key เป็น OAuth) */
export function resolveModel(spec: string): LanguageModel {
  const { provider, model } = parseSpec(spec);
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    throw new Error(
      `provider ไม่รองรับ: "${provider}" — รองรับ: ${SUPPORTED_PROVIDERS.join('/')} (เช่น "openai:gpt-5", "sonnet", "groq:fast")`,
    );
  }

  let key: string;
  if (cfg.requiresKey) {
    const found = resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks);
    if (!found) {
      throw new Error(`ต้องตั้ง ${cfg.envVar} ก่อนใช้ provider "${provider}" (BYOK — API key ตรงจาก console)`);
    }
    assertDirectApiKey(cfg, found); // reject OAuth/subscription token + format ผิด
    key = found;
  } else {
    key = resolveKeyFromEnv(cfg.envVar) ?? cfg.localPlaceholderKey ?? 'local';
  }

  // <PROVIDER>_BASE_URL env → override (สลับ region intl/จีน); ไม่งั้น local อ่าน env, cloud ใช้ default
  const baseURL =
    process.env[`${cfg.id.toUpperCase()}_BASE_URL`] ??
    (cfg.requiresKey ? cfg.baseURL : process.env[cfg.envVar] ?? cfg.baseURL);
  return cfg.create(key, baseURL)(model);
}

// ────────────────────────────────────────────────────────────────────────────
// EMBEDDINGS (BYOK) — optional semantic layer for src/search/. Reuses the same
// keys + factories as the chat providers; resolves to null (no throw) when no key
// is present, so the search engine degrades silently to its pure-TS BM25 floor.
// ────────────────────────────────────────────────────────────────────────────
interface EmbeddingProviderConfig {
  envVar: string;
  envFallbacks?: readonly string[];
  requiresKey: boolean;
  localPlaceholderKey?: string;
  defaultModel: string;
  create: (key: string, baseURL?: string) => (modelId: string) => EmbeddingModel;
}

export const EMBEDDING_PROVIDERS: Record<string, EmbeddingProviderConfig> = {
  openai: {
    envVar: 'OPENAI_API_KEY',
    requiresKey: true,
    defaultModel: 'text-embedding-3-small',
    create: (key, baseURL) => (id) => createOpenAI({ apiKey: key, baseURL }).textEmbeddingModel(id),
  },
  mistral: {
    envVar: 'MISTRAL_API_KEY',
    requiresKey: true,
    defaultModel: 'mistral-embed',
    create: (key) => (id) => createMistral({ apiKey: key }).textEmbeddingModel(id),
  },
  google: {
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    envFallbacks: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    requiresKey: true,
    defaultModel: 'text-embedding-004',
    create: (key) => (id) => createGoogleGenerativeAI({ apiKey: key }).textEmbeddingModel(id),
  },
  // local — only picked when explicitly requested (auto-detect never assumes a server is up)
  ollama: {
    envVar: 'OLLAMA_BASE_URL',
    requiresKey: false,
    localPlaceholderKey: 'ollama',
    defaultModel: 'nomic-embed-text',
    create: (key, baseURL) => (id) =>
      createOpenAICompatible({ name: 'ollama', apiKey: key, baseURL: baseURL ?? 'http://localhost:11434/v1' }).textEmbeddingModel(id),
  },
};

/** cloud, key-gated providers tried (in order) when no explicit embeddingModel is configured. */
const EMBED_AUTODETECT = ['openai', 'mistral', 'google'] as const;

export interface ResolvedEmbedder {
  model: EmbeddingModel;
  provider: string;
  modelId: string;
  /** stable tag recorded in the vector sidecar so a model change self-invalidates the cache. */
  tag: string;
}

function buildEmbedder(provider: string, modelId?: string): ResolvedEmbedder | null {
  const cfg = EMBEDDING_PROVIDERS[provider];
  if (!cfg) return null;
  let key: string;
  if (cfg.requiresKey) {
    const found = resolveKeyFromEnv(cfg.envVar, cfg.envFallbacks);
    if (!found) return null;
    const policy = PROVIDERS[provider];
    if (policy) {
      try {
        assertDirectApiKey(policy, found);
      } catch {
        return null;
      }
    }
    key = found;
  } else {
    key = resolveKeyFromEnv(cfg.envVar) ?? cfg.localPlaceholderKey ?? 'local';
  }
  const baseURL =
    process.env[`${provider.toUpperCase()}_BASE_URL`] ??
    (cfg.requiresKey ? undefined : process.env[cfg.envVar] ?? undefined);
  const id = modelId ?? cfg.defaultModel;
  try {
    return { model: cfg.create(key, baseURL)(id), provider, modelId: id, tag: `${provider}:${id}` };
  } catch {
    return null;
  }
}

/**
 * Resolve an embeddings model. `spec` is 'provider' | 'provider:modelId' | undefined.
 * undefined → auto-detect the first cloud provider whose key is present. Returns null
 * (never throws) when nothing resolves, so callers degrade to BM25-only.
 */
export function resolveEmbedder(spec?: string): ResolvedEmbedder | null {
  if (spec) {
    const idx = spec.indexOf(':');
    const provider = (idx === -1 ? spec : spec.slice(0, idx)).trim();
    if (!provider) return null;
    const modelId = idx === -1 ? undefined : spec.slice(idx + 1).trim() || undefined;
    return buildEmbedder(provider, modelId);
  }
  for (const provider of EMBED_AUTODETECT) {
    const e = buildEmbedder(provider);
    if (e) return e;
  }
  return null;
}
