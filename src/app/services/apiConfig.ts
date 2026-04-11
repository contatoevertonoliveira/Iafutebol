export interface ApiConfig {
  footballDataApiKey: string;
  openLigaDbEnabled: boolean;
}

export const API_ENDPOINTS = {
  footballData: 'https://api.football-data.org/v4',
  openLigaDb: 'https://api.openligadb.de',
};

// Salvar configurações no localStorage
export function saveApiConfig(config: ApiConfig): void {
  localStorage.setItem('apiConfig', JSON.stringify(config));
}

// Carregar configurações do localStorage
export function loadApiConfig(): ApiConfig | null {
  const stored = localStorage.getItem('apiConfig');
  if (!stored) return null;
  return JSON.parse(stored);
}

// Validar API key do football-data.org
export async function validateFootballDataApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_ENDPOINTS.footballData}/competitions`, {
      headers: {
        'X-Auth-Token': apiKey,
      },
    });
    return response.ok;
  } catch (error) {
    console.error('Erro ao validar API key:', error);
    return false;
  }
}
