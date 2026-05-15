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

export interface ApiFootballLeagueCatalogItem {
  league: {
    id: number;
    name: string;
    type: string;
    logo: string;
  };
  country: {
    name: string;
    code: string | null;
    flag: string | null;
  };
  seasons: Array<{
    year: number;
    start: string;
    end: string;
    current: boolean;
  }>;
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
    extra?: number | null;
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

export interface ApiFootballEvent {
  time: {
    elapsed: number | null;
    extra?: number | null;
  };
  team: ApiFootballTeam;
  player: {
    id: number | null;
    name: string | null;
  };
  assist: {
    id: number | null;
    name: string | null;
  };
  type: string;
  detail: string;
  comments: string | null;
}

export interface ApiFootballResponse<T> {
  get: string;
  parameters: Record<string, any>;
  errors: any[] | Record<string, any> | string | null;
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

  private isUnsupportedPageParamError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    if (!message.includes('page')) return false;
    return (
      message.includes('the page field do not exist') ||
      message.includes('the page field does not exist') ||
      message.includes('page field') ||
      message.includes('field do not exist') ||
      message.includes('field does not exist')
    );
  }

  private normalizeApiErrors(errors: unknown): string[] {
    if (!errors) return [];
    if (Array.isArray(errors)) {
      return errors
        .filter((e) => e !== null && e !== undefined && e !== false && e !== '')
        .map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
    }
    if (typeof errors === 'object') {
      const entries = Object.entries(errors as Record<string, unknown>);
      return entries
        .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
        .map(([k, v]) => {
          if (v === true) return k;
          return `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
        });
    }
    if (typeof errors === 'string') return [errors];
    return [String(errors)];
  }

  private assertNoApiErrors<T>(data: ApiFootballResponse<T>): void {
    const errs = this.normalizeApiErrors(data.errors);
    if (errs.length > 0) {
      throw new Error(`API-Football error: ${errs.join('; ')}`);
    }
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
          apikey: publicAnonKey,
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

  private async fetchRaw<T>(endpoint: string, params?: Record<string, string>): Promise<ApiFootballResponse<T>> {
    const url = new URL(`${API_ENDPOINTS.apiFootball}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    try {
      const data = await this.fetchViaServerProxy<ApiFootballResponse<T>>(url.toString());
      this.assertNoApiErrors(data);
      return data;
    } catch (proxyError) {
      console.warn('⚠️ Proxy via servidor falhou, tentando requisição direta...', proxyError);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'x-apisports-key': this.apiKey,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await response.json().catch(() => null);
          const apiErrors = body?.errors ? this.normalizeApiErrors(body.errors) : [];
          const details =
            apiErrors.length > 0
              ? apiErrors.join('; ')
              : body?.message
                ? String(body.message)
                : body
                  ? JSON.stringify(body)
                  : '';
          throw new Error(`API Error: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`);
        }
        const text = await response.text().catch(() => '');
        throw new Error(`API Error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
      }

      const data: ApiFootballResponse<T> = await response.json();
      this.assertNoApiErrors(data);
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetch<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const data = await this.fetchRaw<T>(endpoint, params);
    return data.response;
  }

  private async fetchPagedArray<TItem>(endpoint: string, params?: Record<string, string>, maxPages?: number): Promise<TItem[]> {
    const baseParams = { ...(params ?? {}) };
    const all: TItem[] = [];
    let page = 1;
    let total = 1;
    const limit = typeof maxPages === 'number' && maxPages > 0 ? Math.floor(maxPages) : null;

    do {
      try {
        const data = await this.fetchRaw<TItem[]>(endpoint, { ...baseParams, page: String(page) });
        const items = Array.isArray(data.response) ? data.response : [];
        all.push(...items);
        total = Math.max(1, Number(data.paging?.total ?? 1));
        page += 1;
      } catch (e) {
        if (all.length > 0) break;
        if (this.isUnsupportedPageParamError(e)) {
          const data = await this.fetchRaw<TItem[]>(endpoint, baseParams);
          return Array.isArray(data.response) ? data.response : [];
        }
        throw e;
      }
    } while (page <= total && (limit === null || page <= limit));

    return all;
  }

  // Obter fixtures (partidas)
  async getFixtures(params?: {
    date?: string;
    league?: number;
    season?: number;
    team?: number;
    live?: string;
    last?: number;
    from?: string;
    to?: string;
    timezone?: string;
    fixtureId?: number;
    maxPages?: number;
  }): Promise<ApiFootballMatch[]> {
    const queryParams: Record<string, string> = {};

    if (params?.date) queryParams.date = params.date;
    if (params?.league) queryParams.league = params.league.toString();
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.team) queryParams.team = params.team.toString();
    if (params?.live) queryParams.live = params.live;
    if (params?.last) queryParams.last = params.last.toString();
    if (params?.from) queryParams.from = params.from;
    if (params?.to) queryParams.to = params.to;
    if (params?.timezone) queryParams.timezone = params.timezone;
    if (params?.fixtureId) queryParams.id = params.fixtureId.toString();

    return this.fetchPagedArray<ApiFootballMatch>('/fixtures', queryParams, params?.maxPages);
  }

  async getFixturesOnce(params?: {
    date?: string;
    league?: number;
    season?: number;
    team?: number;
    live?: string;
    last?: number;
    from?: string;
    to?: string;
    timezone?: string;
    fixtureId?: number;
  }): Promise<ApiFootballMatch[]> {
    const queryParams: Record<string, string> = {};

    if (params?.date) queryParams.date = params.date;
    if (params?.league) queryParams.league = params.league.toString();
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.team) queryParams.team = params.team.toString();
    if (params?.live) queryParams.live = params.live;
    if (params?.last) queryParams.last = params.last.toString();
    if (params?.from) queryParams.from = params.from;
    if (params?.to) queryParams.to = params.to;
    if (params?.timezone) queryParams.timezone = params.timezone;
    if (params?.fixtureId) queryParams.id = params.fixtureId.toString();

    return this.fetch<ApiFootballMatch[]>('/fixtures', queryParams);
  }

  async getFixtureEvents(fixtureId: number): Promise<ApiFootballEvent[]> {
    return this.fetchPagedArray<ApiFootballEvent>('/fixtures/events', { fixture: fixtureId.toString() }, 5);
  }

  async getFixtureStatistics(fixtureId: number): Promise<any> {
    return this.fetch<any>('/fixtures/statistics', { fixture: fixtureId.toString() });
  }

  // Obter ligas
  async getLeagues(params?: {
    country?: string;
    season?: number;
    type?: string;
    maxPages?: number;
  }): Promise<ApiFootballLeague[]> {
    const queryParams: Record<string, string> = {};

    if (params?.country) queryParams.country = params.country;
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.type) queryParams.type = params.type;

    return this.fetchPagedArray<ApiFootballLeague>('/leagues', queryParams, params?.maxPages);
  }

  async getSeasons(): Promise<number[]> {
    return this.fetch<number[]>('/leagues/seasons');
  }

  async getLeaguesCatalog(params?: {
    country?: string;
    season?: number;
    type?: string;
    current?: boolean;
    search?: string;
    maxPages?: number;
  }): Promise<ApiFootballLeague[]> {
    return this.getLeaguesCatalogWithProgress(params);
  }

  async getLeaguesCatalogWithProgress(
    params?: {
      country?: string;
      season?: number;
      type?: string;
      current?: boolean;
      search?: string;
      maxPages?: number;
    },
    onProgress?: (progress: { page: number; total: number; count: number }) => void,
  ): Promise<ApiFootballLeague[]> {
    const queryParams: Record<string, string> = {};
    if (params?.country) queryParams.country = params.country;
    if (params?.season) queryParams.season = params.season.toString();
    if (params?.type) queryParams.type = params.type;
    if (params?.current !== undefined) queryParams.current = params.current ? 'true' : 'false';
    if (params?.search) queryParams.search = params.search;

    const maxPages = typeof params?.maxPages === 'number' && params.maxPages > 0 ? Math.floor(params.maxPages) : null;
    const baseParams = { ...queryParams };

    const mapped: ApiFootballLeague[] = [];
    let page = 1;
    let total = 1;
    do {
      let data: ApiFootballResponse<ApiFootballLeagueCatalogItem[]> | null = null;
      let attempts = 0;
      while (attempts < 3 && !data) {
        attempts += 1;
        try {
          data = await this.fetchRaw<ApiFootballLeagueCatalogItem[]>('/leagues', { ...baseParams, page: String(page) });
        } catch (e) {
          if (page === 1 && this.isUnsupportedPageParamError(e)) {
            data = await this.fetchRaw<ApiFootballLeagueCatalogItem[]>('/leagues', baseParams);
            total = 1;
            break;
          }
          if (attempts >= 3) {
            if (mapped.length > 0) {
              onProgress?.({ page, total: Math.max(1, total), count: mapped.length });
              return Array.from(new Map(mapped.map((l) => [l.id, l])).values());
            }
            throw e;
          }
          await new Promise((r) => setTimeout(r, 350 * attempts));
        }
      }
      const chunk = Array.isArray(data?.response) ? data?.response : [];
      total = Math.max(1, Number(data?.paging?.total ?? 1));
      for (const i of chunk) {
        const season =
          i.seasons?.find((s) => s.current)?.year ??
          i.seasons?.[i.seasons.length - 1]?.year ??
          new Date().getFullYear();
        const id = Number(i.league?.id);
        if (!Number.isFinite(id)) continue;
        mapped.push({
          id,
          name: i.league?.name ?? 'Unknown',
          type: i.league?.type ?? 'Unknown',
          logo: i.league?.logo ?? '',
          country: i.country?.name ?? 'Unknown',
          flag: i.country?.flag ?? '',
          season,
        });
      }
      onProgress?.({ page, total, count: mapped.length });
      page += 1;
    } while (page <= total && (maxPages === null || page <= maxPages));

    const byId = new Map<number, ApiFootballLeague>();
    for (const l of mapped) {
      if (!byId.has(l.id)) byId.set(l.id, l);
    }
    return Array.from(byId.values());
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
