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
    expect(parseSendTarget('email:owner@example.com')).toMatchObject({
      platform: 'email',
      address: 'owner@example.com',
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
    expect(() => parseSendTarget('sms:+15551234567')).toThrow('platform');
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

  it('lists configured Discord, Slack, and Email targets', () => {
    expect(
      listConfiguredTargets({
        discord: {
          botToken: 'discord-token',
          defaultChannelId: '111111111111111111',
          allowedChannelIds: ['111111111111111111'],
        },
        slack: { botToken: 'xoxb-token', defaultChannelId: 'C01ABC', allowedChannelIds: ['C01ABC', 'C02DEF'] },
        email: {
          address: 'bot@example.com',
          password: 'email-password',
          smtpHost: 'smtp.example.com',
          homeAddress: 'owner@example.com',
          allowedUsers: ['owner@example.com'],
        },
      }).map((t) => t.target),
    ).toEqual(['discord', 'discord:111111111111111111', 'slack', 'slack:C01ABC', 'slack:C02DEF', 'email', 'email:owner@example.com']);
  });
});
