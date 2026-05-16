import { useState, useMemo, useEffect, useRef } from 'react';
import { mockMatches, mockPredictions, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { PremiumCarousel } from '../components/PremiumCarousel';
import { AgentAnalysis } from '../components/AgentAnalysis';
import { DraggableWindow } from '../components/DraggableWindow';
import { BarChart3, Brain, Globe, Loader2, Plus, Search, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import { MobileMatchCard } from '../components/MobileMatchCard';
import { getDynamicAgentProfiles, AgentEnsemble, AgentPrediction, learnFromMatchResult, recordTrainingSample } from '../services/aiAgents';
import { loadApiConfig } from '../services/apiConfig';
import { FootballDataService, FootballMatch } from '../services/footballDataService';
import { ApiFootballService, ApiFootballMatch } from '../services/apiFootballService';
import { OpenLigaDbService, OpenLigaMatch } from '../services/openLigaDbService';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

type MatchStatus = 'scheduled' | 'live' | 'finished';
type StatusFilter = 'all' | 'live' | 'upcoming' | 'finished';
type GroupMode = 'leagues' | 'championships';
type ApiSource = 'api-football' | 'football-data' | 'openligadb' | 'betfair' | 'mock';

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

export default function Home({ initialSelectedDate = 'today', favoritesOnly = false }: HomeEnhancedProps) {
  const location = useLocation();
  const navigate = useNavigate();
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
  const requestedFixturesKey = 'requested_fixtures_v1';
  const isSyncingRequestedRef = useRef(false);
  const [addMatchOpen, setAddMatchOpen] = useState(false);
  const [addMatchQuery, setAddMatchQuery] = useState('');
  const [addMatchLoading, setAddMatchLoading] = useState(false);
  const [addMatchError, setAddMatchError] = useState('');
  const [addMatchFixtures, setAddMatchFixtures] = useState<ApiFootballMatch[]>([]);
  const [addMatchResults, setAddMatchResults] = useState<ApiFootballMatch[]>([]);

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
    if (['FINISHED', 'FT', 'AET', 'PEN'].includes(normalized)) return 'finished';
    if (['IN_PLAY', 'PAUSED', 'BREAK', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'SUSPENDED', 'INTERRUPTED'].includes(normalized)) return 'live';
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
      const apiFootballKey = config?.apiFootballKey?.trim();
      if (!apiFootballKey) return;

      const disabled = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));

      const fixtureIds = (() => {
        try {
          const raw = localStorage.getItem(requestedFixturesKey);
          if (!raw) return [] as number[];
          const parsed = JSON.parse(raw) as { version: number; items: Record<string, { fixtureId: number }> };
          if (!parsed || parsed.version !== 1 || !parsed.items) return [] as number[];
          return Object.keys(parsed.items)
            .map((k) => Number(parsed.items[k]?.fixtureId ?? k))
            .filter(Number.isFinite);
        } catch {
          return [] as number[];
        }
      })();

      if (fixtureIds.length === 0) return;

      const existing = new Set(realMatchesRef.current.map((m) => String(m.id)));
      const needed = fixtureIds.filter((id) => !existing.has(String(id))).slice(0, 30);
      if (needed.length === 0) return;

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
    window.addEventListener('focus', onRequested);
    return () => {
      window.removeEventListener('requestedFixturesChanged' as any, onRequested as any);
      window.removeEventListener('focus', onRequested);
    };
  }, [apiSource]);

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

  const addRequestedFixture = async (fixtureId: number, opts?: { open?: boolean }) => {
    try {
      const raw = localStorage.getItem(requestedFixturesKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      const next =
        parsed && typeof parsed === 'object' && (parsed as any).version === 1 && (parsed as any).items
          ? { version: 1 as const, items: { ...(parsed as any).items } as Record<string, { fixtureId: number }> }
          : { version: 1 as const, items: {} as Record<string, { fixtureId: number }> };

      next.items[String(fixtureId)] = { fixtureId };
      localStorage.setItem(requestedFixturesKey, JSON.stringify(next));
      window.dispatchEvent(new Event('requestedFixturesChanged'));
      await syncRequestedFixtures();
      if (opts?.open) setSelectedMatchId(String(fixtureId));
      toast.success('Jogo adicionado');
      setAddMatchOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao adicionar jogo');
    }
  };

  useEffect(() => {
    if (!addMatchOpen) return;
    setAddMatchError('');
    setAddMatchQuery('');
    setAddMatchResults([]);
    const cfg = loadApiConfig();
    const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
    if (!apiFootballKey) {
      setAddMatchFixtures([]);
      setAddMatchError('Configure a API-Football em Configurações para buscar jogos do dia.');
      return;
    }

    const disabled = new Set((cfg?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
    const ymd = getDayKey(new Date());

    const run = async () => {
      setAddMatchLoading(true);
      try {
        const service = new ApiFootballService(apiFootballKey);
        const [dayFixtures, liveFixtures] = await Promise.all([
          service.getFixtures({ date: ymd, timezone: TIME_ZONE, maxPages: 6 }),
          service.getFixtures({ live: 'all', timezone: TIME_ZONE, maxPages: 4 }),
        ]);
        const byId = new Map<number, ApiFootballMatch>();
        for (const f of [...(dayFixtures ?? []), ...(liveFixtures ?? [])]) {
          const id = Number(f?.fixture?.id);
          const leagueId = Number(f?.league?.id);
          if (!Number.isFinite(id)) continue;
          if (disabled.size > 0 && Number.isFinite(leagueId) && disabled.has(leagueId)) continue;
          byId.set(id, f);
        }
        const items = Array.from(byId.values());
        items.sort((a, b) => Number(a?.fixture?.timestamp ?? 0) - Number(b?.fixture?.timestamp ?? 0));
        setAddMatchFixtures(items);
        setAddMatchResults(items.slice(0, 30));
      } catch (e) {
        setAddMatchFixtures([]);
        setAddMatchError(e instanceof Error ? e.message : 'Erro ao buscar jogos do dia');
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
          const as = toMatchStatus(a?.fixture?.status?.short ?? 'NS');
          const bs = toMatchStatus(b?.fixture?.status?.short ?? 'NS');
          const rank = (s: MatchStatus) => (s === 'live' ? 0 : s === 'scheduled' ? 1 : 2);
          const r = rank(as) - rank(bs);
          if (r !== 0) return r;
          return Number(a?.fixture?.timestamp ?? 0) - Number(b?.fixture?.timestamp ?? 0);
        });
        setAddMatchResults(sorted.slice(0, 30));
        return;
      }

      const scored = fixtures
        .map((f) => ({ f, score: scoreFixture(f, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map((x) => x.f);
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

  const convertOpenLigaMatchToFootballMatch = (m: OpenLigaMatch): FootballMatch => {
    const endResult =
      m.matchResults?.find((r) => r.resultTypeID === 2) ?? m.matchResults?.[m.matchResults.length - 1];

    const homeGoals = endResult ? endResult.pointsTeam1 : null;
    const awayGoals = endResult ? endResult.pointsTeam2 : null;

    const leagueName = m.leagueName || 'Bundesliga';
    const leagueShortcut = m.leagueShortcut || 'bl1';

    return {
      id: m.matchID,
      utcDate: m.matchDateTimeUTC,
      status: m.matchIsFinished ? 'FINISHED' : 'SCHEDULED',
      matchday: m.group?.groupOrderID || 0,
      homeTeam: {
        id: m.team1.teamId,
        name: m.team1.teamName,
        shortName: m.team1.shortName || m.team1.teamName,
        tla: (m.team1.shortName || m.team1.teamName).substring(0, 3).toUpperCase(),
        crest: m.team1.teamIconUrl || '',
      },
      awayTeam: {
        id: m.team2.teamId,
        name: m.team2.teamName,
        shortName: m.team2.shortName || m.team2.teamName,
        tla: (m.team2.shortName || m.team2.teamName).substring(0, 3).toUpperCase(),
        crest: m.team2.teamIconUrl || '',
      },
      score: {
        fullTime: {
          home: homeGoals,
          away: awayGoals,
        },
      },
      competition: {
        id: 0,
        name: leagueName,
        code: leagueShortcut.toUpperCase(),
        emblem: '',
        area: {
          name: 'Alemanha',
          code: 'DE',
          flag: '',
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

  const consensusToPrediction = (matchId: string, consensus: AgentPrediction): Prediction => {
    const winnerConfidence = Math.round(consensus.winnerConfidence);
    return {
      matchId,
      aiConfidence: Math.round(consensus.confidence),
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

    for (const m of matches) {
      const id = m.id.toString();
      const key = `${source}:${id}`;
      if (opts?.force) {
        delete store.items[key];
      } else if (store.items[key]?.prediction) {
        continue;
      }
      const consensus = await ensemble.getConsensusPrediction(m);
      store.items[key] = {
        createdAt: new Date().toISOString(),
        prediction: consensusToPrediction(id, consensus),
      };
    }

    try {
      localStorage.setItem(storeKey, JSON.stringify(store));
    } catch {}

    return Object.fromEntries(
      matches.map((m) => {
        const id = m.id.toString();
        const key = `${source}:${id}`;
        return [id, store.items[key]!.prediction] as const;
      }),
    );
  };

  const processCrests = (matches: FootballMatch[]) => {
    return matches.map((match) => {
      const homeCrest =
        match.homeTeam.crest ||
        `https://crests.football-data.org/${match.homeTeam.id}.png` ||
        `https://via.placeholder.com/40/cccccc/000000?text=${match.homeTeam.shortName}`;

      const awayCrest =
        match.awayTeam.crest ||
        `https://crests.football-data.org/${match.awayTeam.id}.png` ||
        `https://via.placeholder.com/40/cccccc/000000?text=${match.awayTeam.shortName}`;

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
      const footballDataApiKey = config?.footballDataApiKey?.trim();
      const openLigaDbEnabled = config?.openLigaDbEnabled ?? true;

      if (apiFootballKey) {
        try {
          const service = new ApiFootballService(apiFootballKey);
          const maxPages = selectedDate === 'today' ? 3 : selectedDate === 'week' ? 5 : 10;
          const fixtures = await service.getFixtures({ from: dateFrom, to: dateTo, timezone: TIME_ZONE, maxPages });
          const matches = fixtures.map(convertApiFootballMatchToFootballMatch);
          successfulSource = successfulSource ?? 'api-football';
          if (matches.length > 0) {
            const processedMatches = processCrests(matches);
            const disabled = config?.apiFootballDisabledLeagueIds ?? [];
            const visibleMatches =
              disabled.length > 0 ? processedMatches.filter((m) => !disabled.includes(m.competition.id)) : processedMatches;
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
          console.warn('⚠️ API-Football falhou, tentando próxima opção...', error);
        }
      }

      if (footballDataApiKey) {
        try {
          const service = new FootballDataService(footballDataApiKey);
          const matches = await service.getMatches(undefined, dateFrom, dateTo);
          successfulSource = successfulSource ?? 'football-data';
          if (matches.length > 0) {
            const processedMatches = processCrests(matches);
            setApiSource('football-data');
            setRealMatches(processedMatches);
            const predictionsById = await generatePredictionsForMatches('football-data', processedMatches);
            setRealPredictions(predictionsById);
            setLastUpdatedAt(new Date());
            writeCache({
              dateFrom,
              dateTo,
              apiSource: 'football-data',
              matches: processedMatches,
              predictions: predictionsById,
              configHash: '',
            });
            toast.success(`${matches.length} partidas carregadas (Football-Data)`);
            return;
          }
        } catch (error) {
          console.warn('⚠️ Football-Data falhou, tentando próxima opção...', error);
        }
      }

      if (openLigaDbEnabled) {
        try {
          const service = new OpenLigaDbService();
          const openLigaMatches = await service.getMatchesByDateRange({ dateFrom, dateTo });
          const matches = openLigaMatches.map(convertOpenLigaMatchToFootballMatch);
          successfulSource = successfulSource ?? 'openligadb';
          if (matches.length > 0) {
            const processedMatches = processCrests(matches);
            setApiSource('openligadb');
            setRealMatches(processedMatches);
            const predictionsById = await generatePredictionsForMatches('openligadb', processedMatches);
            setRealPredictions(predictionsById);
            setLastUpdatedAt(new Date());
            writeCache({
              dateFrom,
              dateTo,
              apiSource: 'openligadb',
              matches: processedMatches,
              predictions: predictionsById,
              configHash: '',
            });
            toast.success(`${matches.length} partidas carregadas (OpenLigaDB)`);
            return;
          }
        } catch (error) {
          console.warn('⚠️ OpenLigaDB falhou, usando fallback...', error);
        }
      }

      if (!successfulSource) {
        try {
          const { projectId, publicAnonKey } = await import('/utils/supabase/info');
          const res = await fetch(
            `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/betfair/matches/list`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${publicAnonKey}`,
                apikey: publicAnonKey,
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
      { id: 1765, name: 'Flamengo', crest: 'https://crests.football-data.org/1765.png', shortName: 'FLA' },
      { id: 1770, name: 'Palmeiras', crest: 'https://crests.football-data.org/1770.png', shortName: 'PAL' },
      { id: 1766, name: 'São Paulo', crest: 'https://crests.football-data.org/1766.png', shortName: 'SAO' },
      { id: 1769, name: 'Grêmio', crest: 'https://crests.football-data.org/1769.png', shortName: 'GRE' },
      { id: 66, name: 'Manchester United', crest: 'https://crests.football-data.org/66.png', shortName: 'MUN' },
      { id: 57, name: 'Arsenal', crest: 'https://crests.football-data.org/57.png', shortName: 'ARS' },
    ];

    const competitions = [
      { id: 2013, name: 'Campeonato Brasileiro Série A', emblem: 'https://crests.football-data.org/764.svg' },
      { id: 2021, name: 'Premier League', emblem: 'https://crests.football-data.org/PL.png' },
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
        const status = toMatchStatus(footballMatch.status);
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
          home: typeof fullTime?.home === 'number' ? fullTime.home : null,
          away: typeof fullTime?.away === 'number' ? fullTime.away : null,
        },
        liveElapsed: footballMatch.live?.elapsed ?? null,
        liveStatusShort: footballMatch.live?.statusShort ?? undefined,
        liveExtra: footballMatch.live?.extra ?? null,
      };
    }) as DisplayMatch[];
  }, [TIME_ZONE, apiSource, parseApiDate, realMatches]);

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

      return true;
    });
  }, [favoritesOnly, favoriteMatchIds, getDayKey, matchesToUse, selectedDate, selectedStatus]);

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

      return true;
    });
  }, [baseFilteredMatches, selectedCountry, selectedLeague]);

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

  // Jogos premium (alta confiança + melhor retorno)
  const premiumMatches = useMemo(() => {
    const pickPrediction = (matchId: string) => {
      return apiSource !== 'mock' ? realPredictions[matchId] : mockPredictions.find((p) => p.matchId === matchId);
    };

    const sourceMatches = filteredMatches;

    return sourceMatches
      .map((match) => {
        const prediction = pickPrediction(match.id);
        if (!prediction) return null;
        return {
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeCrest: match.homeCrest || '',
          awayCrest: match.awayCrest || '',
          league: match.league,
          time: `${new Date(match.date).toLocaleDateString('pt-BR')} - ${match.time}`,
          aiConfidence: prediction.aiConfidence,
          prediction:
            prediction.winner.prediction === 'home'
              ? `Vitória ${match.homeTeam}`
              : prediction.winner.prediction === 'away'
              ? `Vitória ${match.awayTeam}`
              : 'Empate',
          odds: prediction.winner.odds,
          potentialReturn: Math.round((prediction.winner.odds - 1) * 100),
          isPremium: true,
          tags: [
            'Alta Confiança',
            `${prediction.aiConfidence}% IA`,
            'Recomendado',
          ],
        };
      })
      .filter((m): m is NonNullable<typeof m> => !!m)
      .filter((m) => m.aiConfidence >= 80)
      .slice(0, 5);
  }, [apiSource, filteredMatches, realPredictions]);

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

  const refreshLiveMatches = async () => {
    if (apiSource !== 'api-football') return;
    const snapshot = realMatchesRef.current;
    if (snapshot.length === 0) return;
    const candidates = snapshot.filter((m) => {
      const status = toMatchStatus(m.status);
      if (status === 'live') return true;
      if (status !== 'scheduled') return false;
      const kickoff = new Date(m.utcDate).getTime();
      if (!Number.isFinite(kickoff)) return false;
      const now = Date.now();
      return now >= kickoff + 60_000 && now <= kickoff + 3 * 60 * 60_000;
    });
    if (candidates.length === 0) return;

    const config = loadApiConfig();
    const apiFootballKey = config?.apiFootballKey?.trim();
    if (!apiFootballKey) return;

    try {
      const service = new ApiFootballService(apiFootballKey);
      const disabled = new Set((config?.apiFootballDisabledLeagueIds ?? []).map(Number).filter(Number.isFinite));
      const updates: FootballMatch[] = [];
      const ids = candidates.slice(0, 20).map((m) => m.id);
      const concurrency = 5;

      for (let i = 0; i < ids.length; i += concurrency) {
        const chunk = ids.slice(i, i + concurrency);
        const fixturesChunks = await Promise.all(
          chunk.map(async (id) => {
            const res = await service.getFixtures({ fixtureId: id, timezone: TIME_ZONE });
            return res[0] ?? null;
          }),
        );

        for (const fixture of fixturesChunks) {
          if (!fixture) continue;
          const updated = processCrests([convertApiFootballMatchToFootballMatch(fixture)])[0];
          if (disabled.has(updated.competition.id)) continue;
          updates.push(updated);
        }
      }
      if (updates.length === 0) return;

      setRealMatches((prev) => {
        const byId = new Map<number, FootballMatch>();
        for (const u of updates) byId.set(u.id, u);
        return prev.map((m) => byId.get(m.id) ?? m);
      });

      for (const u of updates) updateCacheMatch(u.id.toString(), u);
      setLastUpdatedAt(new Date());
    } catch {
      return;
    }
  };

  useEffect(() => {
    if (apiSource !== 'api-football') return;
    void refreshLiveMatches();
    const id = window.setInterval(() => {
      void refreshLiveMatches();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [apiSource]);

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
        const disabled = config?.apiFootballDisabledLeagueIds ?? [];

        if (disabled.includes(updated.competition.id)) {
          setRealMatches((prev) => prev.filter((m) => m.id.toString() !== matchId));
          updateCacheMatch(matchId, null);
          toast.success('Partida removida (campeonato desativado)');
          return;
        }

        setRealMatches((prev) => prev.map((m) => (m.id.toString() === matchId ? updated : m)));
        updateCacheMatch(matchId, updated);
        setLastUpdatedAt(new Date());
        try {
          const preds = await generatePredictionsForMatches('api-football', [updated], { force: true });
          setRealPredictions((prev) => ({ ...prev, ...preds }));
        } catch {}
        toast.success('Partida e previsão atualizadas');
        return;
      }

      if (apiSource === 'football-data') {
        const apiKey = config?.footballDataApiKey?.trim();
        if (!apiKey) throw new Error('Football-data.org não configurada');
        const service = new FootballDataService(apiKey);
        const updated = processCrests([await service.getMatchById(Number(matchId))])[0];

        setRealMatches((prev) => prev.map((m) => (m.id.toString() === matchId ? updated : m)));
        updateCacheMatch(matchId, updated);
        setLastUpdatedAt(new Date());
        toast.success('Partida atualizada');
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
        />
      </div>

      <div className="p-4 md:p-6">
        {/* Carrossel Premium */}
        <div className="hidden md:block">
          {premiumMatches.length > 0 && (
            <PremiumCarousel
              matches={premiumMatches}
              onMatchClick={handleViewDetails}
            />
          )}
        </div>

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
                    (p) => p.aiConfidence >= 80 && filteredMatches.some((m) => m.id === p.matchId),
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
                (p) => p.aiConfidence >= 80 && filteredMatches.some((m) => m.id === p.matchId),
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
              Digite o nome de um time para localizar fixtures do dia na API-Football e adicionar à lista do Início.
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
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-900 text-sm">{addMatchError}</div>
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
                  {addMatchResults.map((f) => {
                    const id = String(f.fixture.id);
                    const kickoff = Number.isFinite(Number(f.fixture.timestamp))
                      ? new Date(f.fixture.timestamp * 1000)
                      : new Date(f.fixture.date);
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
                    const statusShort = String(f.fixture.status.short ?? 'NS');
                    const status = toMatchStatus(statusShort);
                    const statusLabel = status === 'live' ? 'AO VIVO' : status === 'finished' ? 'FINALIZADO' : 'EM BREVE';
                    const statusVariant = status === 'live' ? 'default' : status === 'finished' ? 'secondary' : 'outline';
                    const venue = String(f.fixture?.venue?.name ?? '').trim();
                    const scoreText =
                      typeof f.goals?.home === 'number' && typeof f.goals?.away === 'number'
                        ? `${f.goals.home} × ${f.goals.away}`
                        : '×';
                    return (
                      <div key={id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-gray-500 truncate">{venue || '—'}</div>
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
                          onClick={() => addRequestedFixture(f.fixture.id, { open: true })}
                        >
                          <div className="mt-3 mx-auto w-full max-w-[980px]">
                            <div className="grid grid-cols-[1fr_120px_1fr] items-center gap-3">
                              <div className="flex items-center justify-end gap-2 min-w-0">
                                <div className="text-sm font-medium text-gray-900 leading-tight text-right">
                                  {f.teams.home.name}
                                </div>
                                {f.teams.home.logo ? (
                                  <img src={f.teams.home.logo} alt="" className="w-9 h-9 shrink-0" />
                                ) : null}
                              </div>

                              <div className="flex items-center justify-center">
                                <div className="text-2xl font-bold text-gray-900 tabular-nums tracking-tight">
                                  {scoreText}
                                </div>
                              </div>

                              <div className="flex items-center justify-start gap-2 min-w-0">
                                {f.teams.away.logo ? (
                                  <img src={f.teams.away.logo} alt="" className="w-9 h-9 shrink-0" />
                                ) : null}
                                <div className="text-sm font-medium text-gray-900 leading-tight">
                                  {f.teams.away.name}
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
