import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { hostname } from 'node:os';
import { redactKey } from '../providers/keys.js';
import { runGatewayAgent } from './session.js';

export interface EmailSendConfig {
  address: string;
  password: string;
  smtpHost: string;
  smtpPort?: number;
  fromName?: string;
}

export interface EmailSendResult {
  to: string;
  messageId: string;
}

interface RawEmail {
  config: EmailSendConfig;
  to: string;
  raw: string;
}

type SmtpSocket = net.Socket | tls.TLSSocket;
export type RawEmailTransport = (email: RawEmail) => Promise<void>;

export interface SendEmailOptions {
  subject?: string;
  inReplyTo?: string;
  references?: string;
  transport?: RawEmailTransport;
}

export interface InboundEmail {
  uid: number;
  from: string;
  subject: string;
  text: string;
  messageId?: string;
  references?: string;
  autoSubmitted?: string;
  precedence?: string;
  listUnsubscribe?: string;
}

export interface EmailReceiveConfig extends EmailSendConfig {
  imapHost: string;
  imapPort?: number;
  allowedUsers?: string[];
  allowAllUsers?: boolean;
  pollIntervalSeconds?: number;
  homeAddress?: string;
}

export interface EmailGatewayOpts extends EmailReceiveConfig {
  model: string;
  budgetUsd?: number;
  allowWrite?: boolean;
  onLog?: (m: string) => void;
  poller?: (config: EmailReceiveConfig) => Promise<InboundEmail[]>;
  markSeen?: (config: EmailReceiveConfig, uid: number) => Promise<void>;
  sendReply?: (config: EmailSendConfig, email: InboundEmail, text: string) => Promise<void>;
}

export function normalizeEmailAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed)) {
    throw new Error(`email address ไม่ถูกต้อง: ${address}`);
  }
  return trimmed;
}

function encodeHeader(raw: string): string {
  const clean = raw.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function messageDomain(address: string): string {
  return address.split('@')[1] || hostname() || 'localhost';
}

export function buildEmailMessage(config: EmailSendConfig, to: string, text: string, subject = 'Sanook'): { raw: string; messageId: string } {
  return buildEmailMessageWithHeaders(config, to, text, { subject });
}

export function buildEmailMessageWithHeaders(
  config: EmailSendConfig,
  to: string,
  text: string,
  options: Pick<SendEmailOptions, 'subject' | 'inReplyTo' | 'references'> = {},
): { raw: string; messageId: string } {
  const from = normalizeEmailAddress(config.address);
  const recipient = normalizeEmailAddress(to);
  const messageId = `<${randomUUID()}@${messageDomain(from)}>`;
  const fromHeader = config.fromName ? `${encodeHeader(config.fromName)} <${from}>` : from;
  const refs = [options.references, options.inReplyTo].filter(Boolean).join(' ').trim();
  const headers = [
    `From: ${fromHeader}`,
    `To: ${recipient}`,
    `Subject: ${encodeHeader(options.subject ?? 'Sanook')}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(refs ? [`References: ${refs}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return {
    messageId,
    raw: `${headers.join('\r\n')}\r\n\r\n${dotStuff(text)}\r\n`,
  };
}

function connectSocket(host: string, port: number, secure: boolean): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function readResponse(socket: SmtpSocket, timeoutMs = 20_000): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => cleanup(new Error('SMTP timeout')), timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      const done = last?.match(/^(\d{3}) /);
      if (done) cleanup(undefined, { code: Number(done[1]), text: lines.join('\n') });
    };
    const onError = (e: Error): void => cleanup(e);
    const cleanup = (err?: Error, value?: { code: number; text: string }): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (err) reject(err);
      else resolve(value!);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function command(socket: SmtpSocket, line: string, ok: number | number[]): Promise<{ code: number; text: string }> {
  socket.write(`${line}\r\n`);
  const response = await readResponse(socket);
  const accepted = Array.isArray(ok) ? ok : [ok];
  if (!accepted.includes(response.code)) throw new Error(`SMTP ${line.split(/\s+/)[0]} failed: ${response.text}`);
  return response;
}

async function wrapStartTls(socket: SmtpSocket, host: string): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket: socket as net.Socket, servername: host }, () => resolve(secured));
    secured.once('error', reject);
  });
}

async function sendViaSmtp(email: RawEmail): Promise<void> {
  const port = email.config.smtpPort ?? 587;
  const implicitTls = port === 465;
  let socket = await connectSocket(email.config.smtpHost, port, implicitTls);
  try {
    const greeting = await readResponse(socket);
    if (greeting.code !== 220) throw new Error(`SMTP greeting failed: ${greeting.text}`);
    let ehlo = await command(socket, `EHLO ${hostname() || 'localhost'}`, 250);
    if (!implicitTls && /STARTTLS/im.test(ehlo.text)) {
      await command(socket, 'STARTTLS', 220);
      socket = await wrapStartTls(socket, email.config.smtpHost);
      ehlo = await command(socket, `EHLO ${hostname() || 'localhost'}`, 250);
    }
    if (!implicitTls && port !== 25 && !/AUTH/im.test(ehlo.text)) {
      throw new Error('SMTP server did not advertise AUTH after EHLO');
    }
    const auth = Buffer.from(`\0${email.config.address}\0${email.config.password}`, 'utf8').toString('base64');
    await command(socket, `AUTH PLAIN ${auth}`, 235);
    await command(socket, `MAIL FROM:<${normalizeEmailAddress(email.config.address)}>`, 250);
    await command(socket, `RCPT TO:<${normalizeEmailAddress(email.to)}>`, [250, 251]);
    await command(socket, 'DATA', 354);
    socket.write(`${email.raw}\r\n.\r\n`);
    const sent = await readResponse(socket);
    if (sent.code !== 250) throw new Error(`SMTP DATA failed: ${sent.text}`);
    await command(socket, 'QUIT', 221).catch(() => {});
  } finally {
    socket.end();
  }
}

export async function sendEmailMessage(config: EmailSendConfig, to: string, text: string, options: SendEmailOptions = {}): Promise<EmailSendResult> {
  if (!config.address || !config.password || !config.smtpHost) {
    throw new Error('Email ต้องมี address, password และ smtpHost');
  }
  const recipient = normalizeEmailAddress(to);
  const { raw, messageId } = buildEmailMessageWithHeaders(config, recipient, text, options);
  await (options.transport ?? sendViaSmtp)({ config, to: recipient, raw });
  return { to: recipient, messageId };
}

function headerValue(raw: string, name: string): string | undefined {
  const lines = raw.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const prefix = `${name.toLowerCase()}:`;
  const found = lines.find((line) => line.toLowerCase().startsWith(prefix));
  return found?.slice(prefix.length).trim();
}

function splitHeaderBody(raw: string): { headers: string; body: string } {
  const match = raw.match(/\r?\n\r?\n/);
  if (!match || match.index == null) return { headers: raw, body: '' };
  return { headers: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function decodeQuotedPrintableHeader(raw: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (char === '_') {
      bytes.push(0x20);
      continue;
    }
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    bytes.push(...Buffer.from(char, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeHeader(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/=\?utf-8\?([bq])\?([^?]+)\?=/gi, (_m, encoding: string, value: string) =>
    encoding.toLowerCase() === 'b' ? Buffer.from(value, 'base64').toString('utf8') : decodeQuotedPrintableHeader(value),
  );
}

export function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  return (match?.[1] ?? raw).replace(/^mailto:/i, '').trim().toLowerCase();
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function decodeTransfer(raw: string, encoding: string | undefined): string {
  if (/base64/i.test(encoding ?? '')) return Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/quoted-printable/i.test(encoding ?? '')) {
    return raw
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return raw;
}

function messageBody(raw: string): string {
  const { headers, body } = splitHeaderBody(raw);
  if (!body) return '';
  const contentType = headerValue(headers, 'Content-Type') ?? '';
  const encoding = headerValue(headers, 'Content-Transfer-Encoding');
  const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`);
    const textPart = parts.find((part) => /content-type:\s*text\/plain/i.test(part));
    const htmlPart = parts.find((part) => /content-type:\s*text\/html/i.test(part));
    const chosen = textPart ?? htmlPart ?? '';
    const { headers: partHeaders, body: partBody } = splitHeaderBody(chosen);
    if (partBody) {
      const decoded = decodeTransfer(partBody, headerValue(partHeaders, 'Content-Transfer-Encoding'));
      return /content-type:\s*text\/html/i.test(partHeaders) ? stripHtml(decoded).trim() : decoded.trim();
    }
  }
  const decoded = decodeTransfer(body, encoding);
  return /text\/html/i.test(contentType) ? stripHtml(decoded).trim() : decoded.trim();
}

export function parseRawEmail(uid: number, raw: string): InboundEmail {
  const { headers } = splitHeaderBody(raw);
  return {
    uid,
    from: extractEmailAddress(headerValue(headers, 'From') ?? ''),
    subject: decodeHeader(headerValue(headers, 'Subject')) || '(no subject)',
    text: messageBody(raw),
    messageId: headerValue(headers, 'Message-ID'),
    references: headerValue(headers, 'References'),
    autoSubmitted: headerValue(headers, 'Auto-Submitted'),
    precedence: headerValue(headers, 'Precedence'),
    listUnsubscribe: headerValue(headers, 'List-Unsubscribe'),
  };
}

export function shouldProcessEmail(email: InboundEmail, config: EmailReceiveConfig): boolean {
  const from = extractEmailAddress(email.from);
  const self = extractEmailAddress(config.address);
  if (!from || from === self) return false;
  if (/^(no-?reply|mailer-daemon|postmaster|bounce)@/i.test(from)) return false;
  if (email.autoSubmitted && !/^no$/i.test(email.autoSubmitted)) return false;
  if (/bulk|junk|list/i.test(email.precedence ?? '')) return false;
  if (email.listUnsubscribe) return false;
  if (config.allowAllUsers) return true;
  const allowed = new Set((config.allowedUsers ?? []).map((s) => s.toLowerCase()));
  return allowed.has(from);
}

function imapQuote(raw: string): string {
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readImapGreeting(socket: SmtpSocket, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => cleanup(new Error('IMAP greeting timeout')), timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString('utf8');
      if (/^\* (OK|PREAUTH|BYE|BAD)/m.test(buffer)) cleanup(undefined, buffer);
    };
    const onError = (e: Error): void => cleanup(e);
    const cleanup = (err?: Error, value?: string): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (err) reject(err);
      else resolve(value ?? buffer);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function readImapResponse(socket: SmtpSocket, tag: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const tagPattern = escapeRegExp(tag);
    const timer = setTimeout(() => cleanup(new Error('IMAP timeout')), timeoutMs);
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString('utf8');
      if (new RegExp(`^${tagPattern} (OK|NO|BAD)`, 'm').test(buffer)) cleanup(undefined, buffer);
    };
    const onError = (e: Error): void => cleanup(e);
    const cleanup = (err?: Error, value?: string): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      if (err) reject(err);
      else resolve(value ?? buffer);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function imapCommand(socket: SmtpSocket, tag: string, commandText: string): Promise<string> {
  socket.write(`${tag} ${commandText}\r\n`);
  const response = await readImapResponse(socket, tag);
  if (!new RegExp(`^${escapeRegExp(tag)} OK`, 'm').test(response)) throw new Error(`IMAP ${commandText.split(/\s+/)[0]} failed: ${response}`);
  return response;
}

export function parseImapSearchResponse(response: string): number[] {
  const line = response.split(/\r?\n/).find((l) => l.startsWith('* SEARCH'));
  if (!line) return [];
  return line
    .slice('* SEARCH'.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isSafeInteger(n));
}

export function parseImapFetchResponse(response: string): InboundEmail[] {
  const out: InboundEmail[] = [];
  const marker = /UID\s+(\d+)[\s\S]*?BODY(?:\.PEEK)?\[\]\s+\{(\d+)\}\r?\n/gim;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(response))) {
    const uid = Number(match[1]);
    const len = Number(match[2]);
    const bodyStart = marker.lastIndex;
    const raw = response.slice(bodyStart, bodyStart + len);
    if (Number.isSafeInteger(uid) && raw) out.push(parseRawEmail(uid, raw));
    marker.lastIndex = bodyStart + len;
  }
  return out;
}

async function connectImap(config: EmailReceiveConfig): Promise<SmtpSocket> {
  const port = config.imapPort ?? 993;
  return connectSocket(config.imapHost, port, port === 993);
}

export async function fetchUnseenEmails(config: EmailReceiveConfig): Promise<InboundEmail[]> {
  if (!config.address || !config.password || !config.imapHost) throw new Error('Email ต้องมี address, password และ imapHost');
  const socket = await connectImap(config);
  try {
    const greeting = await readImapGreeting(socket).catch(() => '');
    if (greeting && /^(\* )?BAD/im.test(greeting)) throw new Error(`IMAP greeting failed: ${greeting}`);
    await imapCommand(socket, 'A1', `LOGIN ${imapQuote(config.address)} ${imapQuote(config.password)}`);
    await imapCommand(socket, 'A2', 'SELECT INBOX');
    const search = await imapCommand(socket, 'A3', 'UID SEARCH UNSEEN');
    const uids = parseImapSearchResponse(search);
    if (!uids.length) return [];
    const fetch = await imapCommand(socket, 'A4', `UID FETCH ${uids.join(',')} (UID BODY.PEEK[])`);
    return parseImapFetchResponse(fetch);
  } finally {
    await imapCommand(socket, 'ZZ', 'LOGOUT').catch(() => {});
    socket.end();
  }
}

export async function markEmailSeen(config: EmailReceiveConfig, uid: number): Promise<void> {
  if (!config.address || !config.password || !config.imapHost) throw new Error('Email ต้องมี address, password และ imapHost');
  const socket = await connectImap(config);
  try {
    await readImapGreeting(socket).catch(() => '');
    await imapCommand(socket, 'A1', `LOGIN ${imapQuote(config.address)} ${imapQuote(config.password)}`);
    await imapCommand(socket, 'A2', 'SELECT INBOX');
    await imapCommand(socket, 'A3', `UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
  } finally {
    await imapCommand(socket, 'ZZ', 'LOGOUT').catch(() => {});
    socket.end();
  }
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export async function sendEmailReply(config: EmailSendConfig, email: InboundEmail, text: string): Promise<void> {
  await sendEmailMessage(config, email.from, text || '(ไม่มีผลลัพธ์)', {
    subject: replySubject(email.subject),
    inReplyTo: email.messageId,
    references: email.references,
  });
}

function emailPrompt(email: InboundEmail): string {
  return [
    `Email from: ${email.from}`,
    `Subject: ${email.subject}`,
    '',
    'Message:',
    email.text || '(empty)',
  ].join('\n');
}

export function startEmail(opts: EmailGatewayOpts): () => void {
  if (!opts.address || !opts.password || !opts.imapHost || !opts.smtpHost) {
    opts.onLog?.('Email ไม่เริ่ม: ต้องตั้ง address/password/imapHost/smtpHost');
    return () => {};
  }
  if (!opts.allowAllUsers && !opts.allowedUsers?.length) {
    opts.onLog?.('⛔ Email ไม่เริ่ม: ต้องตั้ง allowedUsers หรือ allowAllUsers — remote surface นี้รัน agent ได้');
    return () => {};
  }
  const pollMs = Math.max(5, opts.pollIntervalSeconds ?? 15) * 1000;
  const poller = opts.poller ?? fetchUnseenEmails;
  const markSeen = opts.markSeen ?? markEmailSeen;
  const sendReply = opts.sendReply ?? sendEmailReply;
  const running = new Set<number>();
  let stopped = false;
  let busy = false;
  opts.onLog?.(`Email: IMAP polling เริ่มแล้ว (${opts.address}, ทุก ${pollMs / 1000}s)`);

  async function handle(email: InboundEmail): Promise<void> {
    if (running.has(email.uid)) return;
    running.add(email.uid);
    try {
      if (!shouldProcessEmail(email, opts)) {
        opts.onLog?.(`Email: ข้าม ${email.uid} จาก ${email.from} (ไม่ผ่าน policy)`);
        return;
      }
      opts.onLog?.(`Email ${email.uid} จาก ${email.from}: ${email.subject.slice(0, 60)}`);
      try {
        const result = await runGatewayAgent({
          platform: 'email',
          target: email.from,
          model: opts.model,
          prompt: emailPrompt(email),
          budgetUsd: opts.budgetUsd,
          permissionMode: opts.allowWrite === true ? 'auto' : 'ask',
        });
        if (!result.suppressDelivery) await sendReply(opts, email, result.text || '(ไม่มีผลลัพธ์)');
      } catch (e) {
        opts.onLog?.(`Email run error (${email.uid}): ${redactKey((e as Error).message)}`);
        await sendReply(opts, email, 'เกิดข้อผิดพลาดภายใน').catch((err) =>
          opts.onLog?.(`Email reply error (${email.uid}): ${redactKey((err as Error).message)}`),
        );
      }
    } finally {
      await markSeen(opts, email.uid).catch((e) => opts.onLog?.(`Email mark-seen error (${email.uid}): ${redactKey((e as Error).message)}`));
      running.delete(email.uid);
    }
  }

  async function tick(): Promise<void> {
    if (stopped || busy) return;
    busy = true;
    try {
      const emails = await poller(opts);
      for (const email of emails) await handle(email);
    } catch (e) {
      if (!stopped) opts.onLog?.(`Email poll error: ${redactKey((e as Error).message)}`);
    } finally {
      busy = false;
    }
  }

  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
