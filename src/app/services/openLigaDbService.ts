import { API_ENDPOINTS } from './apiConfig';

export interface OpenLigaTeam {
  teamId: number;
  teamName: string;
  teamIconUrl?: string;
  shortName?: string;
}

export interface OpenLigaMatchResult {
  resultID: number;
  resultName: string;
  pointsTeam1: number;
  pointsTeam2: number;
  resultOrderID: number;
  resultTypeID: number;
}

export interface OpenLigaMatch {
  matchID: number;
  matchDateTimeUTC: string;
  matchIsFinished: boolean;
  leagueName?: string;
  leagueShortcut?: string;
  group?: {
    groupName?: string;
    groupOrderID?: number;
  };
  team1: OpenLigaTeam;
  team2: OpenLigaTeam;
  matchResults?: OpenLigaMatchResult[];
}

export class OpenLigaDbService {
  private async fetch<T>(path: string): Promise<T> {
    const baseUrl = API_ENDPOINTS.openLigaDb.endsWith('/')
      ? API_ENDPOINTS.openLigaDb
      : `${API_ENDPOINTS.openLigaDb}/`;
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(normalizedPath, baseUrl);

    const response = await fetch(url.toString(), {
      method: 'GET',
    });

    if (!response.ok) {
      throw new Error(`OpenLigaDB error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getMatchesByDateRange(params: {
    dateFrom: string;
    dateTo: string;
    leagueShortcut?: string;
  }): Promise<OpenLigaMatch[]> {
    const { dateFrom, dateTo, leagueShortcut = 'bl1' } = params;
    const yearFrom = new Date(dateFrom).getUTCFullYear();
    const yearTo = new Date(dateTo).getUTCFullYear();

    const seasons = yearFrom === yearTo ? [yearFrom] : [yearFrom, yearTo];
    const allMatchesArrays = await Promise.all(
      seasons.map((season) => this.fetch<OpenLigaMatch[]>(`/getmatchdata/${leagueShortcut}/${season}`)),
    );

    const allMatches = allMatchesArrays.flat();
    const start = new Date(dateFrom);
    const end = new Date(dateTo);

    return allMatches.filter((m) => {
      const d = new Date(m.matchDateTimeUTC);
      return d >= start && d <= end;
    });
  }
}
