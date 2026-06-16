import { afterEach, describe, expect, it, vi } from 'vitest';
import { haCallServiceTool, haGetStateTool, haListEntitiesTool, haListServicesTool } from './homeassistant.js';

const opts = {} as never;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubHomeAssistantEnv() {
  vi.stubEnv('HASS_URL', 'http://ha.local:8123');
  vi.stubEnv('HASS_TOKEN', 'ha-token');
}

describe('Home Assistant tools', () => {
  it('lists entities with domain and friendly-name filters', async () => {
    stubHomeAssistantEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify([
          { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
          { entity_id: 'switch.garage', state: 'off', attributes: { friendly_name: 'Garage Switch' } },
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = String(await haListEntitiesTool.execute!({ domain: 'light', area: 'kitchen' }, opts));

    expect(out).toContain('light.kitchen: on (Kitchen Light)');
    expect(out).not.toContain('switch.garage');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ha.local:8123/api/states',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer ha-token' }) }),
    );
  });

  it('gets one entity state after validating entity_id', async () => {
    stubHomeAssistantEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ entity_id: 'sensor.temp', state: '21', attributes: { unit_of_measurement: '°C' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = String(await haGetStateTool.execute!({ entity_id: 'sensor.temp' }, opts));

    expect(out).toContain('"entity_id": "sensor.temp"');
    await expect(haGetStateTool.execute!({ entity_id: '../bad' }, opts)).rejects.toThrow('entity_id');
  });

  it('lists services by domain', async () => {
    stubHomeAssistantEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(
        JSON.stringify([
          { domain: 'light', services: { turn_on: {}, turn_off: {} } },
          { domain: 'switch', services: { toggle: {} } },
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = String(await haListServicesTool.execute!({ domain: 'light' }, opts));

    expect(out).toBe('light: turn_off, turn_on');
  });

  it('blocks unsafe service domains and calls safe services through REST', async () => {
    stubHomeAssistantEnv();
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify([{ entity_id: 'light.kitchen' }])));
    vi.stubGlobal('fetch', fetchMock);

    await expect(haCallServiceTool.execute!({ domain: 'shell_command', service: 'run' }, opts)).resolves.toContain('blocked');
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      haCallServiceTool.execute!(
        { domain: 'light', service: 'turn_on', entity_id: 'light.kitchen', data: { brightness: 128 } },
        opts,
      ),
    ).resolves.toContain('OK Home Assistant light.turn_on light.kitchen');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/services/light/turn_on');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer ha-token', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ brightness: 128, entity_id: 'light.kitchen' });
  });
});
