import type { LanguageModel } from 'ai';
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
      codex: 'gpt-5-codex', // coding-tuned, เรียกผ่าน OpenAI API ปกติ
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
    models: { default: 'deepseek-chat', smart: 'deepseek-reasoner', fast: 'deepseek-chat' },
    create: (key) => createDeepSeek({ apiKey: key }),
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    envVar: 'XAI_API_KEY',
    requiresKey: true,
    keyFormat: /^xai-[A-Za-z0-9]{16,}$/,
    models: { default: 'grok-4', smart: 'grok-4', grok: 'grok-4' },
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
  codex: { provider: 'openai', alias: 'codex' },
  gemini: { provider: 'google', alias: 'gemini' },
  flash: { provider: 'google', alias: 'flash' },
  grok: { provider: 'xai', alias: 'grok' },
  deepseek: { provider: 'deepseek', alias: 'default' },
  mistral: { provider: 'mistral', alias: 'default' },
  groq: { provider: 'groq', alias: 'default' },
  ollama: { provider: 'ollama', alias: 'default' },
  lmstudio: { provider: 'lmstudio', alias: 'default' },
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

  const baseURL = cfg.requiresKey ? cfg.baseURL : (process.env[cfg.envVar] ?? cfg.baseURL);
  return cfg.create(key, baseURL)(model);
}
