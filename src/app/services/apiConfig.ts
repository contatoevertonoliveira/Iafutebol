export interface ApiConfig {
  footballDataApiKey: string;
  apiFootballKey: string;
  openLigaDbEnabled: boolean;
  kaggleUsername: string;
  kaggleApiKey: string;
  agentTrainingEnabled: boolean;
}

export const API_ENDPOINTS = {
  footballData: 'https://api.football-data.org/v4/',
  apiFootball: 'https://v3.football.api-sports.io',
  openLigaDb: 'https://api.openligadb.de',
};

// Salvar configurações no localStorage
export function saveApiConfig(config: ApiConfig): void {
  localStorage.setItem('apiConfig', JSON.stringify(config));
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

  const hasAny =
    Boolean(apiFootballKey.trim()) ||
    Boolean(footballDataApiKey.trim()) ||
    openLigaDbEnabled !== undefined;

  if (!hasAny) return null;

  return {
    apiFootballKey: apiFootballKey.trim(),
    footballDataApiKey: footballDataApiKey.trim(),
    openLigaDbEnabled: openLigaDbEnabled ?? true,
  };
}

export function loadApiConfig(): ApiConfig | null {
  const stored = localStorage.getItem('apiConfig');
  const storedConfig = stored ? (JSON.parse(stored) as ApiConfig) : null;

  if (import.meta.env.DEV) {
    const envConfig = getEnvApiConfig();
    if (envConfig) {
      const merged = {
        footballDataApiKey: '',
        apiFootballKey: '',
        openLigaDbEnabled: true,
        kaggleUsername: '',
        kaggleApiKey: '',
        agentTrainingEnabled: false,
        ...envConfig,
        ...(storedConfig ?? {}),
      } satisfies ApiConfig;

      return merged;
    }
  }

  return storedConfig;
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
