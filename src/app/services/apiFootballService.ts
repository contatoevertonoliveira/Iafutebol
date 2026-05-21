import { useEffect, useMemo, useRef, useState } from 'react';
import { API_ENDPOINTS, loadApiConfig } from './apiConfig';

const apiFootballResponseCache = new Map<string, { expiresAt: number; data: any }>();
const apiFootballInFlight = new Map<string, Promise<any>>();

const getApiFootballCacheTtlMs = (endpoint: string, url: URL): number => {
  const path = String(endpoint ?? '').trim() || url.pathname;
  if (path === '/fixtures') {
    const hasLive = url.searchParams.has('live');
    const hasId = url.searchParams.has('id');
    const hasDate = url.searchParams.has('date');
    if (hasLive || hasId) return 30_000;
    if (hasDate) return 5 * 60_000;
    return 60_000;
  }
  if (path === '/fixtures/events' || path === '/fixtures/statistics') return 60_000;
  if (path.startsWith('/leagues') || path === '/teams' || path === '/timezone' || path === '/countries') return 30 * 60_000;
  return 2 * 60_000;
};

const cachedApiFootballFetch = async <T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> => {
  const now = Date.now();
  const cached = apiFootballResponseCache.get(key);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const inFlight = apiFootballInFlight.get(key);
  if (inFlight) return (await inFlight) as T;

  const p = (async () => {
    const data = await fetcher();
    apiFootballResponseCache.set(key, { expiresAt: Date.now() + ttlMs, data });
    return data;
  })().finally(() => {
    apiFootballInFlight.delete(key);
  });

  apiFootballInFlight.set(key, p as any);
  return (await p) as T;
};

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

  private readQuotaLock(): { until: string; message: string } | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('apiFootball_quota_exceeded_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { until?: string; message?: string };
      const until = String(parsed?.until ?? '').trim();
      const message = String(parsed?.message ?? '').trim();
      const ms = until ? new Date(until).getTime() : NaN;
      if (!until || !Number.isFinite(ms)) return null;
      if (Date.now() >= ms) {
        try {
          localStorage.removeItem('apiFootball_quota_exceeded_v1');
        } catch {}
        return null;
      }
      return { until, message: message || 'requests: You have reached the request limit for the day' };
    } catch {
      return null;
    }
  }

  private writeQuotaLock(message: string) {
    if (typeof window === 'undefined') return;
    try {
      const now = new Date();
      const until = new Date(now);
      until.setHours(21, 5, 0, 0);
      if (now.getTime() >= until.getTime()) {
        until.setDate(until.getDate() + 1);
        until.setHours(21, 5, 0, 0);
      }
      localStorage.setItem(
        'apiFootball_quota_exceeded_v1',
        JSON.stringify({ until: until.toISOString(), message: String(message ?? '').trim() }),
      );
    } catch {}
  }

  private clearQuotaLock() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem('apiFootball_quota_exceeded_v1');
    } catch {}
  }

  private isQuotaErrorMessage(message: string) {
    const m = String(message ?? '').toLowerCase();
    return (
      m.includes('request limit for the day') ||
      m.includes('you have reached the request limit') ||
      m.includes('reached the request limit') ||
      m.includes('too many requests') ||
      m.includes('limit of requests per minute') ||
      m.includes('ratelimit')
    );
  }

  private isQuotaErrorList(errs: string[]) {
    return errs.some((e) => {
      const msg = String(e ?? '');
      if (!msg) return false;
      if (msg.toLowerCase().startsWith('requests:') && this.isQuotaErrorMessage(msg)) return true;
      if (msg.toLowerCase().startsWith('ratelimit:') && this.isQuotaErrorMessage(msg)) return true;
      return this.isQuotaErrorMessage(msg);
    });
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
      if (this.isQuotaErrorList(errs)) this.writeQuotaLock(errs.join('; '));
      throw new Error(`API-Football error: ${errs.join('; ')}`);
    }
  }

  private async fetchViaServerProxy<T>(url: string): Promise<T> {
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');

    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/proxy-server-1119702f/proxy/api-football`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publicAnonKey,
          Authorization: `Bearer ${publicAnonKey}`,
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
    const quota = this.readQuotaLock();
    if (quota) throw new Error(`API-Football error: ${quota.message}`);
    const url = new URL(`${API_ENDPOINTS.apiFootball}${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    const requestKey = url.toString();
    const ttlMs = getApiFootballCacheTtlMs(endpoint, url);
    return await cachedApiFootballFetch<ApiFootballResponse<T>>(requestKey, ttlMs, async () => {
      try {
        const data = await this.fetchViaServerProxy<ApiFootballResponse<T>>(requestKey);
        this.assertNoApiErrors(data);
        this.clearQuotaLock();
        return data;
      } catch (proxyError) {
        if (!this.isUnsupportedPageParamError(proxyError)) {
          console.warn('⚠️ Proxy via servidor falhou, tentando requisição direta...', proxyError);
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(requestKey, {
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
            if (apiErrors.length > 0 && this.isQuotaErrorList(apiErrors)) this.writeQuotaLock(apiErrors.join('; '));
            throw new Error(`API Error: ${response.status} ${response.statusText}${details ? ` - ${details}` : ''}`);
          }
          const text = await response.text().catch(() => '');
          if (this.isQuotaErrorMessage(text)) this.writeQuotaLock(text);
          throw new Error(`API Error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
        }

        const data: ApiFootballResponse<T> = await response.json();
        this.assertNoApiErrors(data);
        this.clearQuotaLock();
        return data;
      } finally {
        clearTimeout(timeout);
      }
    });
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

  private getCachedLeagueSeason(leagueId: number): number | null {
    if (!Number.isFinite(leagueId)) return null;
    if (typeof window === 'undefined') return null;
    const keys = ['apiFootball_leagues_cache_v2_all', 'apiFootball_leagues_cache_v2', 'apiFootball_leagues_cache_v1'];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { items?: any[] };
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        const found = items.find((l) => Number((l as any)?.id) === leagueId) ?? null;
        const season = Number((found as any)?.season);
        if (Number.isFinite(season) && season > 2000) return Math.floor(season);
      } catch {
        continue;
      }
    }
    return null;
  }

  private ensureSeasonForLeague(queryParams: Record<string, string>, params?: { league?: number; season?: number }) {
    const leagueId = Number(params?.league);
    const explicitSeason = Number(params?.season);
    if (!Number.isFinite(leagueId) || leagueId <= 0) return;
    if (Number.isFinite(explicitSeason) && explicitSeason > 0) return;
    if (queryParams.season) return;
    const cached = this.getCachedLeagueSeason(leagueId);
    const fallback = new Date().getFullYear();
    queryParams.season = String(cached ?? fallback);
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

    if (params?.league && !params?.season) this.ensureSeasonForLeague(queryParams, params);

    if (params?.live || params?.fixtureId) {
      return this.fetch<ApiFootballMatch[]>('/fixtures', queryParams);
    }
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

    if (params?.league && !params?.season) this.ensureSeasonForLeague(queryParams, params);

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

    if (params?.league && !params?.season) this.ensureSeasonForLeague(queryParams, params);

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

export interface ApiFootballLiveUpdate {
  fixtureId: number;
  fetchedAt: string;
  statusShort: string | null;
  elapsed: number | null;
  extra: number | null;
  goalsHome: number | null;
  goalsAway: number | null;
  cardsHome: number | null;
  cardsAway: number | null;
  shotsOnGoalHome: number | null;
  shotsOnGoalAway: number | null;
  dangerousAttacksHome: number | null;
  dangerousAttacksAway: number | null;
  attacksHome: number | null;
  attacksAway: number | null;
  cornersHome: number | null;
  cornersAway: number | null;
}

type LiveHubListener = (state: Record<number, ApiFootballLiveUpdate>) => void;

const toNumOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const normalizeFixtureIds = (fixtureIds: Array<number | string>): number[] => {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of fixtureIds) {
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    if (!Number.isFinite(n) || n <= 0) continue;
    const id = Math.floor(n);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const mapWithConcurrency = async <TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> => {
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
};

const getStatValue = (stats: any[], teamId: number, label: string): number | null => {
  const entry = stats.find((x) => Number(x?.team?.id) === teamId) ?? null;
  const arr = Array.isArray(entry?.statistics) ? entry.statistics : [];
  const item = arr.find((s: any) => String(s?.type ?? '') === label) ?? null;
  return toNumOrNull(item?.value ?? null);
};

const buildBaseLiveUpdate = (m: ApiFootballMatch): ApiFootballLiveUpdate => {
  const fixtureId = Number(m?.fixture?.id);
  const statusShort = typeof m?.fixture?.status?.short === 'string' ? m.fixture.status.short : null;
  const elapsed = typeof m?.fixture?.status?.elapsed === 'number' ? m.fixture.status.elapsed : null;
  const extraRaw = (m?.fixture?.status as any)?.extra;
  const extra = typeof extraRaw === 'number' ? extraRaw : null;
  const goalsHome = typeof m?.goals?.home === 'number' ? m.goals.home : null;
  const goalsAway = typeof m?.goals?.away === 'number' ? m.goals.away : null;
  return {
    fixtureId,
    fetchedAt: new Date().toISOString(),
    statusShort,
    elapsed,
    extra,
    goalsHome,
    goalsAway,
    cardsHome: null,
    cardsAway: null,
    shotsOnGoalHome: null,
    shotsOnGoalAway: null,
    dangerousAttacksHome: null,
    dangerousAttacksAway: null,
    attacksHome: null,
    attacksAway: null,
    cornersHome: null,
    cornersAway: null,
  };
};

const enrichLiveUpdate = async (
  service: ApiFootballService,
  m: ApiFootballMatch,
  base: ApiFootballLiveUpdate,
): Promise<ApiFootballLiveUpdate> => {
  const fixtureId = Number(m?.fixture?.id);
  const homeId = Number(m?.teams?.home?.id);
  const awayId = Number(m?.teams?.away?.id);
  const [events, stats] = await Promise.all([
    service.getFixtureEvents(fixtureId).catch(() => [] as ApiFootballEvent[]),
    service.getFixtureStatistics(fixtureId).catch(() => [] as any[]),
  ]);

  const cards = { home: 0, away: 0 };
  for (const e of Array.isArray(events) ? events : []) {
    if (String((e as any)?.type ?? '') !== 'Card') continue;
    const tid = Number((e as any)?.team?.id);
    if (Number.isFinite(homeId) && tid === homeId) cards.home += 1;
    if (Number.isFinite(awayId) && tid === awayId) cards.away += 1;
  }

  const statsArr = Array.isArray(stats) ? stats : [];
  const shotsOnGoalHome = Number.isFinite(homeId) ? getStatValue(statsArr, homeId, 'Shots on Goal') : null;
  const shotsOnGoalAway = Number.isFinite(awayId) ? getStatValue(statsArr, awayId, 'Shots on Goal') : null;
  const dangerousAttacksHome = Number.isFinite(homeId) ? getStatValue(statsArr, homeId, 'Dangerous Attacks') : null;
  const dangerousAttacksAway = Number.isFinite(awayId) ? getStatValue(statsArr, awayId, 'Dangerous Attacks') : null;
  const attacksHome = Number.isFinite(homeId) ? getStatValue(statsArr, homeId, 'Attacks') : null;
  const attacksAway = Number.isFinite(awayId) ? getStatValue(statsArr, awayId, 'Attacks') : null;
  const cornersHome = Number.isFinite(homeId) ? getStatValue(statsArr, homeId, 'Corner Kicks') : null;
  const cornersAway = Number.isFinite(awayId) ? getStatValue(statsArr, awayId, 'Corner Kicks') : null;

  return {
    ...base,
    fetchedAt: new Date().toISOString(),
    cardsHome: cards.home,
    cardsAway: cards.away,
    shotsOnGoalHome,
    shotsOnGoalAway,
    dangerousAttacksHome,
    dangerousAttacksAway,
    attacksHome,
    attacksAway,
    cornersHome,
    cornersAway,
  };
};

const liveHub = (() => {
  const tracked = new Map<number, number>();
  const detailedTracked = new Map<number, number>();
  const listeners = new Set<LiveHubListener>();
  let timerId: number | null = null;
  let inFlight = false;
  let lastPollAt = 0;
  let state: Record<number, ApiFootballLiveUpdate> = {};
  const detailedAt = new Map<number, number>();

  const notify = () => {
    for (const l of listeners) {
      try {
        l(state);
      } catch {}
    }
  };

  const ensureTimer = () => {
    if (timerId != null) return;
    timerId = window.setInterval(() => {
      void poll();
    }, 30_000);
  };

  const poll = async () => {
    if (inFlight) return;
    const now = Date.now();
    if (now - lastPollAt < 5_000) return;
    if (tracked.size === 0) return;

    const config = loadApiConfig();
    const apiKey = String(config?.apiFootballKey ?? '').trim();
    if (!apiKey) return;

    inFlight = true;
    lastPollAt = now;
    try {
      const service = new ApiFootballService(apiKey);
      const ids = Array.from(tracked.keys()).slice(0, 80);
      const tz = 'America/Sao_Paulo';

      const liveItems = await service.getFixtures({ live: 'all', timezone: tz, maxPages: 5 }).catch(() => []);
      const liveById = new Map<number, ApiFootballMatch>();
      for (const it of Array.isArray(liveItems) ? liveItems : []) {
        const id = Number(it?.fixture?.id);
        if (!Number.isFinite(id)) continue;
        liveById.set(id, it);
      }

      const next: Record<number, ApiFootballLiveUpdate> = { ...state };
      const liveTracked: Array<{ id: number; m: ApiFootballMatch }> = [];
      for (const id of ids) {
        const m = liveById.get(id) ?? null;
        if (!m) continue;
        liveTracked.push({ id, m });
        next[id] = buildBaseLiveUpdate(m);
      }

      if (detailedTracked.size > 0) {
        const toDetail = liveTracked
          .filter((x) => detailedTracked.has(x.id))
          .slice()
          .sort((a, b) => (Number(b.m?.fixture?.status?.elapsed ?? 0) || 0) - (Number(a.m?.fixture?.status?.elapsed ?? 0) || 0))
          .slice(0, 6)
          .filter((x) => {
            const last = detailedAt.get(x.id) ?? 0;
            return now - last >= 3 * 60_000;
          });

        if (toDetail.length > 0) {
          const enriched = await mapWithConcurrency(toDetail, 2, async (x) => {
            const base = next[x.id] ?? buildBaseLiveUpdate(x.m);
            const full = await enrichLiveUpdate(service, x.m, base);
            detailedAt.set(x.id, Date.now());
            return full;
          });
          for (const u of enriched) {
            if (u && Number.isFinite(u.fixtureId)) next[u.fixtureId] = u;
          }
        }
      }

      state = next;
      notify();
    } finally {
      inFlight = false;
    }
  };

  const subscribe = (ids: number[], listener: LiveHubListener, opts?: { includeDetails?: boolean }) => {
    listeners.add(listener);
    for (const id of ids) tracked.set(id, (tracked.get(id) ?? 0) + 1);
    if (opts?.includeDetails) {
      for (const id of ids) detailedTracked.set(id, (detailedTracked.get(id) ?? 0) + 1);
    }
    ensureTimer();
    listener(state);
    return () => {
      listeners.delete(listener);
      for (const id of ids) {
        const n = (tracked.get(id) ?? 0) - 1;
        if (n <= 0) tracked.delete(id);
        else tracked.set(id, n);
      }
      if (opts?.includeDetails) {
        for (const id of ids) {
          const n = (detailedTracked.get(id) ?? 0) - 1;
          if (n <= 0) detailedTracked.delete(id);
          else detailedTracked.set(id, n);
        }
      }
    };
  };

  const getState = () => state;

  return { subscribe, getState } as const;
})();

export function useApiFootballLiveUpdates(
  fixtureIds: Array<number | string>,
  opts?: { enabled?: boolean; includeDetails?: boolean },
): Record<string, ApiFootballLiveUpdate> {
  const enabled = opts?.enabled ?? true;
  const includeDetails = opts?.includeDetails ?? false;
  const ids = useMemo(() => normalizeFixtureIds(fixtureIds), [fixtureIds]);
  const idsKey = useMemo(() => ids.join(','), [ids]);
  const [snap, setSnap] = useState<Record<string, ApiFootballLiveUpdate>>({});
  const idsRef = useRef<number[]>(ids);
  idsRef.current = ids;

  useEffect(() => {
    if (!enabled || ids.length === 0) {
      setSnap({});
      return;
    }

    const listener: LiveHubListener = (state) => {
      const out: Record<string, ApiFootballLiveUpdate> = {};
      for (const id of idsRef.current) {
        const u = state[id];
        if (!u) continue;
        out[String(id)] = u;
      }
      setSnap(out);
    };
    return liveHub.subscribe(ids, listener, { includeDetails });
  }, [enabled, idsKey, includeDetails]);

  return snap;
}
