export interface ApiConfig {
  apiFootballKey: string;
  kaggleUsername: string;
  kaggleApiKey: string;
  agentTrainingEnabled: boolean;
  apiFootballDisabledLeagueIds?: number[];
  llmEnabled?: boolean;
  llmProvider?: 'none' | 'deepseek' | 'openai' | 'anthropic' | 'google';
  deepseekApiKey?: string;
  deepseekModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  automationAdminToken?: string;
  betfairBankroll?: number;
  betfairMarketPercents?: Record<string, number>;
  betfairRobotLimits?: {
    scalpingGoals?: {
      profitTargetPct?: number;
      stakePct?: number;
      entryOffsetTicks?: number;
      secondsToWaitMatch?: number;
    };
    scalpingTicks?: {
      targetTicks?: number;
      entryOffsetTicks?: number;
      maxSpreadTicks?: number;
      minSecondsBetweenCycles?: number;
      stakePct?: number;
      maxCycles?: number;
      secondsToWaitMatch?: number;
    };
    overGoalsLimit?: {
      minOdds?: number;
      maxEntries?: number;
      profitTargetPct?: number;
      minDeltaTraded?: number;
      dominanceRatio?: number;
      minSecondsBetweenEntries?: number;
      stakePct?: number;
      entryOffsetTicks?: number;
      secondsToWaitMatch?: number;
    };
  };
}

export const API_ENDPOINTS = {
  apiFootball: 'https://v3.football.api-sports.io',
};

const isQuotaExceeded = (e: unknown) => {
  const anyE = e as any;
  const name = String(anyE?.name ?? '');
  const code = Number(anyE?.code ?? NaN);
  return name === 'QuotaExceededError' || code === 22 || code === 1014;
};

const cleanupStorageForConfigSave = () => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k) keys.push(k);
  }

  const shouldRemove = (k: string) => {
    if (k === 'training_sessions') return true;
    if (k === 'apiFootball_leagues_cache_v2') return true;
    if (k.startsWith('apiFootball_leagues_cache_v2_')) return true;
    if (k.startsWith('matchesCache_v')) return true;
    if (k.startsWith('predictionStore_v')) return true;
    if (k.startsWith('bots_chat_v')) return true;
    if (k.startsWith('bots_external_insights_v')) return true;
    return false;
  };

  for (const k of keys) {
    if (!shouldRemove(k)) continue;
    try {
      localStorage.removeItem(k);
    } catch {}
  }
};

// Salvar configurações no localStorage
export function saveApiConfig(config: ApiConfig): void {
  try {
    localStorage.setItem('apiConfig', JSON.stringify(config));
  } catch (e) {
    if (!isQuotaExceeded(e)) throw e;
    cleanupStorageForConfigSave();
    localStorage.setItem('apiConfig', JSON.stringify(config));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('apiConfigChanged'));
  }
}

function parseBooleanEnv(value: unknown): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function getEnvApiConfig(): Partial<ApiConfig> | null {
  const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;

  const apiFootballKey = (env.VITE_API_FOOTBALL_KEY || env.VITE_API_FOOTBALL_API_KEY || '') as string;
  const llmEnabled = parseBooleanEnv(env.VITE_LLM_ENABLED);
  const llmProvider = String(env.VITE_LLM_PROVIDER ?? '').trim();
  const deepseekApiKey = String(env.VITE_DEEPSEEK_API_KEY ?? '').trim();
  const deepseekModel = String(env.VITE_DEEPSEEK_MODEL ?? '').trim();
  const openaiApiKey = String(env.VITE_OPENAI_API_KEY ?? '').trim();
  const openaiModel = String(env.VITE_OPENAI_MODEL ?? '').trim();
  const anthropicApiKey = String(env.VITE_ANTHROPIC_API_KEY ?? '').trim();
  const anthropicModel = String(env.VITE_ANTHROPIC_MODEL ?? '').trim();
  const googleApiKey = String(env.VITE_GEMINI_API_KEY ?? env.VITE_GOOGLE_API_KEY ?? env.VITE_GOOGLE_GEMINI_API_KEY ?? '').trim();
  const googleModel = String(env.VITE_GEMINI_MODEL ?? env.VITE_GOOGLE_MODEL ?? '').trim();

  const hasAny =
    Boolean(apiFootballKey.trim()) ||
    llmEnabled !== undefined ||
    Boolean(llmProvider) ||
    Boolean(deepseekApiKey) ||
    Boolean(openaiApiKey) ||
    Boolean(anthropicApiKey) ||
    Boolean(googleApiKey);

  if (!hasAny) return null;

  return {
    apiFootballKey: apiFootballKey.trim(),
    llmEnabled: llmEnabled ?? undefined,
    llmProvider: (llmProvider === 'deepseek' ||
      llmProvider === 'openai' ||
      llmProvider === 'anthropic' ||
      llmProvider === 'google' ||
      llmProvider === 'none'
      ? (llmProvider as any)
      : undefined) as any,
    deepseekApiKey: deepseekApiKey || undefined,
    deepseekModel: deepseekModel || undefined,
    openaiApiKey: openaiApiKey || undefined,
    openaiModel: openaiModel || undefined,
    anthropicApiKey: anthropicApiKey || undefined,
    anthropicModel: anthropicModel || undefined,
    googleApiKey: googleApiKey || undefined,
    googleModel: googleModel || undefined,
  };
}

export function loadApiConfig(): ApiConfig | null {
  const stored = localStorage.getItem('apiConfig');
  let storedConfig: ApiConfig | null = null;
  if (stored) {
    try {
      storedConfig = JSON.parse(stored) as ApiConfig;
    } catch {
      try {
        localStorage.removeItem('apiConfig');
      } catch {}
      storedConfig = null;
    }
  }

  const envConfig = getEnvApiConfig();
  if (envConfig) {
    const defaults = {
      apiFootballKey: '',
      kaggleUsername: '',
      kaggleApiKey: '',
      agentTrainingEnabled: false,
      apiFootballDisabledLeagueIds: [],
      llmEnabled: false,
      llmProvider: 'none' as const,
      deepseekApiKey: '',
      deepseekModel: 'deepseek-chat',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini',
      anthropicApiKey: '',
      anthropicModel: 'claude-3-5-sonnet-latest',
      googleApiKey: '',
      googleModel: 'gemma-4-26b-a4b-it',
      automationAdminToken: '',
      betfairBankroll: 0,
      betfairMarketPercents: {
        correctScore: 10,
        winner: 0,
        overUnder: 0,
        btts: 0,
        asianHandicap: 0,
        firstHalf: 0,
        secondHalf: 0,
      } as Record<string, number>,
      betfairRobotLimits: {
        scalpingGoals: {
          profitTargetPct: 0.1,
          stakePct: 1,
          entryOffsetTicks: 2,
          secondsToWaitMatch: 10,
        },
        scalpingTicks: {
          targetTicks: 10,
          entryOffsetTicks: 2,
          maxSpreadTicks: 2,
          minSecondsBetweenCycles: 8,
          stakePct: 1,
          maxCycles: 50,
          secondsToWaitMatch: 10,
        },
        overGoalsLimit: {
          minOdds: 1.3,
          maxEntries: 3,
          profitTargetPct: 0.02,
          minDeltaTraded: 200,
          dominanceRatio: 1.25,
          minSecondsBetweenEntries: 30,
          stakePct: 1,
          entryOffsetTicks: 2,
          secondsToWaitMatch: 10,
        },
      },
    } satisfies ApiConfig;

    const storedApiFootballKey = String(storedConfig?.apiFootballKey ?? '').trim();
    const envApiFootballKey = String(envConfig.apiFootballKey ?? '').trim();

    const merged = {
      ...defaults,
      ...(storedConfig ?? {}),
      apiFootballKey: storedApiFootballKey || envApiFootballKey,
      llmEnabled: (storedConfig?.llmEnabled ?? envConfig.llmEnabled ?? defaults.llmEnabled) as boolean,
      llmProvider: (storedConfig?.llmProvider ?? envConfig.llmProvider ?? defaults.llmProvider) as any,
      deepseekApiKey: String(storedConfig?.deepseekApiKey ?? envConfig.deepseekApiKey ?? defaults.deepseekApiKey),
      deepseekModel: String(storedConfig?.deepseekModel ?? envConfig.deepseekModel ?? defaults.deepseekModel),
      openaiApiKey: String(storedConfig?.openaiApiKey ?? envConfig.openaiApiKey ?? defaults.openaiApiKey),
      openaiModel: String(storedConfig?.openaiModel ?? envConfig.openaiModel ?? defaults.openaiModel),
      anthropicApiKey: String(storedConfig?.anthropicApiKey ?? envConfig.anthropicApiKey ?? defaults.anthropicApiKey),
      anthropicModel: String(storedConfig?.anthropicModel ?? envConfig.anthropicModel ?? defaults.anthropicModel),
      googleApiKey: String(storedConfig?.googleApiKey ?? envConfig.googleApiKey ?? defaults.googleApiKey),
      googleModel: String(storedConfig?.googleModel ?? envConfig.googleModel ?? defaults.googleModel),
      automationAdminToken: String(storedConfig?.automationAdminToken ?? defaults.automationAdminToken),
      betfairBankroll: Number.isFinite(Number((storedConfig as any)?.betfairBankroll)) ? Number((storedConfig as any).betfairBankroll) : defaults.betfairBankroll,
      betfairMarketPercents:
        (storedConfig as any)?.betfairMarketPercents && typeof (storedConfig as any).betfairMarketPercents === 'object'
          ? ({ ...defaults.betfairMarketPercents, ...(storedConfig as any).betfairMarketPercents } as Record<string, number>)
          : defaults.betfairMarketPercents,
      betfairRobotLimits: (() => {
        const raw = (storedConfig as any)?.betfairRobotLimits;
        if (!raw || typeof raw !== 'object') return defaults.betfairRobotLimits;
        const sg = raw?.scalpingGoals && typeof raw.scalpingGoals === 'object' ? raw.scalpingGoals : {};
        const st = raw?.scalpingTicks && typeof raw.scalpingTicks === 'object' ? raw.scalpingTicks : {};
        const og = raw?.overGoalsLimit && typeof raw.overGoalsLimit === 'object' ? raw.overGoalsLimit : {};
        return {
          scalpingGoals: { ...(defaults.betfairRobotLimits?.scalpingGoals ?? {}), ...(sg as any) },
          scalpingTicks: { ...(defaults.betfairRobotLimits?.scalpingTicks ?? {}), ...(st as any) },
          overGoalsLimit: { ...(defaults.betfairRobotLimits?.overGoalsLimit ?? {}), ...(og as any) },
        };
      })(),
    } satisfies ApiConfig;

    return {
      ...merged,
      apiFootballDisabledLeagueIds: Array.isArray(merged.apiFootballDisabledLeagueIds) ? merged.apiFootballDisabledLeagueIds : [],
    };
  }

  if (!storedConfig) return storedConfig;
  const defaultsBetfairMarketPercents: Record<string, number> = {
    correctScore: 10,
    winner: 0,
    overUnder: 0,
    btts: 0,
    asianHandicap: 0,
    firstHalf: 0,
    secondHalf: 0,
  };
  const defaultsBetfairRobotLimits = {
    scalpingGoals: { profitTargetPct: 0.1, stakePct: 1, entryOffsetTicks: 2, secondsToWaitMatch: 10 },
    scalpingTicks: {
      targetTicks: 10,
      entryOffsetTicks: 2,
      maxSpreadTicks: 2,
      minSecondsBetweenCycles: 8,
      stakePct: 1,
      maxCycles: 50,
      secondsToWaitMatch: 10,
    },
    overGoalsLimit: {
      minOdds: 1.3,
      maxEntries: 3,
      profitTargetPct: 0.02,
      minDeltaTraded: 200,
      dominanceRatio: 1.25,
      minSecondsBetweenEntries: 30,
      stakePct: 1,
      entryOffsetTicks: 2,
      secondsToWaitMatch: 10,
    },
  };

  const merged = {
    llmEnabled: false,
    llmProvider: 'none' as const,
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicApiKey: '',
    anthropicModel: 'claude-3-5-sonnet-latest',
    googleApiKey: '',
    googleModel: 'gemma-4-26b-a4b-it',
    automationAdminToken: '',
    betfairBankroll: 0,
    ...storedConfig,
    betfairMarketPercents:
      (storedConfig as any)?.betfairMarketPercents && typeof (storedConfig as any).betfairMarketPercents === 'object'
        ? ({ ...defaultsBetfairMarketPercents, ...(storedConfig as any).betfairMarketPercents } as Record<string, number>)
        : defaultsBetfairMarketPercents,
    betfairRobotLimits: (() => {
      const raw = (storedConfig as any)?.betfairRobotLimits;
      if (!raw || typeof raw !== 'object') return defaultsBetfairRobotLimits;
      const sg = raw?.scalpingGoals && typeof raw.scalpingGoals === 'object' ? raw.scalpingGoals : {};
      const st = raw?.scalpingTicks && typeof raw.scalpingTicks === 'object' ? raw.scalpingTicks : {};
      const og = raw?.overGoalsLimit && typeof raw.overGoalsLimit === 'object' ? raw.overGoalsLimit : {};
      return {
        scalpingGoals: { ...(defaultsBetfairRobotLimits.scalpingGoals ?? {}), ...(sg as any) },
        scalpingTicks: { ...(defaultsBetfairRobotLimits.scalpingTicks ?? {}), ...(st as any) },
        overGoalsLimit: { ...(defaultsBetfairRobotLimits.overGoalsLimit ?? {}), ...(og as any) },
      };
    })(),
  } satisfies ApiConfig;

  return {
    ...merged,
    apiFootballDisabledLeagueIds: Array.isArray(merged.apiFootballDisabledLeagueIds) ? merged.apiFootballDisabledLeagueIds : [],
  };
}

// Validar API key do api-football.com
export async function validateApiFootballKey(apiKey: string): Promise<boolean> {
  try {
    console.log('🔍 Validando API-Football key via servidor...');

    // Importar info do Supabase
    const { projectId } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/validate-server-1119702f/validate-api/api-football`,
      {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      }
    );

    const data = await response.json();

    if (data.valid) {
      console.log('✅ API key válida!', data.message);
      return true;
    } else {
      console.error('❌ API key inválida:', data.error);
      console.error('Detalhes:', data.details);
      return false;
    }
  } catch (error) {
    console.error('❌ Erro ao validar API key:', error);

    // Fallback: validação por formato (API-Football usa keys diferentes)
    console.warn('⚠️ Tentando validação por formato...');
    const isValidFormat = apiKey.length >= 32; // API-Football keys são longas
    if (isValidFormat) {
      console.log('✅ Formato da API key válido. Assumindo que está correta.');
      return true;
    }

    return false;
  }
}
