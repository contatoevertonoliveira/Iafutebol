import { API_ENDPOINTS } from './apiConfig';

export interface Competition {
  id: number;
  name: string;
  code: string;
  emblem: string;
  area: {
    name: string;
    code: string;
    flag: string;
  };
}

export interface FootballMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number;
  stage: string;
  group: string | null;
  lastUpdated: string;
  area: {
    id: number;
    name: string;
    code: string;
    flag: string;
  };
  competition: {
    id: number;
    name: string;
    code: string;
    type: string;
    emblem: string;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
    winner: any;
  };
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  score: {
    winner: string | null;
    duration: string;
    fullTime: {
      home: number | null;
      away: number | null;
    };
    halfTime: {
      home: number | null;
      away: number | null;
    };
  };
  odds: {
    msg: string;
  };
  referees: any[];
}

export class FootballDataServiceWithCors {
  private apiKey: string;
  private corsProxyUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    // URL do proxy CORS via Supabase Edge Functions
    this.corsProxyUrl = 'https://your-project.supabase.co/functions/v1/football-data-proxy';
    // Nota: Em produção, substitua 'your-project' pelo ID real do seu projeto Supabase
  }

  private async fetchWithCors<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    try {
      // Primeiro tenta via proxy CORS
      const url = new URL(endpoint, API_ENDPOINTS.footballData);
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }

      const proxyResponse = await fetch(this.corsProxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          url: url.toString(),
          method: 'GET',
          headers: {
            'X-Auth-Token': this.apiKey,
          }
        }),
      });

      if (proxyResponse.ok) {
        return await proxyResponse.json();
      }

      // Fallback: tenta direto (pode falhar por CORS em produção)
      console.warn('⚠️ Proxy CORS falhou, tentando requisição direta...');
      const directResponse = await fetch(url.toString(), {
        headers: {
          'X-Auth-Token': this.apiKey,
        },
      });

      if (!directResponse.ok) {
        throw new Error(`API Error: ${directResponse.status} ${directResponse.statusText}`);
      }

      return directResponse.json();
    } catch (error) {
      console.error('❌ Erro na requisição:', error);
      throw error;
    }
  }

  async getCompetitions(): Promise<Competition[]> {
    try {
      const data = await this.fetchWithCors<{ competitions: Competition[] }>('/competitions');
      return data.competitions;
    } catch (error) {
      console.error('❌ Erro ao buscar competições:', error);
      return [];
    }
  }

  async getMatches(
    competitionId?: number,
    dateFrom?: string,
    dateTo?: string
  ): Promise<FootballMatch[]> {
    try {
      const params: Record<string, string> = {};
      
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      
      let endpoint = '/matches';
      if (competitionId) {
        endpoint = `/competitions/${competitionId}/matches`;
      }

      const data = await this.fetchWithCors<{ matches: FootballMatch[] }>(endpoint, params);
      return data.matches || [];
    } catch (error) {
      console.error('❌ Erro ao buscar partidas:', error);
      return [];
    }
  }

  async getMatchesByDateRange(dateFrom: string, dateTo: string): Promise<FootballMatch[]> {
    return this.getMatches(undefined, dateFrom, dateTo);
  }

  async getCompetitionMatches(competitionId: number): Promise<FootballMatch[]> {
    return this.getMatches(competitionId);
  }

  async getTeam(teamId: number): Promise<any> {
    try {
      const data = await this.fetchWithCors<any>(`/teams/${teamId}`);
      return data;
    } catch (error) {
      console.error(`❌ Erro ao buscar time ${teamId}:`, error);
      return null;
    }
  }

  async getStandings(competitionId: number): Promise<any> {
    try {
      const data = await this.fetchWithCors<any>(`/competitions/${competitionId}/standings`);
      return data;
    } catch (error) {
      console.error(`❌ Erro ao buscar tabela ${competitionId}:`, error);
      return null;
    }
  }
}

// Função auxiliar para formatar datas
export function formatDateForAPI(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Função para obter datas da semana atual
export function getCurrentWeekDates(): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const dateFrom = formatDateForAPI(today);
  
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  const dateTo = formatDateForAPI(nextWeek);
  
  return { dateFrom, dateTo };
}