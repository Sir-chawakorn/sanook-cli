import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select, PasswordInput } from '@inkjs/ui';
import { PROVIDERS, consoleUrl } from '../providers/registry.js';
import { assertDirectApiKey } from '../providers/keys.js';
import { listRemoteModels, mergeModelOptions } from '../providers/models.js';
import { detectCodex, type CodexStatus } from '../providers/codex.js';
import { CODEX_DEVICE_VERIFY_URL, runCodexDeviceCodeLogin } from '../providers/codex-login.js';
import { BRAND } from '../brand.js';
import { setupProviderMenuLines, setupProviderOptions } from './setup-providers.js';
import { detectDefaultLocale, getLocaleCatalog, normalizeLocale, type AppLocale } from '../i18n/index.js';

export { providerOption } from './setup-providers.js';

export interface SetupResult {
  locale: AppLocale;
  provider: string;
  model: string; // "provider:modelId"
  envVar: string;
  key: string; // '' ถ้าเป็น local/delegate provider
  permissionMode: 'auto' | 'ask';
  gatewayHint?: string;
  createBrain?: boolean;
}

type Step =
  | 'language'
  | 'welcome'
  | 'provider'
  | 'codex-auth'
  | 'codex-device-code'
  | 'key'
  | 'model'
  | 'agent'
  | 'tools'
  | 'gateway'
  | 'brain-offer'
  | 'complete';

/** first-run setup wizard: language → welcome → provider → auth → model → brain → complete */
export function SetupWizard({ onComplete }: { onComplete: (r: SetupResult) => void }) {
  const [step, setStep] = useState<Step>('language');
  const [locale, setLocale] = useState<AppLocale>(detectDefaultLocale());
  const m = getLocaleCatalog(locale).setup;
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [remote, setRemote] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [recheck, setRecheck] = useState(0);
  const [keyDraft, setKeyDraft] = useState('');
  const [keyError, setKeyError] = useState('');
  const [codexDeviceCode, setCodexDeviceCode] = useState('');
  const [codexDeviceStatus, setCodexDeviceStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [codexDeviceError, setCodexDeviceError] = useState('');
  const [codexDeviceAttempt, setCodexDeviceAttempt] = useState(0);
  const [permissionMode, setPermissionMode] = useState<'auto' | 'ask'>('ask');
  const [gatewayHint, setGatewayHint] = useState<string | undefined>();

  const cfg = provider ? PROVIDERS[provider] : undefined;
  const providerOptions = setupProviderOptions();
  const providerMenuLines = setupProviderMenuLines();

  const advanceIfCodexReady = (status: CodexStatus): void => {
    if (!status.loggedIn || !status.installed) return;
    setModel(`codex:${PROVIDERS.codex.models.default}`);
    setStep('model');
  };

  // codex-auth: เช็ก codex CLI ติดตั้ง + login ChatGPT (re-run เมื่อกด "เช็กใหม่")
  useEffect(() => {
    if (step !== 'codex-auth') return;
    let alive = true;
    setCodexStatus(null);
    void detectCodex().then((s) => {
      if (!alive) return;
      setCodexStatus(s);
      advanceIfCodexReady(s);
    });
    return () => {
      alive = false;
    };
  }, [step, recheck]);

  // Hermes-style device-code login (writes ~/.codex/auth.json for the official CLI)
  useEffect(() => {
    if (step !== 'codex-device-code') return;
    let alive = true;
    const controller = new AbortController();
    setCodexDeviceStatus('running');
    setCodexDeviceError('');
    setCodexDeviceCode('');
    void runCodexDeviceCodeLogin({
      signal: controller.signal,
      onStatus: (message) => {
        if (!alive) return;
        if (message.startsWith('code:')) setCodexDeviceCode(message.slice('code:'.length));
      },
    })
      .then(() => {
        if (!alive) return;
        setCodexDeviceStatus('done');
        setRecheck((n) => n + 1);
        setStep('codex-auth');
      })
      .catch((e) => {
        if (!alive) return;
        setCodexDeviceStatus('error');
        setCodexDeviceError((e as Error).message);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [step, codexDeviceAttempt]);

  // ดึงรายชื่อ model จริงจาก provider (เฉพาะ provider แบบ SDK ที่ต้อง/ไม่ต้อง key)
  useEffect(() => {
    if (step !== 'model' || !cfg) return;
    let alive = true;
    setLoadingModels(true);
    listRemoteModels(cfg, key || cfg.localPlaceholderKey)
      .then((ids) => alive && setRemote(ids))
      .finally(() => alive && setLoadingModels(false));
    return () => {
      alive = false;
    };
  }, [step, cfg, key]);

  const modelOptions = cfg ? mergeModelOptions(cfg, remote) : [];
  const finish = (createBrain?: boolean): void => {
    if (createBrain) {
      onComplete({
        locale,
        provider,
        model,
        envVar: cfg?.envVar ?? '',
        key,
        permissionMode,
        gatewayHint,
        createBrain: true,
      });
      return;
    }
    setStep('complete');
  };

  const finishRepl = (): void =>
    onComplete({
      locale,
      provider,
      model,
      envVar: cfg?.envVar ?? '',
      key,
      permissionMode,
      gatewayHint,
      createBrain: false,
    });

  const backToProvider = (): void => {
    setProvider('');
    setCodexStatus(null);
    setKeyError('');
    setKey('');
    setKeyDraft('');
    setCodexDeviceCode('');
    setCodexDeviceStatus('idle');
    setCodexDeviceError('');
    setStep('provider');
  };

  // Esc บนทุก step (ยกเว้น provider) = ย้อนกลับไปเลือก provider — กัน dead-end ตอนเลือกผิด
  useInput((_input, key) => {
    if (key.return && step === 'key' && !keyDraft.trim()) {
      setKeyError(m.keyEmptyError);
      return;
    }
    if (key.escape && step !== 'provider' && step !== 'language' && step !== 'codex-device-code') backToProvider();
  });

  const submitKey = (raw: string): void => {
    const k = raw.trim();
    if (!k) {
      setKeyError(m.keyEmptyError);
      return;
    }
    if (cfg) {
      try {
        assertDirectApiKey(cfg, k);
      } catch (e) {
        setKeyError((e as Error).message.split('\n')[0]);
        return;
      }
    }
    setKeyError('');
    setKey(k);
    setKeyDraft(k);
    setStep('model');
  };

  return (
    <Box flexDirection="column" gap={1} marginY={1}>
      <Text bold color="cyan">⚙  {m.title}</Text>

      {step === 'language' && (
        <Box flexDirection="column">
          <Text>{m.stepLanguage} (↑↓ · Enter):</Text>
          <Text color="gray">   {m.languageHint}</Text>
          <Select
            options={[
              { label: m.languageTh, value: 'th' },
              { label: m.languageEn, value: 'en' },
            ]}
            onChange={(v) => {
              setLocale(normalizeLocale(v));
              setStep('welcome');
            }}
          />
        </Box>
      )}

      {step === 'welcome' && (
        <Box flexDirection="column">
          <Text>{m.stepWelcome}</Text>
          <Text color="gray">{m.welcomeBody}</Text>
          <Select
            options={[{ label: m.welcomeContinue, value: 'continue' }]}
            onChange={() => setStep('provider')}
          />
        </Box>
      )}

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text>{m.stepProvider} (↑↓ · Enter):</Text>
          <Text color="gray">   {m.providerHint}</Text>
          <Text color="gray">   {m.providerMenuHint}</Text>
          {providerMenuLines.map((line) => (
            <Text key={line} color="gray">{line}</Text>
          ))}
          <Select
            options={providerOptions}
            onChange={(v) => {
              setProvider(v);
              const p = PROVIDERS[v];
              if (p.kind === 'delegate') setStep('codex-auth');
              else if (p.requiresKey) setStep('key');
              else setStep('model');
            }}
          />
        </Box>
      )}

      {step === 'codex-auth' && (
        <Box flexDirection="column">
          <Text>{m.stepCodex}</Text>
          {codexStatus === null ? (
            <Text color="gray">   {m.codexChecking}</Text>
          ) : codexStatus.loggedIn && !codexStatus.installed ? (
            <Box flexDirection="column">
              <Text color="green">   ✅ {m.codexReady}</Text>
              <Text color="yellow">   ⚠ {m.codexLoggedInNeedCli}</Text>
              <Text>
                {'   '}<Text color="cyan">{m.codexInstallCmd}</Text>
              </Text>
              <Select
                options={[
                  { label: `${m.recheckLabel}`, value: 'recheck' },
                  { label: m.codexOptionBack, value: 'back' },
                ]}
                onChange={(v) => (v === 'recheck' ? setRecheck((n) => n + 1) : backToProvider())}
              />
            </Box>
          ) : !codexStatus.installed ? (
            <Box flexDirection="column">
              <Text color="yellow">   ❌ {m.codexNeedInstall}</Text>
              <Select
                options={[
                  { label: m.codexOptionDevice, value: 'device-code' },
                  { label: m.codexOptionBack, value: 'back' },
                ]}
                onChange={(v) => {
                  if (v === 'device-code') setStep('codex-device-code');
                  else if (v === 'back') backToProvider();
                }}
              />
            </Box>
          ) : !codexStatus.loggedIn ? (
            <Box flexDirection="column">
              <Text color="yellow">   ⚠ {m.codexNeedLogin}</Text>
              <Select
                options={[
                  { label: m.codexOptionDevice, value: 'device-code' },
                  { label: m.codexOptionCliLogin, value: 'cli-login' },
                  { label: m.recheckLabel, value: 'recheck' },
                  { label: m.codexOptionBack, value: 'back' },
                ]}
                onChange={(v) => {
                  if (v === 'device-code') setStep('codex-device-code');
                  else if (v === 'recheck') setRecheck((n) => n + 1);
                  else if (v === 'back') backToProvider();
                }}
              />
              <Text color="gray">   codex login</Text>
            </Box>
          ) : (
            <Text color="green">   ✅ {m.codexReady}</Text>
          )}
        </Box>
      )}

      {step === 'codex-device-code' && (
        <Box flexDirection="column">
          <Text>{m.codexDeviceTitle}</Text>
          {codexDeviceStatus === 'running' ? (
            <>
              <Text color="gray">   {m.codexDeviceOpen}</Text>
              <Text color="cyan">      {CODEX_DEVICE_VERIFY_URL}</Text>
              {codexDeviceCode ? (
                <>
                  <Text color="gray">   {m.codexDeviceEnter}</Text>
                  <Text color="cyan" bold>{`      ${codexDeviceCode}`}</Text>
                </>
              ) : (
                <Text color="gray">   …</Text>
              )}
              <Text color="gray">   {m.codexDeviceWaiting}</Text>
            </>
          ) : codexDeviceStatus === 'error' ? (
            <>
              <Text color="red">   ✗ {codexDeviceError}</Text>
              <Select
                options={[
                  { label: m.codexDeviceRetry, value: 'retry' },
                  { label: m.codexDeviceBack, value: 'back' },
                ]}
                onChange={(v) =>
                  v === 'retry' ? setCodexDeviceAttempt((n) => n + 1) : setStep('codex-auth')
                }
              />
            </>
          ) : (
            <Text color="green">   ✅ ~/.codex/auth.json</Text>
          )}
        </Box>
      )}

      {step === 'key' && cfg && (
        <Box flexDirection="column">
          <Text>
            {m.stepKey} — {cfg.label}: <Text color="gray">{m.keyEscHint}</Text>
          </Text>
          {provider === 'openai' ? <Text color="yellow">   {m.keyOpenAiCodexHint}</Text> : null}
          {consoleUrl(provider) ? <Text color="cyan">   → {consoleUrl(provider)}</Text> : null}
          {cfg.keyExample ? (
            <Text color="gray">
              {'   '}
              {m.keyFormatHint}: {cfg.keyExample}
            </Text>
          ) : null}
          <Text color="gray">   {m.keyStorageHint}</Text>
          <PasswordInput
            placeholder={cfg.envVar}
            onChange={(v) => {
              setKeyDraft(v);
              if (keyError) setKeyError('');
            }}
            onSubmit={submitKey}
          />
          {keyError ? <Text color="red">   ✗ {keyError}</Text> : null}
        </Box>
      )}

      {step === 'model' &&
        cfg &&
        (loadingModels ? (
          <Text color="gray">
            {'   '}
            {m.modelLoading} {cfg.label}…
          </Text>
        ) : (
          <Box flexDirection="column">
            <Text>
              {m.stepModel} — {m.modelPick}
              {remote.length ? <Text color="gray"> ({modelOptions.length})</Text> : null}:
            </Text>
            {provider === 'codex' ? <Text color="gray">   {m.codexModelHint}</Text> : null}
            <Select
              options={modelOptions}
              onChange={(v) => {
                setModel(`${provider}:${v}`);
                setStep('agent');
              }}
            />
          </Box>
        ))}

      {step === 'agent' && (
        <Box flexDirection="column">
          <Text>{m.stepAgent}</Text>
          <Text color="gray">{m.agentTitle}</Text>
          <Select
            options={[
              { label: m.agentAsk, value: 'ask' },
              { label: m.agentAuto, value: 'auto' },
            ]}
            onChange={(v) => {
              setPermissionMode(v as 'auto' | 'ask');
              setStep('tools');
            }}
          />
          <Text color="gray">   {m.agentHint}</Text>
        </Box>
      )}

      {step === 'tools' && (
        <Box flexDirection="column">
          <Text>{m.stepTools}</Text>
          <Text color="gray">{m.toolsBody}</Text>
          <Text color="gray">   {m.toolsMcpHint}</Text>
          <Select
            options={[
              { label: m.toolsWebSkip, value: 'skip' },
              { label: m.toolsWebLater, value: 'later' },
            ]}
            onChange={() => setStep('gateway')}
          />
        </Box>
      )}

      {step === 'gateway' && (
        <Box flexDirection="column">
          <Text>{m.stepGateway}</Text>
          <Text color="gray">{m.gatewayBody}</Text>
          <Select
            options={[
              { label: m.gatewaySkip, value: 'skip' },
              { label: m.gatewayTelegram, value: 'telegram' },
              { label: m.gatewayDiscord, value: 'discord' },
              { label: m.gatewaySlack, value: 'slack' },
              { label: m.gatewayDashboard, value: 'dashboard' },
            ]}
            onChange={(v) => {
              if (v === 'telegram') setGatewayHint('sanook gateway setup telegram');
              else if (v === 'discord') setGatewayHint('sanook gateway setup discord');
              else if (v === 'slack') setGatewayHint('sanook gateway setup slack');
              else if (v === 'dashboard') setGatewayHint('sanook dashboard → Channels');
              else setGatewayHint(undefined);
              setStep('brain-offer');
            }}
          />
        </Box>
      )}

      {step === 'brain-offer' && (
        <Box flexDirection="column">
          <Text>{m.stepBrain}</Text>
          <Text color="gray">{m.brainQuestion}</Text>
          <Select
            options={[
              { label: m.brainYes, value: 'yes' },
              { label: m.brainNo, value: 'no' },
            ]}
            onChange={(v) => finish(v === 'yes')}
          />
        </Box>
      )}

      {step === 'complete' && (
        <Box flexDirection="column">
          <Text>{m.stepComplete}</Text>
          <Text bold>{m.completeTitle}</Text>
          <Text color="gray">{m.completeBody}</Text>
          <Text color="cyan">   {m.completeDashboard}: {BRAND.cliName} dashboard</Text>
          {gatewayHint ? <Text color="yellow">   Gateway: {gatewayHint}</Text> : null}
          <Text color="gray">   permissionMode: {permissionMode}</Text>
          <Select
            options={[{ label: m.completeRepl, value: 'repl' }]}
            onChange={() => finishRepl()}
          />
        </Box>
      )}
    </Box>
  );
}
