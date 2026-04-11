import { API_ENDPOINTS } from './apiConfig';

export interface ApiFootballTeam {
  id: number;
  name: string;
  code: string;
  country: string;
  founded: number;
  national: boolean;
  logo: string;
}

export interface ApiFootballLeague {
  id: number;
  name: string;
  type: string;
  logo: string;
  country: string;
  flag: string;
  season: number;
}

export interface ApiFootballFixture {
  id: number;
  referee: string | null;
  timezone: string;
  date: string;
  timestamp: number;
  venue: {
    id: number | null;
    name: string | null;
    city: string | null;
  };
  status: {
    long: string;
    short: string;
    elapsed: number | null;
  };
}

export interface ApiFootballScore {
  halftime: {
    home: number | null;
    away: number | null;
  };
  fulltime: {
    home: number | null;
    away: number | null;
  };
  extratime: {
    home: number | null;
    away: number | null;
  };
  penalty: {
    home: number | null;
    away: number | null;
  };
}

export interface ApiFootballMatch {
  fixture: ApiFootballFixture;
  league: ApiFootballLeague;
  teams: {
    home: ApiFootballTeam;
    away: ApiFootballTeam;
  };
  goals: {
    home: number | null;
    away: number | null;
  };
  score: ApiFootballScore;
}

export interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, any>;
  errors: any[];
  results: number;
  paging: {
    current: number;
    total: number;
  };
  response: T;
}

export class ApiFootballService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetchViaServerProxy<T>(url: string): Promise<T> {
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/proxy/api-football`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({
          url,
          apiKey: this.apiKey,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Proxy error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
      );
    }

    return response.json();
  }

  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_ENDPOINTS.apiFootball}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    try {
      const data = await this.fetchViaServerProxy<ApiFootballResponse<T>>(url.toString());

      if (data.errors && data.errors.length > 0) {
        throw new Error(`API Error: ${JSON.stringify(data.errors)}`);
      }

      return data.response;
    } catch (proxyError) {
      console.warn('⚠️ Proxy via servidor falhou, tentando requisição direta...', proxyError);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'x-apisports-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data: ApiFootballResponse<T> = await response.json();

    if (data.errors && data.errors.length > 0) {
      throw new Error(`API Error: ${JSON.stringify(data.errors)}`);
    }

    return data.response;
  }

  // Obter fixtures (partidas)
  async getFixtures(params?: {
    date?: string;
    league?: number;
    season?: number;
    team?: number;
    from?: string;
    to?: string;
    timezone?: string;
  }): Promise<ApiFootballMatch[]> {
    const queryParams: Record<string, string> = {};

    if (params?.date) queryParams.date = params.date;
    if (params?.league) queryParams.league = params.league.toString();
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.team) queryParams.team = params.team.toString();
    if (params?.from) queryParams.from = params.from;
    if (params?.to) queryParams.to = params.to;
    if (params?.timezone) queryParams.timezone = params.timezone;

    return this.fetch<ApiFootballMatch[]>('/fixtures', queryParams);
  }

  // Obter ligas
  async getLeagues(params?: {
    country?: string;
    season?: number;
    type?: string;
  }): Promise<ApiFootballLeague[]> {
    const queryParams: Record<string, string> = {};

    if (params?.country) queryParams.country = params.country;
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.type) queryParams.type = params.type;

    return this.fetch<ApiFootballLeague[]>('/leagues', queryParams);
  }

  // Obter times
  async getTeams(params?: {
    league?: number;
    season?: number;
    country?: string;
    search?: string;
  }): Promise<ApiFootballTeam[]> {
    const queryParams: Record<string, string> = {};

    if (params?.league) queryParams.league = params.league.toString();
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.country) queryParams.country = params.country;
    if (params?.search) queryParams.search = params.search;

    return this.fetch<ApiFootballTeam[]>('/teams', queryParams);
  }

  // Obter estatísticas de um time
  async getTeamStatistics(params: {
    league: number;
    season: number;
    team: number;
  }): Promise<any> {
    const queryParams: Record<string, string> = {
      league: params.league.toString(),
      season: params.season.toString(),
      team: params.team.toString(),
    };

    return this.fetch<any>('/teams/statistics', queryParams);
  }

  // Obter head to head (confrontos diretos)
  async getH2H(params: {
    h2h: string; // formato: "teamId1-teamId2"
    date?: string;
    league?: number;
    season?: number;
  }): Promise<ApiFootballMatch[]> {
    const queryParams: Record<string, string> = {
      h2h: params.h2h,
    };

    if (params.date) queryParams.date = params.date;
    if (params.league) queryParams.league = params.league.toString();
    if (params.season) queryParams.season = params.season.toString();

    return this.fetch<ApiFootballMatch[]>('/fixtures/headtohead', queryParams);
  }

  // Obter previsões (predições da própria API)
  async getPredictions(fixtureId: number): Promise<any> {
    return this.fetch<any>('/predictions', { fixture: fixtureId.toString() });
  }

  // Obter classificação da liga
  async getStandings(params: {
    league: number;
    season: number;
  }): Promise<any> {
    const queryParams: Record<string, string> = {
      league: params.league.toString(),
      season: params.season.toString(),
    };

    return this.fetch<any>('/standings', queryParams);
  }

  // Obter países disponíveis
  async getCountries(): Promise<any[]> {
    return this.fetch<any[]>('/countries');
  }

  // Obter fusos horários
  async getTimezones(): Promise<string[]> {
    return this.fetch<string[]>('/timezone');
  }
}
