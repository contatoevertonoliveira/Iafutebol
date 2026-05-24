import { Match, Prediction } from '../data/mockData';
import { TeamLogo } from './TeamLogo';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { FootballMatch } from '../services/aiAgents';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballMatch, ApiFootballService } from '../services/apiFootballService';
import { toast } from 'sonner';

const TIME_ZONE = 'America/Sao_Paulo';
const teamFixturesCache = new Map<string, { fetchedAt: number; items: ApiFootballMatch[] }>();
const automationQueueCache: {
  fetchedAt: number;
  ids: Set<string>;
  byId: Map<string, any>;
  inflight: Promise<Set<string>> | null;
} = { fetchedAt: 0, ids: new Set<string>(), byId: new Map<string, any>(), inflight: null };

const getEdgeHeaders = async () => {
  const { publicAnonKey } = await import('/utils/supabase/info');
  return {
    'Content-Type': 'application/json',
    apikey: publicAnonKey,
    Authorization: `Bearer ${publicAnonKey}`,
  } as const;
};

const ensureAutomationQueueIds = async () => {
  const ttlMs = 30_000;
  const now = Date.now();
  if (automationQueueCache.inflight) return automationQueueCache.inflight;
  if (now - automationQueueCache.fetchedAt < ttlMs) return automationQueueCache.ids;

  automationQueueCache.inflight = (async () => {
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      const items = Array.isArray(data?.items) ? data.items : [];
      const ids = new Set<string>(items.map((x: any) => String(x?.matchId ?? '').trim()).filter(Boolean));
      automationQueueCache.ids = ids;
      const byId = new Map<string, any>();
      for (const it of items) {
        const mid = String((it as any)?.matchId ?? '').trim();
        if (!mid) continue;
        if (!byId.has(mid)) byId.set(mid, it);
      }
      automationQueueCache.byId = byId;
      automationQueueCache.fetchedAt = Date.now();
      return ids;
    } finally {
      automationQueueCache.inflight = null;
    }
  })();

  return automationQueueCache.inflight;
};

const broadcastAutomationQueueChanged = (payload?: { action?: 'add' | 'remove'; matchId?: string }) => {
  try {
    localStorage.setItem(
      'automation_queue_changed_v1',
      JSON.stringify({ at: new Date().toISOString(), action: payload?.action ?? null, matchId: payload?.matchId ?? null }),
    );
  } catch {}
  window.dispatchEvent(new Event('automationQueueChanged'));
};

const computeRobotTraffic = (item: any) => {
  const status = String(item?.status ?? '').trim().toLowerCase();
  if (status === 'paused') return { label: 'Em Pausa', className: 'bg-slate-200 text-slate-900 border-slate-300' };
  if (status === 'stopped') return { label: 'Parado', className: 'bg-gray-200 text-gray-700 border-gray-300' };
  if (status === 'queued') return { label: 'Na fila', className: 'bg-gray-100 text-gray-700 border-gray-300' };
  if (status !== 'running') return { label: status ? status : '—', className: 'bg-gray-100 text-gray-700 border-gray-300' };

  const agentRaw = String(item?.strategy?.agent ?? '').trim().toLowerCase();
  const agent =
    agentRaw === 'overgoalslimit' || agentRaw === 'over_goals_limit'
      ? 'overGoalsLimit'
      : agentRaw === 'scalpingticks' || agentRaw === 'scalping_ticks' || agentRaw === 'scalpinggoals' || agentRaw === 'scalping_goals' || agentRaw === 'scalping_goals_above'
        ? 'scalpingTicks'
        : 'correctScore';

  const phase = (() => {
    if (agent === 'scalpingTicks') return String(item?.strategy?.scalpingTicks?.phase ?? '').trim();
    if (agent === 'overGoalsLimit') return String(item?.strategy?.overGoalsLimit?.phase ?? '').trim();
    return String(item?.strategy?.correctScore?.lastPlan?.mode ?? item?.strategy?.correctScore?.planType ?? '').trim();
  })();

  const hasError =
    Boolean(String(item?.mappingError ?? '').trim()) ||
    String(item?.mappingStatus ?? '').trim().toLowerCase() === 'unmapped' ||
    /\berr(or)?\b|fail|invalid|exception/i.test(phase);
  if (hasError) return { label: 'Erro no Robô!', className: 'bg-red-600 text-white border-red-700' };

  const lastIso = (() => {
    if (agent === 'scalpingTicks') return String(item?.strategy?.scalpingTicks?.lastTickAt ?? item?.strategy?.scalpingGoals?.lastTickAt ?? '').trim();
    if (agent === 'overGoalsLimit') return String(item?.strategy?.overGoalsLimit?.lastTickAt ?? '').trim();
    const exec = String(item?.strategy?.correctScore?.lastExecutionAt ?? '').trim();
    if (exec) return exec;
    const plan = String(item?.strategy?.correctScore?.lastPlannedAt ?? '').trim();
    if (plan) return plan;
    return String(item?.updatedAt ?? '').trim();
  })();
  const lastMs = lastIso ? new Date(lastIso).getTime() : NaN;
  const maxAgeMs = agent === 'scalpingTicks' ? 12_000 : agent === 'overGoalsLimit' ? 20_000 : 45_000;
  if (Number.isFinite(lastMs) && Date.now() - lastMs > maxAgeMs) {
    return { label: 'Oscilando', className: 'bg-amber-200 text-amber-950 border-amber-300' };
  }

  return { label: 'Rodando', className: 'bg-emerald-200 text-emerald-950 border-emerald-300' };
};

type ApiSource = 'api-football' | 'betfair' | 'mock';

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

const calcOu = (rows: FormMatchRow[], line: number) => {
  const total = rows.length;
  const over = rows.filter((r) => r.totalGoals > line).length;
  const under = total - over;
  const overPct = total === 0 ? 0 : (over / total) * 100;
  const underPct = total === 0 ? 0 : (under / total) * 100;
  return { total, over, under, overPct, underPct };
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

type MobileMatchCardProps = {
  match: Match & {
    result?: { home: number | null; away: number | null };
    liveElapsed?: number | null;
    liveExtra?: number | null;
  };
  prediction?: Prediction | null;
  apiSource?: ApiSource;
  homeCrest?: string;
  awayCrest?: string;
  footballMatch?: FootballMatch;
  onViewDetails: (matchId: string) => void;
  onRemoveMatch?: (matchId: string) => void;
};

export function MobileMatchCard({
  match,
  prediction,
  apiSource = 'mock',
  homeCrest,
  awayCrest,
  footballMatch,
  onViewDetails,
  onRemoveMatch,
}: MobileMatchCardProps) {
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const [formOpen, setFormOpen] = useState(false);
  const [betfairConfirmOpen, setBetfairConfirmOpen] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [isEnqueueingBetfair, setIsEnqueueingBetfair] = useState(false);
  const [isInAutomation, setIsInAutomation] = useState(false);
  const [automationTraffic, setAutomationTraffic] = useState<{ label: string; className: string } | null>(null);
  const [isRemovingBetfair, setIsRemovingBetfair] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [guardMatchId, setGuardMatchId] = useState<string | null>(null);
  const [guardOrdersCount, setGuardOrdersCount] = useState(0);
  const [guardMatchedCount, setGuardMatchedCount] = useState(0);
  const [guardIsBusy, setGuardIsBusy] = useState(false);
  const [homeFormFilter, setHomeFormFilter] = useState<'all' | 'home' | 'away'>('home');
  const [awayFormFilter, setAwayFormFilter] = useState<'all' | 'home' | 'away'>('away');
  const [homeAllRows, setHomeAllRows] = useState<FormMatchRow[] | null>(null);
  const [awayAllRows, setAwayAllRows] = useState<FormMatchRow[] | null>(null);
  const [isLoadingForm, setIsLoadingForm] = useState(false);
  const [formError, setFormError] = useState<string>('');
  const [matchOuContext, setMatchOuContext] = useState<MatchOuContext | null>(null);
  const bttsOpportunity =
    Boolean(prediction) &&
    prediction?.btts?.prediction === 'yes' &&
    typeof prediction?.btts?.confidence === 'number' &&
    prediction.btts.confidence >= 75;

  useEffect(() => {
    let alive = true;
    const mid = String(match.id ?? '').trim();
    if (!mid) return;
    const refresh = () => {
      automationQueueCache.fetchedAt = 0;
      void ensureAutomationQueueIds()
        .then((ids) => {
          if (!alive) return;
          setIsInAutomation(ids.has(mid));
          const item = automationQueueCache.byId.get(mid) ?? null;
          setAutomationTraffic(item ? computeRobotTraffic(item) : null);
        })
        .catch(() => {
          if (!alive) return;
          setIsInAutomation(false);
          setAutomationTraffic(null);
        });
    };
    refresh();
    const onChanged = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'automation_queue_changed_v1') refresh();
    };
    window.addEventListener('automationQueueChanged' as any, onChanged as any);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      window.removeEventListener('automationQueueChanged' as any, onChanged as any);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  }, [match.id]);

  const enqueueBetfairAutomation = async () => {
    if (isEnqueueingBetfair) return;
    setIsEnqueueingBetfair(true);
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      let fixtureId: number | null = null;
      if (apiSource === 'api-football') {
        const fid = Number(match.id);
        fixtureId = Number.isFinite(fid) && fid > 0 ? Math.floor(fid) : null;
      } else {
        const cfg = loadApiConfig();
        const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
        if (apiFootballKey) {
          const service = new ApiFootballService(apiFootballKey);
          const resolved = await resolveTeamIdsViaFixtureDate(service, match);
          const fid = Number(resolved?.fixture?.fixture?.id);
          fixtureId = Number.isFinite(fid) && fid > 0 ? Math.floor(fid) : null;
        }
      }
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchId: match.id,
          fixtureId,
          source: apiSource,
          utcDate: match.date ? new Date(match.date).toISOString() : null,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeCrest: homeCrest || null,
          awayCrest: awayCrest || null,
          scoreHome,
          scoreAway,
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
      const mid = String(match.id ?? '').trim();
      if (mid) {
        automationQueueCache.ids.add(mid);
        automationQueueCache.fetchedAt = Date.now();
        setIsInAutomation(true);
        setAutomationTraffic({ label: 'Na fila', className: 'bg-gray-100 text-gray-700 border-gray-300' });
        broadcastAutomationQueueChanged({ action: 'add', matchId: mid });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao adicionar à automação', { description: msg.slice(0, 220) });
    } finally {
      setIsEnqueueingBetfair(false);
    }
  };

  const getAdminTokenOrToast = () => {
    const cfg = loadApiConfig();
    const adminToken = String(cfg?.automationAdminToken ?? '').trim();
    if (!adminToken) {
      toast.error('Informe o Automation Admin Token em Configurações → Betfair.');
      return null;
    }
    return adminToken;
  };

  const fetchOrdersSummary = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return null;
    const { projectId } = await import('/utils/supabase/info');
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/openOrdersSummary`,
      {
        method: 'POST',
        body: JSON.stringify({ matchId, adminToken }),
      },
    );
    const raw = await res.text().catch(() => '');
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    const openCount = Number(data?.openOrdersCount);
    const matchedCount = Number(data?.matchedBetsCount);
    const open = Number.isFinite(openCount) ? openCount : 0;
    const matched = Number.isFinite(matchedCount) ? matchedCount : 0;
    return { open, matched };
  };

  const cashoutCorrectScore = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/cashout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken }),
    });
    const raw = await res.text().catch(() => '');
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const cancelOpenOrdersCorrectScore = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/cancelOpenOrders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken }),
    });
    const raw = await res.text().catch(() => '');
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const removeFromAutomation = async (matchId: string) => {
    if (isRemovingBetfair) return false;
    setIsRemovingBetfair(true);
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/remove`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ matchId }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      automationQueueCache.ids.delete(matchId);
      automationQueueCache.fetchedAt = Date.now();
      setIsInAutomation(false);
      setAutomationTraffic(null);
      toast.success('Item removido da automação');
      broadcastAutomationQueueChanged({ action: 'remove', matchId });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao remover item', { description: msg.slice(0, 220) });
      return false;
    } finally {
      setIsRemovingBetfair(false);
    }
  };

  const handleRemoveWithChecks = async (matchId: string) => {
    try {
      const summary = await fetchOrdersSummary(matchId);
      if (summary && (summary.open > 0 || summary.matched > 0)) {
        setGuardMatchId(matchId);
        setGuardOrdersCount(summary.open);
        setGuardMatchedCount(summary.matched);
        setGuardOpen(true);
        return;
      }
      await removeFromAutomation(matchId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao checar ordens', { description: msg.slice(0, 220) });
    }
  };

  const scoreHome =
    typeof match.result?.home === 'number'
      ? match.result.home
      : typeof footballMatch?.score?.fullTime?.home === 'number'
        ? footballMatch.score.fullTime.home
        : null;
  const scoreAway =
    typeof match.result?.away === 'number'
      ? match.result.away
      : typeof footballMatch?.score?.fullTime?.away === 'number'
        ? footballMatch.score.fullTime.away
        : null;

  const liveMinute = (() => {
    if (!isLive) return null;
    if (typeof match.liveElapsed !== 'number') return null;
    const base = Math.max(0, Math.floor(match.liveElapsed));
    const extra = typeof match.liveExtra === 'number' && match.liveExtra > 0 ? match.liveExtra : null;
    if (extra) return `${base}+${extra}'`;
    return `${base}'`;
  })();

  const startsIn = (() => {
    if (isLive || isFinished) return null;
    const ms = new Date(match.date).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `COMEÇA EM ${m}MIN`;
    return `COMEÇA EM ${h}H ${m}MIN`;
  })();

  const prob = (() => {
    if (!prediction) return null;
    const winner = prediction.winner.prediction;
    const winnerConf = Math.max(0, Math.min(100, Math.round(prediction.winner.confidence)));
    const rest = 100 - winnerConf;
    const half = Math.round(rest / 2);
    const other = rest - half;

    const home = winner === 'home' ? winnerConf : winner === 'away' ? other : half;
    const away = winner === 'away' ? winnerConf : winner === 'home' ? other : half;
    const draw = winner === 'draw' ? winnerConf : rest - other;

    return { home, draw, away };
  })();

  const signals = (() => {
    if (!prediction || !prob) return null;
    const over15 =
      prediction.overUnder?.prediction === 'over' && typeof prediction.overUnder.confidence === 'number'
        ? Math.round(prediction.overUnder.confidence)
        : null;
    const bttsYes =
      prediction.btts?.prediction === 'yes' && typeof prediction.btts.confidence === 'number'
        ? Math.round(prediction.btts.confidence)
        : null;
    const layHome = Math.max(0, 100 - prob.home);
    const layAway = Math.max(0, 100 - prob.away);
    return { over15, bttsYes, layHome, layAway };
  })();

  const ahDisplay = useMemo(() => {
    const ah = prediction?.asianHandicap as any;
    if (!ah || typeof ah !== 'object') return null;
    const team = ah.team === 'away' ? ('away' as const) : ah.team === 'home' ? ('home' as const) : null;
    const lineRaw = Number(ah.line);
    const confRaw = Number(ah.confidence);
    if (!team || !Number.isFinite(lineRaw) || !Number.isFinite(confRaw)) return null;
    const lineBase = Math.abs(lineRaw % 1) < 1e-9 ? lineRaw.toFixed(0) : lineRaw.toFixed(2);
    const line = lineBase.replace(/0+$/g, '').replace(/\.$/g, '');
    const signedLine = `${lineRaw > 0 ? '+' : ''}${line}`;
    return { team, teamLabel: team === 'home' ? 'Casa' : 'Fora', signedLine, confidence: Math.round(confRaw) };
  }, [prediction]);

  useEffect(() => {
    if (!formOpen) return;
    if (homeAllRows !== null && awayAllRows !== null) return;

    const cfg = loadApiConfig();
    const apiFootballKey = String(cfg?.apiFootballKey ?? '').trim();
    if (!apiFootballKey) {
      setFormError('Configure a API-Football em Configurações para ver o histórico.');
      setHomeAllRows([]);
      setAwayAllRows([]);
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
          setHomeAllRows([]);
          setAwayAllRows([]);
          setMatchOuContext(null);
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

        const leagueIdForMatch = Number(fixtureForContext?.league?.id);
        const seasonForMatch = Number(fixtureForContext?.league?.season);
        const filterToMatchLeague = (items: ApiFootballMatch[]) => {
          let out = Array.isArray(items) ? items : [];
          if (Number.isFinite(leagueIdForMatch) && leagueIdForMatch > 0) {
            out = out.filter((m) => Number((m as any)?.league?.id) === leagueIdForMatch);
          }
          if (Number.isFinite(seasonForMatch) && seasonForMatch > 0) {
            out = out.filter((m) => Number((m as any)?.league?.season) === seasonForMatch);
          }
          return out;
        };

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

        const homeRowsAll = filterToMatchLeague(homeTeamFixtures)
          .map((m) => toFormRow(m, homeTeamId))
          .filter((v): v is FormMatchRow => Boolean(v))
          .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
          .slice(0, 30);

        const awayRowsAll = filterToMatchLeague(awayTeamFixtures)
          .map((m) => toFormRow(m, awayTeamId))
          .filter((v): v is FormMatchRow => Boolean(v))
          .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
          .slice(0, 30);

        setHomeAllRows(homeRowsAll);
        setAwayAllRows(awayRowsAll);
      } catch (e) {
        setFormError(e instanceof Error ? e.message : 'Erro ao carregar histórico');
        setHomeAllRows([]);
        setAwayAllRows([]);
        setMatchOuContext(null);
      } finally {
        setIsLoadingForm(false);
      }
    };
    void run();
  }, [apiSource, awayAllRows, footballMatch, formOpen, homeAllRows]);

  const ouPanel = useMemo(() => {
    if (!homeAllRows || !awayAllRows) return null;
    const line = 2.5;
    const pickRows = (rows: FormMatchRow[], filter: 'all' | 'home' | 'away') => {
      const out = filter === 'all' ? rows : filter === 'home' ? rows.filter((r) => r.isTeamHome) : rows.filter((r) => !r.isTeamHome);
      return out.slice(0, 10);
    };
    const homeRows = pickRows(homeAllRows, homeFormFilter);
    const awayRows = pickRows(awayAllRows, awayFormFilter);
    const ouHome = calcOu(homeRows, line);
    const ouAway = calcOu(awayRows, line);
    const combined = [...homeRows, ...awayRows];
    const ouAll = calcOu(combined, line);

    const avgTotalAll = avg(combined.map((r) => r.totalGoals));
    const homeAgainst = avg(homeRows.map((r) => r.awayGoals));
    const awayAgainst = avg(awayRows.map((r) => r.homeGoals));

    const round = matchOuContext?.round ?? null;
    const leagueType = matchOuContext?.leagueType ?? null;
    const decisive = isDecisiveRound(round);
    const isCup = String(leagueType ?? '').toLowerCase() === 'cup';

    const tableSize = matchOuContext?.tableSize ?? null;
    const hRank = matchOuContext?.homeStanding?.rank ?? null;
    const aRank = matchOuContext?.awayStanding?.rank ?? null;

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
        ],
      } satisfies OuAgentOpinion;
    })();

    const agentContexto = (() => {
      let raw = 0;
      const bullets: string[] = [];
      if (isCup) {
        raw -= 0.35;
        bullets.push('Copa: tende a ser mais amarrado.');
      }
      if (decisive && round) {
        raw -= 0.2;
        bullets.push(`Fase decisiva: ${round}.`);
      }
      const mismatch = tableSize && hRank && aRank ? Math.abs((hRank - aRank) / Math.max(1, tableSize)) >= 0.45 : false;
      if (mismatch) {
        raw += 0.18;
        bullets.push('Diferença grande de posição: pode abrir o jogo.');
      }
      const pick: OuPick = raw >= 0 ? 'OVER' : 'UNDER';
      const confidence = clamp(56 + Math.abs(raw) * 70, 56, 78);
      if (bullets.length === 0) bullets.push('Contexto neutro/indisponível.');
      return { agentName: 'Contexto', pick, confidence: Math.round(confidence), bullets } satisfies OuAgentOpinion;
    })();

    const agents: OuAgentOpinion[] = [agentForma, agentDefesa, agentContexto];
    const toScore = (p: OuPick) => (p === 'OVER' ? 1 : 0);
    const weights = [0.5, 0.25, 0.25];
    const score =
      toScore(agents[0].pick) * weights[0] + toScore(agents[1].pick) * weights[1] + toScore(agents[2].pick) * weights[2];
    const pick: OuPick = score >= 0.5 ? 'OVER' : 'UNDER';
    const confidence = clamp(58 + Math.abs(score - 0.5) * 70 + Math.abs(ouAll.overPct - 50) * 0.25, 58, 88);

    return { line, ouAll, agents, consensus: { pick, confidence: Math.round(confidence) } };
  }, [awayAllRows, awayFormFilter, homeAllRows, homeFormFilter, matchOuContext]);

  return (
    <>
      <div
        className={`rounded-2xl border shadow-sm overflow-hidden ${
          isFinished ? 'bg-gray-100 border-gray-200' : isInAutomation ? 'bg-amber-200 border-amber-400 ring-2 ring-amber-400' : 'bg-white border-gray-200'
        }`}
        onClick={() => {
          if (isFinished) return;
          setFormError('');
          setHomeFormFilter('home');
          setAwayFormFilter('away');
          setHomeAllRows(null);
          setAwayAllRows(null);
          setMatchOuContext(null);
          setFormOpen(true);
        }}
      >
      <div className="px-4 pt-4 flex items-center justify-between">
        <div className="text-xs font-semibold">
          {isLive ? (
            <span className="text-red-600">● AO VIVO{liveMinute ? ` - ${liveMinute}` : ''}</span>
          ) : startsIn ? (
            <span className="text-gray-500">{startsIn}</span>
          ) : (
            <span className="text-gray-500">{isFinished ? 'FINALIZADO' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isInAutomation ? (
            <Badge
              variant="outline"
              className={`${(automationTraffic ?? { label: 'Rodando', className: 'bg-emerald-200 text-emerald-950 border-emerald-300' }).className} text-[11px] px-2 py-0.5`}
              title={automationTraffic ? undefined : 'Status estimado (sem leitura do robô)'}
            >
              {(automationTraffic ?? { label: 'Rodando', className: '' }).label}
            </Badge>
          ) : null}
          <button
            className={`p-1 rounded-md border transition-colors ${
              isFinished
                ? 'opacity-60 cursor-not-allowed border-gray-200 bg-white'
                : isInAutomation
                  ? 'border-red-300 bg-red-50 hover:bg-red-100'
                  : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isFinished) return;
              setBetfairConfirmOpen(true);
            }}
            disabled={isFinished}
            aria-label={isInAutomation ? 'Remover da automação (Betfair)' : 'Adicionar à automação (Betfair)'}
            title={isInAutomation ? 'Remover da automação (Betfair)' : 'Adicionar à automação (Betfair)'}
          >
            <img src="/utils/betfair.png" alt="Betfair" className="w-4 h-4" />
          </button>
          {onRemoveMatch ? (
            <button
              className="p-1 rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRemoveConfirmOpen(true);
              }}
              aria-label="Remover do dashboard"
              title="Remover do dashboard"
            >
              <Trash2 className="w-4 h-4 text-gray-700" />
            </button>
          ) : null}
          {bttsOpportunity ? (
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              BTTS SIM {Math.round(prediction!.btts.confidence)}%
            </div>
          ) : null}
          <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">
            {match.league.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4">
        <div className="grid grid-cols-3 items-center">
          <div className="flex flex-col items-center gap-2 min-w-0">
            <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={false} />
            <div className="text-sm font-semibold truncate">{match.homeTeam}</div>
          </div>

          <div className="flex flex-col items-center justify-center">
            {typeof scoreHome === 'number' && typeof scoreAway === 'number' ? (
              <div className="text-4xl font-bold text-gray-900 tabular-nums">
                {scoreHome}-{scoreAway}
              </div>
            ) : (
              <div className="text-2xl font-bold text-gray-900 tabular-nums">{match.time}</div>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 min-w-0">
            <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={false} />
            <div className="text-sm font-semibold truncate">{match.awayTeam}</div>
          </div>
        </div>

        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-3">
          <div className="text-[11px] font-bold tracking-wide text-blue-700">PROBABILIDADE DE VITÓRIA (IA)</div>
          {prob ? (
            <>
              <div className="mt-2 h-2 w-full rounded-full bg-white overflow-hidden flex">
                <div className="h-full bg-blue-700" style={{ width: `${prob.home}%` }} />
                <div className="h-full bg-gray-300" style={{ width: `${prob.draw}%` }} />
                <div className="h-full bg-blue-500" style={{ width: `${prob.away}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-3 text-xs text-gray-700">
                <div className="text-left">
                  <div className="font-bold text-blue-700">{prob.home}%</div>
                  <div className="truncate">{match.homeTeam}</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-700">{prob.draw}%</div>
                  <div>Empate</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-blue-600">{prob.away}%</div>
                  <div className="truncate">{match.awayTeam}</div>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Gerando previsão...</div>
          )}
        </div>

        {signals ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {signals.bttsYes !== null ? (
              <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                BTTS {signals.bttsYes}%
              </div>
            ) : null}
            {signals.over15 !== null ? (
              <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                Over 1.5 {signals.over15}%
              </div>
            ) : null}
            {ahDisplay ? (
              <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200 tabular-nums">
                AH {ahDisplay.teamLabel} {ahDisplay.signedLine} {ahDisplay.confidence}%
              </div>
            ) : null}
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
              Lay Casa {signals.layHome}%
            </div>
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
              Lay Fora {signals.layAway}%
            </div>
          </div>
        ) : null}

        <button
          className="mt-4 w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:bg-gray-200 disabled:text-gray-600 disabled:cursor-not-allowed"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onViewDetails(match.id);
          }}
          disabled={!prediction}
        >
          Ver análise completa
        </button>
      </div>
      </div>

      <Dialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir card?</DialogTitle>
            <DialogDescription>Esse jogo será removido do dashboard.</DialogDescription>
          </DialogHeader>

          <div className="mt-2 text-sm text-gray-700">
            <div className="font-semibold text-gray-900">
              {match.homeTeam} x {match.awayTeam}
            </div>
            <div className="mt-1 text-xs text-gray-600 tabular-nums">{new Date(match.date).toLocaleString('pt-BR', { hour12: false })}</div>
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setRemoveConfirmOpen(false)}
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                setRemoveConfirmOpen(false);
                onRemoveMatch?.(match.id);
              }}
              className="px-3 py-2 rounded-md text-sm font-semibold bg-red-600 hover:bg-red-700 text-white"
            >
              Excluir
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={betfairConfirmOpen}
        onOpenChange={(v) => {
          if (isEnqueueingBetfair || isRemovingBetfair) return;
          setBetfairConfirmOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Automação (Betfair)</DialogTitle>
            <DialogDescription>{isInAutomation ? 'Este jogo já está na automação. Deseja remover?' : 'Deseja adicionar este jogo na automação?'}</DialogDescription>
          </DialogHeader>

          <div className="mt-2 text-sm text-gray-700">
            <div className="font-semibold text-gray-900">{match.homeTeam} x {match.awayTeam}</div>
            <div className="mt-1 text-xs text-gray-600 tabular-nums">{new Date(match.date).toLocaleString('pt-BR', { hour12: false })}</div>
            <div className="mt-2 text-xs text-gray-600">
              {isInAutomation
                ? 'Ao remover, o jogo sai da lista de automação.'
                : 'A automação vai tentar mapear este jogo na Betfair (eventId/marketId/1X2) e preencher as odds na página Automação.'}
            </div>
            {!prediction && !isInAutomation ? (
              <div className="mt-2 text-xs text-gray-600">Análise ainda não pronta. O jogo pode ser adicionado mesmo assim.</div>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setBetfairConfirmOpen(false)}
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm"
            >
              Cancelar
            </button>
            {isInAutomation ? (
              <button
                onClick={async () => {
                  setBetfairConfirmOpen(false);
                  await handleRemoveWithChecks(String(match.id ?? '').trim());
                }}
                disabled={isRemovingBetfair}
                className={`px-3 py-2 rounded-md text-sm font-semibold ${
                  isRemovingBetfair ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {isRemovingBetfair ? 'Removendo…' : 'Remover'}
              </button>
            ) : (
              <button
                onClick={async () => {
                  await enqueueBetfairAutomation();
                  if (!prediction) toast.message('Análise em geração', { description: 'A previsão ainda está sendo gerada; o jogo foi adicionado na automação.' });
                  setBetfairConfirmOpen(false);
                }}
                disabled={isEnqueueingBetfair}
                className={`px-3 py-2 rounded-md text-sm font-semibold ${
                  isEnqueueingBetfair ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {isEnqueueingBetfair ? 'Adicionando…' : 'Adicionar'}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={guardOpen}
        onOpenChange={(v) => {
          if (guardIsBusy) return;
          setGuardOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ordens abertas detectadas</DialogTitle>
            <DialogDescription>
              Há {guardOrdersCount} ordem(ns) aberta(s) e {guardMatchedCount} ordem(ns) executada(s) no mercado de Placar Correto. Confirme a ação.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => {
                setGuardOpen(false);
                setGuardMatchId(null);
                setGuardOrdersCount(0);
                setGuardMatchedCount(0);
              }}
              disabled={guardIsBusy}
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 text-sm"
            >
              Cancelar
            </button>

            <button
              disabled={guardIsBusy || !guardMatchId || guardMatchedCount > 0}
              onClick={async () => {
                if (!guardMatchId) return;
                setGuardIsBusy(true);
                try {
                  await cancelOpenOrdersCorrectScore(guardMatchId);
                  await removeFromAutomation(guardMatchId);
                  setGuardOpen(false);
                  toast.success('Ordens canceladas e item removido');
                } finally {
                  setGuardIsBusy(false);
                  setGuardMatchId(null);
                  setGuardOrdersCount(0);
                  setGuardMatchedCount(0);
                }
              }}
              className={`px-3 py-2 rounded-md text-sm font-semibold ${
                guardIsBusy || !guardMatchId ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-800 text-white'
              }`}
            >
              Cancelar ordens e remover
            </button>

            <button
              disabled={guardIsBusy || !guardMatchId}
              onClick={async () => {
                if (!guardMatchId) return;
                setGuardIsBusy(true);
                try {
                  await cashoutCorrectScore(guardMatchId);
                  await removeFromAutomation(guardMatchId);
                  setGuardOpen(false);
                  toast.success('Cashout enviado e item removido');
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  toast.error('Falha ao remover com cashout', { description: msg.slice(0, 220) });
                } finally {
                  setGuardIsBusy(false);
                  setGuardMatchId(null);
                  setGuardOrdersCount(0);
                  setGuardMatchedCount(0);
                }
              }}
              className={`px-3 py-2 rounded-md text-sm font-semibold ${
                guardIsBusy || !guardMatchId ? 'bg-gray-200 text-gray-600 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              Cashout e remover
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-6xl h-[82vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Panorama rápido (últimos jogos)</DialogTitle>
            <DialogDescription>
              Últimos jogos por time (Casa/Fora/Todos) dentro do mesmo campeonato, e um panorama de probabilidades.
            </DialogDescription>
          </DialogHeader>

          {formError && !isLoadingForm ? (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-900 text-sm">
              {formError}
            </div>
          ) : null}

          {homeAllRows && awayAllRows ? (
            <>
              {(() => {
                const homeRows =
                  homeFormFilter === 'all'
                    ? homeAllRows.slice(0, 10)
                    : homeFormFilter === 'home'
                      ? homeAllRows.filter((r) => r.isTeamHome).slice(0, 10)
                      : homeAllRows.filter((r) => !r.isTeamHome).slice(0, 10);
                const awayRows =
                  awayFormFilter === 'all'
                    ? awayAllRows.slice(0, 10)
                    : awayFormFilter === 'home'
                      ? awayAllRows.filter((r) => r.isTeamHome).slice(0, 10)
                      : awayAllRows.filter((r) => !r.isTeamHome).slice(0, 10);

                const ouHome = calcOu(homeRows, 2.5);
                const ouAway = calcOu(awayRows, 2.5);
                const combined = [...homeRows, ...awayRows];
                const ouAll = calcOu(combined, 2.5);
                return (
                  <div className="space-y-4">
                    <div className="grid gap-4">
                      <div className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-gray-900 leading-tight break-words">{match.homeTeam}</div>
                          <div className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">Casa</div>
                        </div>
                        <div className="mt-2 flex items-center gap-1">
                          {(['home', 'away', 'all'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                                homeFormFilter === k
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                              onClick={() => setHomeFormFilter(k)}
                            >
                              {k === 'home' ? 'Casa' : k === 'away' ? 'Fora' : 'Todos'}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                            <div className="text-gray-700">Mais de 2,5</div>
                            <div className="tabular-nums">{ouHome.overPct.toFixed(2)}%</div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-full bg-green-600" style={{ width: `${ouHome.overPct}%` }} />
                            </div>
                            <div className="text-right tabular-nums font-semibold text-gray-700">{ouHome.over}</div>
                          </div>
                          <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                            <div className="text-gray-700">Menos de 2,5</div>
                            <div className="tabular-nums">{ouHome.underPct.toFixed(2)}%</div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-full bg-green-600" style={{ width: `${ouHome.underPct}%` }} />
                            </div>
                            <div className="text-right tabular-nums font-semibold text-gray-700">{ouHome.under}</div>
                          </div>
                        </div>
                        <ScrollArea className="mt-3 h-40 border border-gray-200 rounded-lg">
                          {homeRows.length === 0 ? (
                            <div className="p-3 text-sm text-gray-600">Sem dados suficientes.</div>
                          ) : (
                            <div>
                              {(() => {
                                const map = new Map<string, FormMatchRow[]>();
                                for (const r of homeRows) {
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
                      </div>

                      <div className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-semibold text-gray-900 leading-tight break-words">{match.awayTeam}</div>
                          <div className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">Fora</div>
                        </div>
                        <div className="mt-2 flex items-center gap-1">
                          {(['home', 'away', 'all'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                                awayFormFilter === k
                                  ? 'bg-gray-900 text-white border-gray-900'
                                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                              }`}
                              onClick={() => setAwayFormFilter(k)}
                            >
                              {k === 'home' ? 'Casa' : k === 'away' ? 'Fora' : 'Todos'}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                            <div className="text-gray-700">Mais de 2,5</div>
                            <div className="tabular-nums">{ouAway.overPct.toFixed(2)}%</div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-full bg-green-600" style={{ width: `${ouAway.overPct}%` }} />
                            </div>
                            <div className="text-right tabular-nums font-semibold text-gray-700">{ouAway.over}</div>
                          </div>
                          <div className="grid grid-cols-[88px_64px_1fr_28px] items-center gap-2 text-sm">
                            <div className="text-gray-700">Menos de 2,5</div>
                            <div className="tabular-nums">{ouAway.underPct.toFixed(2)}%</div>
                            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                              <div className="h-full bg-green-600" style={{ width: `${ouAway.underPct}%` }} />
                            </div>
                            <div className="text-right tabular-nums font-semibold text-gray-700">{ouAway.under}</div>
                          </div>
                        </div>
                        <ScrollArea className="mt-3 h-40 border border-gray-200 rounded-lg">
                          {awayRows.length === 0 ? (
                            <div className="p-3 text-sm text-gray-600">Sem dados suficientes.</div>
                          ) : (
                            <div>
                              {(() => {
                                const map = new Map<string, FormMatchRow[]>();
                                for (const r of awayRows) {
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
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">Panorama do jogo</div>
                        {ouPanel ? (
                          <div
                            className={`text-xs font-semibold px-3 py-1 rounded-full border tabular-nums ${
                              ouPanel.consensus.pick === 'OVER'
                                ? 'bg-green-100 text-green-800 border-green-200'
                                : 'bg-blue-100 text-blue-800 border-blue-200'
                            }`}
                          >
                            {ouPanel.consensus.pick} 2.5 • {ouPanel.consensus.confidence}%
                          </div>
                        ) : (
                          <div className="text-xs font-semibold px-3 py-1 rounded-full border bg-gray-100 text-gray-700 border-gray-200 tabular-nums">
                            —
                          </div>
                        )}
                      </div>

                      {prediction ? (
                        <div className="mt-3">
                          <div className="text-xs text-gray-600">Possibilidades prováveis (IA)</div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <div className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-gray-100 text-gray-800 border-gray-200 tabular-nums">
                              1X2: {prediction.winner.prediction === 'home' ? 'Casa' : prediction.winner.prediction === 'away' ? 'Fora' : 'Empate'}{' '}
                              {Math.round(prediction.winner.confidence)}%
                            </div>
                            <div className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-gray-100 text-gray-800 border-gray-200 tabular-nums">
                              OU {Number(prediction.overUnder.line).toFixed(1)}: {prediction.overUnder.prediction === 'over' ? 'Over' : 'Under'}{' '}
                              {Math.round(prediction.overUnder.confidence)}%
                            </div>
                            <div className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-gray-100 text-gray-800 border-gray-200 tabular-nums">
                              BTTS: {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'} {Math.round(prediction.btts.confidence)}%
                            </div>
                            <div className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-gray-100 text-gray-800 border-gray-200 tabular-nums">
                              Placar: {prediction.correctScore.score} {Math.round(prediction.correctScore.confidence)}%
                            </div>
                            {ahDisplay ? (
                              <div className="text-[11px] font-semibold px-2 py-1 rounded-full border bg-orange-100 text-orange-800 border-orange-200 tabular-nums">
                                AH: {ahDisplay.teamLabel} ({ahDisplay.signedLine}) {ahDisplay.confidence}%
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      {ouPanel ? (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm text-gray-700 tabular-nums">
                            Over {ouAll.overPct.toFixed(0)}% • Under {ouAll.underPct.toFixed(0)}% (amostra)
                          </div>

                          <div className="text-[11px] text-gray-600">
                            {matchOuContext?.leagueType || matchOuContext?.round ? (
                              <div className="tabular-nums">
                                {matchOuContext?.leagueType ? `Tipo: ${matchOuContext.leagueType}` : 'Tipo: —'}
                                {matchOuContext?.round ? ` • ${matchOuContext.round}` : ''}
                              </div>
                            ) : null}
                            {matchOuContext?.tableSize &&
                            (matchOuContext.homeStanding?.rank || matchOuContext.awayStanding?.rank) ? (
                              <div className="tabular-nums">
                                Tabela: {match.homeTeam}{' '}
                                {matchOuContext.homeStanding?.rank ? `${matchOuContext.homeStanding.rank}º` : '—'} /{' '}
                                {matchOuContext.tableSize} • {match.awayTeam}{' '}
                                {matchOuContext.awayStanding?.rank ? `${matchOuContext.awayStanding.rank}º` : '—'} /{' '}
                                {matchOuContext.tableSize}
                              </div>
                            ) : (
                              <div>Tabela: indisponível.</div>
                            )}
                          </div>

                          <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-700">Agentes</div>
                            <div className="divide-y">
                              {ouPanel.agents.map((a) => (
                                <div key={a.agentName} className="px-3 py-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-semibold text-gray-900">{a.agentName}</div>
                                    <div
                                      className={`text-[11px] font-semibold px-2 py-1 rounded-full border tabular-nums ${
                                        a.pick === 'OVER'
                                          ? 'bg-green-100 text-green-800 border-green-200'
                                          : 'bg-blue-100 text-blue-800 border-blue-200'
                                      }`}
                                    >
                                      {a.pick} 2.5 • {a.confidence}%
                                    </div>
                                  </div>
                                  <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                                    {a.bullets.slice(0, 2).map((b, idx) => (
                                      <div key={`${a.agentName}:${idx}`}>{b}</div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="text-sm text-gray-600 flex items-center gap-2">
              <Loader2 className={`w-4 h-4 ${isLoadingForm ? 'animate-spin' : ''}`} />
              {isLoadingForm ? 'Carregando...' : formError || '—'}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
