import { useState, useMemo, useEffect, useRef } from 'react';
import { mockMatches, mockPredictions, countries, leagues, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { PremiumCarousel } from '../components/PremiumCarousel';
import { AgentAnalysis } from '../components/AgentAnalysis';
import { ApiStatus } from '../components/ApiStatus';
import { DraggableWindow } from '../components/DraggableWindow';
import { TrendingUp, Brain, Loader2, RefreshCw } from 'lucide-react';
import { getDynamicAgentProfiles, AgentEnsemble, AgentPrediction, learnFromMatchResult, recordTrainingSample } from '../services/aiAgents';
import { loadApiConfig } from '../services/apiConfig';
import { FootballDataService, FootballMatch } from '../services/footballDataService';
import { ApiFootballService, ApiFootballMatch } from '../services/apiFootballService';
import { OpenLigaDbService, OpenLigaMatch } from '../services/openLigaDbService';
import { Button } from '../components/ui/button';
import { toast } from 'sonner';
import { useLocation } from 'react-router';

type MatchStatus = 'scheduled' | 'live' | 'finished';
type StatusFilter = 'all' | 'live' | 'upcoming' | 'finished';
type GroupMode = 'leagues' | 'championships';
type ApiSource = 'api-football' | 'football-data' | 'openligadb' | 'mock';

type DisplayMatch = Match & {
  homeCrest?: string;
  awayCrest?: string;
  result?: {
    home: number | null;
    away: number | null;
  };
  liveElapsed?: number | null;
};

type HomeEnhancedProps = {
  initialSelectedDate?: string;
  favoritesOnly?: boolean;
};

export default function Home({ initialSelectedDate = 'today', favoritesOnly = false }: HomeEnhancedProps) {
  const location = useLocation();
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
  const [apiSource, setApiSource] = useState<ApiSource>('mock');
  const [realPredictions, setRealPredictions] = useState<Record<string, Prediction>>({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [detailsZIndex, setDetailsZIndex] = useState(60);
  const [agentsZIndex, setAgentsZIndex] = useState(61);
  const zCounterRef = useRef(70);
  const favoritesKey = 'favorite_matches_v1';
  const [favoriteMatchIds, setFavoriteMatchIds] = useState<string[]>([]);

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

        const realWinner = homeScore > awayScore ? 'home' : (homeScore < awayScore ? 'away' : 'draw');
        
        // Obter as previsões individuais que foram geradas para essa partida
        const predictions = await ensemble.predictWithAllAgents(m);
        
        // Ensinar aos agentes o resultado real
        learnFromMatchResult(predictions, realWinner);
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
    if (['IN_PLAY', 'LIVE', '1H', '2H', 'HT', 'ET', 'P'].includes(normalized)) return 'live';
    return 'scheduled';
  };

  const TIME_ZONE = 'America/Sao_Paulo';
  const getDayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const parseApiDate = (value: string) => {
    const raw = String(value || '');
    if (!raw) return new Date(NaN);
    if (/[zZ]$/.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) return new Date(raw);
    return new Date(`${raw}Z`);
  };

  const getDateRange = () => {
    const dateFrom = getDayKey(new Date());
    const dateTo = getDayKey(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    return { dateFrom, dateTo };
  };

  const cacheKey = 'matchesCache_v1';
  const cacheMaxAgeMs = 1000 * 60 * 15;

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
      };

      if (parsed.version !== 1) return null;
      if (parsed.dateFrom !== dateFrom || parsed.dateTo !== dateTo) return null;

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
  }) => {
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          version: 1,
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
      setApiSource(cached.apiSource);
      setRealMatches(cached.matches);
      setRealPredictions(cached.predictions);
      setLastUpdatedAt(new Date(cached.generatedAt));
      if (cached.isFresh) return;
    }

    loadMatchesWithFallback(config);
  }, []);

  const convertApiFootballMatchToFootballMatch = (m: ApiFootballMatch): FootballMatch => {
    const status = m.fixture?.status?.short || 'NS';
    const leagueName = m.league?.name || 'Unknown';
    const leagueCountry = m.league?.country || 'Unknown';
    const leagueFlag = m.league?.flag || '';

    return {
      id: m.fixture.id,
      utcDate: m.fixture.date,
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
          home: m.goals.home,
          away: m.goals.away,
        },
      },
      live: {
        elapsed: m.fixture.status.elapsed,
        statusShort: m.fixture.status.short,
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

  const generatePredictionsForMatches = async (source: ApiSource, matches: FootballMatch[]) => {
    const storeKey = 'predictionStore_v1';
    const store = (() => {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) return { version: 1 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
        const parsed = JSON.parse(raw) as {
          version: number;
          items: Record<string, { createdAt: string; prediction: Prediction }>;
        };
        if (parsed.version !== 1 || !parsed.items) {
          return { version: 1 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
        }
        return { version: 1 as const, items: parsed.items };
      } catch {
        return { version: 1 as const, items: {} as Record<string, { createdAt: string; prediction: Prediction }> };
      }
    })();

    const dynamicAgents = getDynamicAgentProfiles();
    const ensemble = new AgentEnsemble(dynamicAgents);

    for (const m of matches) {
      const id = m.id.toString();
      const key = `${source}:${id}`;
      if (store.items[key]?.prediction) continue;
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
          const fixtures = await service.getFixtures({ from: dateFrom, to: dateTo, timezone: TIME_ZONE });
          const matches = fixtures.map(convertApiFootballMatchToFootballMatch);
          successfulSource = successfulSource ?? 'api-football';
          if (matches.length > 0) {
            const processedMatches = processCrests(matches);
            const disabled = config?.apiFootballDisabledLeagueIds ?? [];
            const visibleMatches =
              disabled.length > 0 ? processedMatches.filter((m) => !disabled.includes(m.competition.id)) : processedMatches;
            setApiSource('api-football');
            setRealMatches(visibleMatches);
            const predictionsById = await generatePredictionsForMatches('api-football', visibleMatches);
            setRealPredictions(predictionsById);
            setLastUpdatedAt(new Date());
            writeCache({
              dateFrom,
              dateTo,
              apiSource: 'api-football',
              matches: visibleMatches,
              predictions: predictionsById,
            });
            toast.success(`${matches.length} partidas carregadas (API-Football)`);
            return;
          }
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
            });
            toast.success(`${matches.length} partidas carregadas (OpenLigaDB)`);
            return;
          }
        } catch (error) {
          console.warn('⚠️ OpenLigaDB falhou, usando fallback...', error);
        }
      }

      if (successfulSource) {
        setApiSource(successfulSource);
        setRealMatches([]);
        setLastUpdatedAt(new Date());
        writeCache({
          dateFrom,
          dateTo,
          apiSource: successfulSource,
          matches: [],
          predictions: {},
        });
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
  const filteredMatches = useMemo(() => {
    // Converte realMatches (FootballMatch) para formato Match se disponível
    const matchesToUse: DisplayMatch[] = apiSource !== 'mock' ?
      realMatches.map((footballMatch) => {
        const matchDate = parseApiDate(footballMatch.utcDate);
        const fullTime = footballMatch.score?.fullTime;
        return {
          id: footballMatch.id.toString(),
          homeTeam: footballMatch.homeTeam.name,
          awayTeam: footballMatch.awayTeam.name,
          homeCrest: footballMatch.homeTeam.crest || '',
          awayCrest: footballMatch.awayTeam.crest || '',
          league: footballMatch.competition.name,
          country: footballMatch.area?.name || footballMatch.competition.area?.name || 'Unknown',
          date: matchDate,
          time: matchDate.toLocaleTimeString('pt-BR', { 
            timeZone: TIME_ZONE,
            hour: '2-digit', 
            minute: '2-digit' 
          }),
          status: toMatchStatus(footballMatch.status),
          result: {
            home: typeof fullTime?.home === 'number' ? fullTime.home : null,
            away: typeof fullTime?.away === 'number' ? fullTime.away : null,
          },
          liveElapsed: footballMatch.live?.elapsed ?? null,
        };
      }) : 
      mockMatches.map((m) => ({ ...m, homeCrest: '', awayCrest: '' }));

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

      // Filtro de país
      if (selectedCountry !== 'all' && match.country !== selectedCountry) {
        return false;
      }

      // Filtro de liga
      if (selectedLeague !== 'all' && match.league !== selectedLeague) {
        return false;
      }

      if (favoritesOnly && !favoriteMatchIds.includes(match.id)) {
        return false;
      }

      return true;
    });
  }, [apiSource, realMatches, selectedStatus, selectedDate, selectedCountry, selectedLeague, favoritesOnly, favoriteMatchIds]);

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

  const handleViewDetails = (matchId: string) => {
    setSelectedMatchId(matchId);
    loadAgentAnalysis(matchId);
  };

  const handleManualRefreshMatches = () => {
    const config = loadApiConfig();
    loadMatchesWithFallback(config);
  };

  return (
    <div className="min-h-screen bg-gray-50">
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
      />

      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <Brain className="w-8 h-8 text-purple-600" />
              <h1 className="text-3xl font-bold text-gray-900">
                Previsões de Futebol com IA
              </h1>
            </div>
            <Button
              onClick={handleManualRefreshMatches}
              disabled={isLoadingMatches}
              className="shrink-0"
            >
              {isLoadingMatches ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Atualizar partidas
            </Button>
          </div>
          <p className="text-gray-600">
            Análises detalhadas geradas por 5 agentes de IA especializados em diferentes aspectos do futebol
          </p>
          {lastUpdatedAt && (
            <p className="text-sm text-gray-500 mt-2">
              Última atualização: {lastUpdatedAt.toLocaleString('pt-BR')}
            </p>
          )}
        </div>

        {/* API Status */}
        <ApiStatus />

        {/* Carrossel Premium */}
        {premiumMatches.length > 0 && (
          <PremiumCarousel
            matches={premiumMatches}
            onMatchClick={handleViewDetails}
          />
        )}

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
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
          <div className="space-y-8">
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
                    const prediction = predictionByMatchId[match.id];
                    if (!prediction) return null;
                    
                    return (
                      <MatchCard
                        key={match.id}
                        match={match}
                        prediction={prediction}
                        onViewDetails={handleViewDetails}
                        homeCrest={match.homeCrest}
                        awayCrest={match.awayCrest}
                        footballMatch={apiSource !== 'mock' ? realMatchById[match.id] : undefined}
                        isFavorite={favoriteMatchIds.includes(match.id)}
                        onToggleFavorite={toggleFavoriteMatch}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedMatch && selectedPrediction && (
        <div className="fixed inset-0 z-50 pointer-events-none">
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
            <PredictionDetails match={selectedMatch} prediction={selectedPrediction} />
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
