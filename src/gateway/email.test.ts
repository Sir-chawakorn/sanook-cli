import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGatewayAgent } from './session.js';
import {
  buildEmailMessage,
  buildEmailMessageWithHeaders,
  parseImapFetchResponse,
  parseImapSearchResponse,
  parseRawEmail,
  sendEmailMessage,
  shouldProcessEmail,
  startEmail,
} from './email.js';

vi.mock('./session.js', () => ({
  runGatewayAgent: vi.fn(async (opts: { prompt: string }) => ({
    text: opts.prompt.includes('silent') ? '[SILENT]' : 'agent reply',
    suppressDelivery: opts.prompt.includes('silent'),
    messages: [],
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('email send adapter', () => {
  it('builds a plain UTF-8 email with safe headers and dot-stuffed body', () => {
    const msg = buildEmailMessage(
      { address: 'bot@example.com', password: 'pw', smtpHost: 'smtp.example.com', fromName: 'Sanook AI' },
      'owner@example.com',
      'first\n.secret',
      'สรุปงาน',
    );
    expect(msg.messageId).toMatch(/^<.+@example\.com>$/);
    expect(msg.raw).toContain('From: Sanook AI <bot@example.com>');
    expect(msg.raw).toContain('To: owner@example.com');
    expect(msg.raw).toContain('Subject: =?UTF-8?B?');
    expect(msg.raw).toContain('first\r\n..secret\r\n');
  });

  it('sends through an injected transport for tests and returns the message id', async () => {
    const calls: unknown[] = [];
    const transport = vi.fn(async (email: unknown) => {
      calls.push(email);
    });
    const res = await sendEmailMessage(
      { address: 'bot@example.com', password: 'pw', smtpHost: 'smtp.example.com', smtpPort: 465 },
      'owner@example.com',
      'hello',
      { subject: 'Deploy', transport },
    );
    expect(res.to).toBe('owner@example.com');
    expect(res.messageId).toMatch(/^<.+@example\.com>$/);
    expect(transport).toHaveBeenCalledOnce();
    const payload = calls[0] as {
      to: string;
      raw: string;
      config: { smtpHost: string; smtpPort?: number };
    };
    expect(payload).toMatchObject({
      to: 'owner@example.com',
      config: { smtpHost: 'smtp.example.com', smtpPort: 465 },
    });
    expect(payload.raw).toContain('Subject: Deploy');
  });

  it('adds thread headers for email replies', () => {
    const msg = buildEmailMessageWithHeaders(
      { address: 'bot@example.com', password: 'pw', smtpHost: 'smtp.example.com' },
      'owner@example.com',
      'reply',
      { subject: 'Re: Help', inReplyTo: '<msg-1@example.com>', references: '<root@example.com>' },
    );
    expect(msg.raw).toContain('In-Reply-To: <msg-1@example.com>');
    expect(msg.raw).toContain('References: <root@example.com> <msg-1@example.com>');
  });

  it('rejects malformed addresses before transport', async () => {
    const transport = vi.fn(async () => {});
    await expect(
      sendEmailMessage({ address: 'bot@example.com', password: 'pw', smtpHost: 'smtp.example.com' }, 'not-email', 'hello', {
        transport,
      }),
    ).rejects.toThrow('email address');
    expect(transport).not.toHaveBeenCalled();
  });

  it('parses raw email headers, body, and IMAP fetch/search responses', () => {
    const raw = [
      'From: Owner <owner@example.com>',
      'Subject: =?UTF-8?B?4Liq4Lij4Li44Lib?=',
      'Message-ID: <msg-1@example.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'hello from mail',
    ].join('\r\n');
    const email = parseRawEmail(42, raw);
    expect(email).toMatchObject({
      uid: 42,
      from: 'owner@example.com',
      subject: 'สรุป',
      text: 'hello from mail',
      messageId: '<msg-1@example.com>',
    });
    expect(parseImapSearchResponse('* SEARCH 42 43\r\nA3 OK done')).toEqual([42, 43]);
    expect(parseImapFetchResponse(`* 1 FETCH (UID 42 BODY[] {${raw.length}}\r\n${raw}\r\n)\r\nA4 OK done`)[0]).toMatchObject({
      uid: 42,
      from: 'owner@example.com',
    });
  });

  it('decodes quoted-printable encoded email subjects', () => {
    const raw = [
      'From: Owner <owner@example.com>',
      'Subject: =?UTF-8?Q?caf=C3=A9_report?=',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'hello',
    ].join('\r\n');

    expect(parseRawEmail(43, raw)).toMatchObject({
      subject: 'café report',
      text: 'hello',
    });
  });

  it('enforces inbound email policy before running the agent', () => {
    const base = {
      uid: 1,
      from: 'owner@example.com',
      subject: 'hello',
      text: 'body',
    };
    const config = {
      address: 'bot@example.com',
      password: 'pw',
      smtpHost: 'smtp.example.com',
      imapHost: 'imap.example.com',
      allowedUsers: ['owner@example.com'],
    };
    expect(shouldProcessEmail(base, config)).toBe(true);
    expect(shouldProcessEmail({ ...base, from: 'other@example.com' }, config)).toBe(false);
    expect(shouldProcessEmail({ ...base, autoSubmitted: 'auto-generated' }, config)).toBe(false);
    expect(shouldProcessEmail({ ...base, from: 'bot@example.com' }, config)).toBe(false);
  });

  it('polls allowed inbound mail, runs the agent, replies, and marks seen', async () => {
    const email = { uid: 7, from: 'owner@example.com', subject: 'Help', text: 'please summarize', messageId: '<m1@example.com>' };
    const poller = vi.fn(async () => [email]);
    const markSeen = vi.fn(async () => {});
    const sendReply = vi.fn(async () => {});
    const stop = startEmail({
      address: 'bot@example.com',
      password: 'pw',
      smtpHost: 'smtp.example.com',
      imapHost: 'imap.example.com',
      allowedUsers: ['owner@example.com'],
      pollIntervalSeconds: 60,
      model: 'sonnet',
      poller,
      markSeen,
      sendReply,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    expect(poller).toHaveBeenCalledOnce();
    expect(runGatewayAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('please summarize') }));
    expect(sendReply).toHaveBeenCalledWith(expect.objectContaining({ address: 'bot@example.com' }), email, 'agent reply');
    expect(markSeen).toHaveBeenCalledWith(expect.objectContaining({ imapHost: 'imap.example.com' }), 7);
  });

  it('marks inbound mail seen but suppresses reply for silence tokens', async () => {
    const email = { uid: 8, from: 'owner@example.com', subject: 'Help', text: 'silent please', messageId: '<m2@example.com>' };
    const markSeen = vi.fn(async () => {});
    const sendReply = vi.fn(async () => {});
    const stop = startEmail({
      address: 'bot@example.com',
      password: 'pw',
      smtpHost: 'smtp.example.com',
      imapHost: 'imap.example.com',
      allowedUsers: ['owner@example.com'],
      pollIntervalSeconds: 60,
      model: 'sonnet',
      poller: vi.fn(async () => [email]),
      markSeen,
      sendReply,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    expect(sendReply).not.toHaveBeenCalled();
    expect(markSeen).toHaveBeenCalledWith(expect.anything(), 8);
  });
});
