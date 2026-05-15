import { Match, Prediction } from '../data/mockData';
import { Calendar, Clock, TrendingUp, Star, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentEnsemble, getDynamicAgentProfiles } from '../services/aiAgents';
import type { FootballMatch } from '../services/footballDataService';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballMatch, ApiFootballService } from '../services/apiFootballService';
import { toast } from 'sonner';

const TIME_ZONE = 'America/Sao_Paulo';
const teamFixturesCache = new Map<string, { fetchedAt: number; items: ApiFootballMatch[] }>();

type ApiSource = 'api-football' | 'football-data' | 'openligadb' | 'betfair' | 'mock';

type FormMatchRow = {
  id: number;
  utcDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  homeGoals: number;
  awayGoals: number;
  isTeamHome: boolean;
  totalGoals: number;
};

const isFinishedApiFixture = (m: ApiFootballMatch) => {
  const short = String(m?.fixture?.status?.short ?? '').toUpperCase();
  return ['FT', 'AET', 'PEN'].includes(short);
};

const toFormRow = (m: ApiFootballMatch, teamId: number): FormMatchRow | null => {
  if (!isFinishedApiFixture(m)) return null;
  const homeGoals = m?.goals?.home;
  const awayGoals = m?.goals?.away;
  if (typeof homeGoals !== 'number' || typeof awayGoals !== 'number') return null;
  const fixtureId = Number(m?.fixture?.id);
  if (!Number.isFinite(fixtureId)) return null;
  const utcDate = String(m?.fixture?.date ?? '');
  const isTeamHome = Number(m?.teams?.home?.id) === Number(teamId);
  return {
    id: fixtureId,
    utcDate,
    league: String(m?.league?.name ?? '').trim(),
    homeTeam: String(m?.teams?.home?.name ?? '—'),
    awayTeam: String(m?.teams?.away?.name ?? '—'),
    homeLogoUrl: typeof (m as any)?.teams?.home?.logo === 'string' ? (m as any).teams.home.logo : undefined,
    awayLogoUrl: typeof (m as any)?.teams?.away?.logo === 'string' ? (m as any).teams.away.logo : undefined,
    homeGoals,
    awayGoals,
    isTeamHome,
    totalGoals: homeGoals + awayGoals,
  };
};

const calcOu = (rows: FormMatchRow[], line: number) => {
  const total = rows.length;
  const over = rows.filter((r) => r.totalGoals > line).length;
  const under = total - over;
  const overPct = total === 0 ? 0 : (over / total) * 100;
  const underPct = total === 0 ? 0 : (under / total) * 100;
  return { total, over, under, overPct, underPct };
};

const formatMonthGroup = (utcDate: string) => {
  const d = new Date(utcDate);
  if (!Number.isFinite(d.getTime())) return '—';
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, month: '2-digit', year: 'numeric' }).format(d);
  return label.replace('/', '.');
};

const formatDay = (utcDate: string) => {
  const d = new Date(utcDate);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
};

const shortLeague = (league: string) => {
  const v = String(league ?? '').trim();
  if (!v) return '—';
  if (v.length <= 10) return v.toUpperCase();
  return `${v.slice(0, 10).toUpperCase()}…`;
};

const normalizeTeamName = (value: string) => {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^0-9a-zA-Z\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toTokens = (value: string) => {
  const raw = normalizeTeamName(value).toLowerCase();
  const stop = new Set([
    'fc',
    'cf',
    'sc',
    'ac',
    'afc',
    'cd',
    'ud',
    'fk',
    'sk',
    'sv',
    'sl',
    'sp',
    'club',
    'calcio',
    'team',
    'de',
    'la',
    'el',
    'the',
    'sport',
    'sporting',
  ]);
  return raw
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t));
};

const overlapScore = (a: string, b: string) => {
  const ta = toTokens(a);
  const tb = new Set(toTokens(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  const hits = ta.filter((t) => tb.has(t)).length;
  return hits / Math.max(ta.length, tb.size);
};

const getMatchYmd = (d: Date) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

const buildTeamSearchCandidates = (teamName: string): string[] => {
  const base = String(teamName ?? '').trim();
  if (!base) return [];
  const cleaned = normalizeTeamName(base);
  const variants = new Set<string>();
  const push = (v: string) => {
    const s = normalizeTeamName(String(v ?? ''));
    if (s.length >= 3) variants.add(s);
  };

  push(base);
  push(cleaned);
  push(cleaned.replace(/\bUTD\b/gi, 'United'));
  push(cleaned.replace(/\bATL\b/gi, 'Atletico'));
  push(cleaned.replace(/\bST\.\b/gi, 'Saint'));
  push(cleaned.replace(/\bW\b$/i, '').trim());
  push(cleaned.replace(/\bU(2[0-3]|1[7-9]|16)\b/gi, '').trim());
  push(cleaned.replace(/\b(FC|CF|SC|AC|AFC|CD|UD|FK|SK|SV|SL|SP)\b/gi, '').replace(/\s+/g, ' ').trim());

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    push(parts.slice(-2).join(' '));
    push(parts.slice(-3).join(' '));
  }
  if (parts.length >= 1) push(parts[0]);
  return Array.from(variants);
};

const resolveTeamIdFromSearch = async (service: ApiFootballService, teamName: string) => {
  const candidates = buildTeamSearchCandidates(teamName);
  if (candidates.length === 0) return null;

  const norm = (s: string) => normalizeTeamName(s).toLowerCase();
  const qn0 = norm(teamName);

  for (const c of candidates) {
    const safe = normalizeTeamName(c);
    if (safe.length < 3) continue;
    let items: any[] = [];
    try {
      items = await service.getTeams({ search: safe });
    } catch {
      continue;
    }
    if (!Array.isArray(items) || items.length === 0) continue;

    const scored = items
      .map((t) => {
        const id = Number((t as any)?.id);
        const name = String((t as any)?.name ?? '');
        const tn = norm(name);
        const qn = norm(safe);
        let score = 0;
        if (tn === qn) score += 120;
        if (tn === qn0) score += 140;
        if (tn.startsWith(qn)) score += 40;
        if (tn.includes(qn)) score += 25;
        score -= Math.abs(tn.length - qn.length);
        return { id, score };
      })
      .filter((x) => Number.isFinite(x.id));

    if (scored.length === 0) continue;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
  }

  return null;
};

const resolveTeamIdsViaFixtureDate = async (service: ApiFootballService, match: Match) => {
  const date = match?.date ? new Date(match.date as unknown as Date) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return null;
  const ymd = getMatchYmd(date);

  const fixtures = await service.getFixtures({ date: ymd, timezone: TIME_ZONE, maxPages: 5 });
  const matchTs = date.getTime();

  let best: { score: number; fixture: ApiFootballMatch; homeId: number; awayId: number } | null = null;
  for (const f of fixtures) {
    const homeName = String(f?.teams?.home?.name ?? '');
    const awayName = String(f?.teams?.away?.name ?? '');
    const homeId = Number(f?.teams?.home?.id);
    const awayId = Number(f?.teams?.away?.id);
    if (!Number.isFinite(homeId) || !Number.isFinite(awayId)) continue;

    const s1 = overlapScore(match.homeTeam, homeName);
    const s2 = overlapScore(match.awayTeam, awayName);
    const sSwap1 = overlapScore(match.homeTeam, awayName);
    const sSwap2 = overlapScore(match.awayTeam, homeName);
    const direct = (s1 + s2) / 2;
    const swapped = (sSwap1 + sSwap2) / 2;
    const nameScore = Math.max(direct, swapped);

    const t = Number(f?.fixture?.timestamp ?? 0);
    const fixtureTs = Number.isFinite(t) && t > 0 ? t * 1000 : new Date(String(f?.fixture?.date ?? '')).getTime();
    const diffMin = Number.isFinite(fixtureTs) ? Math.abs(fixtureTs - matchTs) / 60000 : 99999;
    const timeScore = diffMin <= 15 ? 1 : diffMin <= 60 ? 0.6 : diffMin <= 180 ? 0.3 : 0;

    const score = nameScore * 100 + timeScore * 20;
    if (!best || score > best.score) {
      if (direct >= swapped) best = { score, fixture: f, homeId, awayId };
      else best = { score, fixture: f, homeId: awayId, awayId: homeId };
    }
  }

  if (!best || best.score < 55) return null;
  return { homeTeamId: best.homeId, awayTeamId: best.awayId, fixture: best.fixture };
};

type StandingInfo = {
  rank: number | null;
  points: number | null;
  played: number | null;
  goalsDiff: number | null;
};

type MatchOuContext = {
  leagueType: string | null;
  round: string | null;
  homeStanding: StandingInfo | null;
  awayStanding: StandingInfo | null;
  tableSize: number | null;
};

type OuPick = 'OVER' | 'UNDER';

type OuAgentOpinion = {
  agentName: string;
  pick: OuPick;
  confidence: number;
  bullets: string[];
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const safeNumber = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const avg = (xs: number[]) => {
  if (!Array.isArray(xs) || xs.length === 0) return null;
  const sum = xs.reduce((acc, v) => acc + v, 0);
  return sum / xs.length;
};

const getRoundLabel = (fixture: ApiFootballMatch | null) => {
  const raw = fixture ? String((fixture as any)?.league?.round ?? '') : '';
  const v = raw.trim();
  return v ? v : null;
};

const isDecisiveRound = (round: string | null) => {
  const v = String(round ?? '').toLowerCase();
  if (!v) return false;
  return /final|semi|quarter|round of|play[- ]?offs|knockout|eliminat/.test(v);
};

const extractStandingsRows = (standingsResp: any): any[] => {
  const root = Array.isArray(standingsResp) ? standingsResp[0] : standingsResp;
  const league = root?.league ?? root;
  const standings = league?.standings;
  if (Array.isArray(standings) && standings.length > 0) {
    if (Array.isArray(standings[0])) return standings[0];
    return standings.flatMap((g: any) => (Array.isArray(g) ? g : []));
  }
  return [];
};

const pickTeamStanding = (rows: any[], teamId: number): StandingInfo | null => {
  if (!Number.isFinite(teamId) || teamId <= 0) return null;
  const hit = rows.find((r) => Number(r?.team?.id) === Number(teamId)) ?? null;
  if (!hit) return null;
  const all = Number(hit?.all?.played) ?? Number(hit?.played);
  const gd = Number(hit?.goalsDiff) ?? Number(hit?.all?.goals?.for) - Number(hit?.all?.goals?.against);
  return {
    rank: safeNumber(Number(hit?.rank)),
    points: safeNumber(Number(hit?.points)),
    played: safeNumber(Number.isFinite(all) ? all : NaN),
    goalsDiff: safeNumber(Number.isFinite(gd) ? gd : NaN),
  };
};

type AgentMarketSummary = {
  agentName: string;
  picks: Array<{
    key: string;
    label: string;
    ok: boolean;
    total: number;
    correct: number;
    percent: number | null;
  }>;
};

interface MatchCardProps {
  match: Match & {
    result?: {
      home: number | null;
      away: number | null;
    };
    liveElapsed?: number | null;
    liveStatusShort?: string;
    liveExtra?: number | null;
  };
  prediction?: Prediction | null;
  apiSource?: ApiSource;
  onViewDetails: (matchId: string) => void;
  homeCrest?: string;
  awayCrest?: string;
  footballMatch?: FootballMatch;
  isFavorite?: boolean;
  onToggleFavorite?: (matchId: string) => void;
  onRefreshMatch?: (matchId: string) => void;
  isRefreshing?: boolean;
  lastUpdatedAt?: Date | null;
}

export function MatchCard({
  match,
  prediction,
  apiSource = 'mock',
  onViewDetails,
  homeCrest,
  awayCrest,
  footballMatch,
  isFavorite = false,
  onToggleFavorite,
  onRefreshMatch,
  isRefreshing = false,
  lastUpdatedAt,
}: MatchCardProps) {
  const [showResult, setShowResult] = useState(false);
  const [agentMarketSummaries, setAgentMarketSummaries] = useState<AgentMarketSummary[] | null>(null);
  const [isLoadingAgentMarkets, setIsLoadingAgentMarkets] = useState(false);
  const [tick, setTick] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [betfairConfirmOpen, setBetfairConfirmOpen] = useState(false);
  const [isEnqueueingBetfair, setIsEnqueueingBetfair] = useState(false);
  const [homeHomeRows, setHomeHomeRows] = useState<FormMatchRow[] | null>(null);
  const [awayAwayRows, setAwayAwayRows] = useState<FormMatchRow[] | null>(null);
  const [isLoadingForm, setIsLoadingForm] = useState(false);
  const [formError, setFormError] = useState<string>('');
  const [matchOuContext, setMatchOuContext] = useState<MatchOuContext | null>(null);

  const toMatchStatus = (status: string | undefined): 'scheduled' | 'live' | 'finished' => {
    const normalized = String(status || '').toUpperCase();
    if (['FINISHED', 'FT', 'AET', 'PEN'].includes(normalized)) return 'finished';
    if (['IN_PLAY', 'PAUSED', 'BREAK', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'SUSPENDED', 'INTERRUPTED'].includes(normalized)) return 'live';
    return 'scheduled';
  };

  const resolvedLive = useMemo(() => {
    const rawElapsed = match.liveElapsed ?? footballMatch?.live?.elapsed ?? null;
    const elapsed =
      typeof rawElapsed === 'number'
        ? rawElapsed
        : typeof rawElapsed === 'string'
          ? Number(rawElapsed)
          : null;

    const rawExtra = match.liveExtra ?? footballMatch?.live?.extra ?? null;
    const extra =
      typeof rawExtra === 'number'
        ? rawExtra
        : typeof rawExtra === 'string'
          ? Number(rawExtra)
          : null;

    const statusShort =
      match.liveStatusShort ??
      footballMatch?.live?.statusShort ??
      (typeof footballMatch?.status === 'string' ? footballMatch.status : undefined);

    return {
      elapsed: Number.isFinite(elapsed) ? (elapsed as number) : null,
      extra: Number.isFinite(extra) ? (extra as number) : null,
      statusShort: typeof statusShort === 'string' ? statusShort : undefined,
    };
  }, [
    footballMatch?.live?.elapsed,
    footballMatch?.live?.extra,
    footballMatch?.live?.statusShort,
    footballMatch?.status,
    match.liveElapsed,
    match.liveExtra,
    match.liveStatusShort,
  ]);

  const derivedStatus = useMemo(() => {
    const fromShort = toMatchStatus(resolvedLive.statusShort);
    if (fromShort !== 'scheduled') return fromShort;
    const fromApi = toMatchStatus(footballMatch?.status);
    if (fromApi !== 'scheduled') return fromApi;
    return match.status as 'scheduled' | 'live' | 'finished';
  }, [footballMatch?.status, match.status, resolvedLive.statusShort]);

  const kickoffMs = useMemo(() => new Date(match.date as unknown as Date).getTime(), [match.date]);
  const isEstimatedLive = useMemo(() => {
    if (derivedStatus !== 'scheduled') return false;
    if (!Number.isFinite(kickoffMs)) return false;
    const now = Date.now();
    const started = now >= kickoffMs + 60 * 1000;
    const withinWindow = now <= kickoffMs + 3 * 60 * 60 * 1000;
    return started && withinWindow;
  }, [derivedStatus, kickoffMs]);

  const isFinished = derivedStatus === 'finished';
  const isLive = derivedStatus === 'live' || isEstimatedLive;
  const autoRefreshAttemptedRef = useRef(false);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  useEffect(() => {
    if (!isEstimatedLive) return;
    if (autoRefreshAttemptedRef.current) return;
    if (typeof resolvedLive.elapsed === 'number') return;
    if (!onRefreshMatch) return;
    autoRefreshAttemptedRef.current = true;
    onRefreshMatch(match.id);
  }, [isEstimatedLive, match.id, onRefreshMatch, resolvedLive.elapsed]);

  const liveClockLabel = useMemo(() => {
    if (!isLive) return null;

    const short = String(resolvedLive.statusShort || '').toUpperCase();
    if (short === 'HT') return 'Intervalo';

    const getMinuteText = (m: number, extra: number | null) => {
      if (typeof extra === 'number' && extra > 0) return `${m}+${extra}'`;
      return `${m}'`;
    };

    if (typeof resolvedLive.elapsed === 'number') {
      const minute = Math.max(0, Math.floor(resolvedLive.elapsed));
      const minuteText = getMinuteText(minute, resolvedLive.extra);

      if (short === '1H') return `1º Tempo - ${minuteText}`;
      if (short === '2H') return `2º Tempo - ${minuteText}`;
      if (short === 'ET') return `Prorrogação - ${minuteText}`;
      if (short === 'IN_PLAY' || short === 'LIVE' || short === 'PAUSED' || short === 'BREAK') return `Ao vivo - ${minuteText}`;
      return `Ao vivo - ${minuteText}`;
    }

    if (short === '1H') return '1º Tempo';
    if (short === '2H') return '2º Tempo';
    if (short === 'ET') return 'Prorrogação';
    if (short === 'IN_PLAY' || short === 'LIVE' || short === 'PAUSED' || short === 'BREAK') return 'Ao vivo';
    if (isEstimatedLive) return 'Ao vivo';

    return null;
  }, [isLive, isEstimatedLive, resolvedLive.elapsed, resolvedLive.extra, resolvedLive.statusShort, tick]);

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

  const resultAvailable =
    isFinished &&
    typeof match.result?.home === 'number' &&
    typeof match.result?.away === 'number';

  const displayHomeScore =
    typeof match.result?.home === 'number'
      ? match.result.home
      : typeof footballMatch?.score?.fullTime?.home === 'number'
        ? footballMatch.score.fullTime.home
        : null;

  const displayAwayScore =
    typeof match.result?.away === 'number'
      ? match.result.away
      : typeof footballMatch?.score?.fullTime?.away === 'number'
        ? footballMatch.score.fullTime.away
        : null;

  const shouldShowScoreboard = resultAvailable || isLive;
  const hasPrediction = Boolean(prediction);
  const bttsOpportunity =
    Boolean(prediction) &&
    prediction?.btts?.prediction === 'yes' &&
    typeof prediction?.btts?.confidence === 'number' &&
    prediction.btts.confidence >= 75;

  const voteSignals = useMemo(() => {
    if (!prediction) return null;
    const winner = prediction.winner?.prediction;
    const winnerConf = typeof prediction.winner?.confidence === 'number' ? prediction.winner.confidence : 0;
    const rest = Math.max(0, 100 - winnerConf);
    const half = Math.round(rest / 2);

    const probs =
      winner === 'home'
        ? { home: winnerConf, draw: half, away: rest - half }
        : winner === 'away'
          ? { away: winnerConf, draw: half, home: rest - half }
          : { draw: winnerConf, home: half, away: rest - half };

    const over15 =
      prediction.overUnder?.prediction === 'over' && typeof prediction.overUnder.confidence === 'number'
        ? Math.round(prediction.overUnder.confidence)
        : null;

    const bttsYes =
      prediction.btts?.prediction === 'yes' && typeof prediction.btts.confidence === 'number'
        ? Math.round(prediction.btts.confidence)
        : null;

    const layHome = Math.max(0, 100 - probs.home);
    const layAway = Math.max(0, 100 - probs.away);

    return {
      probs,
      over15,
      bttsYes,
      layHome,
      layAway,
    };
  }, [prediction]);

  const actualWinner = (() => {
    if (!resultAvailable) return null;
    if (match.result!.home! > match.result!.away!) return 'home' as const;
    if (match.result!.home! < match.result!.away!) return 'away' as const;
    return 'draw' as const;
  })();

  const predictedWinner = prediction?.winner?.prediction ?? null;
  const winnerHit = actualWinner && predictedWinner ? actualWinner === predictedWinner : null;
  const winnerPush = actualWinner === 'draw';

  const actualScoreText = resultAvailable ? `${match.result!.home}-${match.result!.away}` : null;
  const predictedScoreText = prediction?.correctScore?.score ?? null;
  const scoreHit = actualScoreText && predictedScoreText ? actualScoreText === predictedScoreText : null;

  const totalGoals = resultAvailable ? match.result!.home! + match.result!.away! : null;
  const overUnderLine = prediction?.overUnder?.line ?? null;
  const actualOverUnder =
    totalGoals === null || typeof overUnderLine !== 'number'
      ? null
      : totalGoals > overUnderLine
        ? ('over' as const)
        : ('under' as const);
  const overUnderHit = actualOverUnder && prediction?.overUnder?.prediction ? actualOverUnder === prediction.overUnder.prediction : null;

  const actualBtts =
    resultAvailable ? ((match.result!.home! > 0 && match.result!.away! > 0 ? 'yes' : 'no') as const) : null;
  const bttsHit = actualBtts && prediction?.btts?.prediction ? actualBtts === prediction.btts.prediction : null;

  const marketHits = {
    winner: winnerPush ? null : winnerHit === true,
    overUnder: overUnderHit === true,
    btts: bttsHit === true,
  } as const;

  const marketTotal = resultAvailable && hasPrediction ? (winnerPush ? 2 : 3) : 0;
  const marketCorrect =
    resultAvailable && hasPrediction
      ? Number(marketHits.overUnder) + Number(marketHits.btts) + (marketHits.winner === true ? 1 : 0)
      : 0;
  const marketPercent = marketTotal === 0 ? 0 : Math.round((marketCorrect / marketTotal) * 100);

  const enqueueBetfairAutomation = async () => {
    if (isEnqueueingBetfair) return;
    setIsEnqueueingBetfair(true);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/automation/betfair/queue/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
        body: JSON.stringify({
          matchId: match.id,
          source: apiSource,
          utcDate: match.date ? new Date(match.date).toISOString() : null,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          prediction: prediction ?? null,
        }),
      });
      const raw = await res.text().catch(() => '');
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      const mapped = Boolean(data?.item?.betfair?.marketId);
      const msg = mapped
        ? 'Jogo adicionado e mapeado na Betfair'
        : 'Jogo adicionado. Mapeamento Betfair pendente';
      const desc = !mapped && data?.item?.mappingError ? String(data.item.mappingError).slice(0, 220) : undefined;
      toast.success(msg, desc ? { description: desc } : undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao adicionar à automação', { description: msg.slice(0, 220) });
    } finally {
      setIsEnqueueingBetfair(false);
    }
  };

  const buildFallbackFootballMatch = (): FootballMatch => {
    const toNumericId = (id: string) => {
      const text = String(id ?? '');
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        h = (h << 5) - h + text.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h) || 1;
    };

    const now = new Date();
    const utcDate = match.date ? new Date(match.date).toISOString() : now.toISOString();
    const homeTeamId = toNumericId(`home:${match.homeTeam}`);
    const awayTeamId = toNumericId(`away:${match.awayTeam}`);

    return {
      id: typeof match.id === 'string' ? toNumericId(match.id) : toNumericId(String(match.id)),
      utcDate,
      status: isFinished ? 'FINISHED' : match.status === 'live' ? 'IN_PLAY' : 'SCHEDULED',
      matchday: 1,
      homeTeam: {
        id: homeTeamId,
        name: match.homeTeam,
        shortName: match.homeTeam,
        tla: match.homeTeam.substring(0, 3).toUpperCase(),
        crest: homeCrest || '',
      },
      awayTeam: {
        id: awayTeamId,
        name: match.awayTeam,
        shortName: match.awayTeam,
        tla: match.awayTeam.substring(0, 3).toUpperCase(),
        crest: awayCrest || '',
      },
      score: {
        fullTime: {
          home: resultAvailable ? match.result!.home : null,
          away: resultAvailable ? match.result!.away : null,
        },
      },
      competition: {
        id: 1,
        name: match.league,
        code: 'NA',
        emblem: '',
        area: {
          name: match.country,
          code: 'NA',
          flag: '',
        },
      },
    };
  };

  const loadAgentMarketBreakdown = async () => {
    if (!resultAvailable || !actualWinner || !actualBtts) return;
    if (isLoadingAgentMarkets) return;

    setIsLoadingAgentMarkets(true);
    try {
      const baseMatch = footballMatch ?? buildFallbackFootballMatch();
      const profiles = getDynamicAgentProfiles();
      const ensemble = new AgentEnsemble(profiles);
      const preds = await ensemble.predictWithAllAgents(baseMatch);

      const totalGoalsLocal = typeof match.result?.home === 'number' && typeof match.result?.away === 'number'
        ? match.result.home + match.result.away
        : null;

      const byName = new Map(profiles.map((p) => [p.name, p] as const));
      const lineKey = (line: number) => {
        if (!Number.isFinite(line)) return '2.5';
        const s = Math.abs(line % 1) < 1e-9 ? line.toFixed(0) : line.toFixed(2);
        return s.replace(/0+$/g, '').replace(/\.$/g, '');
      };
      const winnerLabel = (w: 'home' | 'away' | 'draw') => (w === 'home' ? 'Casa' : w === 'away' ? 'Visitante' : 'Empate');
      const bttsLabel = (v: 'yes' | 'no') => (v === 'yes' ? 'Sim' : 'Não');

      const summaries = preds
        .map((p) => {
          const totalGoals = totalGoalsLocal;
          const ouLine = typeof p.overUnder?.line === 'number' ? p.overUnder.line : 2.5;
          const actualOu = totalGoals === null ? null : totalGoals > ouLine ? ('over' as const) : ('under' as const);

          const winnerOk = actualWinner === 'draw' ? null : p.winner === actualWinner;
          const bttsOk = p.btts.prediction === actualBtts;
          const ouOk = actualOu ? p.overUnder.prediction === actualOu : false;

          const profile = byName.get(p.agentName);
          const stats = profile?.marketKeyStats ?? {};

          const mkWinner = `winner:${p.winner}`;
          const mkBtts = `btts:${p.btts.prediction}`;
          const mkOu = `ou:${p.overUnder.prediction}:${lineKey(ouLine)}`;

          const pick = (key: string, label: string, ok: boolean | null) => {
            const s = (stats as any)?.[key] as { total?: number; correct?: number; accuracy?: number } | undefined;
            const total = Math.max(0, Number(s?.total ?? 0));
            const correct = Math.max(0, Number(s?.correct ?? 0));
            const percent = total > 0 ? Math.round((correct / total) * 100) : null;
            return { key, label, ok, total, correct, percent };
          };

          return {
            agentName: p.agentName,
            picks: [
              pick(mkWinner, `Vencedor: ${winnerLabel(p.winner)}`, winnerOk),
              pick(mkOu, `Over/Under ${lineKey(ouLine)}: ${p.overUnder.prediction === 'over' ? 'Over' : 'Under'}`, ouOk),
              pick(mkBtts, `Ambos marcam: ${bttsLabel(p.btts.prediction)}`, bttsOk),
            ],
          };
        })
        .sort((a, b) => {
          const aScore = a.picks.reduce((sum, x) => sum + (x.ok === true ? 1 : 0), 0);
          const bScore = b.picks.reduce((sum, x) => sum + (x.ok === true ? 1 : 0), 0);
          return bScore - aScore;
        });

      setAgentMarketSummaries(summaries);
    } finally {
      setIsLoadingAgentMarkets(false);
    }
  };

  const handleToggleResult = () => {
    const next = !showResult;
    setShowResult(next);
    if (next && resultAvailable && hasPrediction && !agentMarketSummaries) {
      void loadAgentMarketBreakdown();
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    if (!isFinished && (derivedStatus === 'scheduled' || isLive)) {
      setFormError('');
      setHomeHomeRows(null);
      setAwayAwayRows(null);
      setMatchOuContext(null);
      setFormOpen(true);
      return;
    }
    if (!isFinished || !resultAvailable || !hasPrediction) return;
    handleToggleResult();
  };

  useEffect(() => {
    if (!formOpen) return;
    if (homeHomeRows !== null && awayAwayRows !== null) return;

    const cfg = loadApiConfig();
    const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
    if (!apiFootballKey) {
      setFormError('Configure a API-Football em Configurações para ver o histórico.');
      setHomeHomeRows([]);
      setAwayAwayRows([]);
      return;
    }

    const run = async () => {
      setIsLoadingForm(true);
      setFormError('');
      try {
        const service = new ApiFootballService(apiFootballKey);

        const directIdsOk =
          apiSource === 'api-football' &&
          Number.isFinite(Number(footballMatch?.homeTeam?.id)) &&
          Number.isFinite(Number(footballMatch?.awayTeam?.id));

        const resolvedByDate = await resolveTeamIdsViaFixtureDate(service, match);

        const homeTeamId = directIdsOk
          ? Number(footballMatch!.homeTeam.id)
          : resolvedByDate?.homeTeamId ?? (await resolveTeamIdFromSearch(service, match.homeTeam));

        const awayTeamId = directIdsOk
          ? Number(footballMatch!.awayTeam.id)
          : resolvedByDate?.awayTeamId ?? (await resolveTeamIdFromSearch(service, match.awayTeam));

        if (!Number.isFinite(homeTeamId) || !Number.isFinite(awayTeamId)) {
          setFormError(`Não foi possível identificar os times na API-Football (${match.homeTeam} vs ${match.awayTeam}).`);
          setHomeHomeRows([]);
          setAwayAwayRows([]);
          return;
        }

        const fixtureForContext = resolvedByDate?.fixture ?? null;
        const leagueType = fixtureForContext ? String(fixtureForContext?.league?.type ?? '').trim() || null : null;
        const round = getRoundLabel(fixtureForContext);

        let standingsRows: any[] = [];
        try {
          const leagueId = Number(fixtureForContext?.league?.id);
          const season = Number(fixtureForContext?.league?.season);
          if (Number.isFinite(leagueId) && Number.isFinite(season) && leagueId > 0 && season > 0) {
            const standingsResp = await service.getStandings({ league: leagueId, season });
            standingsRows = extractStandingsRows(standingsResp);
          }
        } catch {
          standingsRows = [];
        }

        setMatchOuContext({
          leagueType,
          round,
          homeStanding: pickTeamStanding(standingsRows, homeTeamId),
          awayStanding: pickTeamStanding(standingsRows, awayTeamId),
          tableSize: standingsRows.length > 0 ? standingsRows.length : null,
        });

        const loadTeam = async (teamId: number) => {
          const cacheKey = `api-football:team:last60:${teamId}`;
          const now = Date.now();
          const cached = teamFixturesCache.get(cacheKey);
          if (cached && now - cached.fetchedAt < 1000 * 60 * 10) return cached.items;
          const items = await service.getFixturesOnce({ team: teamId, last: 60, timezone: TIME_ZONE });
          teamFixturesCache.set(cacheKey, { fetchedAt: now, items: Array.isArray(items) ? items : [] });
          return Array.isArray(items) ? items : [];
        };

        const [homeTeamFixtures, awayTeamFixtures] = await Promise.all([loadTeam(homeTeamId), loadTeam(awayTeamId)]);

        const homeRows = homeTeamFixtures
          .map((m) => toFormRow(m, homeTeamId))
          .filter((v): v is FormMatchRow => Boolean(v))
          .filter((r) => r.isTeamHome)
          .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
          .slice(0, 10);

        const awayRows = awayTeamFixtures
          .map((m) => toFormRow(m, awayTeamId))
          .filter((v): v is FormMatchRow => Boolean(v))
          .filter((r) => !r.isTeamHome)
          .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
          .slice(0, 10);

        setHomeHomeRows(homeRows);
        setAwayAwayRows(awayRows);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
        setHomeHomeRows([]);
        setAwayAwayRows([]);
        setMatchOuContext(null);
      } finally {
        setIsLoadingForm(false);
      }
    };
    void run();
  }, [
    apiSource,
    awayAwayRows,
    footballMatch,
    formOpen,
    homeHomeRows,
    isLive,
    derivedStatus,
  ]);

  const ouPanel = useMemo(() => {
    if (!homeHomeRows || !awayAwayRows) return null;
    const line = 2.5;
    const ouHome = calcOu(homeHomeRows, line);
    const ouAway = calcOu(awayAwayRows, line);
    const combined = [...homeHomeRows, ...awayAwayRows];
    const ouAll = calcOu(combined, line);

    const avgTotalHome = avg(homeHomeRows.map((r) => r.totalGoals));
    const avgTotalAway = avg(awayAwayRows.map((r) => r.totalGoals));
    const avgTotalAll = avg(combined.map((r) => r.totalGoals));

    const homeFor = avg(homeHomeRows.map((r) => r.homeGoals));
    const homeAgainst = avg(homeHomeRows.map((r) => r.awayGoals));
    const awayFor = avg(awayAwayRows.map((r) => r.awayGoals));
    const awayAgainst = avg(awayAwayRows.map((r) => r.homeGoals));

    const round = matchOuContext?.round ?? null;
    const leagueType = matchOuContext?.leagueType ?? null;
    const decisive = isDecisiveRound(round);
    const isCup = String(leagueType ?? '').toLowerCase() === 'cup';

    const tableSize = matchOuContext?.tableSize ?? null;
    const hRank = matchOuContext?.homeStanding?.rank ?? null;
    const aRank = matchOuContext?.awayStanding?.rank ?? null;
    const homePressure =
      tableSize && hRank
        ? hRank <= Math.ceil(tableSize * 0.2)
          ? 'Topo'
          : hRank >= Math.floor(tableSize * 0.8)
            ? 'Pressão'
            : null
        : null;
    const awayPressure =
      tableSize && aRank
        ? aRank <= Math.ceil(tableSize * 0.2)
          ? 'Topo'
          : aRank >= Math.floor(tableSize * 0.8)
            ? 'Pressão'
            : null
        : null;

    const agentForma = (() => {
      const overBias = ouAll.overPct - 50;
      const avgBias = (avgTotalAll ?? 2.5) - 2.5;
      const raw = overBias * 0.8 + avgBias * 14;
      const pick: OuPick = raw >= 0 ? 'OVER' : 'UNDER';
      const confidence = clamp(55 + Math.abs(overBias) * 0.6 + Math.abs(avgBias) * 8, 55, 87);
      return {
        agentName: 'Forma & Gols',
        pick,
        confidence: Math.round(confidence),
        bullets: [
          `Casa: Over 2.5 em ${ouHome.over}/${ouHome.total} (${ouHome.overPct.toFixed(0)}%)`,
          `Fora: Over 2.5 em ${ouAway.over}/${ouAway.total} (${ouAway.overPct.toFixed(0)}%)`,
          `Média gols (amostra): ${(avgTotalAll ?? 0).toFixed(2)}`,
        ],
      } satisfies OuAgentOpinion;
    })();

    const agentDefesa = (() => {
      const againstAvg = avg([homeAgainst ?? 0, awayAgainst ?? 0].filter((n) => typeof n === 'number') as number[]);
      const totalAvg = avgTotalAll ?? 2.5;
      const raw = (againstAvg ?? 1.2) * 1.1 + totalAvg * 0.9;
      const pick: OuPick = raw >= 3.05 ? 'OVER' : 'UNDER';
      const confidence = clamp(55 + Math.abs(raw - 3.05) * 12, 55, 83);
      return {
        agentName: 'Defesas',
        pick,
        confidence: Math.round(confidence),
        bullets: [
          `Casa sofre (média): ${(homeAgainst ?? 0).toFixed(2)}`,
          `Fora sofre (média): ${(awayAgainst ?? 0).toFixed(2)}`,
          `Média gols (amostra): ${(avgTotalAll ?? 0).toFixed(2)}`,
        ],
      } satisfies OuAgentOpinion;
    })();

    const agentContexto = (() => {
      let raw = 0;
      const bullets: string[] = [];

      if (isCup) {
        raw -= 0.35;
        bullets.push('Copa: tende a ser mais amarrado (cautela).');
      } else if (leagueType) {
        bullets.push(`Tipo: ${leagueType}.`);
      }

      if (decisive && round) {
        raw -= 0.2;
        bullets.push(`Fase decisiva: ${round}.`);
      } else if (round) {
        bullets.push(`Rodada: ${round}.`);
      }

      if (homePressure || awayPressure) {
        bullets.push(
          `Tabela: ${match.homeTeam} ${homePressure ? `(${homePressure})` : ''} • ${match.awayTeam} ${awayPressure ? `(${awayPressure})` : ''}`,
        );
      } else if (tableSize) {
        bullets.push('Tabela: sem sinal forte de pressão (topo/queda).');
      } else {
        bullets.push('Tabela: indisponível para este jogo.');
      }

      const mismatch =
        tableSize && hRank && aRank ? Math.abs((hRank - aRank) / Math.max(1, tableSize)) >= 0.45 : false;
      if (mismatch) {
        raw += 0.18;
        bullets.push('Diferença grande de posição: chance de jogo aberto por desequilíbrio.');
      }

      const pick: OuPick = raw >= 0 ? 'OVER' : 'UNDER';
      const confidence = clamp(56 + Math.abs(raw) * 70, 56, 78);
      return { agentName: 'Contexto', pick, confidence: Math.round(confidence), bullets } satisfies OuAgentOpinion;
    })();

    const agents: OuAgentOpinion[] = [agentForma, agentDefesa, agentContexto];

    const consensus = (() => {
      const toScore = (p: OuPick) => (p === 'OVER' ? 1 : 0);
      const weights = [0.5, 0.25, 0.25];
      const score =
        toScore(agents[0].pick) * weights[0] + toScore(agents[1].pick) * weights[1] + toScore(agents[2].pick) * weights[2];
      const pick: OuPick = score >= 0.5 ? 'OVER' : 'UNDER';
      const confidence = clamp(58 + Math.abs(score - 0.5) * 70 + Math.abs(ouAll.overPct - 50) * 0.25, 58, 88);
      const bullets: string[] = [
        `Consenso (Over 2.5): ${(score * 100).toFixed(0)}%`,
        `Over 2.5 (amostra): ${ouAll.over}/${ouAll.total} (${ouAll.overPct.toFixed(0)}%)`,
      ];
      if (avgTotalAll !== null) bullets.push(`Média gols (amostra): ${avgTotalAll.toFixed(2)}`);
      return { pick, confidence: Math.round(confidence), bullets };
    })();

    return {
      line,
      ouHome,
      ouAway,
      ouAll,
      avgTotalHome,
      avgTotalAway,
      avgTotalAll,
      homeFor,
      homeAgainst,
      awayFor,
      awayAgainst,
      agents,
      consensus,
    };
  }, [awayAwayRows, homeHomeRows, matchOuContext, match.awayTeam, match.homeTeam]);

  return (
    <>
      <Card
        className={`overflow-hidden hover:shadow-lg transition-shadow ${
          isFinished ? 'bg-gray-100 text-gray-700 grayscale cursor-pointer' : 'cursor-pointer'
        }`}
        onClick={handleCardClick}
      >
      {/* Header com Liga e País */}
      <div
        className={`text-white px-4 py-2 flex items-center justify-between ${
          isFinished ? 'bg-gradient-to-r from-gray-600 to-gray-800' : 'bg-gradient-to-r from-blue-600 to-blue-700'
        }`}
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          <span className="font-semibold text-sm">{match.league}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-white/20 text-white border-0">
            {match.country}
          </Badge>
          {hasPrediction ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setBetfairConfirmOpen(true);
              }}
              className="p-1 rounded-md hover:bg-white/20 transition-colors"
              aria-label="Automatizar trade na Betfair"
              title="Automatizar trade na Betfair"
            >
              <img src="/utils/betfair.png" alt="Betfair" className="w-4 h-4" />
            </button>
          ) : null}
          {onRefreshMatch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefreshMatch(match.id);
              }}
              disabled={isRefreshing}
              className={`p-1 rounded-md hover:bg-white/20 transition-colors ${isRefreshing ? 'opacity-70 cursor-not-allowed' : ''}`}
              aria-label="Atualizar jogo"
              title="Atualizar jogo"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.(match.id);
            }}
            className="p-1 rounded-md hover:bg-white/20 transition-colors"
            aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Star className={`w-4 h-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-white'}`} />
          </button>
        </div>
      </div>

      {/* Informações da Partida */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>{new Date(match.date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            {liveClockLabel ? (
              <span>{liveClockLabel}</span>
            ) : (
              <span>{match.time}</span>
            )}
          </div>
        </div>

        {/* Times com Escudos */}
        {shouldShowScoreboard ? (
          <div className="grid grid-cols-[1fr_3rem] gap-x-3 gap-y-3 items-center mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={false} />
              <div className="font-medium text-lg truncate">{match.homeTeam}</div>
            </div>
            <div className="text-right text-xl font-bold text-gray-900 tabular-nums">{displayHomeScore ?? '-'}</div>

            <div className="flex items-center gap-2 min-w-0">
              <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={false} />
              <div className="font-medium text-lg truncate">{match.awayTeam}</div>
            </div>
            <div className="text-right text-xl font-bold text-gray-900 tabular-nums">{displayAwayScore ?? '-'}</div>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={true} />
            <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={true} />
          </div>
        )}

        {isLive || bttsOpportunity ? (
          <div className="mb-4 flex justify-end gap-2">
            {bttsOpportunity ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                BTTS SIM {Math.round(prediction!.btts.confidence)}%
              </Badge>
            ) : null}
            {isLive ? <Badge className="bg-green-100 text-green-700 border-green-300">AO VIVO</Badge> : null}
          </div>
        ) : null}

        {voteSignals ? (
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge variant="outline" className="tabular-nums">
              Casa {Math.round(voteSignals.probs.home)}%
            </Badge>
            <Badge variant="outline" className="tabular-nums">
              Fora {Math.round(voteSignals.probs.away)}%
            </Badge>
            {voteSignals.bttsYes !== null ? (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 tabular-nums">
                BTTS {voteSignals.bttsYes}%
              </Badge>
            ) : null}
            {voteSignals.over15 !== null ? (
              <Badge className="bg-blue-100 text-blue-800 border-blue-300 tabular-nums">
                Over 1.5 {voteSignals.over15}%
              </Badge>
            ) : null}
            <Badge variant="outline" className="tabular-nums">
              Lay Casa {Math.round(voteSignals.layHome)}%
            </Badge>
            <Badge variant="outline" className="tabular-nums">
              Lay Fora {Math.round(voteSignals.layAway)}%
            </Badge>
          </div>
        ) : null}

        {resultAvailable && showResult && hasPrediction && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Mercados (Pré-jogo)</div>
              <div className="text-sm font-semibold text-gray-900">
                {marketCorrect}/{marketTotal} ({marketPercent}%)
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Vencedor</div>
                  <div className="font-semibold text-sm truncate">{predictedWinner ? getPredictionLabel(predictedWinner) : '—'}</div>
                </div>
                {marketHits.winner === null ? (
                  <div className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-700">Push</div>
                ) : (
                  <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.winner ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {marketHits.winner ? 'Acertou' : 'Errou'}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Over/Under {prediction!.overUnder.line}</div>
                  <div className="font-semibold text-sm truncate">
                    {prediction!.overUnder.prediction === 'over' ? 'Over' : 'Under'}
                  </div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.overUnder ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {marketHits.overUnder ? 'Acertou' : 'Errou'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Ambos Marcam</div>
                  <div className="font-semibold text-sm truncate">
                    {prediction!.btts.prediction === 'yes' ? 'Sim' : 'Não'}
                  </div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.btts ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {marketHits.btts ? 'Acertou' : 'Errou'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Placar Exato</div>
                  <div className="font-semibold text-sm truncate">{predictedScoreText ?? '—'}</div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${scoreHit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {scoreHit ? 'Acertou' : 'Errou'}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-gray-900">Agentes</div>
                {isLoadingAgentMarkets && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Calculando...
                  </div>
                )}
              </div>

              {agentMarketSummaries && agentMarketSummaries.length > 0 && (
                <div className="space-y-2">
                  {agentMarketSummaries.map((a) => (
                    <div key={a.agentName} className="bg-gray-50 rounded p-2">
                      <div className="text-sm font-semibold text-gray-900">{a.agentName}</div>
                      <div className="mt-2 space-y-1">
                        {a.picks.map((p) => (
                          <div key={p.key} className="flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0 text-gray-700 truncate">{p.label}</div>
                            <div className="flex items-center gap-2 shrink-0">
                              <div className="text-gray-700 tabular-nums">
                                {p.total > 0 ? `${p.correct}/${p.total} (${p.percent}%)` : '—'}
                              </div>
                              {p.ok === null ? (
                                <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">Push</span>
                              ) : (
                                <span className={`px-2 py-1 rounded ${p.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                  {p.ok ? 'Acertou' : 'Errou'}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confiança da IA */}
        {hasPrediction ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">Confiança da IA</span>
              <span className={`text-sm font-semibold ${
                (prediction!.aiConfidence ?? 0) >= 80 ? 'text-green-600' :
                (prediction!.aiConfidence ?? 0) >= 60 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {prediction!.aiConfidence}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  (prediction!.aiConfidence ?? 0) >= 80 ? 'bg-green-600' :
                  (prediction!.aiConfidence ?? 0) >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                }`}
                style={{ width: `${prediction!.aiConfidence}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Gerando previsão...
          </div>
        )}

        {/* Preview de Previsões */}
        {hasPrediction && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-600 mb-1">Vencedor</div>
              <div className="font-semibold text-sm truncate">
                {getPredictionLabel(prediction!.winner.prediction)}
              </div>
              <div className="text-xs text-gray-500">{prediction!.winner.confidence}%</div>
            </div>
            
            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-600 mb-1">Over/Under {prediction!.overUnder.line}</div>
              <div className="font-semibold text-sm">
                {prediction!.overUnder.prediction === 'over' ? 'Over' : 'Under'}
              </div>
              <div className="text-xs text-gray-500">{prediction!.overUnder.confidence}%</div>
            </div>

            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-600 mb-1">Ambos Marcam</div>
              <div className="font-semibold text-sm">
                {prediction!.btts.prediction === 'yes' ? 'Sim' : 'Não'}
              </div>
              <div className="text-xs text-gray-500">{prediction!.btts.confidence}%</div>
            </div>

            <div className="bg-gray-50 p-2 rounded">
              <div className="text-xs text-gray-600 mb-1">Placar Exato</div>
              <div className="font-semibold text-sm">{prediction!.correctScore.score}</div>
              <div className="text-xs text-gray-500">{prediction!.correctScore.confidence}%</div>
            </div>
          </div>
        )}

        <button
          onClick={() => onViewDetails(match.id)}
          disabled={!hasPrediction}
          className={`w-full py-2 rounded-lg font-semibold transition-colors ${
            hasPrediction
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-200 text-gray-600 cursor-not-allowed'
          }`}
        >
          Ver Análise Completa
        </button>
      </div>
      </Card>

      <Dialog open={betfairConfirmOpen} onOpenChange={setBetfairConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Automatizar trade (Betfair)</DialogTitle>
            <DialogDescription>
              Confirmar inclusão deste jogo na lista de automação?
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 text-sm text-gray-700">
            <div className="font-semibold text-gray-900">{match.homeTeam} x {match.awayTeam}</div>
            <div className="mt-1 text-xs text-gray-600 tabular-nums">{new Date(match.date).toLocaleString('pt-BR', { hour12: false })}</div>
            <div className="mt-2 text-xs text-gray-600">
              A automação vai tentar mapear este jogo na Betfair (eventId/marketId/1X2) e preencher as odds na página Automação.
            </div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setBetfairConfirmOpen(false)}
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={async () => {
                await enqueueBetfairAutomation();
                setBetfairConfirmOpen(false);
              }}
              disabled={!hasPrediction || isEnqueueingBetfair}
              className={`px-3 py-2 rounded-md text-sm font-semibold ${
                !hasPrediction || isEnqueueingBetfair
                  ? 'bg-gray-200 text-gray-600 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              {isEnqueueingBetfair ? 'Adicionando…' : 'Automatizar'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Panorama rápido (últimos jogos)</DialogTitle>
          <DialogDescription>
            Últimos 10 jogos do mandante em casa e do visitante fora, com % de Over/Under 2.5 gols.
          </DialogDescription>
        </DialogHeader>

        {formError && !isLoadingForm ? (
          <Card className="p-3 border border-red-200 bg-red-50 text-red-900">
            {formError}
          </Card>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="sm" showName={false} />
                <div className="font-semibold text-gray-900 leading-tight break-words">{match.homeTeam}</div>
              </div>
              <Badge variant="outline">Casa</Badge>
            </div>

            {homeHomeRows ? (
              <>
                {(() => {
                  const ou = calcOu(homeHomeRows, 2.5);
                  return (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                        <div className="text-gray-700">Mais de 2,5</div>
                        <div className="tabular-nums">{ou.overPct.toFixed(2)}%</div>
                        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full bg-green-600" style={{ width: `${ou.overPct}%` }} />
                        </div>
                        <div className="text-right tabular-nums font-semibold text-gray-700">{ou.over}</div>
                      </div>
                      <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                        <div className="text-gray-700">Menos de 2,5</div>
                        <div className="tabular-nums">{ou.underPct.toFixed(2)}%</div>
                        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full bg-green-600" style={{ width: `${ou.underPct}%` }} />
                        </div>
                        <div className="text-right tabular-nums font-semibold text-gray-700">{ou.under}</div>
                      </div>
                    </div>
                  );
                })()}

                <ScrollArea className="mt-4 h-72 border border-gray-200 rounded-lg">
                  {homeHomeRows.length === 0 ? (
                    <div className="p-3 text-sm text-gray-600">Sem dados suficientes.</div>
                  ) : (
                    <div>
                      {(() => {
                        const map = new Map<string, FormMatchRow[]>();
                        for (const r of homeHomeRows) {
                          const k = formatMonthGroup(r.utcDate);
                          map.set(k, [...(map.get(k) ?? []), r]);
                        }
                        return Array.from(map.entries()).map(([label, rows]) => (
                          <div key={label}>
                            <div className="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-700 tabular-nums">{label}</div>
                            <div className="divide-y">
                              {rows.map((r, idx) => (
                                <div
                                  key={r.id}
                                  className={`px-3 py-2 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                                >
                                  <div className="flex items-center justify-between gap-3 text-[11px] text-gray-600">
                                    <div className="tabular-nums shrink-0">{formatDay(r.utcDate)}</div>
                                    <div className="min-w-0 truncate font-semibold text-gray-700">{r.league || '—'}</div>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-3">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="shrink-0">
                                          <TeamLogo teamName={r.homeTeam} logoUrl={r.homeLogoUrl} size="sm" showName={false} />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6}>
                                        {r.homeTeam}
                                      </TooltipContent>
                                    </Tooltip>

                                    <div className="text-center font-bold tabular-nums text-gray-900">
                                      {r.homeGoals} × {r.awayGoals}
                                    </div>

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="shrink-0">
                                          <TeamLogo teamName={r.awayTeam} logoUrl={r.awayLogoUrl} size="sm" showName={false} />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6}>
                                        {r.awayTeam}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </ScrollArea>
              </>
            ) : (
              <div className="mt-3 text-sm text-gray-600 flex items-center gap-2">
                <Loader2 className={`w-4 h-4 ${isLoadingForm ? 'animate-spin' : ''}`} />
                {isLoadingForm ? 'Carregando...' : formError || '—'}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-gray-900">Panorama do jogo</div>
              {ouPanel ? (
                <Badge
                  className={
                    ouPanel.consensus.pick === 'OVER'
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }
                >
                  {ouPanel.consensus.pick} 2.5
                </Badge>
              ) : (
                <Badge variant="outline">—</Badge>
              )}
            </div>

            {ouPanel ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-600">Classificação dos agentes</div>
                    <div
                      className={`text-3xl font-bold tabular-nums tracking-tight ${
                        ouPanel.consensus.pick === 'OVER' ? 'text-green-700' : 'text-blue-700'
                      }`}
                    >
                      {ouPanel.consensus.pick} 2.5
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-600">Confiança</div>
                    <div className="text-2xl font-bold tabular-nums text-gray-900">{ouPanel.consensus.confidence}%</div>
                  </div>
                </div>

                <div className="text-sm text-gray-700 tabular-nums">
                  Over {ouPanel.ouAll.overPct.toFixed(0)}% • Under {ouPanel.ouAll.underPct.toFixed(0)}% (amostra)
                </div>

                {matchOuContext ? (
                  <div className="text-xs text-gray-600">
                    {(matchOuContext.leagueType || matchOuContext.round) && (
                      <div className="tabular-nums">
                        {matchOuContext.leagueType ? `Tipo: ${matchOuContext.leagueType}` : 'Tipo: —'}
                        {matchOuContext.round ? ` • ${matchOuContext.round}` : ''}
                      </div>
                    )}
                    {matchOuContext.tableSize && (matchOuContext.homeStanding?.rank || matchOuContext.awayStanding?.rank) ? (
                      <div className="tabular-nums">
                        Tabela: {match.homeTeam} {matchOuContext.homeStanding?.rank ? `${matchOuContext.homeStanding.rank}º` : '—'} /{' '}
                        {matchOuContext.tableSize} • {match.awayTeam}{' '}
                        {matchOuContext.awayStanding?.rank ? `${matchOuContext.awayStanding.rank}º` : '—'} / {matchOuContext.tableSize}
                      </div>
                    ) : (
                      <div>Tabela: indisponível.</div>
                    )}
                  </div>
                ) : null}

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 text-xs font-bold text-gray-700">Agentes</div>
                  <div className="divide-y">
                    {ouPanel.agents.map((a) => (
                      <div key={a.agentName} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-gray-900">{a.agentName}</div>
                          <div className="flex items-center gap-2">
                            <Badge
                              className={
                                a.pick === 'OVER'
                                  ? 'bg-green-100 text-green-800 border-green-300'
                                  : 'bg-blue-100 text-blue-800 border-blue-300'
                              }
                            >
                              {a.pick} 2.5
                            </Badge>
                            <div className="text-xs text-gray-600 tabular-nums">{a.confidence}%</div>
                          </div>
                        </div>
                        <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                          {a.bullets.slice(0, 3).map((b, idx) => (
                            <div key={`${a.agentName}:${idx}`}>{b}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-gray-600 flex items-center gap-2">
                <Loader2 className={`w-4 h-4 ${isLoadingForm ? 'animate-spin' : ''}`} />
                {isLoadingForm ? 'Carregando...' : formError || 'Sem dados suficientes.'}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="sm" showName={false} />
                <div className="font-semibold text-gray-900 leading-tight break-words">{match.awayTeam}</div>
              </div>
              <Badge variant="outline">Fora</Badge>
            </div>

            {awayAwayRows ? (
              <>
                {(() => {
                  const ou = calcOu(awayAwayRows, 2.5);
                  return (
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                        <div className="text-gray-700">Mais de 2,5</div>
                        <div className="tabular-nums">{ou.overPct.toFixed(2)}%</div>
                        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full bg-green-600" style={{ width: `${ou.overPct}%` }} />
                        </div>
                        <div className="text-right tabular-nums font-semibold text-gray-700">{ou.over}</div>
                      </div>
                      <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                        <div className="text-gray-700">Menos de 2,5</div>
                        <div className="tabular-nums">{ou.underPct.toFixed(2)}%</div>
                        <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                          <div className="h-full bg-green-600" style={{ width: `${ou.underPct}%` }} />
                        </div>
                        <div className="text-right tabular-nums font-semibold text-gray-700">{ou.under}</div>
                      </div>
                    </div>
                  );
                })()}

                <ScrollArea className="mt-4 h-72 border border-gray-200 rounded-lg">
                  {awayAwayRows.length === 0 ? (
                    <div className="p-3 text-sm text-gray-600">Sem dados suficientes.</div>
                  ) : (
                    <div>
                      {(() => {
                        const map = new Map<string, FormMatchRow[]>();
                        for (const r of awayAwayRows) {
                          const k = formatMonthGroup(r.utcDate);
                          map.set(k, [...(map.get(k) ?? []), r]);
                        }
                        return Array.from(map.entries()).map(([label, rows]) => (
                          <div key={label}>
                            <div className="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-700 tabular-nums">{label}</div>
                            <div className="divide-y">
                              {rows.map((r, idx) => (
                                <div
                                  key={r.id}
                                  className={`px-3 py-2 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                                >
                                  <div className="flex items-center justify-between gap-3 text-[11px] text-gray-600">
                                    <div className="tabular-nums shrink-0">{formatDay(r.utcDate)}</div>
                                    <div className="min-w-0 truncate font-semibold text-gray-700">{r.league || '—'}</div>
                                  </div>
                                  <div className="mt-1 flex items-center justify-between gap-3">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="shrink-0">
                                          <TeamLogo teamName={r.homeTeam} logoUrl={r.homeLogoUrl} size="sm" showName={false} />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6}>
                                        {r.homeTeam}
                                      </TooltipContent>
                                    </Tooltip>

                                    <div className="text-center font-bold tabular-nums text-gray-900">
                                      {r.homeGoals} × {r.awayGoals}
                                    </div>

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="shrink-0">
                                          <TeamLogo teamName={r.awayTeam} logoUrl={r.awayLogoUrl} size="sm" showName={false} />
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6}>
                                        {r.awayTeam}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </ScrollArea>
              </>
            ) : (
              <div className="mt-3 text-sm text-gray-600 flex items-center gap-2">
                <Loader2 className={`w-4 h-4 ${isLoadingForm ? 'animate-spin' : ''}`} />
                {isLoadingForm ? 'Carregando...' : formError || '—'}
              </div>
            )}
          </Card>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
