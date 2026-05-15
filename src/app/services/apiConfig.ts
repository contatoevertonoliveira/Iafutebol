export interface ApiConfig {
  footballDataApiKey: string;
  apiFootballKey: string;
  openLigaDbEnabled: boolean;
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
}

export const API_ENDPOINTS = {
  footballData: 'https://api.football-data.org/v4/',
  apiFootball: 'https://v3.football.api-sports.io',
  openLigaDb: 'https://api.openligadb.de',
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
  const footballDataApiKey = (env.VITE_FOOTBALL_DATA_API_KEY || env.VITE_FOOTBALL_DATA_KEY || '') as string;
  const openLigaDbEnabled = parseBooleanEnv(env.VITE_OPENLIGADB_ENABLED);
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
    Boolean(footballDataApiKey.trim()) ||
    openLigaDbEnabled !== undefined ||
    llmEnabled !== undefined ||
    Boolean(llmProvider) ||
    Boolean(deepseekApiKey) ||
    Boolean(openaiApiKey) ||
    Boolean(anthropicApiKey) ||
    Boolean(googleApiKey);

  if (!hasAny) return null;

  return {
    apiFootballKey: apiFootballKey.trim(),
    footballDataApiKey: footballDataApiKey.trim(),
    openLigaDbEnabled: openLigaDbEnabled ?? true,
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
  const storedConfig = stored ? (JSON.parse(stored) as ApiConfig) : null;

  const envConfig = getEnvApiConfig();
  if (envConfig) {
    const defaults = {
      footballDataApiKey: '',
      apiFootballKey: '',
      openLigaDbEnabled: true,
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
    } satisfies ApiConfig;

    const storedFootballDataKey = String(storedConfig?.footballDataApiKey ?? '').trim();
    const storedApiFootballKey = String(storedConfig?.apiFootballKey ?? '').trim();
    const envFootballDataKey = String(envConfig.footballDataApiKey ?? '').trim();
    const envApiFootballKey = String(envConfig.apiFootballKey ?? '').trim();

    const merged = {
      ...defaults,
      ...(storedConfig ?? {}),
      footballDataApiKey: storedFootballDataKey || envFootballDataKey,
      apiFootballKey: storedApiFootballKey || envApiFootballKey,
      openLigaDbEnabled: (storedConfig?.openLigaDbEnabled ?? envConfig.openLigaDbEnabled ?? true) as boolean,
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
    } satisfies ApiConfig;

    return {
      ...merged,
      apiFootballDisabledLeagueIds: Array.isArray(merged.apiFootballDisabledLeagueIds) ? merged.apiFootballDisabledLeagueIds : [],
    };
  }

  if (!storedConfig) return storedConfig;
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
    ...storedConfig,
  } satisfies ApiConfig;

  return {
    ...merged,
    apiFootballDisabledLeagueIds: Array.isArray(merged.apiFootballDisabledLeagueIds) ? merged.apiFootballDisabledLeagueIds : [],
  };
}

// Validar API key do football-data.org
export async function validateFootballDataApiKey(apiKey: string): Promise<boolean> {
  try {
    console.log('🔍 Validando Football-Data API key via servidor...');

    // Importar info do Supabase
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/validate-api/football-data`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
        body: JSON.stringify({ apiKey }),
      }
    );

    const data = await response.json();

    if (data.valid) {
      console.log('✅ API key válida!', data.message);
      if (data.competitionsCount) {
        console.log(`📊 ${data.competitionsCount} competições disponíveis`);
      }
      return true;
    } else {
      console.error('❌ API key inválida:', data.error);
      console.error('Detalhes:', data.details);
      return false;
    }
  } catch (error) {
    console.error('❌ Erro ao validar API key:', error);

    // Fallback: validação por formato
    console.warn('⚠️ Tentando validação por formato...');
    const isValidFormat = /^[a-f0-9]{32,40}$/i.test(apiKey);
    if (isValidFormat) {
      console.log('✅ Formato da API key válido. Assumindo que está correta.');
      return true;
    }

    return false;
  }
}

// Validar API key do api-football.com
export async function validateApiFootballKey(apiKey: string): Promise<boolean> {
  try {
    console.log('🔍 Validando API-Football key via servidor...');

    // Importar info do Supabase
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/validate-api/api-football`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
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
