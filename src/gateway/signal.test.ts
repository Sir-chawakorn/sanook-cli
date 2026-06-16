import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedSignalConfig } from './config.js';
import {
  handleSignalEvent,
  isAllowedSignalSource,
  normalizeSignalId,
  parseSignalSseLine,
  redactSignalId,
  sendSignalMessage,
  signalEnvelopeMessage,
  signalEventsUrl,
  signalRpcUrl,
  splitSignalText,
} from './signal.js';

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

function config(overrides: Partial<ResolvedSignalConfig> = {}): ResolvedSignalConfig {
  return {
    httpUrl: 'http://127.0.0.1:8080',
    account: '+15550000000',
    homeChannel: '+15551234567',
    homeChannelName: 'Owner',
    allowedUsers: ['+15551234567'],
    groupAllowedUsers: ['group:group-1'],
    allowAllUsers: false,
    requireMention: false,
    enabled: true,
    source: 'config',
    ...overrides,
  };
}

describe('Signal gateway adapter', () => {
  it('normalizes, redacts, and builds signal-cli URLs', () => {
    expect(normalizeSignalId('+1 (555) 123-4567')).toBe('+15551234567');
    expect(normalizeSignalId('group: abcd1234 ')).toBe('group:abcd1234');
    expect(redactSignalId('+15551234567')).toBe('+155…4567');
    expect(redactSignalId('group:abcd1234')).toBe('group:abcd…1234');
    expect(signalRpcUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080/api/v1/rpc');
    expect(signalEventsUrl('http://127.0.0.1:8080/', '+15550000000')).toBe(
      'http://127.0.0.1:8080/api/v1/events?account=%2B15550000000',
    );
  });

  it('splits long Signal messages at natural boundaries', () => {
    const chunks = splitSignalText(`intro\n${'word '.repeat(3000)}`, 400);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 400)).toBe(true);
  });

  it('sends direct messages through signal-cli JSON-RPC', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', result: { timestamp: 1718584242000 }, id: '1' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSignalMessage(config(), '+1 (555) 123-4567', 'hello signal')).resolves.toEqual({
      to: '+15551234567',
      messageCount: 1,
      messageIds: ['1718584242000'],
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/rpc');
    expect(JSON.parse(String(init.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'send',
      params: {
        account: '+15550000000',
        recipient: ['+15551234567'],
        message: 'hello signal',
      },
    });
  });

  it('sends group messages with groupId instead of recipient', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { timestamp: 2 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSignalMessage(config(), 'group:group-1', 'hello group')).resolves.toMatchObject({
      to: 'group:group-1',
      messageIds: ['2'],
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'send',
      params: {
        account: '+15550000000',
        groupId: 'group-1',
        message: 'hello group',
      },
    });
  });

  it('parses SSE data lines and signal-cli envelopes', () => {
    const raw = {
      envelope: {
        sourceNumber: '+15551234567',
        timestamp: 10,
        dataMessage: {
          message: 'hello from signal',
          groupInfo: { groupId: 'group-1' },
        },
      },
    };
    expect(parseSignalSseLine(`data: ${JSON.stringify(raw)}`)).toEqual(raw);
    expect(signalEnvelopeMessage(raw, '+15550000000')).toEqual({
      target: 'group:group-1',
      sender: '+15551234567',
      text: 'hello from signal',
      groupId: 'group-1',
      timestamp: 10,
    });
    expect(
      signalEnvelopeMessage(
        {
          envelope: {
            syncMessage: {
              sentMessage: {
                destination: '+15550000000',
                timestamp: 11,
                message: 'note to self',
              },
            },
          },
        },
        '+15550000000',
      ),
    ).toMatchObject({ target: '+15550000000', sender: '+15550000000', text: 'note to self', noteToSelf: true });
  });

  it('enforces DM and group allowlists separately', () => {
    expect(isAllowedSignalSource(config(), { target: '+15551234567', sender: '+15551234567', text: 'hi' })).toBe(true);
    expect(isAllowedSignalSource(config(), { target: '+15557654321', sender: '+15557654321', text: 'hi' })).toBe(false);
    expect(isAllowedSignalSource(config(), { target: 'group:group-1', sender: '+15551234567', text: 'hi', groupId: 'group-1' })).toBe(true);
    expect(isAllowedSignalSource(config(), { target: 'group:other', sender: '+15551234567', text: 'hi', groupId: 'other' })).toBe(false);
    expect(isAllowedSignalSource(config({ allowAllUsers: true, allowedUsers: [] }), { target: '+15557654321', sender: '+15557654321', text: 'hi' })).toBe(true);
  });

  it('runs the gateway agent for allowed inbound Signal messages and sends replies', async () => {
    h.runGatewayAgent.mockResolvedValue({ text: 'agent reply', suppressDelivery: false, messages: [] });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { timestamp: 99 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      handleSignalEvent({
        config: config(),
        event: { target: '+15551234567', sender: '+15551234567', text: 'hello from signal' },
        model: 'test:model',
        permissionMode: 'ask',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: true });

    expect(h.runGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'signal',
        target: '+15551234567',
        model: 'test:model',
        prompt: expect.stringContaining('hello from signal'),
        userText: 'hello from signal',
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      method: 'send',
      params: {
        recipient: ['+15551234567'],
        message: 'agent reply',
      },
    });
  });

  it('requires a configured group mention when requested', async () => {
    await expect(
      handleSignalEvent({
        config: config({ requireMention: true }),
        event: { target: 'group:group-1', sender: '+15551234567', text: 'hello group', groupId: 'group-1' },
        model: 'test:model',
        runningTargets: new Set<string>(),
      }),
    ).resolves.toEqual({ handled: false, reason: 'not_mentioned' });
    expect(h.runGatewayAgent).not.toHaveBeenCalled();
  });
});
