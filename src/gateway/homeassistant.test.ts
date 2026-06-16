import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedHomeAssistantConfig } from './config.js';
import {
  formatHomeAssistantStateChange,
  handleHomeAssistantEvent,
  homeAssistantApiUrl,
  homeAssistantAuthHeaders,
  homeAssistantWebSocketUrl,
  normalizeHomeAssistantUrl,
  sendHomeAssistantNotification,
  shouldForwardHomeAssistantEvent,
  startHomeAssistant,
  truncateHomeAssistantMessage,
  type HomeAssistantStateChangedEvent,
} from './homeassistant.js';

const h = vi.hoisted(() => ({
  runGatewayAgent: vi.fn(),
}));

vi.mock('./session.js', () => ({
  runGatewayAgent: h.runGatewayAgent,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  h.runGatewayAgent.mockReset();
});

function config(overrides: Partial<ResolvedHomeAssistantConfig> = {}): ResolvedHomeAssistantConfig {
  return {
    url: 'http://ha.local:8123',
    token: 'ha-token',
    homeChannel: 'sanook_agent',
    homeChannelName: 'Home',
    watchDomains: ['light', 'binary_sensor'],
    watchEntities: [],
    ignoreEntities: [],
    watchAll: false,
    cooldownSeconds: 30,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

function stateEvent(
  entityId = 'light.kitchen',
  oldValue = 'off',
  newValue = 'on',
  attrs: Record<string, unknown> = { friendly_name: 'Kitchen Light' },
): HomeAssistantStateChangedEvent {
  return {
    event_type: 'state_changed',
    data: {
      entity_id: entityId,
      old_state: { state: oldValue, attributes: attrs },
      new_state: { state: newValue, attributes: attrs },
    },
  };
}

describe('Home Assistant gateway adapter', () => {
  it('normalizes URLs, builds API/websocket URLs, auth headers, and truncates notifications', () => {
    expect(normalizeHomeAssistantUrl(' http://ha.local:8123/ ')).toBe('http://ha.local:8123');
    expect(normalizeHomeAssistantUrl('ha.local:8123')).toBeUndefined();
    expect(homeAssistantApiUrl(config(), '/states')).toBe('http://ha.local:8123/api/states');
    expect(homeAssistantWebSocketUrl('https://ha.local:8123/lab/')).toBe('wss://ha.local:8123/lab/api/websocket');
    expect(homeAssistantAuthHeaders(' token ')).toEqual({ authorization: 'Bearer token' });
    expect(truncateHomeAssistantMessage('')).toBe('(ไม่มีผลลัพธ์)');
    expect(truncateHomeAssistantMessage('hello world', 8)).toBe('hello...');
  });

  it('creates persistent notifications through the Home Assistant REST API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendHomeAssistantNotification(config(), 'hello home', 'notify_me')).resolves.toMatchObject({
      notificationId: 'notify_me',
      messageCount: 1,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ha.local:8123/api/services/persistent_notification/create');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ authorization: 'Bearer ha-token' });
    expect(JSON.parse(String(init.body))).toEqual({
      title: 'Sanook',
      message: 'hello home',
      notification_id: 'notify_me',
    });
  });

  it('filters state_changed events using watch lists, ignore lists, unchanged values, and cooldowns', () => {
    expect(shouldForwardHomeAssistantEvent(config(), stateEvent()).ok).toBe(true);
    expect(shouldForwardHomeAssistantEvent(config(), stateEvent('sensor.temp', '20', '21')).reason).toBe('not_watched');
    expect(shouldForwardHomeAssistantEvent(config({ watchEntities: ['sensor.temp'] }), stateEvent('sensor.temp', '20', '21')).ok).toBe(true);
    expect(shouldForwardHomeAssistantEvent(config({ ignoreEntities: ['light.kitchen'] }), stateEvent()).reason).toBe('ignored_entity');
    expect(shouldForwardHomeAssistantEvent(config(), stateEvent('light.kitchen', 'on', 'on')).reason).toBe('unchanged');

    const seen = new Map<string, number>([['light.kitchen', 100]]);
    expect(shouldForwardHomeAssistantEvent(config(), stateEvent(), { lastEventTime: seen, nowSeconds: 120 }).reason).toBe('cooldown');
    expect(shouldForwardHomeAssistantEvent(config(), stateEvent(), { lastEventTime: seen, nowSeconds: 131 }).ok).toBe(true);
  });

  it('formats common domains into concise event prompts', () => {
    expect(formatHomeAssistantStateChange(stateEvent('light.kitchen', 'off', 'on'))).toBe('[Home Assistant] Kitchen Light: turned on');
    expect(formatHomeAssistantStateChange(stateEvent('binary_sensor.door', 'off', 'on', { friendly_name: 'Front Door' }))).toBe(
      '[Home Assistant] Front Door: triggered (was cleared)',
    );
    expect(
      formatHomeAssistantStateChange(
        stateEvent('sensor.temp', '20', '21', { friendly_name: 'Temperature', unit_of_measurement: '°C' }),
      ),
    ).toBe('[Home Assistant] Temperature: changed from 20°C to 21°C');
  });

  it('runs the gateway agent for allowed events and replies as a persistent notification', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleHomeAssistantEvent({
        config: config(),
        event: stateEvent(),
        model: 'test:model',
        permissionMode: 'ask',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: true });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'homeassistant',
        target: 'sanook_agent',
        model: 'test:model',
        prompt: '[Home Assistant] Kitchen Light: turned on',
        userText: '[Home Assistant] Kitchen Light: turned on',
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ha.local:8123/api/services/persistent_notification/create',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Sanook', message: 'agent reply', notification_id: 'sanook_agent' }),
      }),
    );
  });

  it('authenticates and subscribes to state_changed over the Home Assistant websocket', () => {
    const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
    const sent: string[] = [];
    const ws = {
      send: (data: string) => sent.push(data),
      close: vi.fn(),
      addEventListener: (type: string, listener: (event: { data?: unknown }) => void) => {
        listeners[type] ??= [];
        listeners[type].push(listener);
      },
    };

    const stop = startHomeAssistant({
      config: config(),
      model: 'test:model',
      webSocketFactory: (url) => {
        expect(url).toBe('ws://ha.local:8123/api/websocket');
        return ws;
      },
    });

    listeners.message?.[0]?.({ data: JSON.stringify({ type: 'auth_required' }) });
    listeners.message?.[0]?.({ data: JSON.stringify({ type: 'auth_ok' }) });
    listeners.message?.[0]?.({ data: JSON.stringify({ id: 1, type: 'result', success: true }) });

    expect(JSON.parse(sent[0])).toEqual({ type: 'auth', access_token: 'ha-token' });
    expect(JSON.parse(sent[1])).toEqual({ id: 1, type: 'subscribe_events', event_type: 'state_changed' });
    stop();
    expect(ws.close).toHaveBeenCalledOnce();
  });
});
