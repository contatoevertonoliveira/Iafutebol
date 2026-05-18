import { useState, useMemo, useEffect, useRef } from 'react';
import { mockMatches, mockPredictions, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { AgentAnalysis } from '../components/AgentAnalysis';
import { DraggableWindow } from '../components/DraggableWindow';
import { BarChart3, Brain, Globe, Loader2, Plus, Search, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import { MobileMatchCard } from '../components/MobileMatchCard';
import { getDynamicAgentProfiles, AgentEnsemble, AgentPrediction, learnFromMatchResult, recordTrainingSample, type FootballMatch } from '../services/aiAgents';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballService, ApiFootballMatch, useApiFootballLiveUpdates } from '../services/apiFootballService';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

type MatchStatus = 'scheduled' | 'live' | 'finished';
type StatusFilter = 'all' | 'live' | 'upcoming' | 'finished';
type GroupMode = 'leagues' | 'championships';
type ApiSource = 'api-football' | 'betfair' | 'mock';

type DisplayMatch = Match & {
  homeCrest?: string;
  awayCrest?: string;
  homeTeamId?: number;
  awayTeamId?: number;
  result?: {
    home: number | null;
    away: number | null;
  };
  liveElapsed?: number | null;
  liveStatusShort?: string;
  liveExtra?: number | null;
};

type HomeEnhancedProps = {
  initialSelectedDate?: string;
  favoritesOnly?: boolean;
};

type RequestedFixturesStoreV1 = { version: 1; items: Record<string, { fixtureId: number }> };
type RequestedFixturesStoreV2 = {
  version: 2;
  items: Record<
    string,
    | { source: 'api-football'; fixtureId: number }
    | { source: 'betfair'; match: FootballMatch }
  >;
};

type AddMatchCandidate =
  | { source: 'api-football'; fixture: ApiFootballMatch }
  | { source: 'betfair'; match: FootballMatch };

export default function Home({ initialSelectedDate = 'today', favoritesOnly = false }: HomeEnhancedProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const warnedManyLeaguesRef = useRef(false);
  const [quickSearch, setQuickSearch] = useState('');
  const warnedQuotaRef = useRef(false);
  const warnTooManyActiveLeagues = (count: number) => {
    if (!Number.isFinite(count) || count <= 30) return;
    if (warnedManyLeaguesRef.current) return;
    warnedManyLeaguesRef.current = true;
    toast.warning(`Muitas ligas ativas (${count}).`, {
      description: 'Isso pode consumir a cota diária da API-Football. Se necessário, desative ligas em Configurações → Campeonatos.',
    });
  };
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate);
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [groupMode, setGroupMode] = useState<GroupMode>('leagues');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [showAgentAnalysis, setShowAgentAnalysis] = useState(false);
  const [agentPredictions, setAgentPredictions] = useState<AgentPrediction[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [realMatches, setRealMatches] = useState<FootballMatch[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [refreshingMatchIds, setRefreshingMatchIds] = useState<Set<string>>(() => new Set());
  const [apiSource, setApiSource] = useState<ApiSource>('mock');
  const [realPredictions, setRealPredictions] = useState<Record<string, Prediction>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const realMatchesRef = useRef<FootballMatch[]>([]);
  const [detailsZIndex, setDetailsZIndex] = useState(60);
  const [agentsZIndex, setAgentsZIndex] = useState(61);
  const zCounterRef = useRef(70);
  const favoritesKey = 'favorite_matches_v1';
  const [favoriteMatchIds, setFavoriteMatchIds] = useState<string[]>([]);
  const dismissedMatchesKey = 'dismissed_matches_v1';
  const [dismissedMatchIds, setDismissedMatchIds] = useState<string[]>([]);
  const requestedFixturesKey = 'requested_fixtures_v1';
  const isSyncingRequestedRef = useRef(false);
  const isSyncingBetfairOddsRef = useRef(false);
  const [addMatchOpen, setAddMatchOpen] = useState(false);
  const [addMatchQuery, setAddMatchQuery] = useState('');
  const [addMatchLoading, setAddMatchLoading] = useState(false);
  const [addMatchError, setAddMatchError] = useState('');
  const [addMatchFixtures, setAddMatchFixtures] = useState<AddMatchCandidate[]>([]);
  const [addMatchResults, setAddMatchResults] = useState<AddMatchCandidate[]>([]);

  useEffect(() => {
    realMatchesRef.current = realMatches;
  }, [realMatches]);

  useEffect(() => {
    const refreshFavorites = () => {
      try {
        const raw = localStorage.getItem(favoritesKey) || '[]';
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setFavoriteMatchIds(parsed.map(String));
        } else {
          setFavoriteMatchIds([]);
        }
      } catch {
        setFavoriteMatchIds([]);
      }
    };

    refreshFavorites();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === favoritesKey) refreshFavorites();
    };
    const onFavoritesChanged = () => refreshFavorites();

    window.addEventListener('storage', onStorage);
    window.addEventListener('favoritesChanged' as any, onFavoritesChanged as any);
    window.addEventListener('focus', refreshFavorites);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('favoritesChanged' as any, onFavoritesChanged as any);
      window.removeEventListener('focus', refreshFavorites);
    };
  }, []);

  useEffect(() => {
    const refreshDismissed = () => {
      try {
        const raw = localStorage.getItem(dismissedMatchesKey) || '[]';
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setDismissedMatchIds(parsed.map(String).filter(Boolean));
        } else {
          setDismissedMatchIds([]);
        }
      } catch {
        setDismissedMatchIds([]);
      }
    };
    refreshDismissed();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === dismissedMatchesKey) refreshDismissed();
    };
    const onDismissedChanged = () => refreshDismissed();
    window.addEventListener('storage', onStorage);
    window.addEventListener('dismissedMatchesChanged' as any, onDismissedChanged as any);
    window.addEventListener('focus', refreshDismissed);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('dismissedMatchesChanged' as any, onDismissedChanged as any);
      window.removeEventListener('focus', refreshDismissed);
    };
  }, []);

  const dismissedMatchIdSet = useMemo(() => new Set(dismissedMatchIds.map(String)), [dismissedMatchIds]);

  const toggleFavoriteMatch = (matchId: string) => {
    try {
      const current = new Set(favoriteMatchIds);
      if (current.has(matchId)) current.delete(matchId);
      else current.add(matchId);
      const next = Array.from(current);
      localStorage.setItem(favoritesKey, JSON.stringify(next));
      setFavoriteMatchIds(next);
      window.dispatchEvent(new Event('favoritesChanged'));
    } catch {
      return;
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const league = params.get('league');
    const country = params.get('country');
    if (league && league !== selectedLeague) setSelectedLeague(league);
    if (country && country !== selectedCountry) setSelectedCountry(country);
  }, [location.search, selectedCountry, selectedLeague]);

  useEffect(() => {
    if (apiSource === 'mock' || realMatches.length === 0) return;

    const evaluatedKey = 'evaluated_matches_v1';
    let evaluated: string[] = [];
    try {
      evaluated = JSON.parse(localStorage.getItem(evaluatedKey) || '[]');
    } catch {}

    let hasNewEvaluations = false;
    const dynamicAgents = getDynamicAgentProfiles();
    const ensemble = new AgentEnsemble(dynamicAgents);

    const evaluateMatchesAsync = async () => {
      for (const m of realMatches) {
        if (toMatchStatus(m.status) !== 'finished') continue;
        const id = m.id.toString();
        if (evaluated.includes(id)) continue;
        
        const homeScore = m.score?.fullTime?.home;
        const awayScore = m.score?.fullTime?.away;
        if (typeof homeScore !== 'number' || typeof awayScore !== 'number') continue;

        // Obter as previsões individuais que foram geradas para essa partida
        const predictions = await ensemble.predictWithAllAgents(m);
        
        // Ensinar aos agentes o resultado real
        learnFromMatchResult(m, predictions);
        recordTrainingSample(m, predictions);

        evaluated.push(id);
        hasNewEvaluations = true;
      }

      if (hasNewEvaluations) {
        localStorage.setItem(evaluatedKey, JSON.stringify(evaluated));
        // Dispara evento para forçar a UI a reler a accuracy se necessário
        window.dispatchEvent(new Event('agentMetricsUpdated'));
      }
    };

    evaluateMatchesAsync();
  }, [realMatches, apiSource]);

  const toMatchStatus = (status: string): MatchStatus => {
    const normalized = String(status || '').toUpperCase();
    if (['FINISHED', 'FT', 'AET', 'PEN', 'CLOSED', 'SETTLED', 'ENDED', 'END', 'RESULT', 'ABANDONED', 'CANCELLED', 'CANCELED'].includes(normalized)) {
      return 'finished';
    }
    if (
      [
        'IN_PLAY',
        'INPLAY',
        'PAUSED',
        'BREAK',
        'LIVE',
        '1H',
        '2H',
        'HT',
        'ET',
        'BT',
        'P',
        'SUSP',
        'INT',
        'SUSPENDED',
        'INTERRUPTED',
      ].includes(normalized)
    ) {
      return 'live';
    }
    return 'scheduled';
  };

  const TIME_ZONE = 'America/Sao_Paulo';
  const getDayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const parseApiDate = (value: string) => {
    const raw = String(value || '');
    if (!raw) return new Date(NaN);
    if (/[zZ]$/.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) return new Date(raw);
    return new Date(raw);
  };

  const getDateRange = () => {
    const dateFrom = getDayKey(new Date());
    const horizonDays = selectedDate === 'today' ? 1 : selectedDate === 'week' ? 7 : selectedDate === 'month' ? 30 : 30;
    const dateTo = getDayKey(new Date(Date.now() + horizonDays * 24 * 60 * 60 * 1000));
    return { dateFrom, dateTo };
  };

  const cacheKey = 'matchesCache_v3';
  const cacheMaxAgeMs = 1000 * 60 * 15;

  const readLeaguesCatalogCache = () => {
    const keys = [
      'apiFootball_leagues_cache_v2_all',
      'apiFootball_leagues_cache_v2',
      'apiFootball_leagues_cache_v1',
    ];
    for (const key of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { fetchedAt?: string; items?: Array<{ id: number; name: string; country: string }> };
        if (!parsed?.items || !Array.isArray(parsed.items)) continue;
        return parsed.items;
      } catch {
        continue;
      }
    }
    return [] as Array<{ id: number; name: string; country: string }>;
  };

  const getConfigHash = (source: ApiSource, config: ReturnType<typeof loadApiConfig>) => {
    if (source !== 'api-football') return '';
    const ids = (config?.apiFootballDisabledLeagueIds ?? []).slice().map(Number).filter(Number.isFinite);
    ids.sort((a, b) => a - b);
    return ids.join(',');
  };

  const readCache = (dateFrom: string, dateTo: string) => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        version: number;
        generatedAt: string;
        dateFrom: string;
        dateTo: string;
        apiSource: ApiSource;
        matches: FootballMatch[];
        predictions: Record<string, Prediction>;
        configHash?: string;
      };

      if (parsed.version !== 3) return null;
      if (parsed.dateFrom !== dateFrom || parsed.dateTo !== dateTo) return null;

      const config = loadApiConfig();
      const expectedHash = getConfigHash(parsed.apiSource, config);
      const actualHash = String(parsed.configHash ?? '');
      if (expectedHash !== actualHash) return null;

      const age = Date.now() - new Date(parsed.generatedAt).getTime();
      return { ...parsed, isFresh: age >= 0 && age < cacheMaxAgeMs };
    } catch {
      return null;
    }
  };

  const writeCache = (payload: {
    dateFrom: string;
    dateTo: string;
    apiSource: ApiSource;
    matches: FootballMatch[];
    predictions: Record<string, Prediction>;
    configHash: string;
  }) => {
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          version: 3,
          generatedAt: new Date().toISOString(),
          ...payload,
        }),
      );
    } catch {
      return;
    }
  };

  useEffect(() => {
    const config = loadApiConfig();
    const { dateFrom, dateTo } = getDateRange();
    const cached = readCache(dateFrom, dateTo);

    if (cached) {
      const cachedMatches = Array.isArray(cached.matches) ? cached.matches : [];
      const isEmptyRemoteCache = cached.apiSource !== 'mock' && cachedMatches.length === 0;

      if (isEmptyRemoteCache) {
        try {
          localStorage.removeItem(cacheKey);
        } catch {}
      } else {
        setApiSource(cached.apiSource);
        setRealMatches(cachedMatches);
        setRealPredictions(cached.predictions);
        setLastUpdatedAt(new Date(cached.generatedAt));
        if (cached.isFresh) return;
      }
    }

    loadMatchesWithFallback(config);
  }, [selectedDate]);

  useEffect(() => {
    setSelectedDate(initialSelectedDate);
  }, [initialSelectedDate]);

  useEffect(() => {
    const onConfigChanged = () => {
      try {
        localStorage.removeItem('matchesCache_v1');
        localStorage.removeItem('matchesCache_v2');
        localStorage.removeItem('matchesCache_v3');
      } catch {}
      const config = loadApiConfig();
      loadMatchesWithFallback(config);
    };

    window.addEventListener('apiConfigChanged' as any, onConfigChanged as any);
    return () => window.removeEventListener('apiConfigChanged' as any, onConfigChanged as any);
  }, []);

  useEffect(() => {
    const onManualRefresh = () => {
      const config = loadApiConfig();
      loadMatchesWithFallback(config);
    };
    window.addEventListener('manualRefreshMatches' as any, onManualRefresh as any);
    return () => window.removeEventListener('manualRefreshMatches' as any, onManualRefresh as any);
  }, []);

  const syncRequestedFixtures = async () => {
    if (isSyncingRequestedRef.current) return;
    isSyncingRequestedRef.current = true;
    try {
      const config = loadApiConfig();
      const apiFootballKey = config?.apiFootballKey?.trim() || '';

      const disabled = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));

      const store = (() => {
        try {
          const raw = localStorage.getItem(requestedFixturesKey);
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          if (parsed && typeof parsed === 'object' && (parsed as any).version === 2 && (parsed as any).items) {
            return { version: 2 as const, items: { ...(parsed as any).items } } as RequestedFixturesStoreV2;
          }
          if (parsed && typeof parsed === 'object' && (parsed as any).version === 1 && (parsed as any).items) {
            const items = { ...(parsed as any).items } as Record<string, { fixtureId: number }>;
            const migrated: RequestedFixturesStoreV2 = { version: 2, items: {} };
            for (const k of Object.keys(items)) {
              const fixtureId = Number(items[k]?.fixtureId ?? k);
              if (!Number.isFinite(fixtureId)) continue;
              migrated.items[String(fixtureId)] = { source: 'api-football', fixtureId };
            }
            return migrated;
          }
          return { version: 2 as const, items: {} } as RequestedFixturesStoreV2;
        } catch {
          return { version: 2 as const, items: {} } as RequestedFixturesStoreV2;
        }
      })();

      const betfairItems = Object.values(store.items).filter((x): x is { source: 'betfair'; match: FootballMatch } => (x as any)?.source === 'betfair');
      if (betfairItems.length > 0) {
        const incoming = betfairItems.map((x) => x.match).filter(Boolean);
        if (incoming.length > 0) {
          const processed = processCrests(incoming);
          setRealMatches((prev) => {
            const map = new Map<number, FootballMatch>();
            for (const m of prev) map.set(m.id, m);
            for (const m of processed) map.set(m.id, m);
            return Array.from(map.values());
          });
          if (apiSource === 'mock') setApiSource('betfair');
          setLastUpdatedAt(new Date());
        }
      }

      const fixtureIds = (() => {
        try {
          const values = Object.values(store.items);
          return values
            .filter((x): x is { source: 'api-football'; fixtureId: number } => (x as any)?.source === 'api-football')
            .map((x) => Number(x.fixtureId))
            .filter(Number.isFinite);
        } catch {
          return [] as number[];
        }
      })();

      if (fixtureIds.length === 0) return;

      const existing = new Set(realMatchesRef.current.map((m) => String(m.id)));
      const needed = fixtureIds.filter((id) => !existing.has(String(id))).slice(0, 30);
      if (needed.length === 0) return;

      if (!apiFootballKey) return;
      if (readQuotaLock()) return;

      const service = new ApiFootballService(apiFootballKey);
      const fetched: FootballMatch[] = [];
      for (const id of needed) {
        const res = await service.getFixturesOnce({ fixtureId: id, timezone: TIME_ZONE });
        const fixture = Array.isArray(res) ? res[0] : null;
        if (!fixture) continue;
        const converted = convertApiFootballMatchToFootballMatch(fixture);
        if (disabled.size > 0 && disabled.has(Number(converted.competition.id))) continue;
        fetched.push(converted);
      }

      if (fetched.length === 0) return;
      const processed = processCrests(fetched);
      setRealMatches((prev) => {
        const map = new Map<number, FootballMatch>();
        for (const m of prev) map.set(m.id, m);
        for (const m of processed) map.set(m.id, m);
        return Array.from(map.values());
      });

      if (apiSource === 'mock') setApiSource('api-football');

      try {
        const preds = await generatePredictionsForMatches('api-football', processed);
        setRealPredictions((prev) => ({ ...prev, ...preds }));
      } catch {}

      setLastUpdatedAt(new Date());
    } finally {
      isSyncingRequestedRef.current = false;
    }
  };

  useEffect(() => {
    void syncRequestedFixtures();
    const onRequested = () => void syncRequestedFixtures();
    window.addEventListener('requestedFixturesChanged' as any, onRequested as any);
    return () => {
      window.removeEventListener('requestedFixturesChanged' as any, onRequested as any);
    };
  }, [apiSource]);

  const liveCandidateIds = useMemo(() => {
    if (apiSource !== 'api-football') return [] as number[];
    const snapshot = realMatchesRef.current;
    if (!snapshot || snapshot.length === 0) return [] as number[];

    const now = Date.now();
    const ids = snapshot
      .filter((m) => {
        const status = toMatchStatus(m.status);
        if (status === 'live') return true;
        if (status !== 'scheduled') return false;
        const kickoff = new Date(m.utcDate).getTime();
        if (!Number.isFinite(kickoff)) return false;
        return now >= kickoff - 5 * 60_000 && now <= kickoff + 3 * 60 * 60_000;
      })
      .map((m) => Number(m.id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 30);

    return ids;
  }, [apiSource, realMatches]);

  const liveUpdates = useApiFootballLiveUpdates(liveCandidateIds, { enabled: apiSource === 'api-football' });

  const normalizeSearchText = (value: string) => {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^0-9a-zA-Z\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const scoreFixture = (fixture: ApiFootballMatch, query: string) => {
    const q = normalizeSearchText(query);
    if (!q) return 0;
    const tokens = q.split(' ').filter(Boolean);
    if (tokens.length === 0) return 0;
    const home = normalizeSearchText(fixture?.teams?.home?.name ?? '');
    const away = normalizeSearchText(fixture?.teams?.away?.name ?? '');
    const league = normalizeSearchText(fixture?.league?.name ?? '');
    const merged = `${home} ${away} ${league}`;
    let hits = 0;
    for (const t of tokens) {
      if (merged.includes(t)) hits += 1;
    }
    if (hits === 0) return 0;
    return hits * 10 - Math.abs(merged.length - q.length) * 0.02;
  };

  function readQuotaLock() {
    try {
      const raw = localStorage.getItem('apiFootball_quota_exceeded_v1');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { until?: string; message?: string };
      const until = String(parsed?.until ?? '').trim();
      const ms = until ? new Date(until).getTime() : NaN;
      if (!until || !Number.isFinite(ms)) return null;
      if (Date.now() >= ms) {
        try {
          localStorage.removeItem('apiFootball_quota_exceeded_v1');
        } catch {}
        return null;
      }
      return { until, message: String(parsed?.message ?? '').trim() || 'requests: You have reached the request limit for the day' };
    } catch {
      return null;
    }
  }

  const readRequestedStore = (): RequestedFixturesStoreV2 => {
    try {
      const raw = localStorage.getItem(requestedFixturesKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === 'object' && (parsed as any).version === 2 && (parsed as any).items) {
        return { version: 2, items: { ...(parsed as any).items } } as RequestedFixturesStoreV2;
      }
      if (parsed && typeof parsed === 'object' && (parsed as any).version === 1 && (parsed as any).items) {
        const items = { ...(parsed as any).items } as Record<string, { fixtureId: number }>;
        const migrated: RequestedFixturesStoreV2 = { version: 2, items: {} };
        for (const k of Object.keys(items)) {
          const fixtureId = Number(items[k]?.fixtureId ?? k);
          if (!Number.isFinite(fixtureId)) continue;
          migrated.items[String(fixtureId)] = { source: 'api-football', fixtureId };
        }
        return migrated;
      }
      return { version: 2, items: {} };
    } catch {
      return { version: 2, items: {} };
    }
  };

  const writeRequestedStore = (store: RequestedFixturesStoreV2) => {
    localStorage.setItem(requestedFixturesKey, JSON.stringify(store));
    window.dispatchEvent(new Event('requestedFixturesChanged'));
  };

  const dismissMatch = (matchId: string) => {
    const id = String(matchId ?? '').trim();
    if (!id) return;
    try {
      const current = new Set(dismissedMatchIds.map(String));
      current.add(id);
      const nextIds = Array.from(current);
      localStorage.setItem(dismissedMatchesKey, JSON.stringify(nextIds));
      setDismissedMatchIds(nextIds);
      window.dispatchEvent(new Event('dismissedMatchesChanged'));
    } catch {}

    try {
      const store = readRequestedStore();
      let changed = false;
      for (const k of Object.keys(store.items)) {
        const v = store.items[k];
        if (v?.source === 'api-football') {
          if (String(v.fixtureId) === id) {
            delete store.items[k];
            changed = true;
          }
        } else if (v?.source === 'betfair') {
          const ev = String(v.match?.betfair?.eventId ?? '').trim();
          const mid = String(v.match?.id ?? '').trim();
          if (ev === id || mid === id || k === id) {
            delete store.items[k];
            changed = true;
          }
        }
      }
      if (changed) writeRequestedStore(store);
    } catch {}

    if (selectedMatchId === id) setSelectedMatchId(null);
    toast.success('Card removido do dashboard');
  };

  const addRequestedFixture = async (fixtureId: number, opts?: { open?: boolean }) => {
    try {
      const next = readRequestedStore();
      next.items[String(fixtureId)] = { source: 'api-football', fixtureId };
      writeRequestedStore(next);
      await syncRequestedFixtures();
      if (opts?.open) setSelectedMatchId(String(fixtureId));
      toast.success('Jogo adicionado');
      setAddMatchOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar jogo');
    }
  };

  const addRequestedBetfairMatch = async (match: FootballMatch, opts?: { open?: boolean }) => {
    try {
      const next = readRequestedStore();
      next.items[`betfair:${String(match.betfair?.eventId ?? match.id)}`] = { source: 'betfair', match };
      writeRequestedStore(next);

      const processed = processCrests([match]);
      setRealMatches((prev) => {
        const map = new Map<number, FootballMatch>();
        for (const m of prev) map.set(m.id, m);
        for (const m of processed) map.set(m.id, m);
        return Array.from(map.values());
      });
      setApiSource((s) => (s === 'mock' ? 'betfair' : s));
      setLastUpdatedAt(new Date());
      if (opts?.open) setSelectedMatchId(String(match.id));
      toast.success('Jogo adicionado');
      setAddMatchOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar jogo');
    }
  };

  const fetchBetfairMatchesForDay = async (ymd: string) => {
    const { projectId, publicAnonKey } = await import('/utils/supabase/info');
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-server-1119702f/betfair/matches/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({ dateFrom: ymd, dateTo: ymd, maxResults: 400 }),
    });
    const raw = await res.text().catch(() => '');
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    const matches = Array.isArray(data?.matches) ? (data.matches as FootballMatch[]) : [];
    return matches;
  };

  useEffect(() => {
    if (!addMatchOpen) return;
    setAddMatchError('');
    setAddMatchQuery('');
    setAddMatchResults([]);
    const cfg = loadApiConfig();
    const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
    const quotaLock = readQuotaLock();

    const disabled = new Set((cfg?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
    const leaguesCatalog = readLeaguesCatalogCache();
    const activeLeagueIds = leaguesCatalog
      .map((l) => Number((l as any).id))
      .filter(Number.isFinite)
      .filter((id) => !disabled.has(id));
    activeLeagueIds.sort((a, b) => a - b);
    const ymd = getDayKey(new Date());

    const run = async () => {
      setAddMatchLoading(true);
      try {
        const preferBetfair = !apiFootballKey || Boolean(quotaLock);
        if (preferBetfair) {
          const matches = await fetchBetfairMatchesForDay(ymd);
          const items: AddMatchCandidate[] = matches
            .map((m) => ({ source: 'betfair' as const, match: m }))
            .slice()
            .sort((a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime());
          setAddMatchFixtures(items);
          setAddMatchResults(items.slice(0, 30));
          if (!apiFootballKey) setAddMatchError('API-Football não configurada. Exibindo Betfair como fallback.');
          else setAddMatchError('API-Football indisponível (cota diária). Exibindo Betfair como fallback.');
          return;
        }

        const service = new ApiFootballService(apiFootballKey);
        if (leaguesCatalog.length === 0) {
          const matches = await fetchBetfairMatchesForDay(ymd);
          const items: AddMatchCandidate[] = matches
            .map((m) => ({ source: 'betfair' as const, match: m }))
            .slice()
            .sort((a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime());
          setAddMatchFixtures(items);
          setAddMatchResults(items.slice(0, 30));
          setAddMatchError('Catálogo de ligas não carregado. Exibindo Betfair como fallback.');
          return;
        }
        if (leaguesCatalog.length > 0 && activeLeagueIds.length === 0) {
          const matches = await fetchBetfairMatchesForDay(ymd);
          const items: AddMatchCandidate[] = matches
            .map((m) => ({ source: 'betfair' as const, match: m }))
            .slice()
            .sort((a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime());
          setAddMatchFixtures(items);
          setAddMatchResults(items.slice(0, 30));
          setAddMatchError('Todos os campeonatos estão desativados. Exibindo Betfair como fallback.');
          return;
        }
        warnTooManyActiveLeagues(activeLeagueIds.length);

        const mapWithConcurrency = async <TIn, TOut>(items: TIn[], limit: number, fn: (item: TIn, index: number) => Promise<TOut>) => {
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

        const tooManyLeagues = activeLeagueIds.length > 18;
        const activeLeagueSet = new Set(activeLeagueIds);
        const shouldSplitByLeague = activeLeagueIds.length > 0 && !tooManyLeagues;
        const [dayFixtures, liveFixtures] = shouldSplitByLeague
          ? await Promise.all([
            mapWithConcurrency(activeLeagueIds, 3, async (leagueId) => await service.getFixtures({ date: ymd, league: leagueId, timezone: TIME_ZONE, maxPages: 2 })).then((r) => r.flat()),
            mapWithConcurrency(activeLeagueIds, 3, async (leagueId) => await service.getFixtures({ live: 'all', league: leagueId, timezone: TIME_ZONE, maxPages: 2 })).then((r) => r.flat()),
          ])
          : await Promise.all([service.getFixtures({ date: ymd, timezone: TIME_ZONE, maxPages: 8 }), service.getFixtures({ live: 'all', timezone: TIME_ZONE, maxPages: 4 })]);
        const byId = new Map<number, ApiFootballMatch>();
        for (const f of [...(dayFixtures ?? []), ...(liveFixtures ?? [])]) {
          const id = Number(f?.fixture?.id);
          const leagueId = Number(f?.league?.id);
          if (!Number.isFinite(id)) continue;
          if (disabled.size > 0 && Number.isFinite(leagueId) && disabled.has(leagueId)) continue;
          if (tooManyLeagues) {
            if (!Number.isFinite(leagueId) || !activeLeagueSet.has(leagueId)) continue;
          }
          byId.set(id, f);
        }
        const items = Array.from(byId.values());
        items.sort((a, b) => Number(a?.fixture?.timestamp ?? 0) - Number(b?.fixture?.timestamp ?? 0));
        const candidates: AddMatchCandidate[] = items.map((f) => ({ source: 'api-football' as const, fixture: f }));
        setAddMatchFixtures(candidates);
        setAddMatchResults(candidates.slice(0, 30));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao buscar jogos do dia';
        const isQuota = /request limit for the day|reached the request limit|you have reached the request limit|\brequests\b\s*:/i.test(msg);
        if (isQuota) {
          try {
            const matches = await fetchBetfairMatchesForDay(ymd);
            const items: AddMatchCandidate[] = matches
              .map((m) => ({ source: 'betfair' as const, match: m }))
              .slice()
              .sort((a, b) => new Date(a.match.utcDate).getTime() - new Date(b.match.utcDate).getTime());
            setAddMatchFixtures(items);
            setAddMatchResults(items.slice(0, 30));
            setAddMatchError('API-Football indisponível (cota diária). Exibindo Betfair como fallback.');
          } catch {
            setAddMatchFixtures([]);
            setAddMatchError(msg);
          }
        } else {
          setAddMatchFixtures([]);
          setAddMatchError(msg);
        }
      } finally {
        setAddMatchLoading(false);
      }
    };
    void run();
  }, [addMatchOpen]);

  useEffect(() => {
    if (!addMatchOpen) return;
    const id = window.setTimeout(() => {
      const fixtures = addMatchFixtures ?? [];
      const q = addMatchQuery;
      if (!q.trim()) {
        const sorted = [...fixtures].sort((a, b) => {
          const as = a.source === 'api-football' ? toMatchStatus(a.fixture?.fixture?.status?.short ?? 'NS') : toMatchStatus(a.match?.status ?? '');
          const bs = b.source === 'api-football' ? toMatchStatus(b.fixture?.fixture?.status?.short ?? 'NS') : toMatchStatus(b.match?.status ?? '');
          const rank = (s: MatchStatus) => (s === 'live' ? 0 : s === 'scheduled' ? 1 : 2);
          const r = rank(as) - rank(bs);
          if (r !== 0) return r;
          const at = a.source === 'api-football' ? Number(a.fixture?.fixture?.timestamp ?? 0) : Math.floor(new Date(a.match?.utcDate ?? '').getTime() / 1000) || 0;
          const bt = b.source === 'api-football' ? Number(b.fixture?.fixture?.timestamp ?? 0) : Math.floor(new Date(b.match?.utcDate ?? '').getTime() / 1000) || 0;
          return at - bt;
        });
        setAddMatchResults(sorted.slice(0, 30));
        return;
      }

      const scored = fixtures
        .map((c) => {
          if (c.source === 'api-football') return { c, score: scoreFixture(c.fixture, q) };
          const merged = `${normalizeSearchText(c.match?.homeTeam?.name ?? '')} ${normalizeSearchText(c.match?.awayTeam?.name ?? '')} ${normalizeSearchText(c.match?.competition?.name ?? '')}`;
          const qq = normalizeSearchText(q);
          const tokens = qq.split(' ').filter(Boolean);
          let hits = 0;
          for (const t of tokens) if (merged.includes(t)) hits += 1;
          const score = hits === 0 ? 0 : hits * 10 - Math.abs(merged.length - qq.length) * 0.02;
          return { c, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map((x) => x.c);
      setAddMatchResults(scored);
    }, 140);
    return () => window.clearTimeout(id);
  }, [addMatchFixtures, addMatchOpen, addMatchQuery]);

  const convertApiFootballMatchToFootballMatch = (m: ApiFootballMatch): FootballMatch => {
    const status = m.fixture?.status?.short || 'NS';
    const leagueName = m.league?.name || 'Unknown';
    const leagueCountry = m.league?.country || 'Unknown';
    const leagueFlag = m.league?.flag || '';
    const isLiveStatus = toMatchStatus(status) === 'live';
    const isFinishedStatus = toMatchStatus(status) === 'finished';
    const homeGoals =
      typeof m.goals.home === 'number' ? m.goals.home : isLiveStatus ? 0 : isFinishedStatus ? 0 : null;
    const awayGoals =
      typeof m.goals.away === 'number' ? m.goals.away : isLiveStatus ? 0 : isFinishedStatus ? 0 : null;

    return {
      id: m.fixture.id,
      utcDate: Number.isFinite(m.fixture?.timestamp)
        ? new Date(m.fixture.timestamp * 1000).toISOString()
        : m.fixture.date,
      status,
      matchday: 0,
      homeTeam: {
        id: m.teams.home.id,
        name: m.teams.home.name,
        shortName: m.teams.home.code || m.teams.home.name,
        tla: m.teams.home.code || m.teams.home.name.substring(0, 3).toUpperCase(),
        crest: m.teams.home.logo || '',
      },
      awayTeam: {
        id: m.teams.away.id,
        name: m.teams.away.name,
        shortName: m.teams.away.code || m.teams.away.name,
        tla: m.teams.away.code || m.teams.away.name.substring(0, 3).toUpperCase(),
        crest: m.teams.away.logo || '',
      },
      score: {
        fullTime: {
          home: homeGoals,
          away: awayGoals,
        },
      },
      live: {
        elapsed: m.fixture.status.elapsed,
        statusShort: m.fixture.status.short,
        extra: m.fixture.status.extra,
      },
      competition: {
        id: m.league.id,
        name: leagueName,
        code: String(m.league.id),
        emblem: m.league.logo || '',
        area: {
          name: leagueCountry,
          code: '',
          flag: leagueFlag,
        },
      },
    };
  };

  const calculateOddsFromConfidence = (confidence: number) => {
    const c = Math.max(40, Math.min(95, confidence));
    const normalized = (95 - c) / (95 - 40);
    const odds = 1.2 + normalized * 3.3;
    return Number(odds.toFixed(2));
  };

  const fairProbFromConfidence = (confidence: number) => {
    const c = Math.max(1, Math.min(99, Number(confidence) || 0));
    return c / 100;
  };

  const fairOddsFromConfidence = (confidence: number) => {
    const p = fairProbFromConfidence(confidence);
    return p > 0 ? 1 / p : null;
  };

  const getBetfairBackOdd = (m: FootballMatch | undefined, outcome: 'home' | 'draw' | 'away') => {
    const raw =
      outcome === 'home'
        ? m?.betfair?.odds?.home?.back
        : outcome === 'draw'
          ? m?.betfair?.odds?.draw?.back
          : m?.betfair?.odds?.away?.back;
    const v = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
    if (!Number.isFinite(v as number)) return null;
    const n = Number(v);
    return n > 1.001 ? n : null;
  };

  const normalizeScoreKey = (value: string) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const m = raw.match(/^(\d+)\s*[-x×]\s*(\d+)$/i) || raw.match(/^(\d+)\s*-\s*(\d+)$/i);
    if (!m) return null;
    return `${Number(m[1])}-${Number(m[2])}`;
  };

  const getBetfairCorrectScoreBackOdd = (m: FootballMatch | undefined, scoreKey: string | null) => {
    if (!scoreKey) return null;
    const raw = m?.betfair?.correctScore?.prices?.[scoreKey]?.back ?? null;
    const v = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
    if (!Number.isFinite(v as number)) return null;
    const n = Number(v);
    return n > 1.001 ? n : null;
  };

  const getBetfairCorrectScoreProb = (m: FootballMatch | undefined, scoreKey: string | null) => {
    if (!scoreKey) return null;
    const raw = m?.betfair?.correctScore?.prices?.[scoreKey]?.prob ?? null;
    const v = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
    if (!Number.isFinite(v as number)) return null;
    const n = Number(v);
    return n >= 0 ? n : null;
  };

  const expectedValueFromProbAndOdd = (prob: number, odd: number) => {
    const p = Math.max(0.001, Math.min(0.999, Number(prob) || 0));
    const o = Math.max(1.001, Number(odd) || 0);
    return p * o - 1;
  };

  const consensusToPrediction = (matchId: string, consensus: AgentPrediction): Prediction => {
    const winnerConfidenceRaw = Number(consensus.winnerConfidence);
    const winnerConfidence = Number.isFinite(winnerConfidenceRaw) ? Math.round(winnerConfidenceRaw) : 0;
    const aiConfidenceRaw = Number(consensus.confidence);
    const aiConfidence = Number.isFinite(aiConfidenceRaw) ? Math.round(aiConfidenceRaw) : 0;
    return {
      matchId,
      aiConfidence,
      winner: {
        prediction: consensus.winner,
        confidence: winnerConfidence,
        odds: calculateOddsFromConfidence(winnerConfidence),
      },
      firstHalf: {
        prediction: consensus.firstHalf.prediction,
        confidence: Math.round(consensus.firstHalf.confidence),
      },
      secondHalf: {
        prediction: consensus.secondHalf.prediction,
        confidence: Math.round(consensus.secondHalf.confidence),
      },
      overUnder: {
        prediction: consensus.overUnder.prediction,
        line: consensus.overUnder.line,
        confidence: Math.round(consensus.overUnder.confidence),
      },
      asianHandicap: {
        team: consensus.asianHandicap.team,
        line: consensus.asianHandicap.line,
        confidence: Math.round(consensus.asianHandicap.confidence),
      },
      correctScore: {
        score: consensus.correctScore.score,
        confidence: Math.round(consensus.correctScore.confidence),
      },
      btts: {
        prediction: consensus.btts.prediction,
        confidence: Math.round(consensus.btts.confidence),
      },
    };
  };

  const generatePredictionsForMatches = async (source: ApiSource, matches: FootballMatch[], opts?: { force?: boolean }) => {
    const storeKey = 'predictionStore_v2';
    const store = (() => {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) return { version: 2 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
        const parsed = JSON.parse(raw) as {
          version: number;
          items: Record<string, { createdAt: string; prediction: Prediction }>;
        };
        if (parsed.version !== 2 || !parsed.items) {
          return { version: 2 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
        }
        return { version: 2 as const, items: parsed.items };
      } catch {
        return { version: 2 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
      }
    })();

    const dynamicAgents = getDynamicAgentProfiles();
    const ensemble = new AgentEnsemble(dynamicAgents);

    const readRequestedFixtureIds = () => {
      try {
        const raw = localStorage.getItem(requestedFixturesKey);
        if (!raw) return [] as string[];
        const parsed = JSON.parse(raw) as { version: number; items: Record<string, { fixtureId: number }> };
        if (!parsed || parsed.version !== 1 || !parsed.items) return [] as string[];
        return Object.keys(parsed.items).map(String);
      } catch {
        return [] as string[];
      }
    };

    const selectedDashboardIds = new Set<string>([...favoriteMatchIds.map(String), ...readRequestedFixtureIds()]);

    const buildPreLiveSummary = (arr: ApiFootballMatch[], teamId: number) => {
      const items = Array.isArray(arr) ? arr : [];
      let played = 0;
      let gf = 0;
      let ga = 0;
      let w = 0;
      let d = 0;
      let l = 0;
      for (const f of items) {
        const homeId = Number((f as any)?.teams?.home?.id);
        const awayId = Number((f as any)?.teams?.away?.id);
        const gHome = typeof (f as any)?.goals?.home === 'number' ? (f as any).goals.home : null;
        const gAway = typeof (f as any)?.goals?.away === 'number' ? (f as any).goals.away : null;
        if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;
        if (gHome == null || gAway == null) continue;
        const isHome = homeId === teamId;
        const isAway = awayId === teamId;
        if (!isHome && !isAway) continue;
        const goalsFor = isHome ? gHome : gAway;
        const goalsAgainst = isHome ? gAway : gHome;
        played += 1;
        gf += goalsFor;
        ga += goalsAgainst;
        if (goalsFor > goalsAgainst) w += 1;
        else if (goalsFor < goalsAgainst) l += 1;
        else d += 1;
      }
      return {
        played,
        gfAvg: played > 0 ? Math.round((gf / played) * 100) / 100 : null,
        gaAvg: played > 0 ? Math.round((ga / played) * 100) / 100 : null,
        w,
        d,
        l,
      };
    };

    const buildH2HSummary = (arr: ApiFootballMatch[], homeId: number, awayId: number) => {
      const items = Array.isArray(arr) ? arr : [];
      let played = 0;
      let homeW = 0;
      let awayW = 0;
      let draw = 0;
      let goals = 0;
      for (const f of items) {
        const hId = Number((f as any)?.teams?.home?.id);
        const aId = Number((f as any)?.teams?.away?.id);
        const gHome = typeof (f as any)?.goals?.home === 'number' ? (f as any).goals.home : null;
        const gAway = typeof (f as any)?.goals?.away === 'number' ? (f as any).goals.away : null;
        if (!Number.isFinite(hId) || !Number.isFinite(aId)) continue;
        if (gHome == null || gAway == null) continue;
        const isSamePair = (hId === homeId && aId === awayId) || (hId === awayId && aId === homeId);
        if (!isSamePair) continue;
        played += 1;
        goals += gHome + gAway;
        const homeGoalsForHomeTeam = hId === homeId ? gHome : gAway;
        const awayGoalsForAwayTeam = aId === awayId ? gAway : gHome;
        if (homeGoalsForHomeTeam > awayGoalsForAwayTeam) homeW += 1;
        else if (homeGoalsForHomeTeam < awayGoalsForAwayTeam) awayW += 1;
        else draw += 1;
      }
      return { played, homeW, awayW, draw, goalsAvg: played > 0 ? Math.round((goals / played) * 100) / 100 : null };
    };

    const ensurePreLiveStats = async (m: FootballMatch) => {
      if (source !== 'api-football') return;
      const id = String(m.id);
      if (!selectedDashboardIds.has(id)) return;

      const status = toMatchStatus(m.status);
      if (status !== 'scheduled') return;
      const kickoffMs = new Date(m.utcDate).getTime();
      if (!Number.isFinite(kickoffMs)) return;
      if (kickoffMs - Date.now() > 24 * 60 * 60_000) return;

      const cacheKey = `prelive_summary_v1:${id}`;
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { fetchedAt: string; preLive: FootballMatch['preLive'] };
          const age = parsed?.fetchedAt ? Date.now() - new Date(parsed.fetchedAt).getTime() : Infinity;
          if (Number.isFinite(age) && age >= 0 && age < 6 * 60 * 60_000 && parsed?.preLive) {
            (m as any).preLive = parsed.preLive;
            return;
          }
        }
      } catch {}

      const cfg = loadApiConfig();
      const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
      if (!apiFootballKey) return;
      const homeId = Number(m.homeTeam?.id);
      const awayId = Number(m.awayTeam?.id);
      if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) return;

      try {
        const service = new ApiFootballService(apiFootballKey);
        const last = 10;
        const [homeLast, awayLast, h2h] = await Promise.all([
          service.getFixturesOnce({ team: homeId, last, timezone: TIME_ZONE }).catch(() => [] as ApiFootballMatch[]),
          service.getFixturesOnce({ team: awayId, last, timezone: TIME_ZONE }).catch(() => [] as ApiFootballMatch[]),
          service.getH2H({ h2h: `${homeId}-${awayId}` }).catch(() => [] as ApiFootballMatch[]),
        ]);
        const preLive: FootballMatch['preLive'] = {
          fetchedAt: new Date().toISOString(),
          homeLast: buildPreLiveSummary(homeLast, homeId),
          awayLast: buildPreLiveSummary(awayLast, awayId),
          h2h: buildH2HSummary(h2h.slice(0, 10), homeId, awayId),
        };
        (m as any).preLive = preLive;
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: preLive.fetchedAt, preLive }));
        } catch {}
      } catch {}
    };

    for (const m of matches) {
      const id = m.id.toString();
      const key = `${source}:${id}`;
      if (opts?.force) {
        delete store.items[key];
      } else if (store.items[key]?.prediction) {
        continue;
      }
      let consensus: AgentPrediction | null = null;
      try {
        await ensurePreLiveStats(m);
        consensus = await ensemble.getConsensusPrediction(m);
      } catch {
        continue;
      }
      store.items[key] = {
        createdAt: new Date().toISOString(),
        prediction: consensusToPrediction(id, consensus),
      };
    }

    try {
      localStorage.setItem(storeKey, JSON.stringify(store));
    } catch {}

    const entries = matches
      .map((m) => {
        const id = m.id.toString();
        const key = `${source}:${id}`;
        const pred = store.items[key]?.prediction ?? null;
        return pred ? ([id, pred] as const) : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    return Object.fromEntries(entries);
  };

  const processCrests = (matches: FootballMatch[]) => {
    return matches.map((match) => {
      const homeCrest = match.homeTeam.crest || '';
      const awayCrest = match.awayTeam.crest || '';

      return {
        ...match,
        homeTeam: {
          ...match.homeTeam,
          crest: homeCrest,
        },
        awayTeam: {
          ...match.awayTeam,
          crest: awayCrest,
        },
      };
    });
  };

  const loadMatchesWithFallback = async (config: ReturnType<typeof loadApiConfig>) => {
    setIsLoadingMatches(true);
    try {
      const { dateFrom, dateTo } = getDateRange();
      console.log('🔍 Iniciando carregamento de partidas...');
      console.log(`📅 Período: ${dateFrom} a ${dateTo}`);

      setRealPredictions({});
      let successfulSource: ApiSource | null = null;

      const apiFootballKey = config?.apiFootballKey?.trim();

      if (apiFootballKey) {
        try {
          const service = new ApiFootballService(apiFootballKey);
          const horizonDays = selectedDate === 'today' ? 1 : selectedDate === 'week' ? 7 : 30;
          const days = Array.from({ length: horizonDays }, (_, i) => getDayKey(new Date(Date.now() + i * 24 * 60 * 60 * 1000)));
          const allowedKeys = new Set(days);

          const fixtureLocalDayKey = (m: ApiFootballMatch) => {
            const raw = String(m?.fixture?.date ?? '');
            if (!raw) return '';
            return getDayKey(parseApiDate(raw));
          };

          const mapWithConcurrency = async <TIn, TOut>(
            items: TIn[],
            limit: number,
            fn: (item: TIn, index: number) => Promise<TOut>,
          ) => {
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

          const disabledLeagueIds = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
          const leaguesCatalog = readLeaguesCatalogCache();
          const activeLeagueIds = leaguesCatalog
            .map((l) => Number((l as any).id))
            .filter(Number.isFinite)
            .filter((id) => !disabledLeagueIds.has(id));
          activeLeagueIds.sort((a, b) => a - b);

          if (leaguesCatalog.length === 0) {
            throw new Error('Catálogo de ligas não carregado. Abra Configurações → Campeonatos e clique em “Atualizar lista”.');
          }

          if (leaguesCatalog.length > 0 && activeLeagueIds.length === 0) {
            successfulSource = successfulSource ?? 'api-football';
            setApiSource('api-football');
            setRealMatches([]);
            setRealPredictions({});
            setLastUpdatedAt(new Date());
            writeCache({
              dateFrom,
              dateTo,
              apiSource: 'api-football',
              matches: [],
              predictions: {},
              configHash: getConfigHash('api-football', config),
            });
            toast.warning('Todos os campeonatos estão desativados. Ative pelo menos um em Configurações → Campeonatos.');
            return;
          }

          warnTooManyActiveLeagues(activeLeagueIds.length);

          const tooManyLeagues = activeLeagueIds.length > 18;
          const activeLeagueSet = new Set(activeLeagueIds);
          const shouldSplitByLeague = activeLeagueIds.length > 0 && !tooManyLeagues;
          const perLeaguePages = selectedDate === 'today' ? 5 : selectedDate === 'week' ? 4 : 3;
          const perDayLimit = selectedDate === 'today' ? 6 : selectedDate === 'week' ? 5 : 4;
          const perDayPages = selectedDate === 'today' ? 8 : selectedDate === 'week' ? 6 : 5;

          const rangeFixtures = shouldSplitByLeague
            ? (
              await mapWithConcurrency(
                activeLeagueIds,
                3,
                async (leagueId) =>
                  await service.getFixtures({ from: dateFrom, to: dateTo, league: leagueId, timezone: TIME_ZONE, maxPages: perLeaguePages }),
              )
            ).flat()
            : (
              await mapWithConcurrency(
                days,
                perDayLimit,
                async (date) => {
                  const items = await service.getFixtures({ date, timezone: TIME_ZONE, maxPages: perDayPages });
                  return items.filter((m) => fixtureLocalDayKey(m) === date);
                },
              )
            ).flat();

          const includeLive = days.includes(getDayKey(new Date()));
          const liveItems = includeLive
            ? shouldSplitByLeague
              ? (
                await mapWithConcurrency(
                  activeLeagueIds,
                  3,
                  async (leagueId) => await service.getFixtures({ live: 'all', league: leagueId, timezone: TIME_ZONE, maxPages: 2 }),
                )
              ).flat()
              : await service.getFixtures({ live: 'all', timezone: TIME_ZONE, maxPages: 5 }).catch(() => [])
            : [];

          const filteredRange = tooManyLeagues
            ? (Array.isArray(rangeFixtures) ? rangeFixtures : []).filter((m) => {
              const leagueId = Number((m as any)?.league?.id);
              return Number.isFinite(leagueId) && activeLeagueSet.has(leagueId);
            })
            : rangeFixtures;

          const filteredLive = tooManyLeagues
            ? (Array.isArray(liveItems) ? liveItems : []).filter((m) => {
              const leagueId = Number((m as any)?.league?.id);
              return Number.isFinite(leagueId) && activeLeagueSet.has(leagueId);
            })
            : liveItems;

          const unique = new Map<number, ApiFootballMatch>();
          for (const m of filteredRange) {
            const id = Number(m?.fixture?.id);
            if (!Number.isFinite(id)) continue;
            if (!allowedKeys.has(fixtureLocalDayKey(m))) continue;
            unique.set(id, m);
          }
          for (const m of filteredLive) {
            const id = Number(m?.fixture?.id);
            if (!Number.isFinite(id)) continue;
            if (!unique.has(id)) unique.set(id, m);
          }

          const fixtures = Array.from(unique.values());
          const matches = fixtures.map(convertApiFootballMatchToFootballMatch);
          if (matches.length > 0) {
            successfulSource = successfulSource ?? 'api-football';
            const processedMatches = processCrests(matches);
            const disabled = config?.apiFootballDisabledLeagueIds ?? [];
            const visibleMatches = disabled.length > 0 ? processedMatches.filter((m) => !disabled.includes(m.competition.id)) : processedMatches;
            setApiSource('api-football');
            setRealMatches(visibleMatches);
            if (visibleMatches.length === 0 && processedMatches.length > 0 && disabled.length > 0) {
              setRealPredictions({});
              setLastUpdatedAt(new Date());
              writeCache({
                dateFrom,
                dateTo,
                apiSource: 'api-football',
                matches: [],
                predictions: {},
                configHash: getConfigHash('api-football', config),
              });
              toast.warning('Todos os campeonatos estão desativados. Ative pelo menos um em Ligas para ver jogos.');
              return;
            }
            const predictionsById = await generatePredictionsForMatches('api-football', visibleMatches);
            setRealPredictions(predictionsById);
            setLastUpdatedAt(new Date());
            writeCache({
              dateFrom,
              dateTo,
              apiSource: 'api-football',
              matches: visibleMatches,
              predictions: predictionsById,
              configHash: getConfigHash('api-football', config),
            });
            toast.success(`${matches.length} partidas carregadas (API-Football)`);
            return;
          }
          toast.info(`API-Football não retornou partidas para o período ${dateFrom} → ${dateTo}`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error ?? '');
          if (!warnedQuotaRef.current && /request limit for the day|reached the request limit|you have reached the request limit|\\brequests\\b\\s*:/i.test(msg)) {
            warnedQuotaRef.current = true;
            toast.warning('Cota diária da API-Football atingida. Usando Betfair para manter o sistema ativo.');
          }
          console.warn('⚠️ API-Football falhou, tentando próxima opção...', error);
        }
      }

      try {
        const { projectId, publicAnonKey } = await import('/utils/supabase/info');
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/betfair-server-1119702f/betfair/matches/list`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: publicAnonKey,
              Authorization: `Bearer ${publicAnonKey}`,
            },
            body: JSON.stringify({
              dateFrom,
              dateTo,
              maxResults: selectedDate === 'today' ? 120 : selectedDate === 'week' ? 220 : 300,
            }),
          },
        );

        const raw = await res.text().catch(() => '');
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = null;
        }

        if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));

        const matches = Array.isArray(data?.matches) ? (data.matches as FootballMatch[]) : [];
        successfulSource = successfulSource ?? 'betfair';
        if (matches.length > 0) {
          const processedMatches = processCrests(matches);
          setApiSource('betfair');
          setRealMatches(processedMatches);
          const predictionsById = await generatePredictionsForMatches('betfair', processedMatches);
          setRealPredictions(predictionsById);
          setLastUpdatedAt(new Date());
          writeCache({
            dateFrom,
            dateTo,
            apiSource: 'betfair',
            matches: processedMatches,
            predictions: predictionsById,
            configHash: '',
          });
          toast.success(`${matches.length} partidas carregadas (Betfair)`);
          return;
        }
      } catch (error) {
        console.warn('⚠️ Betfair falhou, usando fallback...', error);
      }

      if (successfulSource) {
        setApiSource('mock');
        setRealMatches([]);
        setLastUpdatedAt(new Date());
        toast.info('Nenhuma partida encontrada para o período selecionado');
        return;
      }

      setApiSource('mock');
      setRealMatches([]);
      toast.warning('Usando dados de exemplo (nenhuma API respondeu)');
    } catch (error) {
      console.error('❌ Erro ao carregar partidas:', error);
      setApiSource('mock');
      setRealMatches([]);
      toast.warning('Usando dados de exemplo devido a erro nas APIs');
    } finally {
      setIsLoadingMatches(false);
    }
  };

  // Função para gerar dados mock quando a API falha
  const getMockMatches = () => {
    const teams = [
      { id: 1765, name: 'Flamengo', crest: '', shortName: 'FLA' },
      { id: 1770, name: 'Palmeiras', crest: '', shortName: 'PAL' },
      { id: 1766, name: 'São Paulo', crest: '', shortName: 'SAO' },
      { id: 1769, name: 'Grêmio', crest: '', shortName: 'GRE' },
      { id: 66, name: 'Manchester United', crest: '', shortName: 'MUN' },
      { id: 57, name: 'Arsenal', crest: '', shortName: 'ARS' },
    ];

    const competitions = [
      { id: 2013, name: 'Campeonato Brasileiro Série A', emblem: '' },
      { id: 2021, name: 'Premier League', emblem: '' },
    ];

    const today = new Date();
    const matches = [];

    for (let i = 0; i < 6; i++) {
      const matchDate = new Date(today);
      matchDate.setDate(today.getDate() + i);
      
      const homeTeam = teams[i % teams.length];
      const awayTeam = teams[(i + 1) % teams.length];
      const competition = competitions[i % competitions.length];
      
      matches.push({
        id: 400000 + i,
        utcDate: matchDate.toISOString(),
        status: 'SCHEDULED',
        matchday: Math.floor(Math.random() * 38) + 1,
        competition: {
          id: competition.id,
          name: competition.name,
          emblem: competition.emblem
        },
        homeTeam: {
          id: homeTeam.id,
          name: homeTeam.name,
          shortName: homeTeam.shortName,
          crest: homeTeam.crest
        },
        awayTeam: {
          id: awayTeam.id,
          name: awayTeam.name,
          shortName: awayTeam.shortName,
          crest: awayTeam.crest
        },
        score: {
          winner: null,
          fullTime: { home: null, away: null }
        }
      });
    }
    
    console.log('🎭 Usando dados mock (fallback)');
    return matches;
  };

  // Filtrar partidas
  // Filtrar partidas - usa realMatches se disponível, senão mockMatches
  const matchesToUse = useMemo(() => {
    if (apiSource === 'mock') return mockMatches.map((m) => ({ ...m, homeCrest: '', awayCrest: '' })) as DisplayMatch[];

    return realMatches.map((footballMatch) => {
      const matchDate = parseApiDate(footballMatch.utcDate);
      const fullTime = footballMatch.score?.fullTime;
      const live = liveUpdates[String(footballMatch.id)] ?? null;
      const status = toMatchStatus(String(live?.statusShort ?? footballMatch.status));
      return {
        id: footballMatch.id.toString(),
        homeTeam: footballMatch.homeTeam.name,
        awayTeam: footballMatch.awayTeam.name,
        homeCrest: footballMatch.homeTeam.crest || '',
        awayCrest: footballMatch.awayTeam.crest || '',
        homeTeamId: footballMatch.homeTeam.id,
        awayTeamId: footballMatch.awayTeam.id,
        league: footballMatch.competition.name,
        country: footballMatch.area?.name || footballMatch.competition.area?.name || 'Unknown',
        date: matchDate,
        time: matchDate.toLocaleTimeString('pt-BR', {
          timeZone: TIME_ZONE,
          hour: '2-digit',
          minute: '2-digit',
        }),
        status,
        result: {
          home: typeof live?.goalsHome === 'number' ? live.goalsHome : typeof fullTime?.home === 'number' ? fullTime.home : null,
          away: typeof live?.goalsAway === 'number' ? live.goalsAway : typeof fullTime?.away === 'number' ? fullTime.away : null,
        },
        liveElapsed: typeof live?.elapsed === 'number' ? live.elapsed : (footballMatch.live?.elapsed ?? null),
        liveStatusShort: (live?.statusShort ?? footballMatch.live?.statusShort) ?? undefined,
        liveExtra: typeof live?.extra === 'number' ? live.extra : (footballMatch.live?.extra ?? null),
      };
    }) as DisplayMatch[];
  }, [TIME_ZONE, apiSource, liveUpdates, parseApiDate, realMatches]);

  const baseFilteredMatches = useMemo(() => {
    const now = new Date();
    const todayKey = getDayKey(now);
    const tomorrowKey = getDayKey(new Date(Date.now() + 1 * 24 * 60 * 60 * 1000));
    const allowedKeys = (() => {
      if (selectedDate === 'week') {
        const set = new Set<string>();
        for (let i = 0; i < 7; i++) set.add(getDayKey(new Date(Date.now() + i * 24 * 60 * 60 * 1000)));
        return set;
      }
      if (selectedDate === 'fortnight') {
        const set = new Set<string>();
        for (let i = 0; i < 15; i++) set.add(getDayKey(new Date(Date.now() + i * 24 * 60 * 60 * 1000)));
        return set;
      }
      if (selectedDate === 'month') {
        const set = new Set<string>();
        for (let i = 0; i < 30; i++) set.add(getDayKey(new Date(Date.now() + i * 24 * 60 * 60 * 1000)));
        return set;
      }
      return null;
    })();

    return matchesToUse.filter((match) => {
      const matchKey = getDayKey(new Date(match.date));

      if (match.status === 'finished' && matchKey < todayKey) {
        return false;
      }

      if (selectedStatus !== 'all') {
        if (selectedStatus === 'live' && match.status !== 'live') return false;
        if (selectedStatus === 'upcoming' && match.status !== 'scheduled') return false;
        if (selectedStatus === 'finished' && match.status !== 'finished') return false;
      }

      // Filtro de data
      if (selectedDate !== 'all') {
        if (selectedDate === 'today') {
          if (matchKey !== todayKey) return false;
        } else if (selectedDate === 'tomorrow') {
          if (matchKey !== tomorrowKey) return false;
        } else if (selectedDate === 'week') {
          if (!allowedKeys?.has(matchKey)) return false;
        } else if (selectedDate === 'fortnight') {
          if (!allowedKeys?.has(matchKey)) return false;
        } else if (selectedDate === 'month') {
          if (!allowedKeys?.has(matchKey)) return false;
        }
      }

      if (favoritesOnly && !favoriteMatchIds.includes(match.id)) {
        return false;
      }

      if (dismissedMatchIdSet.has(match.id)) {
        return false;
      }

      return true;
    });
  }, [dismissedMatchIdSet, favoritesOnly, favoriteMatchIds, getDayKey, matchesToUse, selectedDate, selectedStatus]);

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => {
      // Filtro de país
      if (selectedCountry !== 'all' && match.country !== selectedCountry) {
        return false;
      }

      // Filtro de liga
      if (selectedLeague !== 'all' && match.league !== selectedLeague) {
        return false;
      }

      const query = String(quickSearch ?? '').trim();
      if (query) {
        const normalize = (v: string) =>
          String(v ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/['’]/g, '')
            .replace(/[^0-9a-z\s]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const tokens = normalize(query).split(' ').filter(Boolean);
        if (tokens.length > 0) {
          const hay = normalize(`${match.homeTeam} ${match.awayTeam}`);
          for (const t of tokens) {
            if (!hay.includes(t)) return false;
          }
        }
      }

      return true;
    });
  }, [baseFilteredMatches, quickSearch, selectedCountry, selectedLeague]);

  const optionMatches = useMemo(() => {
    if (!favoritesOnly) return matchesToUse;
    return matchesToUse.filter((m) => favoriteMatchIds.includes(m.id));
  }, [favoriteMatchIds, favoritesOnly, matchesToUse]);

  const enabledLeagueOptions = useMemo(() => {
    if (apiSource !== 'api-football') return { countries: [] as string[], leagues: [] as string[] };
    const config = loadApiConfig();
    const disabledIds = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
    try {
      const raw = localStorage.getItem('apiFootball_leagues_cache_v2') ?? localStorage.getItem('apiFootball_leagues_cache_v1');
      if (!raw) return { countries: [] as string[], leagues: [] as string[] };
      const parsed = JSON.parse(raw) as { fetchedAt: string; items: Array<{ id: number; name: string; country: string }> };
      const items = Array.isArray(parsed?.items) ? parsed.items : [];

      const countries = new Set<string>();
      const leagues = new Set<string>();
      let enabledCount = 0;
      for (const l of items) {
        const id = Number((l as any).id);
        if (!Number.isFinite(id)) continue;
        if (!disabledIds.has(id)) enabledCount += 1;
        const country = String((l as any).country ?? '').trim();
        const name = String((l as any).name ?? '').trim();
        if (!disabledIds.has(id) || enabledCount === 0) {
          if (country) countries.add(country);
          if (name) leagues.add(name);
        }
      }

      if (enabledCount === 0) {
        countries.clear();
        leagues.clear();
        for (const l of items) {
          const id = Number((l as any).id);
          if (!Number.isFinite(id)) continue;
          const country = String((l as any).country ?? '').trim();
          const name = String((l as any).name ?? '').trim();
          if (country) countries.add(country);
          if (name) leagues.add(name);
        }
      }

      return {
        countries: Array.from(countries).sort((a, b) => a.localeCompare(b)),
        leagues: Array.from(leagues).sort((a, b) => a.localeCompare(b)),
      };
    } catch {
      return { countries: [] as string[], leagues: [] as string[] };
    }
  }, [apiSource]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const c of optionMatches.map((m) => m.country)) if (c) set.add(c);
    for (const c of enabledLeagueOptions.countries) if (c) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enabledLeagueOptions.countries, optionMatches]);

  const leagues = useMemo(() => {
    const set = new Set<string>();
    for (const l of optionMatches.map((m) => m.league)) if (l) set.add(l);
    for (const l of enabledLeagueOptions.leagues) if (l) set.add(l);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enabledLeagueOptions.leagues, optionMatches]);

  // Agrupar partidas por liga
  const groupedMatches = useMemo(() => {
    const statusRank = (status: MatchStatus) => (status === 'live' ? 0 : status === 'scheduled' ? 1 : 2);
    const groups: Record<string, Match[]> = {};
    
    filteredMatches.forEach((match) => {
      const key = groupMode === 'championships' ? match.league : `${match.country} - ${match.league}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(match);
    });

    const sortMatches = (a: Match, b: Match) => {
      const rankA = statusRank(a.status as MatchStatus);
      const rankB = statusRank(b.status as MatchStatus);
      if (rankA !== rankB) return rankA - rankB;

      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();

      if (rankA === 2) return timeB - timeA;
      return timeA - timeB;
    };

    const entries = Object.entries(groups).map(([key, matches]) => {
      const sorted = [...matches].sort(sortMatches);
      return [key, sorted] as const;
    });

    const groupBestRank = (matches: Match[]) => Math.min(...matches.map((m) => statusRank(m.status as MatchStatus)));
    const groupBestTime = (matches: Match[]) => {
      const best = groupBestRank(matches);
      const times = matches
        .filter((m) => statusRank(m.status as MatchStatus) === best)
        .map((m) => new Date(m.date).getTime());
      return times.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...times);
    };

    entries.sort((a, b) => {
      const rankA = groupBestRank(a[1]);
      const rankB = groupBestRank(b[1]);
      if (rankA !== rankB) return rankA - rankB;
      return groupBestTime(a[1]) - groupBestTime(b[1]);
    });

    return entries;
  }, [filteredMatches, groupMode]);

  const predictionByMatchId = useMemo(() => {
    if (apiSource !== 'mock') return realPredictions;
    return Object.fromEntries(mockPredictions.map((p) => [p.matchId, p]));
  }, [apiSource, realPredictions]);

  const realMatchById = useMemo(() => {
    return Object.fromEntries(realMatches.map((m) => [m.id.toString(), m])) as Record<string, FootballMatch>;
  }, [realMatches]);

  useEffect(() => {
    type MatchHistoryItem = {
      id: string;
      source: ApiSource;
      archivedAt: string;
      match: {
        id: string;
        utcDate: string;
        homeTeam: string;
        awayTeam: string;
        league: string;
        country: string;
        result: { home: number; away: number };
      };
      prediction: Prediction | null;
    };

    const historyKey = 'matches_history_v1';
    const store = (() => {
      try {
        const raw = localStorage.getItem(historyKey);
        if (!raw) return { version: 1 as const, items: {} as Record<string, MatchHistoryItem> };
        const parsed = JSON.parse(raw) as { version: number; items: Record<string, MatchHistoryItem> };
        if (parsed.version !== 1 || !parsed.items) return { version: 1 as const, items: {} as Record<string, MatchHistoryItem> };
        return { version: 1 as const, items: parsed.items };
      } catch {
        return { version: 1 as const, items: {} as Record<string, MatchHistoryItem> };
      }
    })();

    let changed = false;
    for (const match of filteredMatches) {
      if (match.status !== 'finished') continue;
      if (typeof match.result?.home !== 'number' || typeof match.result?.away !== 'number') continue;
      if (store.items[match.id]) continue;

      const prediction = predictionByMatchId[match.id] ?? null;

      store.items[match.id] = {
        id: match.id,
        source: apiSource,
        archivedAt: new Date().toISOString(),
        match: {
          id: match.id,
          utcDate: new Date(match.date).toISOString(),
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league: match.league,
          country: match.country,
          result: { home: match.result!.home!, away: match.result!.away! },
        },
        prediction,
      };
      changed = true;
    }

    if (!changed) return;
    try {
      localStorage.setItem(historyKey, JSON.stringify(store));
    } catch {}
  }, [filteredMatches, predictionByMatchId, apiSource]);

  const winnerPerformance = useMemo(() => {
    const finished = filteredMatches.filter(
      (m) =>
        m.status === 'finished' &&
        typeof m.result?.home === 'number' &&
        typeof m.result?.away === 'number' &&
        Boolean(predictionByMatchId[m.id]),
    );

    const total = finished.length;
    const hits = finished.filter((m) => {
      const pred = predictionByMatchId[m.id];
      if (!pred) return false;
      const home = m.result!.home!;
      const away = m.result!.away!;
      const actualWinner = home > away ? 'home' : home < away ? 'away' : 'draw';
      return pred.winner.prediction === actualWinner;
    }).length;

    const percent = total === 0 ? 0 : Math.round((hits / total) * 100);
    return { hits, total, percent };
  }, [filteredMatches, predictionByMatchId]);

  const selectedMatch = selectedMatchId ? filteredMatches.find((m) => m.id === selectedMatchId) ?? null : null;
  const selectedPrediction = selectedMatchId ? predictionByMatchId[selectedMatchId] ?? null : null;

  // Carregar análise dos agentes de IA
  const loadAgentAnalysis = async (matchId: string) => {
    setIsLoadingAgents(true);
    setShowAgentAnalysis(true);

    // Simular carregamento (em produção seria chamada real aos modelos)
    setTimeout(async () => {
      const realMatch = realMatches.find((m) => m.id.toString() === matchId);
      if (realMatch) {
        const dynamicAgents = getDynamicAgentProfiles();
        const ensemble = new AgentEnsemble(dynamicAgents);
        const predictions = await ensemble.predictWithAllAgents(realMatch);
        setAgentPredictions(predictions);
        setIsLoadingAgents(false);
        return;
      }

      const match = mockMatches.find((m) => m.id === matchId);
      if (!match) {
        setIsLoadingAgents(false);
        return;
      }

      const footballMatch: FootballMatch = {
        id: parseInt(matchId),
        utcDate: match.date.toISOString(),
        status: match.status,
        matchday: 1,
        homeTeam: {
          id: 1,
          name: match.homeTeam,
          shortName: match.homeTeam,
          tla: match.homeTeam.substring(0, 3).toUpperCase(),
          crest: '',
        },
        awayTeam: {
          id: 2,
          name: match.awayTeam,
          shortName: match.awayTeam,
          tla: match.awayTeam.substring(0, 3).toUpperCase(),
          crest: '',
        },
        score: {
          fullTime: { home: null, away: null },
        },
        competition: {
          id: 1,
          name: match.league,
          code: match.league.substring(0, 2).toUpperCase(),
          emblem: '',
          area: {
            name: match.country,
            code: match.country.substring(0, 2).toUpperCase(),
            flag: '',
          },
        },
      };

      const dynamicAgents = getDynamicAgentProfiles();
      const ensemble = new AgentEnsemble(dynamicAgents);
      const predictions = await ensemble.predictWithAllAgents(footballMatch);
      setAgentPredictions(predictions);
      setIsLoadingAgents(false);
    }, 1500);
  };

  const openMatchIdFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const v = params.get('open') ?? params.get('matchId');
    const id = String(v ?? '').trim();
    return id ? id : null;
  }, [location.search]);

  useEffect(() => {
    if (!favoritesOnly) return;
    if (!openMatchIdFromQuery) return;

    try {
      const current = new Set(favoriteMatchIds);
      if (!current.has(openMatchIdFromQuery)) {
        const next = Array.from(current);
        next.push(openMatchIdFromQuery);
        localStorage.setItem(favoritesKey, JSON.stringify(next));
        window.dispatchEvent(new Event('favoritesChanged'));
      }
    } catch {}

    if (selectedMatchId !== openMatchIdFromQuery) {
      setSelectedMatchId(openMatchIdFromQuery);
      loadAgentAnalysis(openMatchIdFromQuery);
    }
  }, [favoritesOnly, openMatchIdFromQuery, favoriteMatchIds, selectedMatchId]);

  const handleViewDetails = (matchId: string) => {
    setSelectedMatchId(matchId);
    loadAgentAnalysis(matchId);
  };

  const handleViewDetailsMobile = (matchId: string) => {
    navigate(`/analysis/${matchId}`);
  };

  const handleManualRefreshMatches = () => {
    const config = loadApiConfig();
    loadMatchesWithFallback(config);
  };

  const updateCacheMatch = (matchId: string, next: FootballMatch | null) => {
    try {
      const { dateFrom, dateTo } = getDateRange();
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        version: number;
        generatedAt: string;
        dateFrom: string;
        dateTo: string;
        apiSource: ApiSource;
        matches: FootballMatch[];
        predictions: Record<string, Prediction>;
        configHash?: string;
      };
      if (parsed.version !== 3) return;
      if (parsed.dateFrom !== dateFrom || parsed.dateTo !== dateTo) return;
      if (!Array.isArray(parsed.matches)) return;

      const idx = parsed.matches.findIndex((m) => m.id.toString() === matchId);
      let matches = parsed.matches;
      if (next === null) {
        if (idx === -1) return;
        matches = parsed.matches.filter((m) => m.id.toString() !== matchId);
      } else if (idx !== -1) {
        matches = [...parsed.matches];
        matches[idx] = next;
      } else {
        matches = [...parsed.matches, next];
      }

      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          ...parsed,
          generatedAt: new Date().toISOString(),
          matches,
        }),
      );
    } catch {}
  };

  const upsertBetfairIntoMatch = (matchId: string, betfair: FootballMatch['betfair']) => {
    setRealMatches((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.id.toString() !== matchId) return m;
        changed = true;
        const updated = { ...m, betfair };
        updateCacheMatch(matchId, updated);
        return updated;
      });
      return changed ? next : prev;
    });
  };

  const syncBetfairOddsForTopMatches = async (opts?: { maxMatches?: number }) => {
    if (isSyncingBetfairOddsRef.current) return;
    if (apiSource === 'mock' || apiSource === 'betfair') return;

    const preds = realPredictions;
    if (!preds || Object.keys(preds).length === 0) return;

    const snapshot = realMatchesRef.current;
    if (!Array.isArray(snapshot) || snapshot.length === 0) return;

    const maxMatches = Math.max(1, Math.min(20, Number(opts?.maxMatches ?? 12) || 12));

    const items = snapshot
      .map((m) => {
        const id = m.id.toString();
        const p = preds[id];
        if (!p) return null;
        if (toMatchStatus(m.status) === 'finished') return null;

        const isLive = toMatchStatus(m.status) === 'live';
        const maxAgeSec = isLive ? 120 : 15 * 60;
        const fetchedAt = String(m.betfair?.oddsFetchedAt ?? '').trim();
        const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : NaN;
        const ageSec = Number.isFinite(fetchedMs) ? (Date.now() - fetchedMs) / 1000 : Infinity;
        const stale = !Number.isFinite(ageSec) ? true : ageSec >= 0 && ageSec > maxAgeSec;

        const marketOdd = getBetfairBackOdd(m, p.winner.prediction);
        const needs = marketOdd == null || stale;

        const fairProb = fairProbFromConfidence(p.winner.confidence);
        const ev = marketOdd == null ? null : expectedValueFromProbAndOdd(fairProb, marketOdd);

        return {
          id,
          aiConfidence: p.aiConfidence,
          winnerConfidence: p.winner.confidence,
          ev,
          needs,
          force: Boolean(stale),
          minFreshSeconds: isLive ? 120 : 600,
          match: m,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .filter((x) => x.needs)
      .sort((a, b) => {
        const ae = typeof a.ev === 'number' ? a.ev : -999;
        const be = typeof b.ev === 'number' ? b.ev : -999;
        if (be !== ae) return be - ae;
        if (b.aiConfidence !== a.aiConfidence) return b.aiConfidence - a.aiConfidence;
        return (b.winnerConfidence ?? 0) - (a.winnerConfidence ?? 0);
      })
      .slice(0, maxMatches);

    if (items.length === 0) return;

    isSyncingBetfairOddsRef.current = true;
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const url = `https://${projectId}.supabase.co/functions/v1/betfair-server-1119702f/betfair/match/resolve`;
      const concurrency = 4;

      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        await Promise.all(
          chunk.map(async (it) => {
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: publicAnonKey,
                Authorization: `Bearer ${publicAnonKey}`,
              },
              body: JSON.stringify({
                homeTeam: it.match.homeTeam?.name ?? '',
                awayTeam: it.match.awayTeam?.name ?? '',
                utcDate: it.match.utcDate ?? null,
                minFreshSeconds: it.minFreshSeconds,
                includeCorrectScore: true,
                force: it.force,
              }),
            });

            const raw = await res.text().catch(() => '');
            let data: any = null;
            try {
              data = raw ? JSON.parse(raw) : null;
            } catch {
              data = null;
            }

            if (!res.ok || !data?.ok || !data?.betfair) return;
            upsertBetfairIntoMatch(it.id, data.betfair);
          }),
        );
      }
    } catch {
      return;
    } finally {
      isSyncingBetfairOddsRef.current = false;
    }
  };

  useEffect(() => {
    void syncBetfairOddsForTopMatches();
  }, [apiSource, realMatches, realPredictions]);

  const handleRefreshMatch = async (matchId: string) => {
    if (apiSource === 'mock') return;
    if (refreshingMatchIds.has(matchId)) return;
    const config = loadApiConfig();

    setRefreshingMatchIds((prev) => {
      const next = new Set(prev);
      next.add(matchId);
      return next;
    });

    try {
      if (apiSource === 'api-football') {
        const apiFootballKey = config?.apiFootballKey?.trim();
        if (!apiFootballKey) throw new Error('API-Football não configurada');
        const service = new ApiFootballService(apiFootballKey);
        const fixtures = await service.getFixtures({ fixtureId: Number(matchId), timezone: TIME_ZONE });
        const fixture = fixtures[0];
        if (!fixture) throw new Error('Partida não encontrada na API-Football');

        const updated = processCrests([convertApiFootballMatchToFootballMatch(fixture)])[0];
        const disabledSet = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
        const leagueId = Number(updated.competition.id);
        const isDisabledLeague = Number.isFinite(leagueId) && disabledSet.has(leagueId);

        setRealMatches((prev) => prev.map((m) => (m.id.toString() === matchId ? updated : m)));
        updateCacheMatch(matchId, updated);
        setLastUpdatedAt(new Date());
        try {
          const preds = await generatePredictionsForMatches('api-football', [updated], { force: true });
          setRealPredictions((prev) => ({ ...prev, ...preds }));
        } catch {}
        if (isDisabledLeague) {
          toast.warning('Partida atualizada, mas o campeonato está desativado em Configurações → Campeonatos.');
        } else {
          toast.success('Partida e previsão atualizadas');
        }
        return;
      }

      toast.error('Atualização por jogo não disponível para esta fonte');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar partida');
    } finally {
      setRefreshingMatchIds((prev) => {
        const next = new Set(prev);
        next.delete(matchId);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="hidden md:block">
        <FilterBar
          selectedDate={selectedDate}
          selectedCountry={selectedCountry}
          selectedLeague={selectedLeague}
          onDateChange={setSelectedDate}
          onCountryChange={setSelectedCountry}
          onLeagueChange={setSelectedLeague}
          countries={countries}
          leagues={leagues}
          selectedStatus={selectedStatus}
          onStatusChange={setSelectedStatus}
          groupMode={groupMode}
          onGroupModeChange={setGroupMode}
          onRefresh={handleManualRefreshMatches}
          isRefreshing={isLoadingMatches}
          onAddMatch={() => setAddMatchOpen(true)}
          quickSearch={quickSearch}
          onQuickSearchChange={setQuickSearch}
        />
      </div>

      <div className="p-4 md:p-6">
        {/* Estatísticas */}
        <div className="md:hidden mb-5">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <BarChart3 className="w-4 h-4 text-blue-700" />
                <div className="text-xs text-gray-600">Partidas</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{filteredMatches.length}</div>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <ShieldCheck className="w-4 h-4 text-green-700" />
                <div className="text-xs text-gray-600">Alta</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">
                  {Object.values(predictionByMatchId).filter(
                    (p) => p.aiConfidence >= 50 && filteredMatches.some((m) => m.id === p.matchId),
                  ).length}
                </div>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Target className="w-4 h-4 text-gray-800" />
                <div className="text-xs text-gray-600">Acertos</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">
                  {winnerPerformance.total === 0 ? '-' : `${winnerPerformance.hits}/${winnerPerformance.total}`}
                </div>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Globe className="w-4 h-4 text-purple-700" />
                <div className="text-xs text-gray-600">Países</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{new Set(filteredMatches.map((m) => m.country)).size}</div>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <Brain className="w-4 h-4 text-orange-700" />
                <div className="text-xs text-gray-600">Agentes</div>
                <div className="text-sm font-bold text-gray-900 tabular-nums">{getDynamicAgentProfiles().length}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1 h-9" onClick={() => setAddMatchOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Adicionar
              </Button>
              <Button className="flex-1 h-9" onClick={handleManualRefreshMatches} disabled={isLoadingMatches}>
                {isLoadingMatches ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                Atualizar
              </Button>
            </div>
          </div>
        </div>

        <div className="hidden md:grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Total de Partidas</div>
            <div className="text-2xl font-bold text-blue-600">{filteredMatches.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Alta Confiança</div>
            <div className="text-2xl font-bold text-green-600">
              {Object.values(predictionByMatchId).filter(
                (p) => p.aiConfidence >= 50 && filteredMatches.some((m) => m.id === p.matchId),
              ).length}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Acertos (Vencedor)</div>
            <div className="text-2xl font-bold text-gray-900">
              {winnerPerformance.total === 0 ? '-' : `${winnerPerformance.hits}/${winnerPerformance.total}`}
            </div>
            <div className="text-sm text-gray-500">
              {winnerPerformance.total === 0 ? 'Sem jogos finalizados' : `${winnerPerformance.percent}%`}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Países</div>
            <div className="text-2xl font-bold text-purple-600">
              {new Set(filteredMatches.map(m => m.country)).size}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Agentes IA Ativos</div>
            <div className="text-2xl font-bold text-orange-600">{getDynamicAgentProfiles().length}</div>
          </div>
        </div>

        {/* Lista de partidas agrupadas */}
        {groupedMatches.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Nenhuma partida encontrada
            </h3>
            <p className="text-gray-600">
              Tente ajustar os filtros para ver mais resultados
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-4">
              {groupedMatches.flatMap(([, matches]) => matches).map((match) => {
                const prediction = predictionByMatchId[match.id] ?? null;
                return (
                  <MobileMatchCard
                    key={match.id}
                    match={match}
                    prediction={prediction}
                    apiSource={apiSource}
                    onViewDetails={handleViewDetailsMobile}
                    onRemoveMatch={dismissMatch}
                    homeCrest={match.homeCrest}
                    awayCrest={match.awayCrest}
                    footballMatch={apiSource !== 'mock' ? realMatchById[match.id] : undefined}
                  />
                );
              })}
            </div>

            <div className="hidden md:block space-y-8">
              {groupedMatches.map(([leagueKey, matches]) => (
                <div key={leagueKey}>
                  <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    {leagueKey}
                    <span className="text-sm font-normal text-gray-500">
                      ({matches.length} {matches.length === 1 ? 'partida' : 'partidas'})
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {matches.map((match) => {
                      const prediction = predictionByMatchId[match.id] ?? null;
                      return (
                        <MatchCard
                          key={match.id}
                          match={match}
                          prediction={prediction}
                          apiSource={apiSource}
                          onViewDetails={handleViewDetails}
                          onRemoveMatch={dismissMatch}
                          homeCrest={match.homeCrest}
                          awayCrest={match.awayCrest}
                          footballMatch={apiSource !== 'mock' ? realMatchById[match.id] : undefined}
                          onRefreshMatch={handleRefreshMatch}
                          isRefreshing={refreshingMatchIds.has(match.id)}
                          lastUpdatedAt={lastUpdatedAt}
                          isFavorite={favoriteMatchIds.includes(match.id)}
                          onToggleFavorite={toggleFavoriteMatch}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={addMatchOpen} onOpenChange={setAddMatchOpen}>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Adicionar jogo do dia</DialogTitle>
            <DialogDescription>
              Digite o nome de um time para localizar jogos do dia (API-Football ou Betfair quando necessário) e adicionar à lista do Início.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                value={addMatchQuery}
                onChange={(e) => setAddMatchQuery(e.target.value)}
                placeholder="Ex.: Juventus, Feyenoord, Milan..."
              />
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {getDayKey(new Date())}
            </Badge>
          </div>

          {addMatchError ? (
            <div
              className={
                addMatchError.toLowerCase().includes('betfair')
                  ? 'p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm'
                  : 'p-3 rounded-xl border border-red-200 bg-red-50 text-red-900 text-sm'
              }
            >
              {addMatchError}
            </div>
          ) : null}

          <div className="border rounded-xl overflow-hidden">
            <div className="max-h-[56vh] overflow-auto">
              {addMatchLoading ? (
                <div className="p-6 flex items-center justify-center gap-3 text-gray-600">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Buscando jogos do dia...
                </div>
              ) : addMatchResults.length === 0 ? (
                <div className="p-6 text-sm text-gray-600">Nenhum jogo encontrado para esse texto.</div>
              ) : (
                <div className="divide-y bg-white">
                  {addMatchResults.map((row) => {
                    const isApi = row.source === 'api-football';
                    const f = isApi ? row.fixture : null;
                    const bm = !isApi ? row.match : null;

                    const id = isApi ? String(f!.fixture.id) : String(bm!.id);
                    const kickoff = isApi
                      ? Number.isFinite(Number(f!.fixture.timestamp))
                        ? new Date(f!.fixture.timestamp * 1000)
                        : new Date(f!.fixture.date)
                      : new Date(bm!.utcDate);
                    const time = Number.isFinite(kickoff.getTime())
                      ? kickoff.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                      : '--:--';
                    const dateShort = Number.isFinite(kickoff.getTime())
                      ? kickoff.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                      : '--/--';
                    const todayKey = getDayKey(new Date());
                    const kickoffKey = Number.isFinite(kickoff.getTime()) ? getDayKey(kickoff) : '';
                    const yesterdayKey = getDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
                    const dayWord = kickoffKey === todayKey ? 'Hoje' : kickoffKey === yesterdayKey ? 'Ontem' : '';
                    const statusShort = isApi ? String(f!.fixture.status.short ?? 'NS') : String(bm!.status ?? 'SCHEDULED');
                    const status = toMatchStatus(statusShort);
                    const statusLabel = status === 'live' ? 'AO VIVO' : status === 'finished' ? 'FINALIZADO' : 'EM BREVE';
                    const statusVariant = status === 'live' ? 'default' : status === 'finished' ? 'secondary' : 'outline';
                    const venue = isApi ? String(f!.fixture?.venue?.name ?? '').trim() : '';
                    const scoreText =
                      isApi
                        ? typeof f!.goals?.home === 'number' && typeof f!.goals?.away === 'number'
                          ? `${f!.goals.home} × ${f!.goals.away}`
                          : '×'
                        : typeof bm?.score?.fullTime?.home === 'number' && typeof bm?.score?.fullTime?.away === 'number'
                          ? `${bm.score.fullTime.home} × ${bm.score.fullTime.away}`
                          : '×';
                    return (
                      <div key={id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-gray-500 truncate">
                            {venue || (isApi ? String(f?.league?.name ?? '—') : String(bm?.competition?.name ?? '—'))}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={statusVariant as any}>{statusLabel}</Badge>
                            <div className="text-[11px] text-gray-500 tabular-nums">
                              {dateShort}
                              {dayWord ? ` • ${dayWord}` : ''}
                              {' • '}
                              {time}
                            </div>
                          </div>
                        </div>

                        <button
                          className="w-full text-left"
                          onClick={() =>
                            isApi ? addRequestedFixture(f!.fixture.id, { open: true }) : addRequestedBetfairMatch(bm!, { open: true })
                          }
                        >
                          <div className="mt-3 mx-auto w-full max-w-[980px]">
                            <div className="grid grid-cols-[1fr_120px_1fr] items-center gap-3">
                              <div className="flex items-center justify-end gap-2 min-w-0">
                                <div className="text-sm font-medium text-gray-900 leading-tight text-right">
                                  {isApi ? f!.teams.home.name : bm!.homeTeam.name}
                                </div>
                                {(isApi ? f!.teams.home.logo : '') ? (
                                  <img src={f!.teams.home.logo} alt="" className="w-9 h-9 shrink-0" />
                                ) : !isApi && bm!.homeTeam.crest ? (
                                  <img src={bm!.homeTeam.crest} alt="" className="w-9 h-9 shrink-0" />
                                ) : null}
                              </div>

                              <div className="flex items-center justify-center">
                                <div className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
                                  {scoreText}
                                </div>
                              </div>

                              <div className="flex items-center justify-start gap-2 min-w-0">
                                {(isApi ? f!.teams.away.logo : '') ? (
                                  <img src={f!.teams.away.logo} alt="" className="w-9 h-9 shrink-0" />
                                ) : !isApi && bm!.awayTeam.crest ? (
                                  <img src={bm!.awayTeam.crest} alt="" className="w-9 h-9 shrink-0" />
                                ) : null}
                                <div className="text-sm font-medium text-gray-900 leading-tight">
                                  {isApi ? f!.teams.away.name : bm!.awayTeam.name}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-center">
                            <div className="text-xs font-semibold text-green-700">
                              ADICIONAR PARA ANÁLISE
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {selectedMatch && selectedPrediction && (
        <div className="fixed inset-0 z-50 pointer-events-none hidden md:block">
          <DraggableWindow
            title="Análise Completa (Previsão)"
            onClose={() => {
              setSelectedMatchId(null);
              setShowAgentAnalysis(false);
              setAgentPredictions([]);
            }}
            initialPosition={{ x: 80, y: 80 }}
            initialSize={{ width: 980, height: 760 }}
            zIndex={detailsZIndex}
            onFocus={() => {
              zCounterRef.current += 1;
              setDetailsZIndex(zCounterRef.current);
            }}
          >
            <PredictionDetails match={selectedMatch} prediction={selectedPrediction} apiSource={apiSource} lastUpdatedAt={lastUpdatedAt} />
          </DraggableWindow>

          {showAgentAnalysis && (
            <DraggableWindow
              title="Análise dos Agentes"
              onClose={() => {
                setShowAgentAnalysis(false);
                setAgentPredictions([]);
              }}
              initialPosition={{ x: 1120, y: 120 }}
              initialSize={{ width: 720, height: 760 }}
              zIndex={agentsZIndex}
              onFocus={() => {
                zCounterRef.current += 1;
                setAgentsZIndex(zCounterRef.current);
              }}
            >
              <div className="p-6">
                {isLoadingAgents ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <span className="ml-3 text-gray-600">Consultando agentes de IA...</span>
                  </div>
                ) : agentPredictions.length > 0 ? (
                  <AgentAnalysis predictions={agentPredictions} profiles={getDynamicAgentProfiles()} />
                ) : null}
              </div>
            </DraggableWindow>
          )}
        </div>
      )}
    </div>
  );
}
