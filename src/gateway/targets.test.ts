import { describe, it, expect } from 'vitest';
import { formatTarget, listConfiguredTargets, parseSendTarget } from './targets.js';

describe('messaging targets', () => {
  it('parses platform, chat, and thread target formats', () => {
    expect(parseSendTarget('telegram')).toMatchObject({ platform: 'telegram' });
    expect(parseSendTarget(' Slack : C01ABC ')).toMatchObject({ platform: 'slack', address: 'C01ABC' });
    expect(parseSendTarget('telegram:-100123')).toMatchObject({ platform: 'telegram', address: '-100123', chatId: -100123 });
    expect(parseSendTarget('telegram:-100123:17585')).toMatchObject({
      platform: 'telegram',
      address: '-100123',
      thread: '17585',
      chatId: -100123,
      threadId: 17585,
    });
    expect(parseSendTarget('discord:123456789012345678')).toMatchObject({
      platform: 'discord',
      address: '123456789012345678',
    });
    expect(parseSendTarget('slack:C01ABC:1718584242.000100')).toMatchObject({
      platform: 'slack',
      address: 'C01ABC',
      thread: '1718584242.000100',
    });
    expect(parseSendTarget('mattermost:chan-home:root-post-1')).toMatchObject({
      platform: 'mattermost',
      address: 'chan-home',
      thread: 'root-post-1',
    });
    expect(parseSendTarget('homeassistant:sanook_agent')).toMatchObject({
      platform: 'homeassistant',
      address: 'sanook_agent',
    });
    expect(parseSendTarget('email:owner@example.com')).toMatchObject({
      platform: 'email',
      address: 'owner@example.com',
    });
    expect(parseSendTarget('line:U1234567890abcdef')).toMatchObject({
      platform: 'line',
      address: 'U1234567890abcdef',
    });
    expect(parseSendTarget('sms:+15551234567')).toMatchObject({
      platform: 'sms',
      address: '+15551234567',
    });
    expect(parseSendTarget('ntfy:sanook-topic')).toMatchObject({
      platform: 'ntfy',
      address: 'sanook-topic',
    });
    expect(parseSendTarget('signal:+1 (555) 123-4567')).toMatchObject({
      platform: 'signal',
      address: '+15551234567',
    });
    expect(parseSendTarget('signal:group:abcd1234')).toMatchObject({
      platform: 'signal',
      address: 'group:abcd1234',
    });
    expect(parseSendTarget('whatsapp:+1 (555) 123-4567')).toMatchObject({
      platform: 'whatsapp',
      address: '15551234567',
    });
    expect(parseSendTarget('matrix:!roomid:matrix.org')).toMatchObject({
      platform: 'matrix',
      address: '!roomid:matrix.org',
    });
    expect(parseSendTarget('matrix:#alias:matrix.org')).toMatchObject({
      platform: 'matrix',
      address: '#alias:matrix.org',
    });
    expect(parseSendTarget('matrix:!roomid:matrix.org:8448')).toMatchObject({
      platform: 'matrix',
      address: '!roomid:matrix.org:8448',
    });
    expect(parseSendTarget('google-chat:spaces/AAAA/threads/thread-1')).toMatchObject({
      platform: 'googlechat',
      address: 'spaces/AAAA/threads/thread-1',
    });
    expect(parseSendTarget('googlechat:space/AAAA')).toMatchObject({
      platform: 'googlechat',
      address: 'space/AAAA',
    });
    expect(parseSendTarget('gchat:https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t')).toMatchObject({
      platform: 'googlechat',
      address: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
    });
    expect(parseSendTarget('google_chat:spaces/BBBB')).toMatchObject({
      platform: 'googlechat',
      address: 'spaces/BBBB',
    });
    expect(parseSendTarget('imessage:iMessage;-;user@example.com')).toMatchObject({
      platform: 'bluebubbles',
      address: 'iMessage;-;user@example.com',
    });
    expect(parseSendTarget('blue-bubbles:user@example.com')).toMatchObject({
      platform: 'bluebubbles',
      address: 'user@example.com',
    });
    expect(parseSendTarget('blue_bubbles:+15551234567')).toMatchObject({
      platform: 'bluebubbles',
      address: '+15551234567',
    });
    expect(parseSendTarget('teams:19:chatid@thread.v2')).toMatchObject({
      platform: 'teams',
      address: '19:chatid@thread.v2',
    });
  });

  it('rejects ambiguous or partial numeric targets', () => {
    expect(() => parseSendTarget('telegram:123abc')).toThrow('chat_id');
    expect(() => parseSendTarget('telegram:1.2')).toThrow('chat_id');
    expect(() => parseSendTarget('telegram:')).toThrow('target');
    expect(() => parseSendTarget('telegram::17585')).toThrow('target');
    expect(() => parseSendTarget('telegram:123:')).toThrow('target');
    expect(() => parseSendTarget('telegram:1:2:3')).toThrow('target');
    expect(() => parseSendTarget('telegram:9007199254740993')).toThrow('ใหญ่เกินไป');
    expect(() => parseSendTarget('telegram:-100123:0')).toThrow('thread_id');
    expect(() => parseSendTarget('telegram:-100123:-1')).toThrow('thread_id');
    expect(() => parseSendTarget('email:owner@example.com:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('line:U1234567890abcdef:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('homeassistant:sanook_agent:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('sms:+15551234567:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('ntfy:sanook-topic:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('signal:+15551234567:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('whatsapp:+15551234567:thread')).toThrow('ไม่รองรับ thread');
    expect(() => parseSendTarget('whatsapp:not-a-number')).toThrow('wa_id');
    expect(() => parseSendTarget('matrix:not-a-room')).toThrow('Matrix target');
    expect(() => parseSendTarget('googlechat:not-a-space')).toThrow('Google Chat target');
    expect(() => parseSendTarget('bluebubbles:user name@example.com')).toThrow('BlueBubbles target');
  });

  it('formats targets for user-facing output', () => {
    expect(formatTarget({ platform: 'telegram' })).toBe('telegram');
    expect(formatTarget({ platform: 'telegram', chatId: 1 })).toBe('telegram:1');
    expect(formatTarget({ platform: 'telegram', chatId: 1, threadId: 2 })).toBe('telegram:1:2');
    expect(formatTarget({ platform: 'slack', address: 'C01ABC', thread: '1718584242.000100' })).toBe(
      'slack:C01ABC:1718584242.000100',
    );
  });

  it('lists configured telegram home and explicit chat targets', () => {
    expect(
      listConfiguredTargets({
        telegram: { botToken: '123:abc', allowedChatIds: [111, 222] },
      }).map((t) => t.target),
    ).toEqual(['telegram', 'telegram:111', 'telegram:222']);
  });

  it('marks telegram not-ready when token exists but no allowlist is configured', () => {
    const targets = listConfiguredTargets({ telegram: { botToken: '123:abc', allowedChatIds: [] } });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ target: 'telegram', configured: false });
  });

  it('marks webhook-mode Google Chat homes ready', () => {
    expect(
      listConfiguredTargets({
        googleChat: {
          incomingWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
          homeChannel: 'webhook',
        },
      }).map((t) => ({ target: t.target, configured: t.configured })),
    ).toEqual([{ target: 'googlechat', configured: true }]);
  });

  it('lists configured Discord, Slack, Mattermost, Home Assistant, Email, LINE, SMS, ntfy, Signal, WhatsApp, Matrix, Google Chat, BlueBubbles, and Teams targets', () => {
    expect(
      listConfiguredTargets({
        discord: {
          botToken: 'discord-token',
          defaultChannelId: '111111111111111111',
          allowedChannelIds: ['111111111111111111'],
        },
        slack: { botToken: 'xoxb-token', defaultChannelId: 'C01ABC', allowedChannelIds: ['C01ABC', 'C02DEF'] },
        mattermost: {
          serverUrl: 'https://mm.example.com',
          token: 'mattermost-token',
          homeChannel: 'chan-home',
          homeChannelName: 'Owner',
          allowedChannels: ['chan-home', 'chan-ops'],
        },
        homeassistant: {
          url: 'http://ha.local:8123',
          token: 'hass-token',
          homeChannel: 'sanook_agent',
          homeChannelName: 'Owner',
          watchDomains: ['light'],
        },
        email: {
          address: 'bot@example.com',
          password: 'email-password',
          smtpHost: 'smtp.example.com',
          homeAddress: 'owner@example.com',
          allowedUsers: ['owner@example.com'],
        },
        line: {
          channelAccessToken: 'line-token',
          homeChannel: 'U1234567890abcdef',
          allowedUsers: ['U1234567890abcdef'],
          allowedGroups: ['C1234567890abcdef'],
          allowedRooms: ['R1234567890abcdef'],
        },
        sms: {
          accountSid: 'AC123',
          authToken: 'twilio-token',
          phoneNumber: '+15550000000',
          homeChannel: '+15551234567',
          homeChannelName: 'Owner',
          allowedUsers: ['+15557654321'],
        },
        ntfy: {
          topic: 'sanook-topic',
          publishTopic: 'sanook-replies',
          homeChannel: 'sanook-topic',
          homeChannelName: 'Owner',
          allowedUsers: ['sanook-topic', 'other-topic'],
        },
        signal: {
          httpUrl: 'http://127.0.0.1:8080',
          account: '+15550000000',
          homeChannel: '+15551234567',
          homeChannelName: 'Owner',
          allowedUsers: ['+15557654321'],
          groupAllowedUsers: ['group:abcd1234', '*'],
        },
        whatsapp: {
          phoneNumberId: '1234567890',
          accessToken: 'whatsapp-token',
          homeChannel: '+15551234567',
          homeChannelName: 'Owner',
          allowedUsers: ['+15557654321'],
        },
        matrix: {
          homeserver: 'https://matrix.example.org',
          accessToken: 'matrix-token',
          homeRoom: '!home:matrix.example.org',
          homeRoomName: 'Owner',
          allowedRooms: ['!home:matrix.example.org', '!ops:matrix.example.org'],
        },
        googleChat: {
          serviceAccountJson: '/home/you/.sanook/google-chat-sa.json',
          incomingWebhookUrl: 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k&token=t',
          homeChannel: 'spaces/AAAA',
          homeChannelName: 'Owner',
          allowedSpaces: ['spaces/AAAA', 'spaces/BBBB'],
        },
        bluebubbles: {
          serverUrl: 'http://localhost:1234',
          password: 'bb-secret',
          homeChannel: 'user@example.com',
          homeChannelName: 'Owner',
          allowedUsers: ['user@example.com', '+15551234567'],
        },
        teams: {
          deliveryMode: 'graph',
          graphAccessToken: 'teams-graph-token',
          chatId: '19:chat@thread.v2',
          homeChannel: '19:chat@thread.v2',
          homeChannelName: 'Owner',
        },
      }).map((t) => t.target),
    ).toEqual([
      'discord',
      'discord:111111111111111111',
      'slack',
      'slack:C01ABC',
      'slack:C02DEF',
      'mattermost',
      'mattermost:chan-ops',
      'homeassistant',
      'email',
      'email:owner@example.com',
      'line',
      'line:U1234567890abcdef',
      'line:C1234567890abcdef',
      'line:R1234567890abcdef',
      'sms',
      'sms:+15557654321',
      'ntfy',
      'ntfy:sanook-replies',
      'ntfy:other-topic',
      'signal',
      'signal:+15557654321',
      'signal:group:abcd1234',
      'whatsapp',
      'whatsapp:15557654321',
      'matrix',
      'matrix:!ops:matrix.example.org',
      'googlechat',
      'googlechat:spaces/BBBB',
      'bluebubbles',
      'bluebubbles:+15551234567',
      'teams',
    ]);
  });
});
