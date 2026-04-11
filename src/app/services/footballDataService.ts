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
}

export class FootballDataService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_ENDPOINTS.footballData}${endpoint}`, {
      headers: {
        'X-Auth-Token': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    return response.json();
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
