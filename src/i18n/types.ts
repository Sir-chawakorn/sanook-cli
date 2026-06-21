export type AppLocale = 'en' | 'th';

export interface SetupMessages {
  title: string;
  stepLanguage: string;
  stepWelcome: string;
  stepProvider: string;
  stepCodex: string;
  stepKey: string;
  stepModel: string;
  stepAgent: string;
  stepTools: string;
  stepGateway: string;
  stepBrain: string;
  stepComplete: string;
  languageHint: string;
  languageEn: string;
  languageTh: string;
  welcomeBody: string;
  welcomeContinue: string;
  providerHint: string;
  providerMenuHint: string;
  codexTitle: string;
  codexChecking: string;
  codexNeedInstall: string;
  codexNeedLogin: string;
  codexLoggedInNeedCli: string;
  codexReady: string;
  codexDeviceTitle: string;
  codexDeviceOpen: string;
  codexDeviceEnter: string;
  codexDeviceWaiting: string;
  codexDeviceRetry: string;
  codexDeviceBack: string;
  codexOptionDevice: string;
  codexOptionCliLogin: string;
  codexOptionRecheck: string;
  codexOptionBack: string;
  codexInstallCmd: string;
  codexModelHint: string;
  keyEscHint: string;
  keyOpenAiCodexHint: string;
  keyFormatHint: string;
  keyStorageHint: string;
  keyEmptyError: string;
  modelLoading: string;
  modelPick: string;
  brainQuestion: string;
  brainYes: string;
  brainNo: string;
  completeTitle: string;
  completeBody: string;
  completeDashboard: string;
  completeRepl: string;
  continueLabel: string;
  backLabel: string;
  recheckLabel: string;
  agentTitle: string;
  agentAsk: string;
  agentAuto: string;
  agentHint: string;
  toolsTitle: string;
  toolsBody: string;
  toolsMcpHint: string;
  toolsWebSkip: string;
  toolsWebLater: string;
  gatewayTitle: string;
  gatewayBody: string;
  gatewaySkip: string;
  gatewayTelegram: string;
  gatewayDiscord: string;
  gatewaySlack: string;
  gatewayDashboard: string;
}

export interface DashboardMessages {
  productName: string;
  tagline: string;
  nav: {
    home: string;
    chat: string;
    models: string;
    sessions: string;
    files: string;
    logs: string;
    cron: string;
    channels: string;
    config: string;
    mcp: string;
    brain: string;
  };
  home: {
    title: string;
    cliVersion: string;
    model: string;
    brainPath: string;
    gateway: string;
    openRepl: string;
  };
}

export interface LocaleCatalog {
  setup: SetupMessages;
  dashboard: DashboardMessages;
}
