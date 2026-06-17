import { tool } from 'ai';
import { z } from 'zod';
import { readGatewayConfig, resolveHomeAssistantConfig, type ResolvedHomeAssistantConfig } from '../gateway/config.js';
import { homeAssistantApiUrl, homeAssistantAuthHeaders, readHomeAssistantJsonResponse } from '../gateway/homeassistant.js';

const BLOCKED_DOMAINS = new Set(['shell_command', 'command_line', 'python_script', 'pyscript', 'hassio', 'rest_command']);
const ENTITY_ID_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/;

interface HaState {
  entity_id?: string;
  state?: string;
  attributes?: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

interface HaService {
  domain?: string;
  services?: Record<string, unknown>;
}

async function loadHaConfig(): Promise<ResolvedHomeAssistantConfig> {
  const config = resolveHomeAssistantConfig(await readGatewayConfig());
  if (!config.token) throw new Error('ยังไม่ได้ตั้ง Home Assistant — รัน: sanook gateway setup homeassistant หรือ set HASS_TOKEN');
  return config;
}

async function haFetch<T>(config: ResolvedHomeAssistantConfig, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(homeAssistantApiUrl(config, path), {
    ...init,
    headers: {
      ...homeAssistantAuthHeaders(config.token, init.method ? { 'content-type': 'application/json' } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  return readHomeAssistantJsonResponse<T>(r, 'Home Assistant API');
}

function validateEntityId(entityId: string): string {
  const clean = entityId.trim();
  if (!ENTITY_ID_RE.test(clean)) throw new Error(`entity_id ไม่ปลอดภัย/ไม่ถูกต้อง: ${entityId}`);
  return clean;
}

function stateSummary(state: HaState): string {
  const name = typeof state.attributes?.friendly_name === 'string' ? state.attributes.friendly_name : state.entity_id;
  return `${state.entity_id}: ${state.state ?? '(unknown)'}${name && name !== state.entity_id ? ` (${name})` : ''}`;
}

export const haListEntitiesTool = tool({
  description: 'Home Assistant: list entities/states. Requires HASS_TOKEN or gateway setup homeassistant.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Filter by entity domain เช่น light, switch, climate, sensor'),
    area: z.string().optional().describe('Simple friendly-name substring filter เช่น living room, kitchen'),
    limit: z.number().int().positive().max(200).optional().describe('Maximum rows to return (default 80)'),
  }),
  execute: async ({ domain, area, limit }) => {
    const config = await loadHaConfig();
    const states = await haFetch<HaState[]>(config, '/states');
    const cleanDomain = domain?.trim();
    const areaNeedle = area?.trim().toLowerCase();
    const rows = states
      .filter((s) => !cleanDomain || s.entity_id?.startsWith(`${cleanDomain}.`))
      .filter((s) => !areaNeedle || String(s.attributes?.friendly_name ?? s.entity_id ?? '').toLowerCase().includes(areaNeedle))
      .slice(0, limit ?? 80)
      .map(stateSummary);
    return rows.length ? rows.join('\n') : 'ไม่พบ Home Assistant entity ที่ตรงเงื่อนไข';
  },
});

export const haGetStateTool = tool({
  description: 'Home Assistant: get detailed state and attributes for one entity.',
  inputSchema: z.object({
    entity_id: z.string().describe('Entity id เช่น light.living_room'),
  }),
  execute: async ({ entity_id }) => {
    const config = await loadHaConfig();
    const entityId = validateEntityId(entity_id);
    const state = await haFetch<HaState>(config, `/states/${encodeURIComponent(entityId)}`);
    return JSON.stringify(state, null, 2);
  },
});

export const haListServicesTool = tool({
  description: 'Home Assistant: list available service domains/actions, optionally filtered by domain.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Filter by service domain เช่น light, climate, switch'),
  }),
  execute: async ({ domain }) => {
    const config = await loadHaConfig();
    const services = await haFetch<HaService[]>(config, '/services');
    const cleanDomain = domain?.trim();
    const rows = services
      .filter((entry) => !cleanDomain || entry.domain === cleanDomain)
      .map((entry) => `${entry.domain}: ${Object.keys(entry.services ?? {}).sort().join(', ') || '(none)'}`);
    return rows.length ? rows.join('\n') : 'ไม่พบ Home Assistant service ที่ตรงเงื่อนไข';
  },
});

export const haCallServiceTool = tool({
  description:
    'Home Assistant: call a service to control a device. Blocks unsafe domains such as shell_command, command_line, python_script, pyscript, hassio, and rest_command.',
  inputSchema: z.object({
    domain: z.string().describe('Service domain เช่น light, switch, climate, cover, media_player, scene, script'),
    service: z.string().describe('Service name เช่น turn_on, turn_off, toggle, set_temperature'),
    entity_id: z.string().optional().describe('Optional target entity id เช่น light.living_room'),
    data: z.record(z.unknown()).optional().describe('Additional JSON service data'),
  }),
  execute: async ({ domain, service, entity_id, data }) => {
    const config = await loadHaConfig();
    const cleanDomain = domain.trim();
    const cleanService = service.trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(cleanDomain)) throw new Error(`domain ไม่ถูกต้อง: ${domain}`);
    if (!/^[a-z_][a-z0-9_]*$/.test(cleanService)) throw new Error(`service ไม่ถูกต้อง: ${service}`);
    if (BLOCKED_DOMAINS.has(cleanDomain)) return `⛔ blocked Home Assistant domain: ${cleanDomain}`;
    const entityId = entity_id ? validateEntityId(entity_id) : undefined;
    const body = { ...(data ?? {}), ...(entityId ? { entity_id: entityId } : {}) };
    const result = await haFetch<unknown[]>(config, `/services/${encodeURIComponent(cleanDomain)}/${encodeURIComponent(cleanService)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return `OK Home Assistant ${cleanDomain}.${cleanService}${entityId ? ` ${entityId}` : ''} (${Array.isArray(result) ? result.length : 0} state update(s))`;
  },
});
