import { readFile } from 'node:fs/promises';
import { appHomePath } from '../brand.js';

const EMBEDDING_MODEL_ENV = 'SANOOK_EMBEDDING_MODEL';

export function cleanEmbeddingModelSpec(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const clean = v.trim();
  return clean ? clean : undefined;
}

/** read an optional embeddingModel spec from ~/.sanook/config.json. */
export async function configEmbeddingModel(): Promise<string | undefined> {
  try {
    const cfg = JSON.parse(await readFile(appHomePath('config.json'), 'utf8')) as { embeddingModel?: unknown };
    return cleanEmbeddingModelSpec(cfg.embeddingModel);
  } catch {
    return undefined;
  }
}

export async function embeddingModelSpec(override?: string): Promise<string | undefined> {
  return cleanEmbeddingModelSpec(override) ?? cleanEmbeddingModelSpec(process.env[EMBEDDING_MODEL_ENV]) ?? (await configEmbeddingModel());
}
