import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { resolveKey, envVarFor } from './keys.js';

export interface ParsedSpec {
  provider: string;
  model: string;
}

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'] as const;

// alias สั้นของ Anthropic (model id ที่ยืนยันแล้ว) — provider อื่นใช้ full spec "provider:model"
const ALIASES: Record<string, string> = {
  opus: 'anthropic:claude-opus-4-8',
  sonnet: 'anthropic:claude-sonnet-4-6',
  haiku: 'anthropic:claude-haiku-4-5-20251001',
  fast: 'anthropic:claude-haiku-4-5-20251001',
};

/** parse "provider:model" หรือ alias หรือ "model" (default provider = anthropic) */
export function parseSpec(spec: string): ParsedSpec {
  const resolved = ALIASES[spec] ?? spec;
  const idx = resolved.indexOf(':');
  if (idx === -1) return { provider: 'anthropic', model: resolved };
  return { provider: resolved.slice(0, idx), model: resolved.slice(idx + 1) };
}

/** normalized key สำหรับ lookup pricing เช่น "anthropic:claude-sonnet-4-6" */
export function specKey(spec: string): string {
  const { provider, model } = parseSpec(spec);
  return `${provider}:${model}`;
}

/** resolve spec → LanguageModel (throw ถ้าไม่มี key หรือ provider ไม่รองรับ) */
export function resolveModel(spec: string): LanguageModel {
  const { provider, model } = parseSpec(spec);
  const apiKey = resolveKey(provider);

  switch (provider) {
    case 'anthropic':
      requireKey(provider, apiKey);
      return createAnthropic({ apiKey })(model);
    case 'openai':
      requireKey(provider, apiKey);
      return createOpenAI({ apiKey })(model);
    case 'google':
      requireKey(provider, apiKey);
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'ollama':
      // local — OpenAI-compatible endpoint, ไม่บังคับ key
      return createOpenAI({
        baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
        apiKey: apiKey ?? 'ollama',
      })(model);
    default:
      throw new Error(
        `provider ไม่รองรับ: "${provider}" — รองรับ: ${SUPPORTED_PROVIDERS.join('/')} (เช่น "openai:gpt-5", "sonnet")`,
      );
  }
}

function requireKey(provider: string, apiKey: string | undefined): asserts apiKey is string {
  if (!apiKey) {
    throw new Error(`ต้องตั้ง ${envVarFor(provider)} ก่อนใช้ provider "${provider}" (BYOK)`);
  }
}
