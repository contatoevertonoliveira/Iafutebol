import { API_ENDPOINTS } from './apiConfig';

export interface Team {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
}

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
  homeTeam: Team;
  awayTeam: Team;
  score: {
    fullTime: {
      home: number | null;
      away: number | null;
    };
  };
  competition: Competition;
  live?: {
    elapsed: number | null;
    statusShort?: string;
  };
}

export class FootballDataService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetchViaServerProxy<T>(url: string): Promise<T> {
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/proxy/football-data`,
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
    try {
      // Constrói a URL completa
      const baseUrl = API_ENDPOINTS.footballData.endsWith('/')
        ? API_ENDPOINTS.footballData
        : `${API_ENDPOINTS.footballData}/`;
      const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
      const url = new URL(normalizedEndpoint, baseUrl);
      
      // Adiciona parâmetros de query se existirem
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });
      }

      console.log('🌐 Fazendo requisição para:', url.toString());

      try {
        const data = await this.fetchViaServerProxy<T>(url.toString());
        console.log('✅ Requisição via servidor bem-sucedida');
        return data;
      } catch (proxyError) {
        console.warn('⚠️ Proxy via servidor falhou, tentando requisição direta...', proxyError);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'X-Auth-Token': this.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ Requisição direta bem-sucedida');
      return data;
      
    } catch (error) {
      console.error('❌ Erro na requisição:', error);
      throw error;
    }
  }

  // Método para gerar dados mock quando a API falha
  private getMockData(endpoint: string, params?: Record<string, string>): any {
    console.log('🎭 Gerando dados mock para:', endpoint);
    
    if (endpoint.includes('/matches')) {
      const dateFrom = params?.dateFrom || '2026-04-11';
      const dateTo = params?.dateTo || '2026-04-18';
      
      return {
        matches: this.generateMockMatches(dateFrom, dateTo)
      };
    } else if (endpoint.includes('/competitions')) {
      return {
        competitions: this.generateMockCompetitions()
      };
    }
    
    return { data: 'Mock data' };
  }

  // Gera partidas mock
  private generateMockMatches(dateFrom: string, dateTo: string): any[] {
    const competitions = [
      { id: 2013, name: 'Campeonato Brasileiro Série A', code: 'BSA', emblem: 'https://crests.football-data.org/764.svg' },
      { id: 2021, name: 'Premier League', code: 'PL', emblem: 'https://crests.football-data.org/PL.png' },
      { id: 2014, name: 'La Liga', code: 'PD', emblem: 'https://crests.football-data.org/PD.png' },
    ];

    const teams = [
      { id: 1765, name: 'Flamengo', crest: 'https://crests.football-data.org/1765.png' },
      { id: 1770, name: 'Palmeiras', crest: 'https://crests.football-data.org/1770.png' },
      { id: 1766, name: 'São Paulo', crest: 'https://crests.football-data.org/1766.png' },
      { id: 1769, name: 'Grêmio', crest: 'https://crests.football-data.org/1769.png' },
      { id: 66, name: 'Manchester United', crest: 'https://crests.football-data.org/66.png' },
      { id: 57, name: 'Arsenal', crest: 'https://crests.football-data.org/57.png' },
      { id: 86, name: 'Real Madrid', crest: 'https://crests.football-data.org/86.png' },
      { id: 81, name: 'Barcelona', crest: 'https://crests.football-data.org/81.png' },
    ];

    const matches = [];
    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    
    // Gera 8 partidas mock
    for (let i = 0; i < 8; i++) {
      const matchDate = new Date(startDate);
      matchDate.setDate(startDate.getDate() + i);
      
      if (matchDate > endDate) break;
      
      const homeTeam = teams[Math.floor(Math.random() * teams.length)];
      let awayTeam = teams[Math.floor(Math.random() * teams.length)];
      const competition = competitions[Math.floor(Math.random() * competitions.length)];
      
      // Garante que os times sejam diferentes
      if (homeTeam.id === awayTeam.id) {
        awayTeam = teams[(teams.indexOf(homeTeam) + 1) % teams.length];
      }
      
      matches.push({
        id: 400000 + i,
        utcDate: matchDate.toISOString(),
        status: 'SCHEDULED',
        matchday: Math.floor(Math.random() * 38) + 1,
        stage: 'REGULAR_SEASON',
        group: null,
        competition: {
          id: competition.id,
          name: competition.name,
          code: competition.code,
          emblem: competition.emblem
        },
        homeTeam: {
          id: homeTeam.id,
          name: homeTeam.name,
          shortName: homeTeam.name.substring(0, 3).toUpperCase(),
          crest: homeTeam.crest
        },
        awayTeam: {
          id: awayTeam.id,
          name: awayTeam.name,
          shortName: awayTeam.name.substring(0, 3).toUpperCase(),
          crest: awayTeam.crest
        },
        score: {
          winner: null,
          fullTime: { home: null, away: null },
          halfTime: { home: null, away: null }
        },
        odds: { msg: 'Check bookmakers for odds' }
      });
    }
    
    console.log(`🎯 Geradas ${matches.length} partidas mock de ${dateFrom} a ${dateTo}`);
    return matches;
  }

  // Gera competições mock
  private generateMockCompetitions(): any[] {
    return [
      {
        id: 2013,
        name: 'Campeonato Brasileiro Série A',
        code: 'BSA',
        emblem: 'https://crests.football-data.org/764.svg',
        area: { name: 'Brazil', code: 'BRA', flag: 'https://crests.football-data.org/764.svg' }
      },
      {
        id: 2021,
        name: 'Premier League',
        code: 'PL',
        emblem: 'https://crests.football-data.org/PL.png',
        area: { name: 'England', code: 'ENG', flag: 'https://crests.football-data.org/770.svg' }
      },
      {
        id: 2014,
        name: 'La Liga',
        code: 'PD',
        emblem: 'https://crests.football-data.org/PD.png',
        area: { name: 'Spain', code: 'ESP', flag: 'https://crests.football-data.org/760.svg' }
      }
    ];
  }

  async getCompetitions(): Promise<Competition[]> {
    const data = await this.fetch<{ competitions: Competition[] }>('/competitions');
    return data.competitions;
  }

  async getMatches(
    competitionId?: number,
    dateFrom?: string,
    dateTo?: string
  ): Promise<FootballMatch[]> {
    let endpoint = '/matches';
    const params = new URLSearchParams();

    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);

    if (competitionId) {
      endpoint = `/competitions/${competitionId}/matches`;
    }

    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }

    const data = await this.fetch<{ matches: FootballMatch[] }>(endpoint);
    return data.matches;
  }

  async getTeam(teamId: number): Promise<Team> {
    return this.fetch<Team>(`/teams/${teamId}`);
  }

  async getStandings(competitionId: number): Promise<any> {
    return this.fetch(`/competitions/${competitionId}/standings`);
  }
}
