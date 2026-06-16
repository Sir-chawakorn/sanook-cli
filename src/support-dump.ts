import { arch, platform, release } from 'node:os';
import { appHomePath, appProjectPath, BRAND } from './brand.js';
import { authConfigPath, loadConfig, readGlobalConfigRaw, readStoredAuthRaw } from './config.js';
import { loadMcpConfig } from './mcp.js';
import { parseSpec, PROVIDERS } from './providers/registry.js';
import { redactKey } from './providers/keys.js';
import { listSessions, sessionStorePath } from './session.js';
import { loadSkills } from './skills.js';
import { projectRoot, projectTrustStatus } from './trust.js';

export interface SupportDumpOptions {
  showKeys?: boolean;
  version?: string;
  packageName?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function valueOrUnset(value: unknown): string {
  if (value === undefined || value === null || value === '') return '(not set)';
  return String(value);
}

function keySource(
  envVar: string,
  fallbacks: readonly string[],
  env: NodeJS.ProcessEnv,
): { name: string; key: string } | null {
  for (const name of [envVar, ...fallbacks]) {
    const key = env[name]?.trim();
    if (key) return { name, key };
  }
  return null;
}

function providerStatusLines(stored: Record<string, string>, env: NodeJS.ProcessEnv, showKeys: boolean): string[] {
  const lines = ['provider auth:'];
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    if (!cfg.requiresKey) {
      lines.push(`  ${id.padEnd(10)} ${cfg.label}: no API key required`);
      continue;
    }
    const runtime = keySource(cfg.envVar, cfg.envFallbacks ?? [], env);
    const saved = stored[cfg.envVar];
    const state = runtime ? `ready via ${runtime.name}` : saved ? `stored in auth.json` : `missing ${cfg.envVar}`;
    const key = runtime?.key ?? saved;
    const keySuffix = showKeys && key ? ` (${runtime?.name ?? cfg.envVar}=${redactKey(key)})` : '';
    lines.push(`  ${id.padEnd(10)} ${cfg.label}: ${state}${keySuffix}`);
  }
  return lines;
}

function mcpEndpointLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '(http endpoint)';
  }
}

export async function buildSupportDump(options: SupportDumpOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const lines: string[] = [];
  const mcpLogs: string[] = [];

  const rawConfig = await readGlobalConfigRaw();
  const storedAuth = await readStoredAuthRaw();
  const loadedConfig = await loadConfig({}, cwd).catch((e: unknown) => e as Error);
  const parsed = loadedConfig instanceof Error ? null : parseSpec(loadedConfig.model);
  const provider = parsed ? PROVIDERS[parsed.provider] : undefined;
  const root = await projectRoot(cwd);
  const trust = await projectTrustStatus(root);

  const {
    readGatewayConfig,
    resolveBlueBubblesConfig,
    resolveDingTalkConfig,
    resolveDiscordConfig,
    resolveEmailConfig,
    resolveFeishuConfig,
    resolveGoogleChatConfig,
    resolveHomeAssistantConfig,
    resolveLineConfig,
    resolveMattermostConfig,
    resolveMatrixConfig,
    resolveNtfyConfig,
    resolveQQBotConfig,
    resolveSignalConfig,
    resolveSlackConfig,
    resolveSmsConfig,
    resolveTelegramConfig,
    resolveTeamsConfig,
    resolveWeComConfig,
    resolveWeixinConfig,
    resolveWhatsAppConfig,
    resolveWebhookConfig,
    resolveYuanbaoConfig,
    gatewayConfigPath,
  } = await import('./gateway/config.js');
  const { gatewayServiceStatus } = await import('./gateway/service.js');
  const { listConfiguredTargets } = await import('./gateway/targets.js');
  const { redactSignalId } = await import('./gateway/signal.js');
  const { redactWhatsAppId } = await import('./gateway/whatsapp.js');
  const gatewayConfig = await readGatewayConfig();
  const telegram = resolveTelegramConfig(gatewayConfig, env);
  const discord = resolveDiscordConfig(gatewayConfig, env);
  const slack = resolveSlackConfig(gatewayConfig, env);
  const email = resolveEmailConfig(gatewayConfig, env);
  const homeassistant = resolveHomeAssistantConfig(gatewayConfig, env);
  const line = resolveLineConfig(gatewayConfig, env);
  const mattermost = resolveMattermostConfig(gatewayConfig, env);
  const sms = resolveSmsConfig(gatewayConfig, env);
  const ntfy = resolveNtfyConfig(gatewayConfig, env);
  const signal = resolveSignalConfig(gatewayConfig, env);
  const whatsapp = resolveWhatsAppConfig(gatewayConfig, env);
  const matrix = resolveMatrixConfig(gatewayConfig, env);
  const feishu = resolveFeishuConfig(gatewayConfig, env);
  const dingtalk = resolveDingTalkConfig(gatewayConfig, env);
  const googleChat = resolveGoogleChatConfig(gatewayConfig, env);
  const bluebubbles = resolveBlueBubblesConfig(gatewayConfig, env);
  const wecom = resolveWeComConfig(gatewayConfig, env);
  const weixin = resolveWeixinConfig(gatewayConfig, env);
  const yuanbao = resolveYuanbaoConfig(gatewayConfig, env);
  const qqbot = resolveQQBotConfig(gatewayConfig, env);
  const teams = resolveTeamsConfig(gatewayConfig, env);
  const webhooks = resolveWebhookConfig(gatewayConfig, env);
  const service = await gatewayServiceStatus();
  const targets = listConfiguredTargets(gatewayConfig, env);

  const mcp = await loadMcpConfig((m) => mcpLogs.push(m), cwd);
  const skills = await loadSkills(cwd);
  const currentSessions = await listSessions({ cwd });
  const allSessions = await listSessions({ cwd: null });
  const { tools } = await import('./tools/index.js');

  lines.push(`${BRAND.productName} support dump`);
  lines.push(`version: ${options.version ?? '(dev)'}`);
  if (options.packageName) lines.push(`package: ${options.packageName}`);
  lines.push(`node: ${process.version}`);
  lines.push(`platform: ${platform()} ${release()} ${arch()}`);
  lines.push(`cwd: ${cwd}`);
  lines.push(`project root: ${root}`);
  lines.push(`project trust: ${trust.trusted ? 'trusted' : `untrusted (${trust.reason})`}`);
  lines.push('');

  lines.push('paths:');
  lines.push(`  config: ${appHomePath('config.json')}`);
  lines.push(`  auth: ${authConfigPath()}`);
  lines.push(`  gateway config: ${gatewayConfigPath()}`);
  lines.push(`  gateway service log: ${service.logPath}`);
  lines.push(`  sessions: ${sessionStorePath()}`);
  lines.push(`  mcp global: ${appHomePath('mcp.json')}`);
  lines.push(`  mcp project: ${appProjectPath(root, 'mcp.json')}`);
  lines.push('');

  lines.push('agent config:');
  if (loadedConfig instanceof Error) {
    lines.push(`  load error: ${redactKey(loadedConfig.message)}`);
    lines.push(`  raw keys: ${Object.keys(rawConfig).sort().join(', ') || '(none)'}`);
  } else {
    lines.push(`  model: ${loadedConfig.model}`);
    lines.push(`  provider: ${provider?.label ?? parsed?.provider ?? '(unknown)'}`);
    lines.push(`  fallbackModel: ${valueOrUnset(loadedConfig.fallbackModel)}`);
    lines.push(`  permissionMode: ${loadedConfig.permissionMode}`);
    lines.push(`  maxSteps: ${loadedConfig.maxSteps}`);
    lines.push(`  budgetUsd: ${valueOrUnset(loadedConfig.budgetUsd)}`);
    lines.push(`  brainPath: ${valueOrUnset(loadedConfig.brainPath)}`);
    lines.push(`  cacheTtl: ${loadedConfig.cacheTtl}`);
    lines.push(`  compaction: ${loadedConfig.compaction}`);
    lines.push(`  thinking: ${valueOrUnset(loadedConfig.thinking)}`);
    lines.push(`  summaryModel: ${valueOrUnset(loadedConfig.summaryModel)}`);
    lines.push(`  embeddingModel: ${valueOrUnset(loadedConfig.embeddingModel)}`);
  }
  lines.push('');

  lines.push(...providerStatusLines(storedAuth, env, options.showKeys === true));
  lines.push('');

  lines.push('gateway:');
  lines.push(`  service: ${service.running ? `running pid ${service.state?.pid}` : service.state ? `stopped last pid ${service.state.pid}` : 'not started'}`);
  lines.push(`  telegram: ${telegram.token ? `configured via ${telegram.source}` : 'not configured'}; enabled=${yesNo(telegram.enabled)}; allowed=${telegram.allowedChatIds.length}; write=${yesNo(telegram.allowWrite)}`);
  lines.push(`  discord: ${discord.token ? `configured via ${discord.source}` : 'not configured'}; enabled=${yesNo(discord.enabled)}; allowed=${discord.allowedChannelIds.length}; default=${valueOrUnset(discord.defaultChannelId)}; write=${yesNo(discord.allowWrite)}`);
  lines.push(`  slack: ${slack.botToken ? `configured via ${slack.source}` : 'not configured'}; enabled=${yesNo(slack.enabled)}; appToken=${yesNo(Boolean(slack.appToken))}; allowed=${slack.allowedChannelIds.length}; default=${valueOrUnset(slack.defaultChannelId)}; write=${yesNo(slack.allowWrite)}`);
  lines.push(`  mattermost: ${mattermost.serverUrl || mattermost.token ? `configured via ${mattermost.source}` : 'not configured'}; enabled=${yesNo(mattermost.enabled)}; url=${valueOrUnset(mattermost.serverUrl)}; token=${yesNo(Boolean(mattermost.token))}; allowedUsers=${mattermost.allowedUsers.length}; allowedChannels=${mattermost.allowedChannels.length}; home=${valueOrUnset(mattermost.homeChannel)}; requireMention=${yesNo(mattermost.requireMention)}; replyMode=${mattermost.replyMode}`);
  lines.push(`  homeassistant: ${homeassistant.token ? `configured via ${homeassistant.source}` : 'not configured'}; enabled=${yesNo(homeassistant.enabled)}; url=${valueOrUnset(homeassistant.url)}; token=${yesNo(Boolean(homeassistant.token))}; watchDomains=${homeassistant.watchDomains.length}; watchEntities=${homeassistant.watchEntities.length}; ignore=${homeassistant.ignoreEntities.length}; watchAll=${yesNo(homeassistant.watchAll)}; cooldown=${homeassistant.cooldownSeconds}s`);
  lines.push(`  email: ${email.address ? `configured via ${email.source}` : 'not configured'}; enabled=${yesNo(email.enabled)}; smtp=${valueOrUnset(email.smtpHost)}:${email.smtpPort}; imap=${valueOrUnset(email.imapHost)}:${email.imapPort}; allowed=${email.allowedUsers.length}; home=${valueOrUnset(email.homeAddress)}`);
  lines.push(`  line: ${line.channelAccessToken ? `configured via ${line.source}` : 'not configured'}; enabled=${yesNo(line.enabled)}; allowed=${line.allowedUsers.length + line.allowedGroups.length + line.allowedRooms.length}; home=${valueOrUnset(line.homeChannel)}; secret=${yesNo(Boolean(line.channelSecret))}`);
  lines.push(`  sms: ${sms.accountSid && sms.authToken && sms.phoneNumber ? `configured via ${sms.source}` : 'not configured'}; enabled=${yesNo(sms.enabled)}; allowed=${sms.allowedUsers.length}; home=${valueOrUnset(sms.homeChannel)}; webhook=${valueOrUnset(sms.webhookUrl)}; signature=${sms.insecureNoSignature ? 'disabled' : 'required'}`);
  lines.push(`  ntfy: ${ntfy.topic || ntfy.token ? `configured via ${ntfy.source}` : 'not configured'}; enabled=${yesNo(ntfy.enabled)}; server=${valueOrUnset(ntfy.serverUrl)}; topic=${valueOrUnset(ntfy.topic)}; publish=${valueOrUnset(ntfy.publishTopic)}; allowed=${ntfy.allowedUsers.length}; home=${valueOrUnset(ntfy.homeChannel)}; token=${yesNo(Boolean(ntfy.token))}; markdown=${yesNo(ntfy.markdown)}`);
  lines.push(`  signal: ${signal.account ? `configured via ${signal.source}` : 'not configured'}; enabled=${yesNo(signal.enabled)}; url=${valueOrUnset(signal.httpUrl)}; account=${redactSignalId(signal.account)}; allowed=${signal.allowedUsers.length}; groups=${signal.groupAllowedUsers.length}; home=${redactSignalId(signal.homeChannel)}; requireMention=${yesNo(signal.requireMention)}`);
  lines.push(`  whatsapp: ${whatsapp.phoneNumberId || whatsapp.accessToken ? `configured via ${whatsapp.source}` : 'not configured'}; enabled=${yesNo(whatsapp.enabled)}; phoneNumberId=${yesNo(Boolean(whatsapp.phoneNumberId))}; token=${yesNo(Boolean(whatsapp.accessToken))}; secret=${yesNo(Boolean(whatsapp.appSecret))}; verifyToken=${yesNo(Boolean(whatsapp.verifyToken))}; allowed=${whatsapp.allowedUsers.length}; home=${redactWhatsAppId(whatsapp.homeChannel)}; public=${valueOrUnset(whatsapp.publicUrl)}; api=${whatsapp.apiVersion}`);
  lines.push(`  matrix: ${matrix.homeserver || matrix.accessToken || matrix.userId ? `configured via ${matrix.source}` : 'not configured'}; enabled=${yesNo(matrix.enabled)}; homeserver=${valueOrUnset(matrix.homeserver)}; token=${yesNo(Boolean(matrix.accessToken))}; user=${valueOrUnset(matrix.userId)}; password=${yesNo(Boolean(matrix.password))}; allowedUsers=${matrix.allowedUsers.length}; allowedRooms=${matrix.allowedRooms.length}; home=${valueOrUnset(matrix.homeRoom)}; requireMention=${yesNo(matrix.requireMention)}; autoJoin=${yesNo(matrix.autoJoin)}`);
  lines.push(`  feishu: ${feishu.appId || feishu.appSecret ? `configured via ${feishu.source}` : 'not configured'}; enabled=${yesNo(feishu.enabled)}; domain=${feishu.domain}; base=${valueOrUnset(feishu.baseUrl)}; appId=${yesNo(Boolean(feishu.appId))}; secret=${yesNo(Boolean(feishu.appSecret))}; verifyToken=${yesNo(Boolean(feishu.verificationToken))}; encryptKey=${yesNo(Boolean(feishu.encryptKey))}; allowedChats=${feishu.allowedChats.length}; home=${valueOrUnset(feishu.homeChannel)}; allowedUsers=${feishu.allowedUsers.length}`);
  lines.push(`  dingtalk: ${dingtalk.clientId || dingtalk.clientSecret || dingtalk.webhookUrl ? `configured via ${dingtalk.source}` : 'not configured'}; enabled=${yesNo(dingtalk.enabled)}; api=${valueOrUnset(dingtalk.apiBaseUrl)}; clientId=${yesNo(Boolean(dingtalk.clientId))}; secret=${yesNo(Boolean(dingtalk.clientSecret))}; robot=${yesNo(Boolean(dingtalk.robotCode))}; webhook=${yesNo(Boolean(dingtalk.webhookUrl))}; webhookSecret=${yesNo(Boolean(dingtalk.webhookSecret))}; allowedUsers=${dingtalk.allowedUsers.length}; allowedChats=${dingtalk.allowedChats.length}; freeChats=${dingtalk.freeResponseChats.length}; home=${valueOrUnset(dingtalk.homeChannel)}; requireMention=${yesNo(dingtalk.requireMention)}`);
  lines.push(`  googlechat: ${googleChat.serviceAccountJson || googleChat.incomingWebhookUrl ? `configured via ${googleChat.source}` : 'not configured'}; enabled=${yesNo(googleChat.enabled)}; project=${valueOrUnset(googleChat.projectId)}; subscription=${yesNo(Boolean(googleChat.subscriptionName))}; serviceAccount=${yesNo(Boolean(googleChat.serviceAccountJson))}; webhook=${yesNo(Boolean(googleChat.incomingWebhookUrl))}; allowedUsers=${googleChat.allowedUsers.length}; allowedSpaces=${googleChat.allowedSpaces.length}; freeSpaces=${googleChat.freeResponseSpaces.length}; home=${valueOrUnset(googleChat.homeChannel)}; flow=${googleChat.maxMessages}/${googleChat.maxBytes}`);
  lines.push(`  bluebubbles: ${bluebubbles.serverUrl || bluebubbles.password ? `configured via ${bluebubbles.source}` : 'not configured'}; enabled=${yesNo(bluebubbles.enabled)}; server=${valueOrUnset(bluebubbles.serverUrl)}; password=${yesNo(Boolean(bluebubbles.password))}; webhook=${bluebubbles.webhookHost}:${bluebubbles.webhookPort}${bluebubbles.webhookPath}; allowed=${bluebubbles.allowedUsers.length}; home=${valueOrUnset(bluebubbles.homeChannel)}; requireMention=${yesNo(bluebubbles.requireMention)}`);
  lines.push(`  wecom: ${wecom.botId || wecom.secret ? `configured via ${wecom.source}` : 'not configured'}; enabled=${yesNo(wecom.enabled)}; websocket=${valueOrUnset(wecom.websocketUrl)}; botId=${yesNo(Boolean(wecom.botId))}; secret=${yesNo(Boolean(wecom.secret))}; dmPolicy=${wecom.dmPolicy}; groupPolicy=${wecom.groupPolicy}; allowedUsers=${wecom.allowedUsers.length}; allowedGroups=${wecom.allowedGroups.length}; home=${valueOrUnset(wecom.homeChannel)}`);
  lines.push(`  weixin: ${weixin.accountId || weixin.token ? `configured via ${weixin.source}` : 'not configured'}; enabled=${yesNo(weixin.enabled)}; base=${valueOrUnset(weixin.baseUrl)}; account=${yesNo(Boolean(weixin.accountId))}; token=${yesNo(Boolean(weixin.token))}; dmPolicy=${weixin.dmPolicy}; groupPolicy=${weixin.groupPolicy}; allowedUsers=${weixin.allowedUsers.length}; groupUsers=${weixin.groupAllowedUsers.length}; home=${valueOrUnset(weixin.homeChannel)}; splitMultiline=${yesNo(weixin.splitMultilineMessages)}`);
  lines.push(`  yuanbao: ${yuanbao.appId || yuanbao.appSecret ? `configured via ${yuanbao.source}` : 'not configured'}; enabled=${yesNo(yuanbao.enabled)}; ws=${valueOrUnset(yuanbao.wsUrl)}; api=${valueOrUnset(yuanbao.apiDomain)}; appId=${yesNo(Boolean(yuanbao.appId))}; secret=${yesNo(Boolean(yuanbao.appSecret))}; botId=${valueOrUnset(yuanbao.botId)}; dmPolicy=${yuanbao.dmPolicy}; groupPolicy=${yuanbao.groupPolicy}; allowedUsers=${yuanbao.allowedUsers.length}; groupUsers=${yuanbao.groupAllowedUsers.length}; home=${valueOrUnset(yuanbao.homeChannel)}; routeEnv=${valueOrUnset(yuanbao.routeEnv)}; delivery=pending-websocket-protobuf`);
  lines.push(`  qqbot: ${qqbot.appId || qqbot.clientSecret ? `configured via ${qqbot.source}` : 'not configured'}; enabled=${yesNo(qqbot.enabled)}; api=${valueOrUnset(qqbot.apiBaseUrl)}; appId=${yesNo(Boolean(qqbot.appId))}; secret=${yesNo(Boolean(qqbot.clientSecret))}; dmPolicy=${qqbot.dmPolicy}; groupPolicy=${qqbot.groupPolicy}; allowedUsers=${qqbot.allowedUsers.length}; groupUsers=${qqbot.groupAllowedUsers.length}; allowedChannels=${qqbot.allowedChannels.length}; home=${valueOrUnset(qqbot.homeChannel)}; markdown=${yesNo(qqbot.markdownSupport)}`);
  lines.push(`  teams: ${teams.incomingWebhookUrl || teams.graphAccessToken || teams.clientId ? `configured via ${teams.source}` : 'not configured'}; enabled=${yesNo(teams.enabled)}; mode=${teams.deliveryMode}; webhook=${yesNo(Boolean(teams.incomingWebhookUrl))}; graphToken=${yesNo(Boolean(teams.graphAccessToken))}; chat=${valueOrUnset(teams.chatId)}; teamChannel=${teams.teamId && teams.channelId ? 'set' : '(not set)'}; home=${valueOrUnset(teams.homeChannel)}; botApp=${teams.clientId && teams.tenantId ? 'set' : '(not set)'}; allowed=${teams.allowedUsers.length}; port=${teams.port}`);
  lines.push(`  webhooks: ${webhooks.enabled ? `enabled via ${webhooks.source}` : 'not enabled'}; routes=${Object.keys(webhooks.routes).length}; secret=${yesNo(Boolean(webhooks.secret))}; public=${valueOrUnset(webhooks.publicUrl)}`);
  lines.push(`  send targets: ${targets.length}`);
  lines.push('');

  lines.push('mcp:');
  const mcpEntries = Object.entries(mcp);
  lines.push(`  servers: ${mcpEntries.length}`);
  for (const [name, cfg] of mcpEntries.slice(0, 20)) {
    lines.push(`  ${name}: ${cfg.url ? `http ${mcpEndpointLabel(cfg.url)}` : `stdio ${valueOrUnset(cfg.command)}`}`);
  }
  if (mcpEntries.length > 20) lines.push(`  ... ${mcpEntries.length - 20} more`);
  for (const log of mcpLogs) lines.push(`  note: ${redactKey(log)}`);
  lines.push('');

  lines.push('inventory:');
  lines.push(`  built-in tools: ${Object.keys(tools).length}`);
  lines.push(`  skills: ${skills.length}`);
  lines.push(`  sessions current project: ${currentSessions.length}`);
  lines.push(`  sessions all projects: ${allSessions.length}`);
  const latest = currentSessions[0] ?? allSessions[0];
  if (latest) lines.push(`  latest session: ${latest.id} updated ${latest.updated}`);
  lines.push('');

  lines.push(options.showKeys ? 'secrets: redacted prefixes/suffixes shown; raw keys are never printed' : 'secrets: hidden; use --show-keys to show redacted key fingerprints');
  return `${lines.join('\n')}\n`;
}
