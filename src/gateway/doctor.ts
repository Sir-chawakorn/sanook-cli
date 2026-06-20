import { BRAND } from '../brand.js';
import type { GatewayConfig } from './config.js';
import {
  readGatewayConfig,
  resolveBlueBubblesConfig,
  resolveDiscordConfig,
  resolveEmailConfig,
  resolveGoogleChatConfig,
  resolveHomeAssistantConfig,
  resolveLineConfig,
  resolveMattermostConfig,
  resolveMatrixConfig,
  resolveNtfyConfig,
  resolveSignalConfig,
  resolveSlackConfig,
  resolveSmsConfig,
  resolveTeamsConfig,
  resolveTelegramConfig,
  resolveWebhookConfig,
  resolveWhatsAppConfig,
} from './config.js';
import { listTasks, type Task } from './ledger.js';

export type GatewayDoctorStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface GatewayDoctorCheck {
  id: string;
  channel: string;
  status: GatewayDoctorStatus;
  message: string;
  details?: string[];
}

export interface GatewayDoctorReport {
  ok: boolean;
  checks: GatewayDoctorCheck[];
}

export interface GatewayDoctorOptions {
  config?: GatewayConfig;
  env?: NodeJS.ProcessEnv;
  /** Skip live token / reachability probes (for fast status or offline tests). */
  skipNetwork?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GatewayDeliveryFailure {
  taskId: string;
  deliver: string;
  spec: string;
  error: string;
  lastRun?: number;
  status: Task['status'];
}

const CHAT_INBOUND_CHANNELS = new Set([
  'telegram',
  'discord',
  'slack',
  'mattermost',
  'line',
  'signal',
  'whatsapp',
  'matrix',
  'googlechat',
  'bluebubbles',
  'teams',
  'sms',
  'email',
  'ntfy',
]);

function check(id: string, channel: string, status: GatewayDoctorStatus, message: string, details?: string[]): GatewayDoctorCheck {
  return { id, channel, status, message, details };
}

function isHttpUrl(raw: string | undefined, opts: { requireHttps?: boolean } = {}): boolean {
  const value = raw?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    if (opts.requireHttps && url.protocol !== 'https:') return false;
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function probeOk(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
  predicate?: (response: Response, body: unknown) => boolean,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8_000) });
    const body = await response.json().catch(() => ({}));
    if (predicate ? predicate(response, body) : response.ok) return { ok: true };
    return { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: (error as Error).message || 'request failed' };
  }
}

function allowlistDetail(items: readonly string[] | readonly number[], emptyLabel: string): string[] {
  return items.length ? items.map(String) : [emptyLabel];
}

async function checkTelegram(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveTelegramConfig(config, env);
  if (!resolved.token) return [check('telegram.configured', 'telegram', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [
    check('telegram.token', 'telegram', 'pass', `bot token set (${resolved.source})`),
  ];
  if (!resolved.allowedChatIds.length) {
    checks.push(
      check('telegram.allowlist', 'telegram', 'fail', 'allowed chat ids empty — inbound fail-closed', [
        `รัน: ${BRAND.cliName} gateway setup telegram --allowed-chats <id>`,
      ]),
    );
  } else {
    checks.push(
      check('telegram.allowlist', 'telegram', 'pass', `${resolved.allowedChatIds.length} allowed chat id(s)`, allowlistDetail(resolved.allowedChatIds, '(none)')),
    );
  }
  if (!skipNetwork) {
    const probe = await probeOk(fetchImpl, `https://api.telegram.org/bot${resolved.token}/getMe`, undefined, (r, body) => {
      const parsed = body as { ok?: boolean };
      return r.ok && parsed.ok === true;
    });
    checks.push(
      check(
        'telegram.token.live',
        'telegram',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'getMe OK' : `getMe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

async function checkDiscord(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveDiscordConfig(config, env);
  if (!resolved.token) return [check('discord.configured', 'discord', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [check('discord.token', 'discord', 'pass', `bot token set (${resolved.source})`)];
  if (!resolved.defaultChannelId && !resolved.allowedChannelIds.length) {
    checks.push(check('discord.allowlist', 'discord', 'warn', 'no default channel or allowed channels — outbound may fail'));
  } else {
    checks.push(
      check('discord.allowlist', 'discord', 'pass', 'delivery targets configured', [
        resolved.defaultChannelId ? `default: ${resolved.defaultChannelId}` : '(no default)',
        ...allowlistDetail(resolved.allowedChannelIds, '(no explicit allowlist)'),
      ]),
    );
  }
  if (!skipNetwork) {
    const probe = await probeOk(
      fetchImpl,
      'https://discord.com/api/v10/users/@me',
      { headers: { authorization: `Bot ${resolved.token}` } },
      (r) => r.ok,
    );
    checks.push(
      check(
        'discord.token.live',
        'discord',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'users/@me OK' : `token probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

async function checkSlack(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveSlackConfig(config, env);
  if (!resolved.botToken) return [check('slack.configured', 'slack', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [check('slack.token', 'slack', 'pass', `bot token set (${resolved.source})`)];
  if (!resolved.appToken) {
    checks.push(check('slack.app_token', 'slack', 'warn', 'app token missing — Socket Mode inbound unavailable'));
  } else {
    checks.push(check('slack.app_token', 'slack', 'pass', 'app token set'));
  }
  if (!resolved.defaultChannelId && !resolved.allowedChannelIds.length) {
    checks.push(check('slack.allowlist', 'slack', 'warn', 'no default channel or allowed channels'));
  } else {
    checks.push(check('slack.allowlist', 'slack', 'pass', 'delivery targets configured'));
  }
  if (!skipNetwork) {
    const probe = await probeOk(
      fetchImpl,
      'https://slack.com/api/auth.test',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${resolved.botToken}`, 'content-type': 'application/x-www-form-urlencoded' },
      },
      (r, body) => {
        const parsed = body as { ok?: boolean };
        return r.ok && parsed.ok === true;
      },
    );
    checks.push(
      check(
        'slack.token.live',
        'slack',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'auth.test OK' : `auth.test failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

async function checkMattermost(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveMattermostConfig(config, env);
  if (!resolved.serverUrl && !resolved.token) return [check('mattermost.configured', 'mattermost', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (!resolved.serverUrl) checks.push(check('mattermost.url', 'mattermost', 'fail', 'server URL missing'));
  else checks.push(check('mattermost.url', 'mattermost', isHttpUrl(resolved.serverUrl) ? 'pass' : 'fail', resolved.serverUrl));
  if (!resolved.token) checks.push(check('mattermost.token', 'mattermost', 'fail', 'token missing'));
  else checks.push(check('mattermost.token', 'mattermost', 'pass', 'token set'));
  const hasAllow =
    resolved.allowAllUsers ||
    resolved.homeChannel ||
    resolved.allowedChannels.length ||
    resolved.allowedUsers.length;
  checks.push(
    check(
      'mattermost.allowlist',
      'mattermost',
      hasAllow ? 'pass' : 'fail',
      hasAllow ? 'inbound/outbound allow rules configured' : 'no home channel, allowed users/channels, or allow-all',
    ),
  );
  if (!skipNetwork && resolved.serverUrl && resolved.token) {
    const probe = await probeOk(
      fetchImpl,
      `${resolved.serverUrl}/api/v4/users/me`,
      { headers: { authorization: `Bearer ${resolved.token}` } },
      (r) => r.ok,
    );
    checks.push(
      check(
        'mattermost.token.live',
        'mattermost',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'users/me OK' : `token probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

function checkHomeAssistant(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveHomeAssistantConfig(config, env);
  const configured = Boolean(resolved.token || resolved.url !== 'http://homeassistant.local:8123');
  if (!configured) return [check('homeassistant.configured', 'homeassistant', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [
    check('homeassistant.url', 'homeassistant', isHttpUrl(resolved.url) ? 'pass' : 'fail', resolved.url),
  ];
  if (!resolved.token) checks.push(check('homeassistant.token', 'homeassistant', 'fail', 'token missing'));
  else checks.push(check('homeassistant.token', 'homeassistant', 'pass', 'token set'));
  if (!resolved.watchAll && !resolved.watchDomains.length && !resolved.watchEntities.length) {
    checks.push(check('homeassistant.watch', 'homeassistant', 'warn', 'no watch domains/entities — events may be sparse'));
  }
  return checks;
}

function checkEmail(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveEmailConfig(config, env);
  if (!resolved.address) return [check('email.configured', 'email', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [check('email.address', 'email', 'pass', resolved.address)];
  if (!resolved.password) checks.push(check('email.password', 'email', 'fail', 'password missing'));
  if (!resolved.imapHost || !resolved.smtpHost) checks.push(check('email.hosts', 'email', 'fail', 'IMAP/SMTP hosts incomplete'));
  if (!resolved.allowAllUsers && !resolved.allowedUsers.length) {
    checks.push(check('email.allowlist', 'email', 'fail', 'allowed senders empty — inbound fail-closed'));
  } else {
    checks.push(check('email.allowlist', 'email', 'pass', resolved.allowAllUsers ? 'allow all senders' : `${resolved.allowedUsers.length} allowed sender(s)`));
  }
  return checks;
}

async function checkLine(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveLineConfig(config, env);
  if (!resolved.channelAccessToken) return [check('line.configured', 'line', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [check('line.token', 'line', 'pass', `channel access token set (${resolved.source})`)];
  if (!resolved.channelSecret) checks.push(check('line.secret', 'line', 'warn', 'channel secret missing — webhook signature verification disabled'));
  if (resolved.publicUrl) {
    checks.push(
      check(
        'line.public_url',
        'line',
        isHttpUrl(resolved.publicUrl, { requireHttps: true }) ? 'pass' : 'fail',
        resolved.publicUrl,
      ),
    );
  } else {
    checks.push(check('line.public_url', 'line', 'warn', 'public URL not set — webhook inbound needs a reachable URL'));
  }
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length || resolved.allowedGroups.length || resolved.allowedRooms.length;
  checks.push(check('line.allowlist', 'line', hasAllow ? 'pass' : 'fail', hasAllow ? 'targets configured' : 'no home/allowed targets'));
  if (!skipNetwork) {
    const probe = await probeOk(
      fetchImpl,
      'https://api.line.me/v2/bot/info',
      { headers: { authorization: `Bearer ${resolved.channelAccessToken}` } },
      (r) => r.ok,
    );
    checks.push(
      check(
        'line.token.live',
        'line',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'bot/info OK' : `token probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

async function checkSms(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveSmsConfig(config, env);
  if (!resolved.accountSid && !resolved.authToken && !resolved.phoneNumber) return [check('sms.configured', 'sms', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (!resolved.accountSid || !resolved.authToken || !resolved.phoneNumber) {
    checks.push(check('sms.credentials', 'sms', 'fail', 'Twilio accountSid/authToken/phoneNumber incomplete'));
  } else {
    checks.push(check('sms.credentials', 'sms', 'pass', 'Twilio credentials set'));
  }
  if (resolved.webhookUrl) {
    checks.push(
      check(
        'sms.webhook_url',
        'sms',
        isHttpUrl(resolved.webhookUrl, { requireHttps: true }) ? 'pass' : 'fail',
        resolved.webhookUrl,
      ),
    );
  } else if (!resolved.insecureNoSignature) {
    checks.push(check('sms.webhook_url', 'sms', 'warn', 'webhook URL not set — inbound SMS webhook unavailable'));
  }
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length;
  checks.push(check('sms.allowlist', 'sms', hasAllow ? 'pass' : 'fail', hasAllow ? 'targets configured' : 'no home/allowed users'));
  if (!skipNetwork && resolved.accountSid && resolved.authToken) {
    const auth = Buffer.from(`${resolved.accountSid}:${resolved.authToken}`, 'utf8').toString('base64');
    const probe = await probeOk(
      fetchImpl,
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(resolved.accountSid)}.json`,
      { headers: { authorization: `Basic ${auth}` } },
      (r) => r.ok,
    );
    checks.push(
      check(
        'sms.token.live',
        'sms',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'Twilio account OK' : `credential probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

function checkNtfy(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveNtfyConfig(config, env);
  if (!resolved.topic && !resolved.token) return [check('ntfy.configured', 'ntfy', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [
    check('ntfy.server', 'ntfy', isHttpUrl(resolved.serverUrl) ? 'pass' : 'fail', resolved.serverUrl),
  ];
  if (!resolved.topic) checks.push(check('ntfy.topic', 'ntfy', 'fail', 'topic missing'));
  else checks.push(check('ntfy.topic', 'ntfy', 'pass', resolved.topic));
  const hasAllow = resolved.allowAllUsers || resolved.topic || resolved.homeChannel || resolved.allowedUsers.length;
  checks.push(check('ntfy.allowlist', 'ntfy', hasAllow ? 'pass' : 'fail', hasAllow ? 'topics configured' : 'no allowed topics'));
  return checks;
}

async function checkSignal(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveSignalConfig(config, env);
  if (!resolved.account) return [check('signal.configured', 'signal', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [
    check('signal.http_url', 'signal', isHttpUrl(resolved.httpUrl) ? 'pass' : 'fail', resolved.httpUrl),
    check('signal.account', 'signal', 'pass', 'account configured'),
  ];
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length || resolved.groupAllowedUsers.length;
  checks.push(check('signal.allowlist', 'signal', hasAllow ? 'pass' : 'fail', hasAllow ? 'targets configured' : 'no home/allowed users/groups'));
  if (!skipNetwork) {
    const probe = await probeOk(fetchImpl, `${resolved.httpUrl}/v1/about`, undefined, (r) => r.ok);
    checks.push(
      check(
        'signal.reachable',
        'signal',
        probe.ok ? 'pass' : 'warn',
        probe.ok ? 'signal-cli HTTP reachable' : `signal-cli HTTP probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

function checkWhatsApp(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveWhatsAppConfig(config, env);
  if (!resolved.phoneNumberId && !resolved.accessToken) return [check('whatsapp.configured', 'whatsapp', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (!resolved.phoneNumberId || !resolved.accessToken) checks.push(check('whatsapp.credentials', 'whatsapp', 'fail', 'phoneNumberId/accessToken incomplete'));
  else checks.push(check('whatsapp.credentials', 'whatsapp', 'pass', 'Cloud API credentials set'));
  if (!resolved.appSecret) checks.push(check('whatsapp.app_secret', 'whatsapp', 'warn', 'app secret missing — webhook signature verification disabled'));
  if (resolved.publicUrl) {
    checks.push(
      check(
        'whatsapp.public_url',
        'whatsapp',
        isHttpUrl(resolved.publicUrl, { requireHttps: true }) ? 'pass' : 'fail',
        resolved.publicUrl,
      ),
    );
  } else {
    checks.push(check('whatsapp.public_url', 'whatsapp', 'warn', 'public URL not set — Meta webhook needs a reachable URL'));
  }
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length;
  checks.push(check('whatsapp.allowlist', 'whatsapp', hasAllow ? 'pass' : 'fail', hasAllow ? 'targets configured' : 'no home/allowed users'));
  return checks;
}

async function checkMatrix(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  skipNetwork: boolean,
): Promise<GatewayDoctorCheck[]> {
  const resolved = resolveMatrixConfig(config, env);
  if (!resolved.homeserver && !resolved.accessToken && !resolved.userId) return [check('matrix.configured', 'matrix', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (!resolved.homeserver) checks.push(check('matrix.homeserver', 'matrix', 'fail', 'homeserver missing'));
  else checks.push(check('matrix.homeserver', 'matrix', isHttpUrl(resolved.homeserver) ? 'pass' : 'fail', resolved.homeserver));
  if (!resolved.accessToken && !(resolved.userId && resolved.password)) {
    checks.push(check('matrix.auth', 'matrix', 'fail', 'access token or userId/password required'));
  } else {
    checks.push(check('matrix.auth', 'matrix', 'pass', resolved.accessToken ? 'access token set' : 'password auth configured'));
  }
  const hasAllow = resolved.allowAllUsers || resolved.homeRoom || resolved.allowedRooms.length || resolved.allowedUsers.length;
  checks.push(check('matrix.allowlist', 'matrix', hasAllow ? 'pass' : 'fail', hasAllow ? 'rooms configured' : 'no home/allowed rooms'));
  if (!skipNetwork && resolved.homeserver && resolved.accessToken) {
    const probe = await probeOk(
      fetchImpl,
      `${resolved.homeserver}/_matrix/client/v3/account/whoami`,
      { headers: { authorization: `Bearer ${resolved.accessToken}` } },
      (r) => r.ok,
    );
    checks.push(
      check(
        'matrix.token.live',
        'matrix',
        probe.ok ? 'pass' : 'fail',
        probe.ok ? 'whoami OK' : `token probe failed${probe.detail ? `: ${probe.detail}` : ''}`,
      ),
    );
  }
  return checks;
}

function checkGoogleChat(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveGoogleChatConfig(config, env);
  if (!resolved.serviceAccountJson && !resolved.incomingWebhookUrl) return [check('googlechat.configured', 'googlechat', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (resolved.incomingWebhookUrl) {
    checks.push(
      check(
        'googlechat.webhook_url',
        'googlechat',
        isHttpUrl(resolved.incomingWebhookUrl, { requireHttps: true }) ? 'pass' : 'fail',
        'incoming webhook configured',
      ),
    );
  }
  if (resolved.serviceAccountJson) checks.push(check('googlechat.service_account', 'googlechat', 'pass', 'service account configured'));
  if (!resolved.incomingWebhookUrl && !resolved.serviceAccountJson) {
    checks.push(check('googlechat.delivery', 'googlechat', 'fail', 'no webhook or Chat API credentials'));
  }
  const hasAllow = resolved.allowAllSpaces || resolved.homeChannel || resolved.allowedSpaces.length;
  checks.push(check('googlechat.allowlist', 'googlechat', hasAllow ? 'pass' : 'fail', hasAllow ? 'spaces configured' : 'no home/allowed spaces'));
  return checks;
}

function checkBlueBubbles(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveBlueBubblesConfig(config, env);
  if (!resolved.serverUrl && !resolved.password) return [check('bluebubbles.configured', 'bluebubbles', 'skip', 'not configured')];
  const checks: GatewayDoctorCheck[] = [];
  if (!resolved.serverUrl) checks.push(check('bluebubbles.server', 'bluebubbles', 'fail', 'server URL missing'));
  else checks.push(check('bluebubbles.server', 'bluebubbles', isHttpUrl(resolved.serverUrl) ? 'pass' : 'fail', resolved.serverUrl));
  if (!resolved.password) checks.push(check('bluebubbles.password', 'bluebubbles', 'fail', 'password missing'));
  else checks.push(check('bluebubbles.password', 'bluebubbles', 'pass', 'password set'));
  checks.push(
    check(
      'bluebubbles.webhook',
      'bluebubbles',
      'pass',
      `local webhook ${resolved.webhookHost}:${resolved.webhookPort}${resolved.webhookPath}`,
    ),
  );
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length;
  checks.push(check('bluebubbles.allowlist', 'bluebubbles', hasAllow ? 'pass' : 'fail', hasAllow ? 'targets configured' : 'no home/allowed users'));
  return checks;
}

function checkTeams(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveTeamsConfig(config, env);
  if (!resolved.incomingWebhookUrl && !resolved.graphAccessToken && !resolved.clientId) {
    return [check('teams.configured', 'teams', 'skip', 'not configured')];
  }
  const checks: GatewayDoctorCheck[] = [check('teams.mode', 'teams', 'pass', `delivery mode: ${resolved.deliveryMode}`)];
  if (resolved.incomingWebhookUrl) {
    checks.push(
      check(
        'teams.webhook_url',
        'teams',
        isHttpUrl(resolved.incomingWebhookUrl, { requireHttps: true }) ? 'pass' : 'fail',
        'incoming webhook configured',
      ),
    );
  }
  if (resolved.deliveryMode === 'graph' && !resolved.graphAccessToken && !(resolved.clientId && resolved.clientSecret && resolved.tenantId)) {
    checks.push(check('teams.graph', 'teams', 'fail', 'graph mode needs access token or client credentials'));
  }
  const hasAllow = resolved.allowAllUsers || resolved.homeChannel || resolved.allowedUsers.length || resolved.incomingWebhookUrl || resolved.chatId;
  checks.push(check('teams.allowlist', 'teams', hasAllow ? 'pass' : 'warn', hasAllow ? 'delivery target configured' : 'no home/chat/webhook target'));
  return checks;
}

function checkWebhooks(config: GatewayConfig, env: NodeJS.ProcessEnv): GatewayDoctorCheck[] {
  const resolved = resolveWebhookConfig(config, env);
  if (!resolved.enabled && resolved.source === 'none') return [check('webhooks.configured', 'webhooks', 'skip', 'not enabled')];
  const checks: GatewayDoctorCheck[] = [check('webhooks.enabled', 'webhooks', resolved.enabled ? 'pass' : 'warn', resolved.enabled ? 'enabled' : 'disabled in config')];
  if (resolved.publicUrl) {
    checks.push(
      check(
        'webhooks.public_url',
        'webhooks',
        isHttpUrl(resolved.publicUrl, { requireHttps: true }) ? 'pass' : 'fail',
        resolved.publicUrl,
      ),
    );
  } else {
    checks.push(check('webhooks.public_url', 'webhooks', 'warn', 'public URL not set — external systems cannot reach routes'));
  }
  const routeNames = Object.keys(resolved.routes);
  if (!routeNames.length) checks.push(check('webhooks.routes', 'webhooks', 'warn', 'no routes configured'));
  else {
    const missingDeliver = routeNames.filter((name) => !resolved.routes[name]?.deliver);
    checks.push(
      check(
        'webhooks.routes',
        'webhooks',
        missingDeliver.length ? 'warn' : 'pass',
        `${routeNames.length} route(s)`,
        missingDeliver.length ? missingDeliver.map((name) => `${name}: deliver target missing`) : undefined,
      ),
    );
  }
  if (!resolved.secret) checks.push(check('webhooks.secret', 'webhooks', 'warn', 'global webhook secret not set'));
  return checks;
}

export async function checkGateway(options: GatewayDoctorOptions = {}): Promise<GatewayDoctorReport> {
  const config = options.config ?? (await readGatewayConfig());
  const env = options.env ?? process.env;
  const skipNetwork = options.skipNetwork === true;
  const fetchImpl = options.fetchImpl ?? fetch;

  const groups = await Promise.all([
    checkTelegram(config, env, fetchImpl, skipNetwork),
    checkDiscord(config, env, fetchImpl, skipNetwork),
    checkSlack(config, env, fetchImpl, skipNetwork),
    checkMattermost(config, env, fetchImpl, skipNetwork),
    Promise.resolve(checkHomeAssistant(config, env)),
    Promise.resolve(checkEmail(config, env)),
    checkLine(config, env, fetchImpl, skipNetwork),
    checkSms(config, env, fetchImpl, skipNetwork),
    Promise.resolve(checkNtfy(config, env)),
    checkSignal(config, env, fetchImpl, skipNetwork),
    Promise.resolve(checkWhatsApp(config, env)),
    checkMatrix(config, env, fetchImpl, skipNetwork),
    Promise.resolve(checkGoogleChat(config, env)),
    Promise.resolve(checkBlueBubbles(config, env)),
    Promise.resolve(checkTeams(config, env)),
    Promise.resolve(checkWebhooks(config, env)),
  ]);

  const checks = groups.flat();
  const configured = checks.some((item) => item.status !== 'skip');
  if (!configured) {
    checks.unshift(check('gateway.configured', 'gateway', 'warn', 'no gateway channels configured'));
  }
  return { ok: !checks.some((item) => item.status === 'fail'), checks };
}

export function summarizeChannelHealth(checks: GatewayDoctorCheck[]): Array<{ channel: string; status: GatewayDoctorStatus }> {
  const byChannel = new Map<string, GatewayDoctorStatus>();
  const rank: Record<GatewayDoctorStatus, number> = { fail: 4, warn: 3, pass: 2, skip: 1 };
  for (const item of checks) {
    if (item.channel === 'gateway') continue;
    const current = byChannel.get(item.channel);
    if (!current || rank[item.status] > rank[current]) byChannel.set(item.channel, item.status);
  }
  return [...byChannel.entries()]
    .map(([channel, status]) => ({ channel, status }))
    .sort((a, b) => a.channel.localeCompare(b.channel));
}

export async function listPendingCronJobs(now = Date.now()): Promise<Task[]> {
  return (await listTasks())
    .filter((task) => task.kind === 'cron' && task.status === 'queued')
    .sort((a, b) => a.runAt - b.runAt || a.createdAt - b.createdAt);
}

export async function listRecentDeliveryFailures(limit = 5): Promise<GatewayDeliveryFailure[]> {
  return (await listTasks())
    .filter((task) => Boolean(task.deliver?.trim() && task.lastError?.trim()))
    .sort((a, b) => (b.lastRun ?? b.createdAt) - (a.lastRun ?? a.createdAt))
    .slice(0, limit)
    .map((task) => ({
      taskId: task.id,
      deliver: task.deliver!.trim(),
      spec: task.spec,
      error: task.lastError!.trim(),
      lastRun: task.lastRun,
      status: task.status,
    }));
}

export function formatGatewayDoctorStatus(status: GatewayDoctorStatus): string {
  return status.toUpperCase().padEnd(4);
}

export function formatGatewayDoctorReport(report: GatewayDoctorReport): string {
  const lines = [`${BRAND.productName} gateway doctor`, ''];
  for (const item of report.checks) {
    lines.push(`[${formatGatewayDoctorStatus(item.status)}] ${item.channel}/${item.id} — ${item.message}`);
    for (const detail of item.details ?? []) lines.push(`       - ${detail}`);
  }
  lines.push('', report.ok ? 'OK — no failing checks' : 'FAIL — fix failing checks above');
  return lines.join('\n');
}

export function isInboundChatChannel(channel: string): boolean {
  return CHAT_INBOUND_CHANNELS.has(channel);
}
