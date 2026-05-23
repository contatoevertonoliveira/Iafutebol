import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Activity, Eye, Pause, Play, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { cn } from '../components/ui/utils';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { loadApiConfig, saveApiConfig } from '../services/apiConfig';
import { useApiFootballLiveUpdates } from '../services/apiFootballService';

type QueueStatus = 'queued' | 'running' | 'paused' | 'stopped' | string;

type AutomationMarketToggle = {
  key: string;
  label: string;
  enabled: boolean;
  details?: string | null;
};

type QueueItem = {
  matchId: string;
  source: string | null;
  utcDate: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeCrest?: string | null;
  awayCrest?: string | null;
  scoreHome?: number | null;
  scoreAway?: number | null;
  live?: {
    provider?: string | null;
    elapsed?: number | null;
    extra?: number | null;
    statusShort?: string | null;
    fetchedAt?: string | null;
  } | null;
  prediction: unknown;
  markets?: AutomationMarketToggle[];
  createdAt: string;
  updatedAt?: string;
  status: QueueStatus;
  mappingStatus?: 'pending' | 'mapped' | 'unmapped' | string;
  mappingError?: string | null;
  betfair?: {
    eventId?: string | null;
    eventName?: string | null;
    marketId?: string | null;
    marketStartTime?: string | null;
    inPlay?: boolean;
    inPlaySince?: string | null;
    marketStatus?: string | null;
    publishTime?: string | null;
    matchedVolume?: number | null;
    runners?: {
      homeSelectionId?: number | null;
      drawSelectionId?: number | null;
      awaySelectionId?: number | null;
    };
    odds?: {
      home?: { back?: number | null; backSize?: number | null; lay?: number | null; laySize?: number | null };
      draw?: { back?: number | null; backSize?: number | null; lay?: number | null; laySize?: number | null };
      away?: { back?: number | null; backSize?: number | null; lay?: number | null; laySize?: number | null };
    };
    correctScore?: { marketId?: string | null } | null;
    oddsFetchedAt?: string | null;
  } | null;
  strategy?: {
    agent?: string | null;
    correctScore?: {
      planType?: string | null;
      lastPlan?: any;
      lastPlannedAt?: string | null;
      lastExecutionAt?: string | null;
      lastExecution?: any;
      lastCashoutAt?: string | null;
      adoptedExistingAt?: string | null;
      adoptedExisting?: any;
    } | null;
    scalpingGoals?: {
      phase?: string | null;
      lastTickAt?: string | null;
      adoptedExistingAt?: string | null;
      adoptedExisting?: any;
    } | null;
  } | null;
};

type BotOrderRow = {
  key: string;
  matchId: string;
  agent: string | null;
  betId: string | null;
  customerRef: string | null;
  placedAt: string | null;
  marketId: string | null;
  side: 'BACK' | 'LAY' | null;
  price: number | null;
  sizeMatched: number | null;
  sizeRemaining: number | null;
  averagePriceMatched: number | null;
  status: string | null;
  error: string | null;
  updatedAt: string;
};

type MatchStatus = 'scheduled' | 'live' | 'finished';

const TIME_ZONE = 'America/Sao_Paulo';

const toMatchStatus = (status: string | null | undefined): MatchStatus => {
  const normalized = String(status || '').toUpperCase();
  if (['FINISHED', 'FT', 'AET', 'PEN'].includes(normalized)) return 'finished';
  if (['IN_PLAY', 'PAUSED', 'BREAK', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'SUSPENDED', 'INTERRUPTED'].includes(normalized)) return 'live';
  return 'scheduled';
};

const statusLabel = (s: QueueStatus) => {
  if (s === 'queued') return 'Na fila';
  if (s === 'running') return 'Rodando';
  if (s === 'paused') return 'Pausado';
  if (s === 'stopped') return 'Parado';
  return s ? String(s) : '—';
};

const statusVariant = (s: QueueStatus) => {
  if (s === 'running') return 'default';
  if (s === 'paused') return 'secondary';
  if (s === 'stopped') return 'destructive';
  return 'outline';
};

const robotTrafficBadge = (
  x: {
    status: QueueStatus;
    mappingError?: string | null;
    mappingStatus?: string | null;
    strategy?: any;
    updatedAt?: string | null;
  },
  nowMs: number,
) => {
  const status = String(x?.status ?? '').trim().toLowerCase();
  if (status === 'paused') {
    return { label: 'Em Pausa', variant: 'outline' as const, className: 'bg-slate-200 text-slate-900 border-slate-300', title: '' };
  }
  if (status === 'stopped') {
    return { label: 'Parado', variant: 'outline' as const, className: 'bg-gray-200 text-gray-700 border-gray-300', title: '' };
  }
  if (status === 'queued') {
    return { label: 'Na fila', variant: 'outline' as const, className: 'bg-gray-100 text-gray-700 border-gray-300', title: '' };
  }
  if (status !== 'running') {
    return { label: statusLabel(x.status), variant: 'outline' as const, className: 'bg-gray-100 text-gray-700 border-gray-300', title: '' };
  }

  const agentRaw = String(x?.strategy?.agent ?? '').trim().toLowerCase();
  const agent =
    agentRaw === 'overgoalslimit' || agentRaw === 'over_goals_limit'
      ? 'overGoalsLimit'
      : agentRaw === 'scalpinggoals' || agentRaw === 'scalping_goals' || agentRaw === 'scalping_goals_above'
        ? 'scalpingGoals'
        : agentRaw === 'scalpingticks' || agentRaw === 'scalping_ticks'
          ? 'scalpingTicks'
          : agentRaw === 'asianhandicap' || agentRaw === 'asian_handicap' || agentRaw === 'handicap_asiatico' || agentRaw === 'handicapasiatico'
            ? 'asianHandicap'
            : 'correctScore';

  const agentPhase = (() => {
    if (agent === 'scalpingGoals') return String(x?.strategy?.scalpingGoals?.phase ?? '').trim();
    if (agent === 'scalpingTicks') return String((x as any)?.strategy?.scalpingTicks?.phase ?? '').trim();
    if (agent === 'overGoalsLimit') return String((x as any)?.strategy?.overGoalsLimit?.phase ?? '').trim();
    if (agent === 'asianHandicap') return String((x as any)?.strategy?.asianHandicap?.phase ?? '').trim();
    return String(x?.strategy?.correctScore?.lastPlan?.mode ?? x?.strategy?.correctScore?.planType ?? '').trim();
  })();

  const hasRobotError =
    Boolean(String(x?.mappingError ?? '').trim()) ||
    String(x?.mappingStatus ?? '').trim().toLowerCase() === 'unmapped' ||
    /\berr(or)?\b|fail|invalid|exception/i.test(agentPhase);

  if (hasRobotError) {
    const msg = String(x?.mappingError ?? agentPhase ?? '').trim();
    return { label: 'Erro no Robô!', variant: 'destructive' as const, className: '', title: msg.slice(0, 240) };
  }

  const lastActivityIso = (() => {
    if (agent === 'scalpingGoals') return String(x?.strategy?.scalpingGoals?.lastTickAt ?? '').trim();
    if (agent === 'scalpingTicks') return String((x as any)?.strategy?.scalpingTicks?.lastTickAt ?? '').trim();
    if (agent === 'overGoalsLimit') return String((x as any)?.strategy?.overGoalsLimit?.lastTickAt ?? '').trim();
    if (agent === 'asianHandicap') return String((x as any)?.strategy?.asianHandicap?.lastTickAt ?? '').trim();
    const exec = String(x?.strategy?.correctScore?.lastExecutionAt ?? '').trim();
    if (exec) return exec;
    const plan = String(x?.strategy?.correctScore?.lastPlannedAt ?? '').trim();
    if (plan) return plan;
    return String(x?.updatedAt ?? '').trim();
  })();

  const lastActivityMs = lastActivityIso ? new Date(lastActivityIso).getTime() : NaN;
  const maxAgeMs =
    agent === 'scalpingTicks'
      ? 12_000
      : agent === 'scalpingGoals'
        ? 20_000
        : agent === 'overGoalsLimit' || agent === 'asianHandicap'
          ? 20_000
          : 45_000;

  if (Number.isFinite(lastActivityMs) && nowMs - lastActivityMs > maxAgeMs) {
    const ageSec = Math.floor((nowMs - lastActivityMs) / 1000);
    return {
      label: 'Oscilando',
      variant: 'outline' as const,
      className: 'bg-amber-200 text-amber-950 border-amber-300',
      title: `Sem atividade há ${ageSec}s`,
    };
  }

  return { label: 'Rodando', variant: 'outline' as const, className: 'bg-emerald-200 text-emerald-950 border-emerald-300', title: '' };
};

const formatMoneyBR = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatOdd = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const v = Math.round(value * 100) / 100;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
};

const formatSize = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const v = Math.round(value);
  return formatMoneyBR(v);
};

function TeamCrest({ src, name }: { src: string | null | undefined; name: string | null | undefined }) {
  const label = String(name ?? '').trim() || '—';
  const url = String(src ?? '').trim() || '';
  const fallback = label
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t[0]?.toUpperCase())
    .join('');

  const cappedSources = useMemo(() => {
    const buildTeamBaseCandidates = (teamName: string) => {
      const raw = String(teamName ?? '').trim();
      if (!raw) return [];

      const stripDiacritics = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      const ascii = stripDiacritics(normalized);

      const normalizeKey = (v: string) =>
        stripDiacritics(String(v ?? '').toLowerCase())
          .replace(/['’]/g, '')
          .replace(/[()]/g, '')
          .replace(/[^0-9a-z\s._-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const key = normalizeKey(normalized);

      const heurAliases = (() => {
        if (key.includes('mainz')) return ['fsv_mainz_05', 'mainz_05', 'mainz'];
        if (key.includes('hoffenheim')) return ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'];
        return [] as string[];
      })();

      const aliasMap: Record<string, string[]> = {
        mainz: ['fsv_mainz_05', 'mainz_05', 'mainz'],
        hoffenheim: ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'],
        '1899 hoffenheim': ['1899_hoffenheim', 'hoffenheim'],
        'tsg hoffenheim': ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'],
        'fsv mainz 05': ['fsv_mainz_05', 'mainz_05', 'mainz'],
      };

      const aliases = [...(aliasMap[key] ?? []), ...heurAliases];

      const prefixTokens = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ud', 'afc', 'cfc', 'sv', 'fsv', 'vfb', 'vfl', 'tsg', 'ssc', 'tsv', 'ksv', 'ssv', 'rc']);

      const suffixNoise = (t: string) => {
        const v = String(t ?? '').trim().toLowerCase();
        if (!v) return false;
        if (/^u\d{1,2}$/.test(v)) return true;
        if (['ii', 'iii', 'iv', 'b', 'w', 'women', 'feminino', 'fem', 'reserves', 'reserve'].includes(v)) return true;
        return false;
      };

      const tokenize = (v: string) =>
        String(v ?? '')
          .toLowerCase()
          .replace(/['’]/g, '')
          .replace(/[()]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .split(/[\s_]+/g)
          .map((x) => x.trim())
          .filter(Boolean);

      const toDisplay = (tokens: string[]) => tokens.join(' ').trim();

      const compactNumberPrefix = (tokens: string[]) => {
        const t0 = tokens[0] ?? '';
        const t1 = tokens[1] ?? '';
        if (/^\d+$/.test(t0) && prefixTokens.has(t1)) {
          return [`${t0}.${t1}`, ...tokens.slice(2)];
        }
        return tokens;
      };

      const stripPrefix = (tokens: string[]) => {
        if (tokens.length === 0) return tokens;
        const t0 = tokens[0] ?? '';
        if (prefixTokens.has(t0)) return tokens.slice(1);
        return tokens;
      };

      const stripSuffixes = (tokens: string[]) => {
        const copy = [...tokens];
        while (copy.length > 1 && suffixNoise(copy[copy.length - 1] ?? '')) copy.pop();
        return copy;
      };

      const variants = new Set<string>();
      const push = (v: string) => {
        const s = String(v ?? '').trim();
        if (s) variants.add(s);
      };

      for (const a of aliases) push(String(a).trim());
      push(normalized);
      push(ascii);

      const addTokenVariants = (tokens: string[]) => {
        push(toDisplay(tokens));
        push(toDisplay(stripSuffixes(tokens)));
        push(toDisplay(stripPrefix(tokens)));
        push(toDisplay(stripSuffixes(stripPrefix(tokens))));
        push(toDisplay(compactNumberPrefix(tokens)));
        push(toDisplay(stripSuffixes(compactNumberPrefix(tokens))));
      };

      addTokenVariants(tokenize(normalized));
      addTokenVariants(tokenize(ascii));

      const toFileBase = (s: string) =>
        String(s ?? '')
          .normalize('NFC')
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^0-9a-zA-Z\u00C0-\u024F\u1E00-\u1EFF._-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '');

      const out = Array.from(variants)
        .map((v) => toFileBase(v))
        .filter(Boolean);

      const outAscii = out.map((v) => stripDiacritics(v)).filter(Boolean);

      const dotless = out.map((v) => v.replace(/\./g, '')).filter(Boolean);
      const dotlessAscii = dotless.map((v) => stripDiacritics(v)).filter(Boolean);

      return Array.from(new Set([...out, ...outAscii, ...dotless, ...dotlessAscii]));
    };

    const localCandidates = buildTeamBaseCandidates(label).flatMap((b) => [
      encodeURI(`/assets/times/${b}.png`),
      encodeURI(`/assets/times/${b}.svg`),
      encodeURI(`/assets/times/${b}.webp`),
    ]);

    const sources = Array.from(new Set([...(localCandidates || []), ...(url ? [encodeURI(url)] : [])].filter(Boolean)));
    return sources.slice(0, 40);
  }, [label, url]);

  const [sourceIndex, setSourceIndex] = useState(0);
  const currentSrc = cappedSources[sourceIndex] ?? '';

  useEffect(() => {
    setSourceIndex(0);
  }, [cappedSources]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {currentSrc ? (
          <img
            src={currentSrc}
            alt={label}
            className="w-6 h-6 rounded-sm object-contain bg-white border border-gray-200"
            onError={() => {
              setSourceIndex((prev) => {
                const next = prev + 1;
                return next < cappedSources.length ? next : cappedSources.length;
              });
            }}
          />
        ) : (
          <div className="w-6 h-6 rounded-sm bg-gray-100 border border-gray-200 text-[10px] font-bold text-gray-700 flex items-center justify-center">
            {fallback || '—'}
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function AutomationPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const itemsRef = useRef<QueueItem[]>([]);
  const finishedStopSentRef = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [view, setView] = useState<'all' | 'live' | 'today' | 'tomorrow' | 'next'>('all');
  const [isTestMode, setIsTestMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('automation_test_mode_v1') === '1';
    } catch {
      return false;
    }
  });
  const testModeInitRef = useRef(false);
  const isTestModeRef = useRef(isTestMode);
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [marketsItemId, setMarketsItemId] = useState<string | null>(null);
  const [marketsDraft, setMarketsDraft] = useState<AutomationMarketToggle[]>([]);
  const [marketsSaveBusy, setMarketsSaveBusy] = useState(false);
  const [csPlanType, setCsPlanType] = useState<'coverage' | 'ladder_volume'>('coverage');
  const [robotType, setRobotType] = useState<'correctScore' | 'scalpingGoals' | 'overGoalsLimit' | 'scalpingTicks' | 'asianHandicap'>(
    'correctScore',
  );
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const [startConfirmItem, setStartConfirmItem] = useState<QueueItem | null>(null);
  const [startConfirmBusy, setStartConfirmBusy] = useState(false);
  const [cashoutConfirmOpen, setCashoutConfirmOpen] = useState(false);
  const [cashoutConfirmMatchId, setCashoutConfirmMatchId] = useState<string | null>(null);
  const [cashoutConfirmBusy, setCashoutConfirmBusy] = useState(false);

  const [guardOpen, setGuardOpen] = useState(false);
  const [guardMatchId, setGuardMatchId] = useState<string | null>(null);
  const [guardAction, setGuardAction] = useState<'pause' | 'remove' | null>(null);
  const [guardOrdersCount, setGuardOrdersCount] = useState<number>(0);
  const [guardMatchedCount, setGuardMatchedCount] = useState<number>(0);
  const [guardIsBusy, setGuardIsBusy] = useState(false);
  const [tradePreviewByMatchId, setTradePreviewByMatchId] = useState<
    Record<string, { risk: number | null; cashOut: number | null; profit: number | null; fetchedAt: string }>
  >({});
  const tradePreviewRef = useRef<Record<string, { risk: number | null; cashOut: number | null; profit: number | null; fetchedAt: string }>>({});
  const apiFootballLiveRef = useRef<Record<string, any>>({});
  const lastFundsSyncAtRef = useRef(0);
  const isRefreshingOddsRef = useRef(false);
  const isRefreshingTradePreviewRef = useRef(false);
  const isFastTickScalpingTicksRef = useRef(false);
  const isFastTickCorrectScoreRef = useRef(false);
  const isRefreshingBotOrdersRef = useRef(false);
  const [botOrders, setBotOrders] = useState<BotOrderRow[]>([]);
  const [botOrdersLastRefreshedAt, setBotOrdersLastRefreshedAt] = useState<string | null>(null);
  const [marketNameByMarketId, setMarketNameByMarketId] = useState<Record<string, string>>({});
  const marketNameByMarketIdRef = useRef<Record<string, string>>({});
  const lastMarketNamesFetchAtRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem('scalping_ticks_runner_mode_v1', 'page');
      localStorage.setItem('asian_handicap_runner_mode_v1', 'page');
    } catch {}
    return () => {
      try {
        localStorage.setItem('scalping_ticks_runner_mode_v1', 'layout');
        localStorage.setItem('asian_handicap_runner_mode_v1', 'layout');
      } catch {}
    };
  }, []);

  // #region debug-point A:init
  const dbg = (hypothesisId: 'A' | 'B' | 'C' | 'D' | 'E', msg: string, data?: Record<string, unknown>) => {
    // Disabled by default to avoid net::ERR_CONNECTION_REFUSED
    return;
    /*
    try {
      if (localStorage.getItem('automation_debug_enabled_v1') !== '1') return;
    } catch {
      return;
    }
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'automation-bots-no-entry',
        runId: 'post-fix',
        hypothesisId,
        location: 'AutomationPage.tsx',
        msg: `[DEBUG] ${msg}`,
        data: data ?? {},
        ts: Date.now(),
      }),
    }).catch(() => {});
    */
  };
  // #endregion

  useEffect(() => {
    isTestModeRef.current = isTestMode;
    try {
      localStorage.setItem('automation_test_mode_v1', isTestMode ? '1' : '0');
    } catch {}
    if (!testModeInitRef.current) {
      testModeInitRef.current = true;
      return;
    }
    toast[isTestMode ? 'warning' : 'success'](isTestMode ? 'Modo teste ativado' : 'Modo real ativado', {
      description: isTestMode ? 'Ao iniciar um robô, uma ordem de teste será enviada automaticamente.' : 'Robôs voltaram a operar conforme as validações normais.',
    });
  }, [isTestMode]);

  const getEdgeHeaders = async () => {
    const { publicAnonKey } = await import('/utils/supabase/info');
    return {
      'Content-Type': 'application/json',
      apikey: publicAnonKey,
      Authorization: `Bearer ${publicAnonKey}`,
    };
  };
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const clickTimersRef = useRef<Record<string, number>>({});
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<{
    matchId: string;
    marketId: string;
    marketName: string;
    selectionId: number;
    selectionName: string;
    side: 'BACK' | 'LAY';
    price: string;
    size: string;
    persistenceType: 'LAPSE' | 'PERSIST' | 'MARKET_ON_CLOSE';
  } | null>(null);
  const [isPlacingManual, setIsPlacingManual] = useState(false);
  const [marketOptionsByMatchId, setMarketOptionsByMatchId] = useState<
    Record<
      string,
      {
        fetchedAt: string;
        items: Array<{
          marketId: string;
          marketName: string;
          totalMatched: number | null;
          runners: Array<{ selectionId: number; runnerName: string }>;
        }>;
      }
    >
  >({});
  const [selectedMarketByMatchId, setSelectedMarketByMatchId] = useState<Record<string, string>>({});
  const [marketBookByMatchId, setMarketBookByMatchId] = useState<
    Record<
      string,
      {
        marketId: string;
        marketStatus: string | null;
        fetchedAt: string;
        runners: Record<
          string,
          {
            selectionId: number;
            runnerName: string;
            back: number | null;
            backSize: number | null;
            lay: number | null;
            laySize: number | null;
          }
        >;
      }
    >
  >({});
  const [loadingMarketsByMatchId, setLoadingMarketsByMatchId] = useState<Record<string, boolean>>({});
  const [loadingBookByMatchId, setLoadingBookByMatchId] = useState<Record<string, boolean>>({});

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return copy;
  }, [items]);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const tickCorrectScoreFast = async () => {
      if (isFastTickCorrectScoreRef.current) return;
      if (isTestModeRef.current) return;
      isFastTickCorrectScoreRef.current = true;
      try {
        const cfg = loadApiConfig();
        const adminToken = String(cfg?.automationAdminToken ?? '').trim();
        if (!adminToken) return;
        const bankrollTotal = Number(cfg?.betfairBankroll ?? 0);
        const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
        const correctScorePct = Number(marketPercents.correctScore ?? 10);
        const bankrollForCorrectScore =
          Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(correctScorePct) && correctScorePct > 0
            ? Math.round(((bankrollTotal * correctScorePct) / 100) * 100) / 100
            : 50;

        const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
        const lim = (robotLimits as any)?.correctScore && typeof (robotLimits as any).correctScore === 'object' ? (robotLimits as any).correctScore : {};
        const profitTargetPct = Number(lim?.minProfitPct);

        const targets = itemsRef.current
          .filter((x) => x.status === 'running')
          .filter((x) => normalizeAgent(x.strategy?.agent) === 'correctScore')
          .slice(0, 6);
        if (targets.length === 0) return;

        const { projectId } = await import('/utils/supabase/info');
        const headers = await getEdgeHeaders();

        for (const x of targets) {
          const lastTick = String((x as any).strategy?.correctScore?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 9_000) continue;

          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              config: {
                bankroll: bankrollForCorrectScore,
                ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
              },
            }),
          }).catch(() => null);

          if (tickRes && !tickRes.ok) {
            const t = await tickRes.text().catch(() => '');
            console.warn('correctScore fast tick HTTP error', { matchId: x.matchId, status: tickRes.status, body: t ? t.slice(0, 300) : '' });
          }
        }

        await loadQueue({ silent: true });
      } finally {
        isFastTickCorrectScoreRef.current = false;
      }
    };

    void tickCorrectScoreFast();
    const id = window.setInterval(() => {
      void tickCorrectScoreFast();
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    marketNameByMarketIdRef.current = marketNameByMarketId;
  }, [marketNameByMarketId]);

  useEffect(() => {
    const normalizeAgentLite = (agentRaw: unknown) => {
      const s = String(agentRaw ?? '').trim().toLowerCase();
      if (s === 'scalpingticks' || s === 'scalping_ticks') return 'scalpingTicks';
      if (s === 'scalpinggoals' || s === 'scalping_goals') return 'scalpingGoals';
      if (s === 'overgoalslimit' || s === 'over_goals_limit') return 'overGoalsLimit';
      if (s === 'asianhandicap' || s === 'asian_handicap' || s === 'handicap_asiatico' || s === 'handicapasiatico') return 'asianHandicap';
      if (s === 'favoriterescue' || s === 'favorite_rescue' || s === 'lay_favorito_perdendo') return 'favoriteRescue';
      if (s === 'correctscore' || s === 'correct_score') return 'correctScore';
      return s || null;
    };

    const extractBetIdsFromUnknown = (value: unknown) => {
      const out: string[] = [];
      const seen = new Set<unknown>();

      const walk = (v: unknown, depth: number) => {
        if (depth > 7) return;
        if (!v) return;
        if (seen.has(v)) return;

        if (typeof v === 'string') {
          const s = String(v).trim();
          if (s && /^[0-9]+$/.test(s)) out.push(s);
          return;
        }

        if (typeof v !== 'object') return;
        seen.add(v);

        if (Array.isArray(v)) {
          for (const it of v) walk(it, depth + 1);
          return;
        }

        for (const [k, raw] of Object.entries(v as any)) {
          const key = String(k ?? '').trim();
          const isBetIdKey = /(^betId$|betId$|BetId$|^betIds$)/.test(key);
          if (isBetIdKey) {
            if (Array.isArray(raw)) {
              for (const it of raw) walk(it, depth + 1);
            } else if (typeof raw === 'string') {
              const s = String(raw ?? '').trim();
              if (s) out.push(s);
            }
          } else {
            walk(raw, depth + 1);
          }
        }
      };

      walk(value, 0);
      return Array.from(new Set(out.map((s) => String(s).trim()).filter(Boolean)));
    };

    const extractMarketIdsFromItem = (x: QueueItem) => {
      const out: string[] = [];
      const base = String(x?.betfair?.marketId ?? '').trim();
      if (base) out.push(base);
      const cs = String(x?.betfair?.correctScore?.marketId ?? '').trim();
      if (cs) out.push(cs);

      const st = (x as any)?.strategy?.scalpingTicks ?? null;
      const mOver = String(st?.marketOver?.marketId ?? '').trim();
      const mUnder = String(st?.marketUnder?.marketId ?? '').trim();
      if (mOver) out.push(mOver);
      if (mUnder) out.push(mUnder);

      const og = (x as any)?.strategy?.overGoalsLimit ?? null;
      const ogMid = String(og?.entryMarketId ?? '').trim();
      if (ogMid) out.push(ogMid);

      const ah = (x as any)?.strategy?.asianHandicap ?? null;
      const ahMid = String(ah?.entryMarketId ?? '').trim();
      if (ahMid) out.push(ahMid);

      return Array.from(new Set(out.filter(Boolean)));
    };

    const buildSyntheticErrorRows = (x: QueueItem, nowIso: string) => {
      const out: BotOrderRow[] = [];
      const agent = normalizeAgentLite(x.strategy?.agent);
      const st = agent === 'scalpingTicks' ? (x as any)?.strategy?.scalpingTicks ?? null : null;
      if (!st) return out;

      const entryBetId = String(st?.entryBetId ?? '').trim() || null;
      const entryErrCode = String(st?.lastEntryErrorCode ?? '').trim() || null;
      const entryStatus = String(st?.lastEntryStatus ?? '').trim() || null;
      const entryAt = String(st?.lastEntryAt ?? st?.enteredAt ?? x.updatedAt ?? '').trim() || null;
      const entryMarketId = String(st?.entryMarketId ?? '').trim() || null;
      const entryPrice = Number(st?.entryPrice);
      const entryStake = Number(st?.stakeAbs);

      if (!entryBetId && (entryErrCode || (entryStatus && /fail|error/i.test(entryStatus)))) {
        out.push({
          key: `err-entry-${x.matchId}-${entryAt || nowIso}`,
          matchId: x.matchId,
          agent,
          betId: null,
          customerRef: null,
          placedAt: entryAt,
          marketId: entryMarketId,
          side: 'BACK',
          price: Number.isFinite(entryPrice) ? entryPrice : null,
          sizeMatched: null,
          sizeRemaining: Number.isFinite(entryStake) ? entryStake : null,
          averagePriceMatched: null,
          status: entryStatus,
          error: entryErrCode || 'Falha ao enviar entrada',
          updatedAt: nowIso,
        });
      }

      const tpBetId = String(st?.takeProfit?.betId ?? '').trim() || null;
      const tpErr = String(st?.lastTpPlaceError ?? '').trim() || null;
      const tpAt = String(st?.lastTpPlaceAt ?? '').trim() || null;
      const tpMarketId = String(st?.entryMarketId ?? '').trim() || null;
      const tpPrice = Number(st?.targetPrice ?? st?.takeProfit?.price);
      const tpSize = Number(st?.takeProfit?.size);

      if (!tpBetId && tpErr) {
        out.push({
          key: `err-tp-${x.matchId}-${tpAt || nowIso}`,
          matchId: x.matchId,
          agent,
          betId: null,
          customerRef: null,
          placedAt: tpAt,
          marketId: tpMarketId,
          side: 'LAY',
          price: Number.isFinite(tpPrice) ? tpPrice : null,
          sizeMatched: null,
          sizeRemaining: Number.isFinite(tpSize) ? tpSize : null,
          averagePriceMatched: null,
          status: 'FAILURE',
          error: tpErr,
          updatedAt: nowIso,
        });
      }

      return out;
    };

    const fetchCurrentOrders = async (args: { betIds?: string[]; marketIds?: string[] }) => {
      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      if (!adminToken) return [] as any[];
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/listCurrentOrders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          adminToken,
          ...(Array.isArray(args.betIds) && args.betIds.length > 0 ? { betIds: args.betIds } : {}),
          ...(Array.isArray(args.marketIds) && args.marketIds.length > 0 ? { marketIds: args.marketIds } : {}),
        }),
      }).catch(() => null);
      if (!res) return [] as any[];
      const raw = await res.text().catch(() => '');
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        return [] as any[];
      }
      if (!res.ok || !data?.ok) return [] as any[];
      const cur = Array.isArray(data?.result?.currentOrders) ? data.result.currentOrders : [];
      return cur;
    };

    const fetchMarketNames = async (marketIds: string[]) => {
      const mids = Array.from(new Set(marketIds.map((m) => String(m ?? '').trim()).filter(Boolean)));
      if (mids.length === 0) return;

      const now = Date.now();
      if (now - lastMarketNamesFetchAtRef.current < 25_000) return;
      lastMarketNamesFetchAtRef.current = now;

      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      const chunkSize = 40;
      const found: Record<string, string> = {};

      for (let i = 0; i < mids.length; i += chunkSize) {
        const chunk = mids.slice(i, i + chunkSize);
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            method: 'SportsAPING/v1.0/listMarketCatalogue',
            params: {
              filter: { marketIds: chunk },
              maxResults: String(Math.max(1, Math.min(200, chunk.length))),
              sort: 'MAXIMUM_TRADED',
              marketProjection: ['MARKET_DESCRIPTION'],
            },
          }),
        }).catch(() => null);
        if (!res) continue;
        const raw = await res.text().catch(() => '');
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          continue;
        }
        if (!res.ok || !data?.ok) continue;
        const rows = Array.isArray(data?.result) ? data.result : [];
        for (const r of rows) {
          const marketId = String(r?.marketId ?? '').trim();
          const marketName = String(r?.marketName ?? '').trim();
          if (!marketId || !marketName) continue;
          found[marketId] = marketName;
        }
      }

      const keys = Object.keys(found);
      if (keys.length === 0) return;
      setMarketNameByMarketId((prev) => ({ ...prev, ...found }));
    };

    const refreshBotOrders = async () => {
      if (isRefreshingBotOrdersRef.current) return;
      if (isTestModeRef.current) return;
      const rows = itemsRef.current;
      if (!Array.isArray(rows) || rows.length === 0) return;

      const active = rows.filter((x) => x.status === 'running' || x.status === 'paused');
      if (active.length === 0) return;

      isRefreshingBotOrdersRef.current = true;
      const nowIso = new Date().toISOString();
      try {
        const betIdToMeta = new Map<string, { matchId: string; agent: string | null }>();
        const marketIdToMeta = new Map<string, { matchId: string; agent: string | null }>();
        const betIds: string[] = [];
        const marketIds: string[] = [];
        const synthetic: BotOrderRow[] = [];

        for (const x of active) {
          const agent = normalizeAgentLite(x.strategy?.agent);
          synthetic.push(...buildSyntheticErrorRows(x, nowIso));

          const extractedBetIds = extractBetIdsFromUnknown(x?.strategy ?? null);
          for (const bid of extractedBetIds) {
            const s = String(bid ?? '').trim();
            if (!s) continue;
            if (!betIdToMeta.has(s)) betIdToMeta.set(s, { matchId: x.matchId, agent });
            betIds.push(s);
          }

          const extractedMarketIds = extractMarketIdsFromItem(x);
          for (const mid of extractedMarketIds) {
            const s = String(mid ?? '').trim();
            if (!s) continue;
            if (!marketIdToMeta.has(s)) marketIdToMeta.set(s, { matchId: x.matchId, agent });
            marketIds.push(s);
          }
        }

        const uniqBetIds = Array.from(new Set(betIds)).slice(0, 220);
        const uniqMarketIds = Array.from(new Set(marketIds)).slice(0, 40);
        const known = marketNameByMarketIdRef.current ?? {};
        const missingMarketIds = uniqMarketIds.filter((m) => !known[String(m ?? '').trim()]);

        const chunk = (arr: string[], size: number) => {
          const out: string[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        const currentOrders: any[] = [];
        for (const part of chunk(uniqBetIds, 75)) {
          const cur = await fetchCurrentOrders({ betIds: part });
          currentOrders.push(...cur);
        }
        if (uniqMarketIds.length > 0) {
          const cur = await fetchCurrentOrders({ marketIds: uniqMarketIds });
          currentOrders.push(...cur);
        }

        if (missingMarketIds.length > 0) {
          await fetchMarketNames(missingMarketIds);
        }

        setBotOrders((prev) => {
          const byKey = new Map<string, BotOrderRow>();
          for (const p of prev) byKey.set(p.key, p);

          for (const o of currentOrders) {
            const betId = String(o?.betId ?? '').trim() || null;
            if (!betId) continue;
            const marketId = String(o?.marketId ?? '').trim() || null;
            const meta = (betId ? betIdToMeta.get(betId) : null) ?? (marketId ? marketIdToMeta.get(marketId) : null) ?? null;
            const matchId = meta?.matchId ?? '';
            const agent = meta?.agent ?? null;

            const placedAt = String(o?.placedDate ?? o?.placedAt ?? '').trim() || null;
            const customerRef = String(o?.customerOrderRef ?? o?.customerRef ?? '').trim() || null;
            const sideRaw = String(o?.side ?? '').trim().toUpperCase();
            const side = sideRaw === 'LAY' ? 'LAY' : sideRaw === 'BACK' ? 'BACK' : null;
            const priceRaw = Number(o?.priceSize?.price ?? o?.price);
            const price = Number.isFinite(priceRaw) && priceRaw > 1 ? priceRaw : null;
            const sizeMatchedRaw = Number(o?.sizeMatched);
            const sizeMatched = Number.isFinite(sizeMatchedRaw) ? sizeMatchedRaw : null;
            const sizeRemainingRaw = Number(o?.sizeRemaining);
            const sizeRemaining = Number.isFinite(sizeRemainingRaw) ? sizeRemainingRaw : null;
            const avgPriceMatchedRaw = Number(o?.averagePriceMatched);
            const averagePriceMatched = Number.isFinite(avgPriceMatchedRaw) ? avgPriceMatchedRaw : null;
            const status = String(o?.status ?? '').trim().toUpperCase() || null;

            const next: BotOrderRow = {
              key: betId,
              matchId: matchId || '—',
              agent,
              betId,
              customerRef,
              placedAt,
              marketId,
              side,
              price,
              sizeMatched,
              sizeRemaining,
              averagePriceMatched,
              status,
              error: null,
              updatedAt: nowIso,
            };
            byKey.set(next.key, next);
          }

          for (const s of synthetic) byKey.set(s.key, s);

          return Array.from(byKey.values())
            .filter((r) => Boolean(r.matchId))
            .sort((a, b) => String(b.placedAt ?? b.updatedAt).localeCompare(String(a.placedAt ?? a.updatedAt)));
        });
        setBotOrdersLastRefreshedAt(nowIso);
      } finally {
        isRefreshingBotOrdersRef.current = false;
      }
    };

    void refreshBotOrders();
    const id = window.setInterval(() => void refreshBotOrders(), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const apiFootballLiveFixtureIds = useMemo(() => {
    return items
      .filter((x) => x.status !== 'stopped')
      .filter((x) => {
        const marketStatus = String(x.betfair?.marketStatus ?? '').toUpperCase();
        if (String(x.betfair?.marketId ?? '').trim() && marketStatus === 'CLOSED') return false;
        return true;
      })
      .map((x) => Number(x.matchId))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 80);
  }, [items]);

  const apiFootballLiveDetailedFixtureIds = useMemo(() => {
    return items
      .filter((x) => x.status === 'running')
      .filter((x) => {
        const marketStatus = String(x.betfair?.marketStatus ?? '').toUpperCase();
        if (String(x.betfair?.marketId ?? '').trim() && marketStatus === 'CLOSED') return false;
        return true;
      })
      .map((x) => Number(x.matchId))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 12);
  }, [items]);

  const apiFootballLiveBaseRaw = useApiFootballLiveUpdates(apiFootballLiveFixtureIds, {
    enabled: apiFootballLiveFixtureIds.length > 0,
    fast: true,
  });
  const apiFootballLiveDetailedRaw = useApiFootballLiveUpdates(apiFootballLiveDetailedFixtureIds, {
    enabled: apiFootballLiveDetailedFixtureIds.length > 0,
    includeDetails: true,
    fast: true,
  });
  const apiFootballLiveRaw = useMemo(() => {
    return { ...apiFootballLiveBaseRaw, ...apiFootballLiveDetailedRaw };
  }, [apiFootballLiveBaseRaw, apiFootballLiveDetailedRaw]);

  const apiFootballLiveByMatchId = useMemo(() => {
    const out: Record<
      string,
      {
        elapsed: number | null;
        extra: number | null;
        statusShort: string | null;
        fetchedAt: string;
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
    > = {};
    for (const [id, u] of Object.entries(apiFootballLiveRaw)) {
      out[id] = {
        elapsed: u.elapsed ?? null,
        extra: u.extra ?? null,
        statusShort: u.statusShort ?? null,
        fetchedAt: u.fetchedAt,
        goalsHome: u.goalsHome ?? null,
        goalsAway: u.goalsAway ?? null,
        cardsHome: u.cardsHome ?? null,
        cardsAway: u.cardsAway ?? null,
        shotsOnGoalHome: u.shotsOnGoalHome ?? null,
        shotsOnGoalAway: u.shotsOnGoalAway ?? null,
        dangerousAttacksHome: u.dangerousAttacksHome ?? null,
        dangerousAttacksAway: u.dangerousAttacksAway ?? null,
        attacksHome: u.attacksHome ?? null,
        attacksAway: u.attacksAway ?? null,
        cornersHome: u.cornersHome ?? null,
        cornersAway: u.cornersAway ?? null,
      };
    }
    return out;
  }, [apiFootballLiveRaw]);

  useEffect(() => {
    const mode = (() => {
      try {
        return String(localStorage.getItem('favorite_rescue_runner_mode_v1') ?? '').trim().toLowerCase();
      } catch {
        return '';
      }
    })();
    if (mode !== 'layout') return;

    const feedKey = 'favorite_rescue_feed_v1';
    const nowIso = new Date().toISOString();
    const isLiveStatusShort = (s: string) => {
      const k = String(s ?? '').trim().toUpperCase();
      if (!k) return false;
      return ['1H', '2H', 'HT', 'ET', 'LIVE', 'IN_PLAY', 'INPLAY', 'PAUSED', 'BREAK', 'INT', 'SUSP', 'SUSPENDED'].includes(k);
    };
    const isFinishedStatusShort = (s: string) => {
      const k = String(s ?? '').trim().toUpperCase();
      if (!k) return false;
      return ['FT', 'AET', 'PEN', 'AWD', 'CANC', 'PST', 'ABD'].includes(k);
    };

    const itemsOut: Record<string, any> = {};
    for (const x of items) {
      const matchId = String(x.matchId ?? '').trim();
      if (!matchId) continue;
      if (x.status === 'stopped') continue;

      const apiLive = apiFootballLiveByMatchId[matchId] ?? null;
      const statusShort = String(apiLive?.statusShort ?? x.live?.statusShort ?? '').trim() || null;

      const status =
        (statusShort && isFinishedStatusShort(statusShort)) || String(x.betfair?.marketStatus ?? '').toUpperCase() === 'CLOSED'
          ? 'finished'
          : (statusShort && isLiveStatusShort(statusShort)) || Boolean(x.betfair?.inPlay) || typeof apiLive?.elapsed === 'number' || typeof x.live?.elapsed === 'number'
            ? 'live'
            : 'scheduled';

      const scoreHome =
        typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : typeof x.scoreHome === 'number' ? x.scoreHome : null;
      const scoreAway =
        typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : typeof x.scoreAway === 'number' ? x.scoreAway : null;

      const liveElapsed =
        typeof apiLive?.elapsed === 'number' ? apiLive.elapsed : typeof x.live?.elapsed === 'number' ? x.live.elapsed : null;

      itemsOut[matchId] = {
        updatedAt: nowIso,
        status,
        utcDate: typeof x.utcDate === 'string' ? x.utcDate : null,
        homeTeam: typeof x.homeTeam === 'string' ? x.homeTeam : null,
        awayTeam: typeof x.awayTeam === 'string' ? x.awayTeam : null,
        liveElapsed,
        liveStatusShort: statusShort,
        scoreHome,
        scoreAway,
        betfair: x.betfair ?? null,
      };
    }

    if (Object.keys(itemsOut).length === 0) return;

    try {
      const raw = localStorage.getItem(feedKey);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const prevItems = parsed?.version === 1 && parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
      const nextItems = { ...prevItems, ...itemsOut };
      const prunedEntries = Object.entries(nextItems)
        .map(([id, v]) => [id, v] as const)
        .filter(([, v]) => v && typeof v === 'object')
        .slice(0, 1000);
      localStorage.setItem(feedKey, JSON.stringify({ version: 1, updatedAt: nowIso, items: Object.fromEntries(prunedEntries) }));
      window.dispatchEvent(new Event('favoriteRescueFeedChanged'));
    } catch {}
  }, [apiFootballLiveByMatchId, items]);

  useEffect(() => {
    const expandedIds = Object.keys(expandedById).filter((id) => Boolean(expandedById[id]));
    if (expandedIds.length === 0) return;
    for (const matchId of expandedIds) {
      if (marketOptionsByMatchId[matchId] || loadingMarketsByMatchId[matchId]) continue;
      const x = itemsRef.current.find((it) => it.matchId === matchId) ?? null;
      if (!x) continue;
      void fetchBetfairMarketsForItem(x);
    }
  }, [expandedById, loadingMarketsByMatchId, marketOptionsByMatchId]);

  useEffect(() => {
    const ids = Object.keys(selectedMarketByMatchId);
    if (ids.length === 0) return;
    for (const matchId of ids) {
      const selected = String(selectedMarketByMatchId[matchId] ?? '').trim();
      if (!selected) continue;
      const x = itemsRef.current.find((it) => it.matchId === matchId) ?? null;
      const baseMarketId = String(x?.betfair?.marketId ?? '').trim();
      if (!x) continue;
      if (selected === baseMarketId) continue;
      if (marketBookByMatchId[matchId]?.marketId === selected) continue;
      if (loadingBookByMatchId[matchId]) continue;
      void fetchBetfairMarketBook(matchId, selected);
    }
  }, [loadingBookByMatchId, marketBookByMatchId, selectedMarketByMatchId]);

  const deriveMarketsFromPrediction = (x: QueueItem): AutomationMarketToggle[] => {
    const p = x.prediction && typeof x.prediction === 'object' ? (x.prediction as any) : null;
    if (!p) return [];
    const h = x.homeTeam || 'Casa';
    const a = x.awayTeam || 'Visitante';
    const out: AutomationMarketToggle[] = [];

    const winner = String(p?.winner?.prediction ?? '').trim();
    const winnerConf = Number(p?.winner?.confidence);
    if (winner) {
      const label = winner === 'home' ? `Vencedor: ${h}` : winner === 'away' ? `Vencedor: ${a}` : 'Vencedor: Empate';
      out.push({ key: 'winner', label, enabled: false, details: Number.isFinite(winnerConf) ? `${Math.round(winnerConf)}%` : null });
    }

    const ouPred = String(p?.overUnder?.prediction ?? '').trim();
    const ouLine = Number(p?.overUnder?.line);
    const ouConf = Number(p?.overUnder?.confidence);
    if (ouPred && Number.isFinite(ouLine)) {
      const side = ouPred === 'over' ? 'Over' : ouPred === 'under' ? 'Under' : 'OU';
      out.push({ key: 'overUnder', label: `${side} ${ouLine}`, enabled: false, details: Number.isFinite(ouConf) ? `${Math.round(ouConf)}%` : null });
    }

    const bttsPred = String(p?.btts?.prediction ?? '').trim();
    const bttsConf = Number(p?.btts?.confidence);
    if (bttsPred) {
      out.push({
        key: 'btts',
        label: `Ambas marcam: ${bttsPred === 'yes' ? 'Sim' : 'Não'}`,
        enabled: false,
        details: Number.isFinite(bttsConf) ? `${Math.round(bttsConf)}%` : null,
      });
    }

    const cs = String(p?.correctScore?.score ?? '').trim();
    const csConf = Number(p?.correctScore?.confidence);
    out.push({ key: 'correctScore', label: cs ? `Placar correto: ${cs}` : 'Placar correto', enabled: true, details: Number.isFinite(csConf) ? `${Math.round(csConf)}%` : null });

    const ahTeam = String(p?.asianHandicap?.team ?? '').trim();
    const ahLine = Number(p?.asianHandicap?.line);
    const ahConf = Number(p?.asianHandicap?.confidence);
    if (ahTeam && Number.isFinite(ahLine)) {
      const teamLabel = ahTeam === 'home' ? h : a;
      const lineLabel = ahLine > 0 ? `+${ahLine}` : `${ahLine}`;
      out.push({
        key: 'asianHandicap',
        label: `Handicap: ${teamLabel} (${lineLabel})`,
        enabled: false,
        details: Number.isFinite(ahConf) ? `${Math.round(ahConf)}%` : null,
      });
    }

    const fh = String(p?.firstHalf?.prediction ?? '').trim();
    const fhConf = Number(p?.firstHalf?.confidence);
    if (fh) {
      const label = fh === 'home' ? h : fh === 'away' ? a : 'Empate';
      out.push({ key: 'firstHalf', label: `1º tempo: ${label}`, enabled: false, details: Number.isFinite(fhConf) ? `${Math.round(fhConf)}%` : null });
    }

    const sh = String(p?.secondHalf?.prediction ?? '').trim();
    const shConf = Number(p?.secondHalf?.confidence);
    if (sh) {
      const label = sh === 'home' ? h : sh === 'away' ? a : 'Empate';
      out.push({ key: 'secondHalf', label: `2º tempo: ${label}`, enabled: false, details: Number.isFinite(shConf) ? `${Math.round(shConf)}%` : null });
    }

    return out;
  };

  const clearClickTimer = (matchId: string) => {
    const t = clickTimersRef.current[matchId];
    if (typeof t === 'number') window.clearTimeout(t);
    delete clickTimersRef.current[matchId];
  };

  const scheduleToggleExpanded = (matchId: string) => {
    clearClickTimer(matchId);
    clickTimersRef.current[matchId] = window.setTimeout(() => {
      setExpandedById((prev) => ({ ...prev, [matchId]: !Boolean(prev[matchId]) }));
      delete clickTimersRef.current[matchId];
    }, 220);
  };

  const parsePredictedScore = (x: QueueItem) => {
    const p = x.prediction && typeof x.prediction === 'object' ? (x.prediction as any) : null;
    const raw = String(p?.correctScore?.score ?? '').trim();
    if (!raw) return null;
    const m = raw.match(/^(\d+)\s*[-x×]\s*(\d+)$/i) || raw.match(/^(\d+)\s*-\s*(\d+)$/i);
    if (!m) return null;
    return { home: Number(m[1]), away: Number(m[2]) };
  };

  const kickoffDate = (x: QueueItem) => {
    const iso = x.betfair?.marketStartTime || x.utcDate || null;
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d : null;
  };

  const ymd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const dayLabel = (d: Date) => {
    const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' });
    const day = d.toLocaleDateString('pt-BR', { day: '2-digit' });
    const month = d.toLocaleDateString('pt-BR', { month: 'short' });
    return `${weekday} ${day} ${month}`.replace('.', '');
  };

  const isLive = (x: QueueItem) => {
    const marketStatus = String(x.betfair?.marketStatus ?? '').toUpperCase();
    const hasMarket = Boolean(x.betfair?.marketId);
    if (hasMarket && marketStatus === 'CLOSED') return false;
    const apiShort = apiFootballLiveByMatchId[x.matchId]?.statusShort ?? null;
    if (apiShort && toMatchStatus(apiShort) === 'live') return x.status !== 'stopped';
    const liveStatus = toMatchStatus(x.live?.statusShort);
    if (liveStatus === 'live') return x.status !== 'stopped';
    if (liveStatus === 'finished') return false;
    if (hasMarket && x.betfair?.inPlay === true) return true;
    return false;
  };

  const isFinished = (x: QueueItem) => {
    const hasMarket = Boolean(x.betfair?.marketId);
    const marketStatus = String(x.betfair?.marketStatus ?? '').toUpperCase();
    if (hasMarket && marketStatus === 'CLOSED') return true;
    const apiShort = apiFootballLiveByMatchId[x.matchId]?.statusShort ?? null;
    if (apiShort && toMatchStatus(apiShort) === 'finished') return true;
    if (toMatchStatus(x.live?.statusShort) === 'finished') return true;
    return false;
  };

  const minuteLabel = (elapsed: number | null, extra: number | null) => {
    if (typeof elapsed !== 'number' || !Number.isFinite(elapsed)) return null;
    const e = Math.max(0, Math.floor(elapsed));
    if (typeof extra === 'number' && Number.isFinite(extra) && extra > 0) return `${e}+${Math.floor(extra)}’`;
    return `${e}’`;
  };

  const timeOrMinute = (x: QueueItem) => {
    const toNum = (v: any) => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const k = kickoffDate(x);
    if (isFinished(x)) return 'FT';
    if (isLive(x)) {
      const apiLive = apiFootballLiveByMatchId[x.matchId] ?? null;
      const statusShort = String(apiLive?.statusShort ?? x.live?.statusShort ?? '').toUpperCase();
      if (['HT', 'BREAK', 'INT'].includes(statusShort)) return 'INT';
      const fromApi = apiLive ? minuteLabel(toNum(apiLive.elapsed), toNum(apiLive.extra)) : null;
      if (fromApi) return fromApi;
      const fromLive = minuteLabel(toNum(x.live?.elapsed), toNum(x.live?.extra));

      if (fromLive) return fromLive;

      const inPlaySince = String(x.betfair?.inPlaySince ?? '').trim();
      if (inPlaySince) {
        const ms = new Date(inPlaySince).getTime();
        if (Number.isFinite(ms)) {
          const diffMin = Math.floor((Date.now() - ms) / 60000);
          if (Number.isFinite(diffMin) && diffMin >= 0) return `${diffMin}’`;
        }
      }

      if (k) {
        const diffMin = Math.floor((Date.now() - k.getTime()) / 60000);
        if (Number.isFinite(diffMin) && diffMin >= 0 && diffMin <= 200) return `${diffMin}’`;
      }

      return 'AO VIVO';
    }
    if (!k) return '—';
    return k.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const scopeFiltered = useMemo(() => {
    const todayKey = ymd(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowKey = ymd(tomorrow);

    const byView = (x: QueueItem) => {
      if (view === 'all') return true;
      if (view === 'live') return isLive(x);
      const k = kickoffDate(x);
      if (!k) return false;
      const key = ymd(k);
      if (view === 'today') return key === todayKey;
      if (view === 'tomorrow') return key === tomorrowKey;
      if (view === 'next') return key > tomorrowKey;
      return true;
    };

    return sorted.filter(byView).filter((x) => !isFinished(x));
  }, [sorted, view, now]);

  const finishedItems = useMemo(() => {
    return sorted
      .filter((x) => isFinished(x))
      .slice()
      .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')));
  }, [sorted]);

  const grouped = useMemo(() => {
    const groups = new Map<string, QueueItem[]>();
    for (const x of scopeFiltered) {
      const k = kickoffDate(x) ?? now;
      const key = ymd(k);
      const arr = groups.get(key) ?? [];
      arr.push(x);
      groups.set(key, arr);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => {
      const list = groups.get(k) ?? [];
      const day = new Date(`${k}T12:00:00`);
      const live = list.filter(isLive).sort((a, b) => {
        const ka = kickoffDate(a)?.getTime() ?? 0;
        const kb = kickoffDate(b)?.getTime() ?? 0;
        return kb - ka;
      });
      const upcoming = list.filter((x) => !isLive(x)).sort((a, b) => {
        const ka = kickoffDate(a)?.getTime() ?? 0;
        const kb = kickoffDate(b)?.getTime() ?? 0;
        return ka - kb;
      });
      return { key: k, day, live, upcoming };
    });
  }, [scopeFiltered, now]);

  const loadQueue = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setStatus('loading');
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
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      }
      const next = Array.isArray(data?.items) ? (data.items as QueueItem[]) : [];
      itemsRef.current = next;
      setItems(next);
      if (!opts?.silent) setStatus('idle');
    } catch (e) {
      if (!opts?.silent) setStatus('error');
      const msg = e instanceof Error ? e.message : String(e);
      if (!opts?.silent) toast.error('Falha ao carregar automações', { description: msg.slice(0, 220) });
    }
  };

  const refreshOdds = async () => {
    if (isRefreshingOddsRef.current) return;
    isRefreshingOddsRef.current = true;
    // #region debug-point A:refreshOdds-enter
    dbg('A', 'refreshOdds enter', { itemsCount: itemsRef.current.length });
    // #endregion
    try {
      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      // #region debug-point B:adminToken
      dbg('B', 'adminToken check', { hasAdminToken: Boolean(adminToken), len: adminToken.length });
      // #endregion
      const bankrollTotalStored = Number(cfg?.betfairBankroll ?? 0);
      const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
      const correctScorePct = Number(marketPercents.correctScore ?? 10);
      const overUnderPct = Number(marketPercents.overUnder ?? 10);
      let bankrollTotal = bankrollTotalStored;
      const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};

      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      if (adminToken) {
        const shouldAutoSync = !Number.isFinite(bankrollTotalStored) || bankrollTotalStored <= 0;
        if (shouldAutoSync) {
          const nowTs = Date.now();
          if (nowTs - lastFundsSyncAtRef.current > 60_000) {
            lastFundsSyncAtRef.current = nowTs;
            try {
              const fundsRes = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/automation/betfair/account/funds`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ adminToken }),
              });
              const fundsRaw = await fundsRes.text().catch(() => '');
              const fundsData = fundsRaw ? JSON.parse(fundsRaw) : null;
              if (fundsRes.ok && fundsData?.ok && typeof fundsData?.summary?.availableToBetBalance === 'number') {
                const nextBankroll = fundsData.summary.availableToBetBalance;
                if (Number.isFinite(nextBankroll) && nextBankroll >= 0) {
                  bankrollTotal = nextBankroll;
                  if (!Number.isFinite(bankrollTotalStored) || Math.abs(nextBankroll - bankrollTotalStored) > 0.01) {
                    const nextCfg = loadApiConfig();
                    if (nextCfg) saveApiConfig({ ...nextCfg, betfairBankroll: nextBankroll });
                  }
                }
              }
            } catch {}
          }
        }
      }

      const bankrollForCorrectScore =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(correctScorePct) && correctScorePct > 0
          ? Math.round(((bankrollTotal * correctScorePct) / 100) * 100) / 100
          : 50;
      const bankrollForOverUnder =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(overUnderPct) && overUnderPct > 0
          ? Math.round(((bankrollTotal * overUnderPct) / 100) * 100) / 100
          : 50;

      const testModeActive = isTestModeRef.current;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/refreshOdds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          max: testModeActive ? 10 : 30,
          minFreshSeconds: testModeActive ? 25 : 10,
          includeCorrectScore: !testModeActive,
          runCorrectScorePlan: !testModeActive,
          ...(testModeActive
            ? {}
            : {
                planConfig: {
                  minProfitPct: 0.03,
                  targetProfitPct: 0.03,
                  maxProfitPct: 0.05,
                  bankroll: bankrollForCorrectScore,
                  maxSelections: 10,
                  maxGoals: 3,
                  includeAnyOther: true,
                },
              }),
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      // #region debug-point A:refreshOdds-response
      dbg('A', 'queue/refreshOdds response', { ok: Boolean(res.ok && data?.ok), status: res.status, hasBody: Boolean(raw), error: data?.error ?? null });
      // #endregion
      if (!res.ok || !data?.ok) return;
      await loadQueue({ silent: true });
      // #region debug-point C:queue-after-refresh
      dbg('C', 'queue loaded after refreshOdds', {
        running: itemsRef.current.filter((x) => x.status === 'running').length,
        paused: itemsRef.current.filter((x) => x.status === 'paused').length,
        stopped: itemsRef.current.filter((x) => x.status === 'stopped').length,
        agents: itemsRef.current.reduce((acc: Record<string, number>, x) => {
          const a = normalizeAgent(x.strategy?.agent) || 'none';
          acc[a] = (acc[a] ?? 0) + 1;
          return acc;
        }, {}),
      });
      // #endregion

      if (isTestModeRef.current) return;

      if (adminToken) {
        const snapshot = itemsRef.current;
        const targets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => {
            const agent = normalizeAgent(x.strategy?.agent);
            return agent === 'correctScore';
          })
          .filter((x) => Boolean(x.betfair?.correctScore?.marketId))
          .filter((x) => !String(x.strategy?.correctScore?.adoptedExistingAt ?? '').trim())
          .filter((x) => {
            const ms = Array.isArray(x.markets) ? x.markets : deriveMarketsFromPrediction(x);
            const cs = ms.find((m) => m.key === 'correctScore');
            return cs ? Boolean(cs.enabled) : true;
          })
          .slice(0, 6);
        // #region debug-point C:targets-correctScore
        dbg('C', 'targets correctScore', { count: targets.length, ids: targets.map((t) => t.matchId) });
        // #endregion

        const nowTs = Date.now();
        const csLim = (robotLimits as any)?.correctScore && typeof (robotLimits as any).correctScore === 'object' ? (robotLimits as any).correctScore : {};
        const csMaxSelections = Number(csLim?.maxSelections);
        const csEntryScoresCsv = String(csLim?.entryScoresCsv ?? '0-0,0-1,1-0,1-1');
        const csMinMarketMatched = Number(csLim?.minMarketMatched);

        for (const x of targets) {
          const lastExec = String(x.strategy?.correctScore?.lastExecutionAt ?? '').trim();
          if (lastExec) continue;
          const apiLive = apiFootballLiveByMatchId[String(x.matchId)] ?? null;

          // #region debug-point D:correctScore-exec
          dbg('D', 'correctScore execute call', { matchId: x.matchId, planType: 'coverage' });
          // #endregion
          const execRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/execute`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              dryRun: false,
              adminToken,
              live: apiLive
                ? {
                    fetchedAt: apiLive.fetchedAt,
                    elapsed: apiLive.elapsed,
                    scoreHome: apiLive.goalsHome,
                    scoreAway: apiLive.goalsAway,
                  }
                : null,
              config: { bankroll: bankrollForCorrectScore },
              planConfig: {
                planType: 'coverage',
                maxSelections: Number.isFinite(csMaxSelections) ? csMaxSelections : undefined,
                entryScoresCsv: csEntryScoresCsv,
                minMarketMatched: Number.isFinite(csMinMarketMatched) ? csMinMarketMatched : undefined,
              },
            }),
          }).catch((e) => {
            // #region debug-point E:correctScore-exec-error
            dbg('E', 'correctScore execute fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (execRes) {
            const t = await execRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            // #region debug-point D:correctScore-exec-response
            dbg('D', 'correctScore execute response', {
              matchId: x.matchId,
              status: execRes.status,
              ok: Boolean(execRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              adoptedExisting: Boolean(j?.adoptedExisting),
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

      if (adminToken) {
        const snapshot = itemsRef.current;
        const rebalanceTargets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => {
            const agent = normalizeAgent(x.strategy?.agent);
            return agent === 'correctScore';
          })
          .filter((x) => Boolean(x.betfair?.correctScore?.marketId))
          .filter((x) => Boolean(String(x.strategy?.correctScore?.lastExecutionAt ?? '').trim()) || Boolean(String(x.strategy?.correctScore?.adoptedExistingAt ?? '').trim()))
          .slice(0, 6);
        // #region debug-point C:targets-cs-rebalance
        dbg('C', 'targets correctScore rebalance', { count: rebalanceTargets.length, ids: rebalanceTargets.map((t) => t.matchId) });
        // #endregion

        const nowTs = Date.now();
        for (const x of rebalanceTargets) {
          const lastReb = String((x.strategy as any)?.correctScore?.lastRebalanceAt ?? '').trim();
          const lastRebTs = lastReb ? new Date(lastReb).getTime() : 0;
          if (lastRebTs && Number.isFinite(lastRebTs) && nowTs - lastRebTs < 30_000) continue;

          const apiLive = apiFootballLiveByMatchId[String(x.matchId)] ?? null;
          const goalsHome = typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : x.scoreHome;
          const goalsAway = typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : x.scoreAway;
          const totalGoals = typeof goalsHome === 'number' && typeof goalsAway === 'number' ? Math.max(0, Math.floor(goalsHome) + Math.floor(goalsAway)) : null;
          const lastGoals = Number((x.strategy as any)?.correctScore?.lastGoals);
          const prevGoals = Number.isFinite(lastGoals) ? lastGoals : null;
          if (totalGoals != null && prevGoals != null && totalGoals === prevGoals) continue;

          // #region debug-point D:correctScore-rebalance-call
          dbg('D', 'correctScore rebalance call', { matchId: x.matchId, totalGoals, prevGoals });
          // #endregion
          const rebRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/rebalance`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              dryRun: false,
              config: {
                targetMinGreenAbs: 0,
                maxInstructions: 3,
                maxStakePerInstruction: 50,
              },
            }),
          }).catch((e) => {
            // #region debug-point E:correctScore-rebalance-error
            dbg('E', 'correctScore rebalance fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (rebRes) {
            const t = await rebRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            // #region debug-point D:correctScore-rebalance-response
            dbg('D', 'correctScore rebalance response', {
              matchId: x.matchId,
              status: rebRes.status,
              ok: Boolean(rebRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

      if (adminToken) {
        const snapshot = itemsRef.current;
        const scalpingTargets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => {
            const agent = normalizeAgent(x.strategy?.agent);
            return agent === 'scalpingGoals';
          })
          .slice(0, 4);
        // #region debug-point C:targets-scalpingGoals
        dbg('C', 'targets scalpingGoals', { count: scalpingTargets.length, ids: scalpingTargets.map((t) => t.matchId) });
        // #endregion

        for (const x of scalpingTargets) {
          const lastTick = String(x.strategy?.scalpingGoals?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 10_000) continue;
          const lim = (robotLimits as any)?.scalpingGoals && typeof (robotLimits as any).scalpingGoals === 'object' ? (robotLimits as any).scalpingGoals : {};
          const profitTargetPct = Number(lim?.profitTargetPct);
          const stakePct = Number(lim?.stakePct);
          const entryOffsetTicks = Number(lim?.entryOffsetTicks);
          const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
          // #region debug-point D:scalpingGoals-tick-call
          dbg('D', 'scalpingGoals tick call', { matchId: x.matchId });
          // #endregion
          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingGoals/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              config: {
                bankroll: bankrollForOverUnder,
                ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
                ...(Number.isFinite(stakePct) ? { stakePct } : {}),
                ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
                ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
              },
            }),
          }).catch((e) => {
            // #region debug-point E:scalpingGoals-tick-error
            dbg('E', 'scalpingGoals tick fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (tickRes) {
            const t = await tickRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            // #region debug-point D:scalpingGoals-tick-response
            dbg('D', 'scalpingGoals tick response', {
              matchId: x.matchId,
              status: tickRes.status,
              ok: Boolean(tickRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              entered: Boolean(j?.entered),
              closed: Boolean(j?.closed),
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

      if (adminToken) {
        const snapshot = itemsRef.current;
        const scalpingTicksTargets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => normalizeAgent(x.strategy?.agent) === 'scalpingTicks')
          .slice(0, 4);
        // #region debug-point C:targets-scalpingTicks
        dbg('C', 'targets scalpingTicks', { count: scalpingTicksTargets.length, ids: scalpingTicksTargets.map((t) => t.matchId) });
        // #endregion

        for (const x of scalpingTicksTargets) {
          const lastTick = String((x as any).strategy?.scalpingTicks?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 5_000) continue;
          const live = apiFootballLiveByMatchId[String(x.matchId)] ?? null;
          const lim = (robotLimits as any)?.scalpingTicks && typeof (robotLimits as any).scalpingTicks === 'object' ? (robotLimits as any).scalpingTicks : {};
          const targetTicks = Number(lim?.targetTicks);
          const entryOffsetTicks = Number(lim?.entryOffsetTicks);
          const entryMaxWaitSeconds = Number((lim as any)?.entryMaxWaitSeconds);
          const maxSpreadTicks = Number(lim?.maxSpreadTicks);
          const minSecondsBetweenCycles = Number(lim?.minSecondsBetweenCycles);
          const stakePct = Number(lim?.stakePct);
          const maxCycles = Number(lim?.maxCycles);
          const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
          const invertVolumePct = Number(lim?.invertVolumePct);
          const momentOverThreshold = Number(lim?.momentOverThreshold);
          const momentOverThresholdLate = Number(lim?.momentOverThresholdLate);
          const momentOverThresholdOffDelta = Number(lim?.momentOverThresholdOffDelta);
          const momentWindowMinSec = Number(lim?.momentWindowMinSec);
          const momentWindowMaxSec = Number(lim?.momentWindowMaxSec);
          const minMarketMatched = Number(lim?.minMarketMatched);
          const minRunnerMatched = Number(lim?.minRunnerMatched);
          const afterGoalWaitSeconds = Number(lim?.afterGoalWaitSeconds);
          const recoveryEnabled = typeof (lim as any)?.recoveryEnabled === 'boolean' ? Boolean((lim as any).recoveryEnabled) : null;
          const recoveryIncreasePct = Number((lim as any)?.recoveryIncreasePct);
          const recoveryMaxStakeAbs = Number((lim as any)?.recoveryMaxStakeAbs);
          // #region debug-point D:scalpingTicks-tick-call
          dbg('D', 'scalpingTicks tick call', { matchId: x.matchId });
          // #endregion
          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingTicks/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              live: live
                ? {
                    fetchedAt: live.fetchedAt,
                    elapsed: live.elapsed,
                    scoreHome: live.goalsHome,
                    scoreAway: live.goalsAway,
                  }
                : null,
              config: {
                bankroll: bankrollForOverUnder,
                ...(Number.isFinite(targetTicks) ? { targetTicks } : {}),
                ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
                ...(Number.isFinite(entryMaxWaitSeconds) ? { entryMaxWaitSeconds } : {}),
                ...(Number.isFinite(maxSpreadTicks) ? { maxSpreadTicks } : {}),
                ...(Number.isFinite(minSecondsBetweenCycles) ? { minSecondsBetweenCycles } : {}),
                ...(Number.isFinite(stakePct) ? { stakePct } : {}),
                ...(Number.isFinite(maxCycles) ? { maxCycles } : {}),
                ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
                ...(Number.isFinite(invertVolumePct) ? { invertVolumePct } : {}),
                ...(Number.isFinite(momentOverThreshold) ? { momentOverThreshold } : {}),
                ...(Number.isFinite(momentOverThresholdLate) ? { momentOverThresholdLate } : {}),
                ...(Number.isFinite(momentOverThresholdOffDelta) ? { momentOverThresholdOffDelta } : {}),
                ...(Number.isFinite(momentWindowMinSec) ? { momentWindowMinSec } : {}),
                ...(Number.isFinite(momentWindowMaxSec) ? { momentWindowMaxSec } : {}),
                ...(Number.isFinite(minMarketMatched) ? { minMarketMatched } : {}),
                ...(Number.isFinite(minRunnerMatched) ? { minRunnerMatched } : {}),
                ...(Number.isFinite(afterGoalWaitSeconds) ? { afterGoalWaitSeconds } : {}),
                ...(recoveryEnabled != null ? { recoveryEnabled } : {}),
                ...(Number.isFinite(recoveryIncreasePct) ? { recoveryIncreasePct } : {}),
                ...(Number.isFinite(recoveryMaxStakeAbs) ? { recoveryMaxStakeAbs } : {}),
              },
            }),
          }).catch((e) => {
            // #region debug-point E:scalpingTicks-tick-error
            dbg('E', 'scalpingTicks tick fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (tickRes) {
            const t = await tickRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            if (!tickRes.ok) {
              console.warn('scalpingTicks tick HTTP error', { matchId: x.matchId, status: tickRes.status, body: t ? t.slice(0, 600) : '' });
            }
            // #region debug-point D:scalpingTicks-tick-response
            dbg('D', 'scalpingTicks tick response', {
              matchId: x.matchId,
              status: tickRes.status,
              ok: Boolean(tickRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              entered: Boolean(j?.entered),
              closed: Boolean(j?.closed),
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

      if (adminToken) {
        const snapshot = itemsRef.current;
        const overGoalsLimitTargets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => normalizeAgent(x.strategy?.agent) === 'overGoalsLimit')
          .slice(0, 4);
        // #region debug-point C:targets-overGoalsLimit
        dbg('C', 'targets overGoalsLimit', { count: overGoalsLimitTargets.length, ids: overGoalsLimitTargets.map((t) => t.matchId) });
        // #endregion

        for (const x of overGoalsLimitTargets) {
          const lastTick = String(x.strategy?.overGoalsLimit?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 10_000) continue;
          const live = apiFootballLiveByMatchId[String(x.matchId)] ?? null;
          const lim = (robotLimits as any)?.overGoalsLimit && typeof (robotLimits as any).overGoalsLimit === 'object' ? (robotLimits as any).overGoalsLimit : {};
          const minOdds = Number(lim?.minOdds);
          const maxEntries = Number(lim?.maxEntries);
          const profitTargetPct = Number(lim?.profitTargetPct);
          const minDeltaTraded = Number(lim?.minDeltaTraded);
          const dominanceRatio = Number(lim?.dominanceRatio);
          const minSecondsBetweenEntries = Number(lim?.minSecondsBetweenEntries);
          const stakePct = Number(lim?.stakePct);
          const entryOffsetTicks = Number(lim?.entryOffsetTicks);
          const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
          // #region debug-point D:overGoalsLimit-tick-call
          dbg('D', 'overGoalsLimit tick call', { matchId: x.matchId, hasLive: Boolean(live) });
          // #endregion
          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/overGoalsLimit/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              stats: live
                ? {
                    fetchedAt: live.fetchedAt,
                    dangerousAttacksHome: live.dangerousAttacksHome,
                    dangerousAttacksAway: live.dangerousAttacksAway,
                    attacksHome: live.attacksHome,
                    attacksAway: live.attacksAway,
                    shotsOnGoalHome: live.shotsOnGoalHome,
                    shotsOnGoalAway: live.shotsOnGoalAway,
                    cornersHome: live.cornersHome,
                    cornersAway: live.cornersAway,
                    cardsHome: live.cardsHome,
                    cardsAway: live.cardsAway,
                  }
                : null,
              config: {
                bankroll: bankrollForOverUnder,
                bankrollTotal,
                ...(Number.isFinite(minOdds) ? { minOdds } : {}),
                ...(Number.isFinite(maxEntries) ? { maxEntries } : {}),
                ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
                ...(Number.isFinite(minDeltaTraded) ? { minDeltaTraded } : {}),
                ...(Number.isFinite(dominanceRatio) ? { dominanceRatio } : {}),
                ...(Number.isFinite(minSecondsBetweenEntries) ? { minSecondsBetweenEntries } : {}),
                ...(Number.isFinite(stakePct) ? { stakePct } : {}),
                ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
                ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
              },
            }),
          }).catch((e) => {
            // #region debug-point E:overGoalsLimit-tick-error
            dbg('E', 'overGoalsLimit tick fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (tickRes) {
            const t = await tickRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            // #region debug-point D:overGoalsLimit-tick-response
            dbg('D', 'overGoalsLimit tick response', {
              matchId: x.matchId,
              status: tickRes.status,
              ok: Boolean(tickRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

      if (adminToken) {
        const snapshot = itemsRef.current;
        const asianHandicapTargets = snapshot
          .filter((x) => x.status === 'running')
          .filter((x) => normalizeAgent(x.strategy?.agent) === 'asianHandicap')
          .slice(0, 4);
        // #region debug-point C:targets-asianHandicap
        dbg('C', 'targets asianHandicap', { count: asianHandicapTargets.length, ids: asianHandicapTargets.map((t) => t.matchId) });
        // #endregion

        for (const x of asianHandicapTargets) {
          const lastTick = String((x as any).strategy?.asianHandicap?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 10_000) continue;
          const live = apiFootballLiveByMatchId[String(x.matchId)] ?? null;
          const lim = (robotLimits as any)?.asianHandicap && typeof (robotLimits as any).asianHandicap === 'object' ? (robotLimits as any).asianHandicap : {};
          const profitTargetPct = Number(lim?.profitTargetPct);
          const stakePct = Number(lim?.stakePct);
          const entryOffsetTicks = Number(lim?.entryOffsetTicks);
          const targetTicks = Number(lim?.targetTicks);
          const maxEntries = Number(lim?.maxEntries);
          const maxSpreadTicks = Number(lim?.maxSpreadTicks);
          const minMarketMatched = Number(lim?.minMarketMatched);
          const minRunnerMatched = Number(lim?.minRunnerMatched);
          const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
          const entryMaxWaitSeconds = Number(lim?.entryMaxWaitSeconds);
          // #region debug-point D:asianHandicap-tick-call
          dbg('D', 'asianHandicap tick call', { matchId: x.matchId, hasLive: Boolean(live) });
          // #endregion
          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/asianHandicap/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              live: live
                ? { fetchedAt: live.fetchedAt, elapsed: live.elapsed, goalsHome: live.goalsHome, goalsAway: live.goalsAway, statusShort: live.statusShort }
                : null,
              stats: live
                ? {
                    fetchedAt: live.fetchedAt,
                    dangerousAttacksHome: live.dangerousAttacksHome,
                    dangerousAttacksAway: live.dangerousAttacksAway,
                    attacksHome: live.attacksHome,
                    attacksAway: live.attacksAway,
                    shotsOnGoalHome: live.shotsOnGoalHome,
                    shotsOnGoalAway: live.shotsOnGoalAway,
                    cornersHome: live.cornersHome,
                    cornersAway: live.cornersAway,
                    cardsHome: live.cardsHome,
                    cardsAway: live.cardsAway,
                  }
                : null,
              config: {
                bankroll: bankrollForOverUnder,
                bankrollTotal,
                ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
                ...(Number.isFinite(stakePct) ? { stakePct } : {}),
                ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
                ...(Number.isFinite(targetTicks) ? { targetTicks } : {}),
                ...(Number.isFinite(maxEntries) ? { maxEntries } : {}),
                ...(Number.isFinite(maxSpreadTicks) ? { maxSpreadTicks } : {}),
                ...(Number.isFinite(minMarketMatched) ? { minMarketMatched } : {}),
                ...(Number.isFinite(minRunnerMatched) ? { minRunnerMatched } : {}),
                ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
                ...(Number.isFinite(entryMaxWaitSeconds) ? { entryMaxWaitSeconds } : {}),
              },
            }),
          }).catch((e) => {
            // #region debug-point E:asianHandicap-tick-error
            dbg('E', 'asianHandicap tick fetch error', { matchId: x.matchId, error: e instanceof Error ? e.message : String(e) });
            // #endregion
            return null;
          });
          if (tickRes) {
            const t = await tickRes.text().catch(() => '');
            let j: any = null;
            try {
              j = t ? JSON.parse(t) : null;
            } catch {}
            // #region debug-point D:asianHandicap-tick-response
            dbg('D', 'asianHandicap tick response', {
              matchId: x.matchId,
              status: tickRes.status,
              ok: Boolean(tickRes.ok && j?.ok),
              skipped: Boolean(j?.skipped),
              reason: j?.reason ?? null,
              error: j?.error ?? null,
            });
            // #endregion
          }
        }

        await loadQueue({ silent: true });
      }

    } catch {
      // #region debug-point E:refreshOdds-exception
      dbg('E', 'refreshOdds exception', {});
      // #endregion
      return;
    } finally {
      isRefreshingOddsRef.current = false;
      // #region debug-point A:refreshOdds-exit
      dbg('A', 'refreshOdds exit', {});
      // #endregion
    }
  };

  const fetchBetfairMarketsForItem = async (x: QueueItem) => {
    const matchId = String(x.matchId);
    if (!matchId) return;
    const eventId = String(x.betfair?.eventId ?? '').trim();
    if (!eventId) return;
    if (loadingMarketsByMatchId[matchId]) return;

    setLoadingMarketsByMatchId((prev) => ({ ...prev, [matchId]: true }));
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'SportsAPING/v1.0/listMarketCatalogue',
          params: {
            filter: { eventIds: [eventId] },
            marketProjection: ['RUNNER_DESCRIPTION', 'MARKET_START_TIME'],
            sort: 'MAXIMUM_TRADED',
            maxResults: 25,
          },
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));

      const arr = Array.isArray(data.result) ? data.result : [];
      const items = arr
        .map((m: any) => ({
          marketId: String(m?.marketId ?? '').trim(),
          marketName: String(m?.marketName ?? '').trim() || 'Mercado',
          totalMatched: typeof m?.totalMatched === 'number' ? m.totalMatched : null,
          runners: Array.isArray(m?.runners)
            ? m.runners
                .map((r: any) => ({
                  selectionId: Number(r?.selectionId),
                  runnerName: String(r?.runnerName ?? '').trim() || `#${String(r?.selectionId ?? '')}`,
                }))
                .filter((r: any) => Number.isFinite(r.selectionId))
            : [],
        }))
        .filter((m: any) => m.marketId);

      setMarketOptionsByMatchId((prev) => ({ ...prev, [matchId]: { fetchedAt: new Date().toISOString(), items } }));

      const preferred = String(selectedMarketByMatchId[matchId] ?? '').trim() || String(x.betfair?.marketId ?? '').trim() || String(items[0]?.marketId ?? '').trim();
      if (preferred) {
        setSelectedMarketByMatchId((prev) => ({ ...prev, [matchId]: preferred }));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao carregar mercados da Betfair', { description: msg.slice(0, 220) });
    } finally {
      setLoadingMarketsByMatchId((prev) => ({ ...prev, [matchId]: false }));
    }
  };

  const fetchBetfairMarketBook = async (matchId: string, marketId: string) => {
    const mid = String(marketId ?? '').trim();
    if (!mid) return;
    if (loadingBookByMatchId[matchId]) return;
    setLoadingBookByMatchId((prev) => ({ ...prev, [matchId]: true }));
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'SportsAPING/v1.0/listMarketBook',
          params: {
            marketIds: [mid],
            priceProjection: { priceData: ['EX_BEST_OFFERS'], virtualise: true },
          },
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      const book = Array.isArray(data.result) ? data.result[0] : null;
      const runners = Array.isArray(book?.runners) ? book.runners : [];
      const quotes: Record<
        string,
        {
          selectionId: number;
          runnerName: string;
          back: number | null;
          backSize: number | null;
          lay: number | null;
          laySize: number | null;
        }
      > = {};

      const options = marketOptionsByMatchId[matchId]?.items ?? [];
      const opt = options.find((o) => o.marketId === mid) ?? null;
      const nameBySelectionId = new Map<number, string>();
      for (const r of opt?.runners ?? []) nameBySelectionId.set(r.selectionId, r.runnerName);

      for (const r of runners) {
        const selectionId = Number(r?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const atb = Array.isArray(r?.ex?.availableToBack) ? r.ex.availableToBack : [];
        const atl = Array.isArray(r?.ex?.availableToLay) ? r.ex.availableToLay : [];
        const back = typeof atb?.[0]?.price === 'number' ? atb[0].price : null;
        const backSize = typeof atb?.[0]?.size === 'number' ? atb[0].size : null;
        const lay = typeof atl?.[0]?.price === 'number' ? atl[0].price : null;
        const laySize = typeof atl?.[0]?.size === 'number' ? atl[0].size : null;
        quotes[String(selectionId)] = {
          selectionId,
          runnerName: nameBySelectionId.get(selectionId) ?? `#${selectionId}`,
          back,
          backSize,
          lay,
          laySize,
        };
      }

      setMarketBookByMatchId((prev) => ({
        ...prev,
        [matchId]: {
          marketId: mid,
          marketStatus: typeof book?.status === 'string' ? book.status : null,
          fetchedAt: new Date().toISOString(),
          runners: quotes,
        },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao carregar cotações do mercado', { description: msg.slice(0, 220) });
    } finally {
      setLoadingBookByMatchId((prev) => ({ ...prev, [matchId]: false }));
    }
  };

  const fetchBetfairMarketBookSnapshot = async (matchId: string, marketId: string) => {
    const mid = String(marketId ?? '').trim();
    if (!mid) return null;
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'SportsAPING/v1.0/listMarketBook',
          params: {
            marketIds: [mid],
            priceProjection: { priceData: ['EX_BEST_OFFERS'], virtualise: true },
          },
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      const book = Array.isArray(data.result) ? data.result[0] : null;
      const runners = Array.isArray(book?.runners) ? book.runners : [];
      const quotes: Record<
        string,
        {
          selectionId: number;
          runnerName: string;
          back: number | null;
          backSize: number | null;
          lay: number | null;
          laySize: number | null;
        }
      > = {};

      const options = marketOptionsByMatchId[matchId]?.items ?? [];
      const opt = options.find((o) => o.marketId === mid) ?? null;
      const nameBySelectionId = new Map<number, string>();
      for (const r of opt?.runners ?? []) nameBySelectionId.set(r.selectionId, r.runnerName);

      for (const r of runners) {
        const selectionId = Number(r?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const atb = Array.isArray(r?.ex?.availableToBack) ? r.ex.availableToBack : [];
        const atl = Array.isArray(r?.ex?.availableToLay) ? r.ex.availableToLay : [];
        const back = typeof atb?.[0]?.price === 'number' ? atb[0].price : null;
        const backSize = typeof atb?.[0]?.size === 'number' ? atb[0].size : null;
        const lay = typeof atl?.[0]?.price === 'number' ? atl[0].price : null;
        const laySize = typeof atl?.[0]?.size === 'number' ? atl[0].size : null;
        quotes[String(selectionId)] = {
          selectionId,
          runnerName: nameBySelectionId.get(selectionId) ?? `#${selectionId}`,
          back,
          backSize,
          lay,
          laySize,
        };
      }

      const snapshot = {
        marketId: mid,
        marketStatus: typeof book?.status === 'string' ? book.status : null,
        fetchedAt: new Date().toISOString(),
        runners: quotes,
      };
      setMarketBookByMatchId((prev) => ({ ...prev, [matchId]: snapshot }));
      return snapshot;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao carregar cotações do mercado', { description: msg.slice(0, 220) });
      return null;
    }
  };

  const openManualOrder = (draft: {
    matchId: string;
    marketId: string;
    marketName: string;
    selectionId: number;
    selectionName: string;
    side: 'BACK' | 'LAY';
    price: number | null;
    size?: number | null;
  }) => {
    setManualDraft({
      matchId: draft.matchId,
      marketId: draft.marketId,
      marketName: draft.marketName,
      selectionId: draft.selectionId,
      selectionName: draft.selectionName,
      side: draft.side,
      price: typeof draft.price === 'number' && Number.isFinite(draft.price) ? String(draft.price) : '',
      size: typeof draft.size === 'number' && Number.isFinite(draft.size) ? String(draft.size) : '2.0',
      persistenceType: 'LAPSE',
    });
    setManualOpen(true);
  };

  const submitManualOrder = async () => {
    if (isPlacingManual) return;
    const d = manualDraft;
    if (!d) return;
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return;
    const p = Number(d.price);
    const s = Number(d.size);
    if (!d.marketId) return toast.error('Mercado inválido.');
    if (!Number.isFinite(d.selectionId)) return toast.error('Seleção inválida.');
    if (!Number.isFinite(p) || p <= 1) return toast.error('Preço inválido.');
    if (!Number.isFinite(s) || s <= 0) return toast.error('Stake inválida.');

    setIsPlacingManual(true);
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/placeOrders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          adminToken,
          marketId: d.marketId,
          instructions: [
            {
              selectionId: d.selectionId,
              handicap: 0,
              side: d.side,
              orderType: 'LIMIT',
              limitOrder: { size: s, price: p, persistenceType: d.persistenceType },
            },
          ],
          customerRef: `web_${d.matchId}_${Date.now().toString(16)}`.slice(0, 32),
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      toast.success('Ordem enviada');
      setManualOpen(false);
      setManualDraft(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao enviar ordem', { description: msg.slice(0, 220) });
    } finally {
      setIsPlacingManual(false);
    }
  };

  const updateItem = async (matchId: string, patch: Partial<QueueItem>) => {
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ matchId, patch }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      setItems((prev) => prev.map((x) => (x.matchId === matchId ? (data.item as QueueItem) : x)));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao atualizar automação', { description: msg.slice(0, 220) });
      return false;
    }
  };

  const normalizeMarketsCorrectScoreOnly = (raw: AutomationMarketToggle[] | null | undefined) => {
    const arr = Array.isArray(raw) ? raw : [];
    const map = arr.map((m) => ({
      ...m,
      enabled: m.key === 'correctScore',
    }));
    if (!map.some((m) => m.key === 'correctScore')) {
      map.push({ key: 'correctScore', label: 'Placar correto', enabled: true, details: null });
    }
    return map;
  };

  const normalizeAgent = (
    raw: unknown,
  ): 'correctScore' | 'scalpingGoals' | 'overGoalsLimit' | 'scalpingTicks' | 'asianHandicap' | 'favoriteRescue' => {
    const agentRaw = String(raw ?? '').trim().toLowerCase();
    if (agentRaw === 'overgoalslimit' || agentRaw === 'over_goals_limit') return 'overGoalsLimit';
    if (agentRaw === 'scalpinggoals' || agentRaw === 'scalping_goals' || agentRaw === 'scalping_goals_above') return 'scalpingGoals';
    if (agentRaw === 'scalpingticks' || agentRaw === 'scalping_ticks') return 'scalpingTicks';
    if (agentRaw === 'asianhandicap' || agentRaw === 'asian_handicap' || agentRaw === 'handicap_asiatico' || agentRaw === 'handicapasiatico')
      return 'asianHandicap';
    if (agentRaw === 'favoriterescue' || agentRaw === 'favorite_rescue' || agentRaw === 'lay_favorito_perdendo') return 'favoriteRescue';
    return 'correctScore';
  };

  const openMarketsForItem = async (x: QueueItem) => {
    const base = Array.isArray(x.markets) ? x.markets : deriveMarketsFromPrediction(x);
    setMarketsItemId(x.matchId);
    setMarketsDraft(base);
    const agentRaw = String(x.strategy?.agent ?? '').trim().toLowerCase();
      const agent =
      agentRaw === 'overgoalslimit' || agentRaw === 'over_goals_limit'
        ? 'overGoalsLimit'
        : agentRaw === 'scalpinggoals' || agentRaw === 'scalping_goals' || agentRaw === 'scalping_goals_above'
          ? 'scalpingGoals'
          : agentRaw === 'scalpingticks' || agentRaw === 'scalping_ticks'
            ? 'scalpingTicks'
            : agentRaw === 'asianhandicap' || agentRaw === 'asian_handicap' || agentRaw === 'handicap_asiatico' || agentRaw === 'handicapasiatico'
              ? 'asianHandicap'
                : agentRaw === 'favoriterescue' || agentRaw === 'favorite_rescue' || agentRaw === 'lay_favorito_perdendo'
                  ? 'favoriteRescue'
              : 'correctScore';
    setRobotType(agent);
    setCsPlanType('coverage');
    setMarketsOpen(true);
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

  const updateMarketDraft = (key: string, enabled: boolean) => {
    setMarketsDraft((prev) => {
      const idx = prev.findIndex((m) => m.key === key);
      if (idx === -1) return prev;
      return prev.map((m) => (m.key === key ? { ...m, enabled } : m));
    });
  };

  const saveMarketsModal = async () => {
    if (!marketsItemId) return;
    const cur = itemsRef.current.find((x) => x.matchId === marketsItemId) ?? null;
    if (!cur) return;
    setMarketsSaveBusy(true);
    try {
      const nextStrategy: any = {
        ...(cur.strategy ?? {}),
        agent:
          robotType === 'overGoalsLimit'
            ? 'overGoalsLimit'
            : robotType === 'scalpingGoals'
              ? 'scalpingGoals'
              : robotType === 'scalpingTicks'
                ? 'scalpingTicks'
                : robotType === 'asianHandicap'
                  ? 'asianHandicap'
                  : 'correctScore',
      };
      if (robotType === 'correctScore') {
        nextStrategy.correctScore = {
          ...(cur.strategy?.correctScore ?? {}),
          planType: 'coverage',
        };
      }
      const marketsToSave = robotType === 'correctScore' ? normalizeMarketsCorrectScoreOnly(marketsDraft) : marketsDraft;
      const ok = await updateItem(marketsItemId, { strategy: nextStrategy, markets: marketsToSave });
      if (!ok) return;
      setMarketsOpen(false);
      setMarketsItemId(null);
      setMarketsDraft([]);
    } finally {
      setMarketsSaveBusy(false);
    }
  };

  const removeItem = async (matchId: string) => {
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
      setItems((prev) => prev.filter((x) => x.matchId !== matchId));
      broadcastAutomationQueueChanged({ action: 'remove', matchId });
      toast.success('Item removido da automação');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao remover item', { description: msg.slice(0, 220) });
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

  const getAdminTokenSilent = () => {
    const cfg = loadApiConfig();
    const adminToken = String(cfg?.automationAdminToken ?? '').trim();
    return adminToken ? adminToken : null;
  };

  const fetchOrdersSummary = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return null;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/openOrdersSummary`,
      {
        method: 'POST',
        headers,
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
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} ${res.statusText} | Resposta inválida: ${raw.slice(0, 200)}`);
      }
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const fetchTradePreview = async (matchId: string) => {
    const adminToken = getAdminTokenSilent();
    if (!adminToken) return null;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/tradePreview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken }),
    });
    const raw = await res.text().catch(() => '');
    if (!res.ok) return null;
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (!data?.ok) return null;
    return {
      risk: typeof data?.risk === 'number' ? data.risk : null,
      cashOut: typeof data?.cashOut === 'number' ? data.cashOut : null,
      profit: typeof data?.profit === 'number' ? data.profit : null,
      fetchedAt: String(data?.fetchedAt ?? new Date().toISOString()),
    };
  };

  const cashoutCorrectScore = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/cashoutHedge`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken }),
    });
    const raw = await res.text().catch(() => '');
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const executeCorrectScoreOnce = async (
    matchId: string,
    params?: { bankroll?: number; maxSelections?: number; entryScoresCsv?: string; live?: any },
  ) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        matchId,
        dryRun: false,
        adminToken,
        live: params?.live ?? null,
        config: { bankroll: Number(params?.bankroll) },
        planConfig: {
          planType: 'coverage',
          maxSelections: params?.maxSelections,
          entryScoresCsv: params?.entryScoresCsv,
        },
      }),
    });
    const raw = await res.text().catch(() => '');
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    if (data?.adoptedExisting) {
      const openCount = typeof data?.openOrdersCount === 'number' ? data.openOrdersCount : null;
      const matchedCount = typeof data?.matchedBetsCount === 'number' ? data.matchedBetsCount : null;
      toast.success('Posição manual detectada', {
        description: `Robô assumiu a gestão do mercado. Abertas: ${openCount ?? '—'} | Executadas: ${matchedCount ?? '—'}`,
      });
    }
    return true;
  };

  const executeScalpingGoalsOnce = async (
    matchId: string,
    config: { bankroll: number; profitTargetPct?: number; stakePct?: number; entryOffsetTicks?: number; secondsToWaitMatch?: number },
  ) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingGoals/tick`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken, config }),
    });
    const raw = await res.text().catch(() => '');
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} ${res.statusText} | Resposta inválida: ${raw.slice(0, 200)}`);
      }
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const executeOverGoalsLimitOnce = async (
    matchId: string,
    config: {
      bankroll: number;
      bankrollTotal?: number;
      minOdds?: number;
      maxEntries?: number;
      profitTargetPct?: number;
      minDeltaTraded?: number;
      dominanceRatio?: number;
      minSecondsBetweenEntries?: number;
      stakePct?: number;
      entryOffsetTicks?: number;
      secondsToWaitMatch?: number;
    },
  ) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/overGoalsLimit/tick`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken, config }),
    });
    const raw = await res.text().catch(() => '');
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} ${res.statusText} | Resposta inválida: ${raw.slice(0, 200)}`);
      }
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const executeAsianHandicapOnce = async (
    matchId: string,
    config: {
      bankroll: number;
      bankrollTotal?: number;
      profitTargetPct?: number;
      stakePct?: number;
      entryOffsetTicks?: number;
      entryMaxWaitSeconds?: number;
      targetTicks?: number;
      maxEntries?: number;
      maxSpreadTicks?: number;
      minMarketMatched?: number;
      minRunnerMatched?: number;
      secondsToWaitMatch?: number;
      mode?: 'scalp' | 'swing' | 'hybrid';
    },
  ) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/asianHandicap/tick`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken, config }),
    });
    const raw = await res.text().catch(() => '');
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} ${res.statusText} | Resposta inválida: ${raw.slice(0, 200)}`);
      }
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const executeScalpingTicksOnce = async (
    matchId: string,
    config: {
      bankroll: number;
      targetTicks?: number;
      entryOffsetTicks?: number;
      entryMaxWaitSeconds?: number;
      maxSpreadTicks?: number;
      minSecondsBetweenCycles?: number;
      stakePct?: number;
      maxCycles?: number;
      secondsToWaitMatch?: number;
      invertVolumePct?: number;
      momentOverThreshold?: number;
      momentOverThresholdLate?: number;
      momentOverThresholdOffDelta?: number;
      momentWindowMinSec?: number;
      momentWindowMaxSec?: number;
      minMarketMatched?: number;
      minRunnerMatched?: number;
      afterGoalWaitSeconds?: number;
      recoveryEnabled?: boolean;
      recoveryIncreasePct?: number;
      recoveryMaxStakeAbs?: number;
    },
  ) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return false;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingTicks/tick`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ matchId, adminToken, config }),
    });
    const raw = await res.text().catch(() => '');
    let data: any = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(`HTTP ${res.status} ${res.statusText} | Resposta inválida: ${raw.slice(0, 200)}`);
      }
    }
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
  };

  const openGuard = (matchId: string, action: 'pause' | 'remove', summary: { open: number; matched: number }) => {
    setGuardMatchId(matchId);
    setGuardAction(action);
    setGuardOrdersCount(summary.open);
    setGuardMatchedCount(summary.matched);
    setGuardOpen(true);
  };

  const handleStartConfirmed = async (x: QueueItem) => {
    const ok = await updateItem(x.matchId, { status: 'running' });
    if (!ok) return;
    try {
      const agent = normalizeAgent(x.strategy?.agent);
      if (isTestMode) {
        const adminToken = getAdminTokenOrToast();
        if (!adminToken) return;

        const desiredMarketId = (() => {
          if (agent === 'correctScore') {
            const cs = String(x.betfair?.correctScore?.marketId ?? '').trim();
            if (cs) return cs;
          }
          return String(x.betfair?.marketId ?? '').trim();
        })();
        if (!desiredMarketId) throw new Error('Jogo ainda não está mapeado na Betfair (marketId ausente).');

        await fetchBetfairMarketsForItem(x);
        const snapshot = await fetchBetfairMarketBookSnapshot(x.matchId, desiredMarketId);
        const marketStatus = String(snapshot?.marketStatus ?? '').trim().toUpperCase();
        if (marketStatus && marketStatus !== 'OPEN') {
          throw new Error(`Mercado não está OPEN (status: ${marketStatus}).`);
        }

        const pickFromOdds = () => {
          const marketId = desiredMarketId;
          const odds = x.betfair?.odds ?? null;
          const sel = x.betfair?.runners ?? null;
          const hb = odds?.home?.back ?? null;
          const ab = odds?.away?.back ?? null;
          const hs = sel?.homeSelectionId ?? null;
          const as = sel?.awaySelectionId ?? null;
          if (typeof hb === 'number' && Number.isFinite(hb) && hb > 1 && typeof ab === 'number' && Number.isFinite(ab) && ab > 1) {
            if (hb <= ab && typeof hs === 'number' && Number.isFinite(hs)) return { marketId, selectionId: hs, price: hb, label: 'Casa' };
            if (typeof as === 'number' && Number.isFinite(as)) return { marketId, selectionId: as, price: ab, label: 'Fora' };
          }
          if (typeof hb === 'number' && Number.isFinite(hb) && hb > 1 && typeof hs === 'number' && Number.isFinite(hs)) {
            return { marketId, selectionId: hs, price: hb, label: 'Casa' };
          }
          if (typeof ab === 'number' && Number.isFinite(ab) && ab > 1 && typeof as === 'number' && Number.isFinite(as)) {
            return { marketId, selectionId: as, price: ab, label: 'Fora' };
          }
          return null;
        };

        const pickFromBook = () => {
          const runners = snapshot?.runners ?? {};
          const entries = Object.values(runners);
          const best = entries.find((r) => typeof r.back === 'number' && Number.isFinite(r.back) && r.back > 1) ?? null;
          if (!best) return null;
          return { marketId: desiredMarketId, selectionId: best.selectionId, price: best.back as number, label: best.runnerName };
        };

        const picked = pickFromOdds() ?? pickFromBook();
        if (!picked) throw new Error('Sem preço BACK disponível para enviar ordem de teste.');

        const { projectId } = await import('/utils/supabase/info');
        const headers = await getEdgeHeaders();
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/placeOrders`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            adminToken,
            marketId: picked.marketId,
            instructions: [
              {
                selectionId: picked.selectionId,
                handicap: 0,
                side: 'BACK',
                orderType: 'LIMIT',
                limitOrder: { size: 2.0, price: picked.price, persistenceType: 'LAPSE' },
              },
            ],
            customerRef: `test_${agent}_${x.matchId}_${Date.now().toString(16)}`.slice(0, 32),
          }),
        });
        const raw = await res.text().catch(() => '');
        const data = raw ? JSON.parse(raw) : null;
        if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
        toast.success('Ordem de teste enviada', { description: `${agent} | ${picked.label} @ ${formatOdd(picked.price)} | stake R$ 2` });
        await loadQueue({ silent: true });
        return;
      }
      if (agent === 'favoriteRescue') return;
      if (agent === 'scalpingGoals' || agent === 'overGoalsLimit' || agent === 'scalpingTicks' || agent === 'asianHandicap') {
        const cfg = loadApiConfig();
        const bankrollTotal = Number(cfg?.betfairBankroll ?? 0);
        const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
        const overUnderPct = Number(marketPercents.overUnder ?? 10);
        const bankroll =
          Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(overUnderPct) && overUnderPct > 0
            ? Math.round(((bankrollTotal * overUnderPct) / 100) * 100) / 100
            : 50;
        const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
        if (agent === 'overGoalsLimit') {
          const lim = (robotLimits as any)?.overGoalsLimit && typeof (robotLimits as any).overGoalsLimit === 'object' ? (robotLimits as any).overGoalsLimit : {};
          await executeOverGoalsLimitOnce(x.matchId, {
            bankroll,
            bankrollTotal,
            minOdds: Number(lim?.minOdds),
            maxEntries: Number(lim?.maxEntries),
            profitTargetPct: Number(lim?.profitTargetPct),
            minDeltaTraded: Number(lim?.minDeltaTraded),
            dominanceRatio: Number(lim?.dominanceRatio),
            minSecondsBetweenEntries: Number(lim?.minSecondsBetweenEntries),
            stakePct: Number(lim?.stakePct),
            entryOffsetTicks: Number(lim?.entryOffsetTicks),
            secondsToWaitMatch: Number(lim?.secondsToWaitMatch),
          });
        } else if (agent === 'asianHandicap') {
          const lim = (robotLimits as any)?.asianHandicap && typeof (robotLimits as any).asianHandicap === 'object' ? (robotLimits as any).asianHandicap : {};
          const m = String(lim?.mode ?? '').trim().toLowerCase();
          const mode = m === 'scalp' || m === 'swing' || m === 'hybrid' ? (m as any) : undefined;
          await executeAsianHandicapOnce(x.matchId, {
            bankroll,
            bankrollTotal,
            profitTargetPct: Number(lim?.profitTargetPct),
            stakePct: Number(lim?.stakePct),
            entryOffsetTicks: Number(lim?.entryOffsetTicks),
            entryMaxWaitSeconds: Number(lim?.entryMaxWaitSeconds),
            targetTicks: Number(lim?.targetTicks),
            maxEntries: Number(lim?.maxEntries),
            maxSpreadTicks: Number(lim?.maxSpreadTicks),
            minMarketMatched: Number(lim?.minMarketMatched),
            minRunnerMatched: Number(lim?.minRunnerMatched),
            secondsToWaitMatch: Number(lim?.secondsToWaitMatch),
            ...(mode ? { mode } : {}),
          });
        } else if (agent === 'scalpingTicks') {
          const lim = (robotLimits as any)?.scalpingTicks && typeof (robotLimits as any).scalpingTicks === 'object' ? (robotLimits as any).scalpingTicks : {};
          await executeScalpingTicksOnce(x.matchId, {
            bankroll,
            targetTicks: Number(lim?.targetTicks),
            entryOffsetTicks: Number(lim?.entryOffsetTicks),
            entryMaxWaitSeconds: Number((lim as any)?.entryMaxWaitSeconds),
            maxSpreadTicks: Number(lim?.maxSpreadTicks),
            minSecondsBetweenCycles: Number(lim?.minSecondsBetweenCycles),
            stakePct: Number(lim?.stakePct),
            maxCycles: Number(lim?.maxCycles),
            secondsToWaitMatch: Number(lim?.secondsToWaitMatch),
            invertVolumePct: Number(lim?.invertVolumePct),
            momentOverThreshold: Number(lim?.momentOverThreshold),
            momentOverThresholdLate: Number(lim?.momentOverThresholdLate),
            momentOverThresholdOffDelta: Number(lim?.momentOverThresholdOffDelta),
            momentWindowMinSec: Number(lim?.momentWindowMinSec),
            momentWindowMaxSec: Number(lim?.momentWindowMaxSec),
            minMarketMatched: Number(lim?.minMarketMatched),
            minRunnerMatched: Number(lim?.minRunnerMatched),
            afterGoalWaitSeconds: Number(lim?.afterGoalWaitSeconds),
            recoveryEnabled: typeof (lim as any)?.recoveryEnabled === 'boolean' ? Boolean((lim as any).recoveryEnabled) : undefined,
            recoveryIncreasePct: Number((lim as any)?.recoveryIncreasePct),
            recoveryMaxStakeAbs: Number((lim as any)?.recoveryMaxStakeAbs),
          });
        } else {
          const lim = (robotLimits as any)?.scalpingGoals && typeof (robotLimits as any).scalpingGoals === 'object' ? (robotLimits as any).scalpingGoals : {};
          const profitTargetPct = Number(lim?.profitTargetPct);
          const stakePct = Number(lim?.stakePct);
          const entryOffsetTicks = Number(lim?.entryOffsetTicks);
          const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
          await executeScalpingGoalsOnce(x.matchId, {
            bankroll,
            ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
            ...(Number.isFinite(stakePct) ? { stakePct } : {}),
            ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
            ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
          });
        }
      } else {
        const cfg = loadApiConfig();
        const bankrollTotal = Number(cfg?.betfairBankroll ?? 0);
        const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
        const correctScorePct = Number(marketPercents.correctScore ?? 10);
        const bankroll =
          Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(correctScorePct) && correctScorePct > 0
            ? Math.round(((bankrollTotal * correctScorePct) / 100) * 100) / 100
            : 50;
        const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
        const csLim = (robotLimits as any)?.correctScore && typeof (robotLimits as any).correctScore === 'object' ? (robotLimits as any).correctScore : {};
        const apiLive = apiFootballLiveByMatchId[String(x.matchId)] ?? null;
        await executeCorrectScoreOnce(x.matchId, {
          bankroll,
          maxSelections: Number(csLim?.maxSelections),
          entryScoresCsv: String(csLim?.entryScoresCsv ?? '0-0,0-1,1-0,1-1'),
          live: apiLive
            ? {
                fetchedAt: apiLive.fetchedAt,
                elapsed: apiLive.elapsed,
                scoreHome: apiLive.goalsHome,
                scoreAway: apiLive.goalsAway,
              }
            : null,
        });
      }
      await loadQueue({ silent: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao iniciar execução', { description: msg.slice(0, 220) });
    }
  };

  const openStartConfirm = (x: QueueItem) => {
    setStartConfirmItem(x);
    setStartConfirmOpen(true);
  };

  const handlePause = async (x: QueueItem) => {
    try {
      const summary = await fetchOrdersSummary(x.matchId);
      if (summary && summary.open > 0) return openGuard(x.matchId, 'pause', summary);
      await updateItem(x.matchId, { status: 'paused' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao checar ordens', { description: msg.slice(0, 220) });
    }
  };

  const handleRemove = async (x: QueueItem) => {
    try {
      const summary = await fetchOrdersSummary(x.matchId);
      if (summary && (summary.open > 0 || summary.matched > 0)) return openGuard(x.matchId, 'remove', summary);
      await removeItem(x.matchId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao checar ordens', { description: msg.slice(0, 220) });
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const rows = itemsRef.current;
      if (!Array.isArray(rows) || rows.length === 0) return;
      const store = (finishedStopSentRef.current as unknown as Set<string>) ?? new Set<string>();
      for (const x of rows) {
        if (!x?.matchId) continue;
        if (x.status !== 'running' && x.status !== 'paused') continue;
        if (!isFinished(x)) continue;
        if (store.has(x.matchId)) continue;
        store.add(x.matchId);
        void updateItem(x.matchId, { status: 'stopped' });
      }
      finishedStopSentRef.current = store as any;
    }, 20_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void refreshOdds();
    const id = window.setInterval(() => {
      void refreshOdds();
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const tickScalpingTicksFast = async () => {
      if (isFastTickScalpingTicksRef.current) return;
      if (isTestModeRef.current) return;
      isFastTickScalpingTicksRef.current = true;
      try {
        const cfg = loadApiConfig();
        const adminToken = String(cfg?.automationAdminToken ?? '').trim();
        if (!adminToken) return;
        const bankrollTotal = Number(cfg?.betfairBankroll ?? 0);
        const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
        const overUnderPct = Number(marketPercents.overUnder ?? 10);
        const bankrollForOverUnder =
          Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(overUnderPct) && overUnderPct > 0
            ? Math.round(((bankrollTotal * overUnderPct) / 100) * 100) / 100
            : 50;
        const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
        const lim = (robotLimits as any)?.scalpingTicks && typeof (robotLimits as any).scalpingTicks === 'object' ? (robotLimits as any).scalpingTicks : {};

        const targets = itemsRef.current
          .filter((x) => x.status === 'running')
          .filter((x) => normalizeAgent(x.strategy?.agent) === 'scalpingTicks')
          .slice(0, 6);
        if (targets.length === 0) return;

        const { projectId } = await import('/utils/supabase/info');
        const headers = await getEdgeHeaders();

        for (const x of targets) {
          const lastTick = String((x as any).strategy?.scalpingTicks?.lastTickAt ?? '').trim();
          const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
          if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 9_000) continue;

          const live = (apiFootballLiveRef.current as any)?.[String(x.matchId)] ?? null;
          const tickRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingTicks/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: x.matchId,
              adminToken,
              live: live
                ? {
                    fetchedAt: live.fetchedAt,
                    elapsed: live.elapsed,
                    scoreHome: live.goalsHome,
                    scoreAway: live.goalsAway,
                  }
                : null,
              config: {
                bankroll: bankrollForOverUnder,
                ...(Number.isFinite(Number(lim?.targetTicks)) ? { targetTicks: Number(lim?.targetTicks) } : {}),
                ...(Number.isFinite(Number(lim?.entryOffsetTicks)) ? { entryOffsetTicks: Number(lim?.entryOffsetTicks) } : {}),
                ...(Number.isFinite(Number((lim as any)?.entryMaxWaitSeconds)) ? { entryMaxWaitSeconds: Number((lim as any).entryMaxWaitSeconds) } : {}),
                ...(Number.isFinite(Number(lim?.maxSpreadTicks)) ? { maxSpreadTicks: Number(lim?.maxSpreadTicks) } : {}),
                ...(Number.isFinite(Number(lim?.minSecondsBetweenCycles)) ? { minSecondsBetweenCycles: Number(lim?.minSecondsBetweenCycles) } : {}),
                ...(Number.isFinite(Number(lim?.stakePct)) ? { stakePct: Number(lim?.stakePct) } : {}),
                ...(Number.isFinite(Number(lim?.maxCycles)) ? { maxCycles: Number(lim?.maxCycles) } : {}),
                ...(Number.isFinite(Number(lim?.secondsToWaitMatch)) ? { secondsToWaitMatch: Number(lim?.secondsToWaitMatch) } : {}),
                ...(Number.isFinite(Number(lim?.invertVolumePct)) ? { invertVolumePct: Number(lim?.invertVolumePct) } : {}),
                ...(Number.isFinite(Number(lim?.momentOverThreshold)) ? { momentOverThreshold: Number(lim?.momentOverThreshold) } : {}),
                ...(Number.isFinite(Number(lim?.momentOverThresholdLate)) ? { momentOverThresholdLate: Number(lim?.momentOverThresholdLate) } : {}),
                ...(Number.isFinite(Number(lim?.momentOverThresholdOffDelta)) ? { momentOverThresholdOffDelta: Number(lim?.momentOverThresholdOffDelta) } : {}),
                ...(Number.isFinite(Number(lim?.momentWindowMinSec)) ? { momentWindowMinSec: Number(lim?.momentWindowMinSec) } : {}),
                ...(Number.isFinite(Number(lim?.momentWindowMaxSec)) ? { momentWindowMaxSec: Number(lim?.momentWindowMaxSec) } : {}),
                ...(Number.isFinite(Number(lim?.minMarketMatched)) ? { minMarketMatched: Number(lim?.minMarketMatched) } : {}),
                ...(Number.isFinite(Number(lim?.minRunnerMatched)) ? { minRunnerMatched: Number(lim?.minRunnerMatched) } : {}),
                ...(Number.isFinite(Number(lim?.afterGoalWaitSeconds)) ? { afterGoalWaitSeconds: Number(lim?.afterGoalWaitSeconds) } : {}),
                ...(typeof (lim as any)?.recoveryEnabled === 'boolean' ? { recoveryEnabled: Boolean((lim as any).recoveryEnabled) } : {}),
                ...(Number.isFinite(Number((lim as any)?.recoveryIncreasePct)) ? { recoveryIncreasePct: Number((lim as any).recoveryIncreasePct) } : {}),
                ...(Number.isFinite(Number((lim as any)?.recoveryMaxStakeAbs)) ? { recoveryMaxStakeAbs: Number((lim as any).recoveryMaxStakeAbs) } : {}),
              },
            }),
          }).catch(() => null);

          if (tickRes && !tickRes.ok) {
            const t = await tickRes.text().catch(() => '');
            console.warn('scalpingTicks fast tick HTTP error', { matchId: x.matchId, status: tickRes.status, body: t ? t.slice(0, 300) : '' });
          }
        }

        await loadQueue({ silent: true });
      } finally {
        isFastTickScalpingTicksRef.current = false;
      }
    };

    void tickScalpingTicksFast();
    const id = window.setInterval(() => {
      void tickScalpingTicksFast();
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    tradePreviewRef.current = tradePreviewByMatchId;
  }, [tradePreviewByMatchId]);

  useEffect(() => {
    apiFootballLiveRef.current = apiFootballLiveByMatchId as any;
  }, [apiFootballLiveByMatchId]);

  useEffect(() => {
    const tick = async () => {
      if (isRefreshingTradePreviewRef.current) return;
      const active = itemsRef.current.filter((x) => x.status === 'running' && String(x?.betfair?.correctScore?.marketId ?? '').trim());
      if (active.length === 0) return;

      isRefreshingTradePreviewRef.current = true;
      try {
        for (const x of active) {
          const existing = tradePreviewRef.current[x.matchId];
          const lastAt = existing?.fetchedAt ? new Date(existing.fetchedAt).getTime() : 0;
          if (lastAt && Date.now() - lastAt < 25_000) continue;
          const preview = await fetchTradePreview(x.matchId);
          if (!preview) continue;
          setTradePreviewByMatchId((prev) => ({ ...prev, [x.matchId]: preview }));
        }
      } finally {
        isRefreshingTradePreviewRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <Dialog
        open={marketsOpen}
        onOpenChange={(v) => {
          if (marketsSaveBusy) return;
          setMarketsOpen(v);
          if (!v) {
            setMarketsItemId(null);
            setMarketsDraft([]);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mercados da automação</DialogTitle>
            <DialogDescription>
              Selecione um robô para este jogo.
            </DialogDescription>
          </DialogHeader>

          {marketsItemId ? (
            <div className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-3">
              <div className="text-sm font-semibold text-gray-900">Robô</div>
              <div className="mt-1 text-xs text-gray-600">Escolha qual robô vai operar este jogo.</div>

              <div className="mt-3">
                <Label htmlFor="robotType">Tipo</Label>
                <select
                  id="robotType"
                  value={robotType}
                  onChange={(e) => {
                    if (!marketsItemId) return;
                    const v =
                      e.target.value === 'overGoalsLimit'
                        ? 'overGoalsLimit'
                        : e.target.value === 'scalpingGoals'
                          ? 'scalpingGoals'
                          : e.target.value === 'scalpingTicks'
                            ? 'scalpingTicks'
                            : e.target.value === 'asianHandicap'
                              ? 'asianHandicap'
                            : 'correctScore';
                    setRobotType(v);
                  }}
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="correctScore">Correct Score (Placar Correto)</option>
                  <option value="scalpingGoals">Scalping Gol Acima</option>
                  <option value="overGoalsLimit">Over Gols Limite</option>
                  <option value="scalpingTicks">Scalping em Ticks</option>
                  <option value="asianHandicap">Handicap Asiático</option>
                </select>
              </div>

              {robotType === 'correctScore' ? (
                <div className="mt-4">
                  <div className="text-sm font-semibold text-gray-900">Estratégia (Correct Score)</div>
                  <div className="mt-1 text-xs text-gray-600">Modo único: Dutching (Cobertura).</div>
                </div>
              ) : robotType === 'scalpingGoals' ? (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Opera mercados de gols (Under/Over) com estratégia de scalping e cashout/hedge automático.
                </div>
              ) : robotType === 'scalpingTicks' ? (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Faz scalping no Under 0.5 acima do placar, buscando ciclos de ticks positivos.
                </div>
              ) : robotType === 'asianHandicap' ? (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Opera Asian Handicap com leitura de pressão + fluxo, alternando entre scalp e swing conforme o momentum.
                </div>
              ) : (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Opera mercados de Over (limite de gols) com leitura de liquidez/volume e até 3 entradas por jogo.
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-3">
            <div className="text-sm font-semibold text-gray-900">Previsões</div>
            <div className="mt-1 text-xs text-gray-600">Desativado por enquanto. A automação está operando somente pelos bots e suas estratégias.</div>
          </div>

          <div className="mt-2 text-xs text-gray-600">
            Selecione um robô e clique em <span className="font-semibold">Salvar</span>. Depois clique em <span className="font-semibold">Iniciar</span> no card.
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={marketsSaveBusy}
              onClick={() => {
                setMarketsOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button disabled={marketsSaveBusy || !marketsItemId} onClick={() => void saveMarketsModal()}>
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={startConfirmOpen}
        onOpenChange={(v) => {
          if (startConfirmBusy) return;
          setStartConfirmOpen(v);
          if (!v) setStartConfirmItem(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {(() => {
            const x = startConfirmItem;
            const agent = normalizeAgent(x?.strategy?.agent);
            const title = x ? `${x.homeTeam ?? '—'} x ${x.awayTeam ?? '—'}` : null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Iniciar automação</DialogTitle>
                  <DialogDescription>
                    O agente IA vai assumir a operação deste jogo conforme a estratégia selecionada. Confirme para iniciar.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-2 space-y-2">
                  {title ? <div className="text-sm font-semibold text-gray-900">{title}</div> : null}
                  {agent === 'scalpingGoals' ? (
                    <div className="text-sm text-gray-700">
                      Robô: <span className="font-semibold">Scalping Gol Acima</span>
                    </div>
                  ) : agent === 'scalpingTicks' ? (
                    <div className="text-sm text-gray-700">
                      Robô: <span className="font-semibold">Scalping em Ticks</span>
                    </div>
                  ) : agent === 'overGoalsLimit' ? (
                    <div className="text-sm text-gray-700">
                      Robô: <span className="font-semibold">Over Gols Limite</span>
                    </div>
                  ) : agent === 'asianHandicap' ? (
                    <div className="text-sm text-gray-700">
                      Robô: <span className="font-semibold">Handicap Asiático</span>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-700">
                      Estratégia (Correct Score): <span className="font-semibold">Dutching (Cobertura)</span>
                    </div>
                  )}
                  <div className="text-xs text-gray-600">
                    Se já existir posição manual no mercado, o robô detecta e assume a gestão sem duplicar entradas.
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 mt-4">
                  <Button
                    variant="outline"
                    disabled={startConfirmBusy}
                    onClick={() => {
                      setStartConfirmOpen(false);
                      setStartConfirmItem(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    disabled={startConfirmBusy || !startConfirmItem}
                    onClick={async () => {
                      if (!startConfirmItem) return;
                      setStartConfirmBusy(true);
                      try {
                        await handleStartConfirmed(startConfirmItem);
                        setStartConfirmOpen(false);
                        setStartConfirmItem(null);
                      } finally {
                        setStartConfirmBusy(false);
                      }
                    }}
                  >
                    Confirmar e iniciar
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={cashoutConfirmOpen}
        onOpenChange={(v) => {
          if (cashoutConfirmBusy) return;
          setCashoutConfirmOpen(v);
          if (!v) setCashoutConfirmMatchId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {(() => {
            const matchId = String(cashoutConfirmMatchId ?? '').trim();
            const x = matchId ? itemsRef.current.find((it) => it.matchId === matchId) ?? null : null;
            const title = x ? `${x.homeTeam ?? '—'} x ${x.awayTeam ?? '—'}` : null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Confirmar Cashout</DialogTitle>
                  <DialogDescription>Ao confirmar, faremos hedge (cashout) da operação.</DialogDescription>
                </DialogHeader>

                {title ? <div className="mt-2 text-sm font-semibold text-gray-900">{title}</div> : null}

                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    disabled={cashoutConfirmBusy}
                    onClick={() => {
                      setCashoutConfirmOpen(false);
                      setCashoutConfirmMatchId(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    disabled={cashoutConfirmBusy || !matchId}
                    onClick={async () => {
                      if (!matchId) return;
                      setCashoutConfirmBusy(true);
                      try {
                        await cashoutCorrectScore(matchId);
                        setTradePreviewByMatchId((prev) => {
                          const next = { ...prev };
                          delete next[matchId];
                          return next;
                        });
                        await loadQueue({ silent: true });
                        toast.success('Cashout enviado', { description: 'Hedge solicitado com sucesso.' });
                        setCashoutConfirmOpen(false);
                        setCashoutConfirmMatchId(null);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        toast.error('Falha no cashout', { description: msg.slice(0, 220) });
                      } finally {
                        setCashoutConfirmBusy(false);
                      }
                    }}
                  >
                    Confirmar
                  </Button>
                </div>
              </>
            );
          })()}
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
            Há {guardOrdersCount} ordem(ns) aberta(s) e {guardMatchedCount} ordem(ns) executada(s) vinculadas ao robô desta partida. Confirme a ação.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 mt-2">
            <Button
              variant="outline"
              disabled={guardIsBusy}
              onClick={() => {
                setGuardOpen(false);
                setGuardMatchId(null);
                setGuardAction(null);
                setGuardOrdersCount(0);
                setGuardMatchedCount(0);
              }}
            >
              Cancelar
            </Button>

            {guardAction === 'pause' ? (
              <>
                <Button
                  variant="outline"
                  disabled={guardIsBusy || !guardMatchId}
                  onClick={async () => {
                    if (!guardMatchId) return;
                    setGuardIsBusy(true);
                    try {
                      await updateItem(guardMatchId, { status: 'paused' });
                      setGuardOpen(false);
                    } finally {
                      setGuardIsBusy(false);
                    }
                  }}
                >
                  Pausar mesmo assim
                </Button>
                <Button
                  disabled={guardIsBusy || !guardMatchId}
                  onClick={async () => {
                    if (!guardMatchId) return;
                    setGuardIsBusy(true);
                    try {
                      await cashoutCorrectScore(guardMatchId);
                      await updateItem(guardMatchId, { status: 'paused' });
                      await loadQueue({ silent: true });
                      setGuardOpen(false);
                      toast.success('Cashout enviado e automação pausada');
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      toast.error('Falha ao fazer cashout', { description: msg.slice(0, 220) });
                    } finally {
                      setGuardIsBusy(false);
                    }
                  }}
                >
                  Cashout (hedge) e pausar
                </Button>
              </>
            ) : guardAction === 'remove' ? (
              <>
                <Button
                  variant="outline"
                  disabled={guardIsBusy || !guardMatchId}
                  onClick={async () => {
                    if (!guardMatchId) return;
                    setGuardIsBusy(true);
                    try {
                      await removeItem(guardMatchId);
                      setGuardOpen(false);
                      toast.success('Item removido');
                    } finally {
                      setGuardIsBusy(false);
                    }
                  }}
                >
                  Remover mesmo assim
                </Button>
                <Button
                  variant="destructive"
                  disabled={guardIsBusy || !guardMatchId}
                  onClick={async () => {
                    if (!guardMatchId) return;
                    setGuardIsBusy(true);
                    try {
                      await cashoutCorrectScore(guardMatchId);
                      await removeItem(guardMatchId);
                      setGuardOpen(false);
                      toast.success('Cashout enviado e item removido');
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      toast.error('Falha ao remover com cashout', { description: msg.slice(0, 220) });
                    } finally {
                      setGuardIsBusy(false);
                    }
                  }}
                >
                  Cashout (hedge) e remover
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manualOpen}
        onOpenChange={(v) => {
          if (isPlacingManual) return;
          setManualOpen(v);
          if (!v) setManualDraft(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Entrada manual (Betfair)</DialogTitle>
            <DialogDescription>Clique em uma odd BACK ou LAY para abrir esta tela.</DialogDescription>
          </DialogHeader>

          {manualDraft ? (
            <div className="mt-2">
              <div className="text-sm font-semibold text-gray-900">{manualDraft.selectionName}</div>
              <div className="mt-1 text-xs text-gray-600">
                <span className="tabular-nums">{manualDraft.side}</span>
                <span className="mx-2 opacity-60">•</span>
                <span className="tabular-nums">Sel: {manualDraft.selectionId}</span>
              </div>
              <div className="mt-1 text-xs text-gray-600 truncate">
                Mercado: {manualDraft.marketName}{' '}
                <span className="tabular-nums opacity-70">({manualDraft.marketId})</span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="manualPrice">Preço</Label>
                  <Input
                    id="manualPrice"
                    value={manualDraft.price}
                    onChange={(e) => setManualDraft((prev) => (prev ? { ...prev, price: e.target.value } : prev))}
                    placeholder="Ex: 2.0"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="manualSize">Stake</Label>
                  <Input
                    id="manualSize"
                    value={manualDraft.size}
                    onChange={(e) => setManualDraft((prev) => (prev ? { ...prev, size: e.target.value } : prev))}
                    placeholder="Ex: 2.0"
                    className="mt-2"
                  />
                </div>
              </div>

              <div className="mt-3">
                <Label htmlFor="manualPersistence">Persistência</Label>
                <select
                  id="manualPersistence"
                  value={manualDraft.persistenceType}
                  onChange={(e) =>
                    setManualDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            persistenceType:
                              e.target.value === 'PERSIST' ? 'PERSIST' : e.target.value === 'MARKET_ON_CLOSE' ? 'MARKET_ON_CLOSE' : 'LAPSE',
                          }
                        : prev,
                    )
                  }
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="LAPSE">Cancelar (LAPSE)</option>
                  <option value="PERSIST">Manter (PERSIST)</option>
                  <option value="MARKET_ON_CLOSE">Fechar no mercado (MOC)</option>
                </select>
              </div>

              {(() => {
                const parseNum = (raw: string) => {
                  const s = String(raw ?? '')
                    .trim()
                    .replace(/\s+/g, '')
                    .replace(',', '.')
                    .replace(/[^0-9.]/g, '');
                  if (!s) return null;
                  const n = Number(s);
                  return Number.isFinite(n) ? n : null;
                };

                const stake = parseNum(manualDraft.size);
                const odd = parseNum(manualDraft.price);
                const canCalc = typeof stake === 'number' && stake > 0 && typeof odd === 'number' && odd > 1;
                const fmt = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? formatMoneyBR(v) : '—');

                if (manualDraft.side === 'BACK') {
                  const profit = canCalc ? stake * (odd - 1) : null;
                  const totalReturn = canCalc ? stake * odd : null;
                  return (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="text-xs font-semibold text-gray-700">Resumo</div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-700">
                        <div>Retorno total</div>
                        <div className="text-right tabular-nums font-semibold">{fmt(totalReturn)}</div>
                        <div>Lucro se ganhar</div>
                        <div className="text-right tabular-nums font-semibold">{fmt(profit)}</div>
                        <div>Perda se perder</div>
                        <div className="text-right tabular-nums font-semibold">{fmt(stake)}</div>
                      </div>
                      {!canCalc ? <div className="mt-1 text-[11px] text-gray-500">Preencha preço e stake para calcular.</div> : null}
                    </div>
                  );
                }

                const liability = canCalc ? stake * (odd - 1) : null;
                const profit = canCalc ? stake : null;
                return (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-xs font-semibold text-gray-700">Resumo</div>
                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-700">
                      <div>Responsabilidade</div>
                      <div className="text-right tabular-nums font-semibold">{fmt(liability)}</div>
                      <div>Lucro se NÃO acontecer</div>
                      <div className="text-right tabular-nums font-semibold">{fmt(profit)}</div>
                      <div>Perda se acontecer</div>
                      <div className="text-right tabular-nums font-semibold">{fmt(liability)}</div>
                    </div>
                    {!canCalc ? <div className="mt-1 text-[11px] text-gray-500">Preencha preço e stake para calcular.</div> : null}
                  </div>
                );
              })()}

              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={isPlacingManual}
                  onClick={() => {
                    setManualOpen(false);
                    setManualDraft(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button disabled={isPlacingManual} onClick={() => void submitManualOrder()}>
                  {isPlacingManual ? 'Enviando…' : 'Enviar ordem'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-emerald-700" />
              <h1 className="text-3xl font-bold text-gray-900">Automação</h1>
              <Badge variant="outline" className="tabular-nums">
                Betfair
              </Badge>
            </div>
            <div className="mt-2 text-gray-600">
              Lista de jogos selecionados para processamento automático por agentes operacionais.
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch checked={isTestMode} onCheckedChange={setIsTestMode} />
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-900">{isTestMode ? 'Modo teste' : 'Modo real'}</div>
                <div className={cn('text-xs', isTestMode ? 'text-amber-700' : 'text-gray-600')}>
                  {isTestMode ? 'Envia ordem ao iniciar' : 'Estratégia normal'}
                </div>
              </div>
            </div>
            <Button variant="outline" onClick={() => void loadQueue()} disabled={status === 'loading'}>
              <RefreshCw className={cn('w-4 h-4 mr-2', status === 'loading' ? 'animate-spin' : '')} />
              Atualizar
            </Button>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-gray-900">Lista (estilo Exchange)</div>
              <div className="text-sm text-gray-600 mt-1">
                Os jogos adicionados aparecem agrupados por data, com coluna de 1/X/2 e badges com os mercados sugeridos pelos agentes.
              </div>
            </div>
            <Badge variant="outline" className="tabular-nums">
              {scopeFiltered.length}
            </Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')}>
              Todos
            </Button>
            <Button variant={view === 'live' ? 'default' : 'outline'} onClick={() => setView('live')}>
              Ao vivo
            </Button>
            <Button variant={view === 'today' ? 'default' : 'outline'} onClick={() => setView('today')}>
              Hoje
            </Button>
            <Button variant={view === 'tomorrow' ? 'default' : 'outline'} onClick={() => setView('tomorrow')}>
              Amanhã
            </Button>
            <Button variant={view === 'next' ? 'default' : 'outline'} onClick={() => setView('next')}>
              Próximos dias
            </Button>
          </div>

          {scopeFiltered.length === 0 ? (
            <div className="mt-3 text-sm text-gray-600">Nenhum jogo nessa visualização.</div>
          ) : (
            <div className="mt-4 space-y-6">
              {grouped.map((g) => {
                const renderRows = (rows: QueueItem[]) => (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                    <div className="min-w-[980px]">
                      <div className="grid grid-cols-[44px_72px_1fr_repeat(6,72px)_220px] text-xs font-semibold text-gray-700 bg-gray-100 border-b border-gray-200">
                        <div className="px-2 py-2 text-center"></div>
                        <div className="px-2 py-2 text-center">Tempo</div>
                        <div className="px-3 py-2">Jogo</div>
                        <div className="px-2 py-2 text-center" style={{ gridColumn: 'span 2' }}>
                          1
                        </div>
                        <div className="px-2 py-2 text-center" style={{ gridColumn: 'span 2' }}>
                          X
                        </div>
                        <div className="px-2 py-2 text-center" style={{ gridColumn: 'span 2' }}>
                          2
                        </div>
                        <div className="px-3 py-2 text-right">Ações</div>
                      </div>

                      {rows.map((x) => {
                        const k = kickoffDate(x);
                        const agent = normalizeAgent(x.strategy?.agent);
                        const mapped = Boolean(x.betfair?.marketId);
                        const matched = x.betfair?.matchedVolume ?? null;
                        const markets = Array.isArray(x.markets) ? x.markets : deriveMarketsFromPrediction(x);
                        const finished = isFinished(x);
                        const live = isLive(x);
                        const canPause = !finished && x.status === 'running';
                        const canStart = !finished && (x.status === 'queued' || x.status === 'paused' || x.status === 'stopped');
                        const canStop = !finished && (x.status === 'running' || x.status === 'paused');
                        const gameStatusLabel = live ? 'AO VIVO' : finished ? 'FINALIZADO' : 'EM BREVE';
                        const gameStatusVariant = live ? 'default' : finished ? 'secondary' : 'outline';
                        const baseMarketId = String(x.betfair?.marketId ?? '').trim();
                        const selectedMarketId = String(selectedMarketByMatchId[x.matchId] ?? baseMarketId).trim();
                        const marketOptions = marketOptionsByMatchId[x.matchId]?.items ?? [];
                        const selectedOpt = marketOptions.find((m) => m.marketId === selectedMarketId) ?? null;
                        const marketName = selectedOpt?.marketName ?? (selectedMarketId === baseMarketId ? 'Match Odds' : 'Mercado');

                        const book = marketBookByMatchId[x.matchId] ?? null;
                        const bookIsSelected = Boolean(book?.marketId && book.marketId === selectedMarketId);

                        const statusForSelected = selectedMarketId === baseMarketId ? String(x.betfair?.marketStatus ?? '').toUpperCase() : String(book?.marketStatus ?? '').toUpperCase();
                        const isSuspended = statusForSelected === 'SUSPENDED';

                        const matchOddsRunners = {
                          home: {
                            selectionId: Number(x.betfair?.runners?.homeSelectionId ?? NaN),
                            runnerName: String(x.homeTeam ?? 'Casa'),
                            back: x.betfair?.odds?.home?.back ?? null,
                            backSize: x.betfair?.odds?.home?.backSize ?? null,
                            lay: x.betfair?.odds?.home?.lay ?? null,
                            laySize: x.betfair?.odds?.home?.laySize ?? null,
                          },
                          draw: {
                            selectionId: Number(x.betfair?.runners?.drawSelectionId ?? NaN),
                            runnerName: 'Empate',
                            back: x.betfair?.odds?.draw?.back ?? null,
                            backSize: x.betfair?.odds?.draw?.backSize ?? null,
                            lay: x.betfair?.odds?.draw?.lay ?? null,
                            laySize: x.betfair?.odds?.draw?.laySize ?? null,
                          },
                          away: {
                            selectionId: Number(x.betfair?.runners?.awaySelectionId ?? NaN),
                            runnerName: String(x.awayTeam ?? 'Visitante'),
                            back: x.betfair?.odds?.away?.back ?? null,
                            backSize: x.betfair?.odds?.away?.backSize ?? null,
                            lay: x.betfair?.odds?.away?.lay ?? null,
                            laySize: x.betfair?.odds?.away?.laySize ?? null,
                          },
                        };

                        const takeRunnerSlotsFromBook = () => {
                          const runners = selectedOpt?.runners ?? [];
                          const out: Array<{ selectionId: number; runnerName: string }> = [];
                          for (const r of runners) {
                            if (!Number.isFinite(r.selectionId)) continue;
                            out.push({ selectionId: r.selectionId, runnerName: r.runnerName });
                            if (out.length >= 3) break;
                          }
                          if (out.length > 0) return out;
                          const fallback = Object.values(book?.runners ?? {});
                          return fallback.slice(0, 3).map((r) => ({ selectionId: r.selectionId, runnerName: r.runnerName }));
                        };

                        const runnerSlots =
                          selectedMarketId && selectedMarketId === baseMarketId
                            ? ([
                                { key: 'home' as const, ...matchOddsRunners.home },
                                { key: 'draw' as const, ...matchOddsRunners.draw },
                                { key: 'away' as const, ...matchOddsRunners.away },
                              ] as const)
                            : (() => {
                                const slots = takeRunnerSlotsFromBook();
                                const runner0 = slots[0] ?? null;
                                const runner1 = slots[1] ?? null;
                                const runner2 = slots[2] ?? null;
                                const r0 = runner0 ? book?.runners?.[String(runner0.selectionId)] ?? null : null;
                                const r1 = runner1 ? book?.runners?.[String(runner1.selectionId)] ?? null : null;
                                const r2 = runner2 ? book?.runners?.[String(runner2.selectionId)] ?? null : null;
                                return [
                                  {
                                    key: 'home' as const,
                                    selectionId: runner0?.selectionId ?? NaN,
                                    runnerName: runner0?.runnerName ?? '—',
                                    back: r0?.back ?? null,
                                    backSize: r0?.backSize ?? null,
                                    lay: r0?.lay ?? null,
                                    laySize: r0?.laySize ?? null,
                                  },
                                  {
                                    key: 'draw' as const,
                                    selectionId: runner1?.selectionId ?? NaN,
                                    runnerName: runner1?.runnerName ?? '—',
                                    back: r1?.back ?? null,
                                    backSize: r1?.backSize ?? null,
                                    lay: r1?.lay ?? null,
                                    laySize: r1?.laySize ?? null,
                                  },
                                  {
                                    key: 'away' as const,
                                    selectionId: runner2?.selectionId ?? NaN,
                                    runnerName: runner2?.runnerName ?? '—',
                                    back: r2?.back ?? null,
                                    backSize: r2?.backSize ?? null,
                                    lay: r2?.lay ?? null,
                                    laySize: r2?.laySize ?? null,
                                  },
                                ] as const;
                              })();

                        const OddCell = ({
                          kind,
                          idx,
                        }: {
                          kind: 'back' | 'lay';
                          idx: 0 | 1 | 2;
                        }) => {
                          const slot = runnerSlots[idx];
                          const selectionId = Number(slot.selectionId);
                          const priceVal = kind === 'back' ? slot.back : slot.lay;
                          const sizeVal = kind === 'back' ? slot.backSize : slot.laySize;
                          const canClick =
                            !finished &&
                            Boolean(selectedMarketId) &&
                            Number.isFinite(selectionId) &&
                            typeof priceVal === 'number' &&
                            Number.isFinite(priceVal) &&
                            priceVal > 1;

                          return (
                            <button
                              type="button"
                              className={cn(
                                'h-full px-2 py-2 text-center text-xs tabular-nums border-l border-gray-200',
                                finished
                                  ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
                                  : kind === 'back'
                                    ? cn('bg-sky-50 text-sky-900', canClick ? 'hover:bg-sky-100' : 'opacity-60 cursor-not-allowed')
                                    : cn('bg-rose-50 text-rose-900', canClick ? 'hover:bg-rose-100' : 'opacity-60 cursor-not-allowed'),
                              )}
                              style={{ fontFamily: 'var(--price-button-font-family), Tahoma, Verdana, Arial, sans-serif' }}
                              title={String(slot.runnerName ?? '')}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!canClick) return;
                                openManualOrder({
                                  matchId: x.matchId,
                                  marketId: selectedMarketId,
                                  marketName,
                                  selectionId,
                                  selectionName: String(slot.runnerName ?? ''),
                                  side: kind === 'back' ? 'BACK' : 'LAY',
                                  price: typeof priceVal === 'number' ? priceVal : null,
                                });
                              }}
                              disabled={!canClick}
                            >
                              <div className={cn('font-semibold', finished ? 'opacity-70' : '')}>{formatOdd(priceVal)}</div>
                              <div className={cn('text-[10px] opacity-80', finished ? 'opacity-60' : '')}>{formatSize(sizeVal)}</div>
                            </button>
                          );
                        };

                        const renderTimeLabel = (label: string) => {
                          const raw = String(label ?? '').trim();
                          const mm = raw.match(/^(\d+)\s*\+\s*(\d+)\s*[’'′]?\s*$/);
                          if (!mm) return <span>{raw || '—'}</span>;
                          const base = mm[1];
                          const extraPart = mm[2];
                          return (
                            <div className="flex flex-col items-center justify-center leading-none">
                              <div className="leading-none">{base}’</div>
                              <div className="mt-0.5 text-[11px] leading-none font-bold text-sky-800 tabular-nums">
                                +{extraPart}
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div
                            key={x.matchId}
                            className={cn(
                              'relative grid grid-cols-[44px_72px_1fr_repeat(6,72px)_220px] border-b border-gray-100',
                              finished ? 'bg-gray-50 border-l-4 border-gray-300 opacity-80 grayscale' : 'bg-white',
                            )}
                            onDoubleClick={(e) => {
                              const el = e.target as HTMLElement | null;
                              if (el?.closest('button')) return;
                              clearClickTimer(x.matchId);
                              void openMarketsForItem(x);
                            }}
                          >
                            <div className="px-2 py-2 flex items-center justify-center bg-gray-50">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                                    type="button"
                                    aria-label="Status do Robô"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                  >
                                    {(() => {
                                      const traffic = robotTrafficBadge(x, Date.now());
                                      const label = traffic.label;
                                      const kind =
                                        label === 'Erro no Robô!'
                                          ? 'error'
                                          : label === 'Oscilando'
                                            ? 'oscillating'
                                            : label === 'Rodando'
                                              ? 'running'
                                              : label === 'Em Pausa' || label === 'Parado' || label === 'Na fila'
                                                ? 'off'
                                                : 'off';

                                      if (kind === 'error') {
                                        return <X className="w-4 h-4 text-red-600" />;
                                      }

                                      const dotClass =
                                        kind === 'running'
                                          ? 'bg-emerald-500 ring-emerald-200 animate-pulse [animation-duration:2.8s]'
                                          : kind === 'oscillating'
                                            ? 'bg-amber-400 ring-amber-200 animate-pulse [animation-duration:2.8s]'
                                            : 'bg-red-500 ring-red-200';

                                      return <span className={cn('h-3 w-3 rounded-full ring-4', dotClass)} />;
                                    })()}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  {(() => {
                                    const traffic = robotTrafficBadge(x, Date.now());
                                    const base = traffic.label;
                                    const title = String(traffic.title ?? '').trim();
                                    return title ? `${base} — ${title}` : base;
                                  })()}
                                </TooltipContent>
                              </Tooltip>
                            </div>

                            <div className="px-2 py-2 flex items-stretch justify-center bg-gray-50">
                              <div className="w-full h-[72px] overflow-hidden rounded-md flex">
                                <div
                                  className={cn(
                                    'w-1/2 h-full flex items-center justify-center tabular-nums font-semibold',
                                    live ? 'bg-emerald-200 text-emerald-950' : finished ? 'bg-gray-200 text-gray-700' : 'bg-gray-200 text-gray-700',
                                  )}
                                >
                                  {renderTimeLabel(timeOrMinute(x))}
                                </div>
                                <div
                                  className={cn(
                                    'w-1/2 h-full flex flex-col items-center justify-center tabular-nums font-semibold',
                                    finished ? 'bg-gray-200 text-gray-700' : 'bg-emerald-900 text-white',
                                  )}
                                >
                                  {(() => {
                                    const apiLive = apiFootballLiveByMatchId[x.matchId] ?? null;
                                    const h = typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : x.scoreHome;
                                    const a = typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : x.scoreAway;
                                    return (
                                      <>
                                        <div className="leading-none">{typeof h === 'number' ? h : '—'}</div>
                                        <div className="text-[10px] opacity-70 leading-none my-0.5">x</div>
                                        <div className="leading-none">{typeof a === 'number' ? a : '—'}</div>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>

                            <div
                              className="px-3 py-2 min-w-0 cursor-pointer select-none"
                              onClick={(e) => {
                                const el = e.target as HTMLElement | null;
                                if (el?.closest('button')) return;
                                scheduleToggleExpanded(x.matchId);
                              }}
                              onDoubleClick={(e) => {
                                const el = e.target as HTMLElement | null;
                                if (el?.closest('button')) return;
                                clearClickTimer(x.matchId);
                              }}
                            >
                              {(() => {
                                const predicted = parsePredictedScore(x);
                                const expanded = Boolean(expandedById[x.matchId]);
                                const homeName = x.homeTeam ?? '—';
                                const awayName = x.awayTeam ?? '—';
                                const computedScalpingTicksPreview = (() => {
                                  if (agent !== 'scalpingTicks') return null;
                                  const st = (x as any)?.strategy?.scalpingTicks ?? null;
                                  const phase = String(st?.phase ?? '').trim().toLowerCase();
                                  if (!phase || !phase.includes('entered')) return null;
                                  const entryMatchedSize = Number(st?.entryMatchedSize);
                                  if (!(Number.isFinite(entryMatchedSize) && entryMatchedSize > 0)) return null;
                                  const stakeAbs = Number(st?.stakeAbs);
                                  const entryPrice = Number(st?.entryPrice);
                                  const side = String(st?.side ?? '').trim().toLowerCase() === 'over' ? 'over' : 'under';
                                  const market = side === 'over' ? st?.marketOver : st?.marketUnder;
                                  const layPrice = Number(side === 'over' ? market?.odds?.over?.lay : market?.odds?.under?.lay);
                                  if (!(Number.isFinite(stakeAbs) && stakeAbs > 0)) return null;
                                  if (!(Number.isFinite(entryPrice) && entryPrice > 1)) return null;
                                  if (!(Number.isFinite(layPrice) && layPrice > 1)) return null;
                                  const cashOut = Math.round(((entryPrice * stakeAbs) / layPrice) * 100) / 100;
                                  const risk = Math.round(stakeAbs * 100) / 100;
                                  const profit = Math.round((cashOut - risk) * 100) / 100;
                                  return {
                                    risk,
                                    cashOut,
                                    profit,
                                    fetchedAt: String(st?.lastTickAt ?? x.updatedAt ?? new Date().toISOString()),
                                  };
                                })();

                                const preview = computedScalpingTicksPreview ?? tradePreviewByMatchId[x.matchId] ?? null;
                                const showPreview = x.status === 'running' && preview && (typeof preview.profit === 'number' || typeof preview.risk === 'number');
                                const money = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? formatMoneyBR(v) : '—');
                                const profitValue = typeof preview?.profit === 'number' && Number.isFinite(preview.profit) ? preview.profit : null;
                                const profitClass = profitValue != null && profitValue >= 0 ? 'text-emerald-700' : 'text-red-700';
                                const footer = (() => {
                                  if (x.status !== 'running') return null;
                                  if (!mapped) return { text: 'Mapeando evento/mercado na Betfair...', className: 'text-gray-600' };
                                  if (finished) return { text: 'Jogo finalizado.', className: 'text-gray-600' };
                                  const phase =
                                    agent === 'scalpingGoals'
                                      ? String(x.strategy?.scalpingGoals?.phase ?? '').trim()
                                      : agent === 'scalpingTicks'
                                        ? String((x as any).strategy?.scalpingTicks?.phase ?? '').trim()
                                        : agent === 'overGoalsLimit'
                                          ? String((x as any).strategy?.overGoalsLimit?.phase ?? '').trim()
                                          : agent === 'asianHandicap'
                                            ? String((x as any).strategy?.asianHandicap?.phase ?? '').trim()
                                            : String(x.strategy?.correctScore?.lastPlan?.mode ?? x.strategy?.correctScore?.planType ?? '').trim();

                                  if (!phase) {
                                    return {
                                      text: agent === 'correctScore' ? 'Calculando cenários...' : 'Analisando o mercado...',
                                      className: 'text-red-700',
                                    };
                                  }
                                  const p = phase.toLowerCase();
                                  if (p.includes('closed_profit_target') || p.includes('closed')) {
                                    return { text: 'Cashout efetuado com sucesso...', className: 'text-emerald-700' };
                                  }
                                  if (p.includes('time_exit') || p.includes('cashout') || p.includes('risk_exit')) {
                                    return { text: 'Saindo da Operação...', className: 'text-purple-700' };
                                  }
                                  if (p.includes('exit_placed') || p.includes('waiting_exit')) {
                                    return { text: 'Tentando sair da operação...', className: 'text-amber-700' };
                                  }
                                  if (p.includes('entered')) {
                                    return { text: 'Entrada efetuada...', className: 'text-emerald-700' };
                                  }
                                  if (p.includes('entering') || p.includes('waiting_entry_fill') || p.includes('reprice_entry')) {
                                    return { text: 'Aguardando correspondência da entrada...', className: 'text-amber-700' };
                                  }
                                  if (p.includes('cooldown') || p.includes('post_goal_wait')) {
                                    return { text: 'Aguardando o jogo normalizar para Scalpes...', className: 'text-purple-700' };
                                  }
                                  if (p.includes('skip_no_market') || p.includes('skip') || p.includes('blocked')) {
                                    return { text: 'Monitorando oportunidades...', className: 'text-red-700' };
                                  }
                                  if (p.includes('waiting_entry')) {
                                    return { text: 'Analisando o mercado...', className: 'text-red-700' };
                                  }
                                  if (p.includes('swing_hold_pressure') || p.includes('swing_hold')) {
                                    return { text: 'Aguardando alerta de Gol...', className: 'text-red-700' };
                                  }
                                  if (agent === 'correctScore') {
                                    if (p.includes('rebalance')) return { text: 'Redistribuindo greenbook...', className: 'text-purple-700' };
                                    if (p.includes('dutch_back')) return { text: 'Montando dutching e distribuindo stakes...', className: 'text-red-700' };
                                    if (p.includes('staged_back')) return { text: 'Aguardando odds melhores para dutching...', className: 'text-red-700' };
                                    if (p.includes('adopt')) return { text: 'Gerenciando posição existente...', className: 'text-amber-700' };
                                  }
                                  return { text: 'Monitorando oportunidades...', className: 'text-red-700' };
                                })();

                                return (
                                  <>
                                    <div className="flex items-center justify-between gap-3 min-w-0">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <TeamCrest src={x.homeCrest} name={homeName} />
                                          <div className="font-semibold text-gray-900 truncate">{homeName}</div>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 min-w-0">
                                          <TeamCrest src={x.awayCrest} name={awayName} />
                                          <div className="font-semibold text-gray-900 truncate">{awayName}</div>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                                        {showPreview ? (
                                          <button
                                            type="button"
                                            className="rounded-md bg-amber-200 px-2 py-1 text-[11px] leading-tight tabular-nums hover:bg-amber-300 transition-colors order-1"
                                            onClick={() => {
                                              setCashoutConfirmMatchId(x.matchId);
                                              setCashoutConfirmOpen(true);
                                            }}
                                          >
                                            <div className="flex items-center gap-2">
                                              <div className="text-gray-800">Risco: {money(preview?.risk ?? null)}</div>
                                              <div className="text-gray-900 font-semibold">Cash Out {money(preview?.cashOut ?? null)}</div>
                                            </div>
                                            <div className={cn('text-center font-semibold', profitClass)}>Lucro: {money(profitValue)}</div>
                                          </button>
                                        ) : null}
                                        <div className="text-xs text-gray-600 order-3">{expanded ? 'Ocultar' : 'Detalhes'}</div>
                                      </div>
                                    </div>
                                    {footer ? (
                                      <div className="mt-1 flex items-center justify-between gap-2">
                                        <div className={cn('text-[11px]', footer.className)}>{footer.text}</div>
                                        {finished ? (
                                          <Badge variant="secondary" className="h-5 px-2 text-[10px] font-semibold tracking-wide">
                                            FINALIZADO
                                          </Badge>
                                        ) : null}
                                      </div>
                                    ) : finished ? (
                                      <div className="mt-1 flex items-center justify-end">
                                        <Badge variant="secondary" className="h-5 px-2 text-[10px] font-semibold tracking-wide">
                                          FINALIZADO
                                        </Badge>
                                      </div>
                                    ) : null}

                                    {expanded ? (
                                      <div className="mt-2">
                                        <div className="flex items-center flex-wrap gap-2">
                                          <Badge variant={gameStatusVariant as any}>{gameStatusLabel}</Badge>
                                          <Badge variant={statusVariant(x.status) as any}>{statusLabel(x.status)}</Badge>
                                          <Badge variant={mapped ? 'default' : (x.mappingStatus === 'unmapped' ? 'destructive' : 'secondary') as any}>
                                            {mapped ? 'Mapeado' : x.mappingStatus === 'unmapped' ? 'Não mapeado' : 'Mapeando'}
                                          </Badge>
                                          {x.source ? (
                                            <Badge variant="outline">Fonte: {x.source}</Badge>
                                          ) : null}
                                          {predicted ? (
                                            <Badge variant="outline" className="tabular-nums">
                                              Placar previsto: {predicted.home}-{predicted.away}
                                            </Badge>
                                          ) : null}
                                        </div>

                                        {mapped && x.betfair?.eventId ? (
                                          <div className="mt-3 flex items-center justify-center">
                                            <div className="w-full max-w-[520px]">
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="text-[11px] font-semibold text-gray-700">Mercado (entrada manual)</div>
                                                {loadingMarketsByMatchId[x.matchId] ? <div className="text-[11px] text-gray-500">Carregando…</div> : null}
                                              </div>
                                              <div className="mt-1">
                                                <Select
                                                  value={
                                                    selectedMarketId && marketOptions.some((m) => m.marketId === selectedMarketId) ? selectedMarketId : ''
                                                  }
                                                  onValueChange={(v) => {
                                                    const next = String(v ?? '').trim();
                                                    if (!next) return;
                                                    setSelectedMarketByMatchId((prev) => ({ ...prev, [x.matchId]: next }));
                                                  }}
                                                >
                                                  <SelectTrigger className="h-9">
                                                    <SelectValue placeholder={selectedMarketId ? marketName : 'Selecionar mercado'} />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {marketOptions.length === 0 ? (
                                                      <SelectItem value={baseMarketId || '__none__'} disabled>
                                                        Nenhum mercado
                                                      </SelectItem>
                                                    ) : (
                                                      marketOptions.map((m) => (
                                                        <SelectItem key={m.marketId} value={m.marketId}>
                                                          {m.marketName}
                                                        </SelectItem>
                                                      ))
                                                    )}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                              {selectedMarketId && selectedMarketId !== baseMarketId ? (
                                                <div className="mt-1 text-[11px] text-gray-500 tabular-nums">
                                                  {loadingBookByMatchId[x.matchId] ? 'Carregando cotações…' : bookIsSelected ? `Market: ${selectedMarketId}` : `Market: ${selectedMarketId}`}
                                                </div>
                                              ) : null}
                                            </div>
                                          </div>
                                        ) : null}

                                        <div className="mt-2 text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                                          <span className="tabular-nums">{k ? k.toLocaleString('pt-BR', { hour12: false }) : '—'}</span>
                                          <span className="tabular-nums">ID: {x.matchId}</span>
                                          {mapped && x.betfair?.marketId ? <span className="tabular-nums">Market: {x.betfair.marketId}</span> : null}
                                        </div>

                                        {!mapped && x.mappingError ? (
                                          <div className="mt-1 text-[11px] text-red-700">
                                            {x.mappingError}
                                          </div>
                                        ) : null}

                                        {markets.length > 0 ? (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {markets.map((m) => (
                                              <Badge
                                                key={m.key}
                                                variant={m.enabled ? 'secondary' : 'outline'}
                                                className={cn('text-[11px] font-semibold', m.enabled ? '' : 'opacity-50 line-through')}
                                              >
                                                {m.label}
                                              </Badge>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </>
                                );
                              })()}
                            </div>

                            {isSuspended ? (
                              <div className="col-span-6 px-3 py-2 flex items-center justify-center bg-gray-100 text-gray-700 font-semibold border-l border-gray-200">
                                SUSPENSO
                              </div>
                            ) : (
                              <>
                                <OddCell kind="back" idx={0} />
                                <OddCell kind="lay" idx={0} />
                                <OddCell kind="back" idx={1} />
                                <OddCell kind="lay" idx={1} />
                                <OddCell kind="back" idx={2} />
                                <OddCell kind="lay" idx={2} />
                              </>
                            )}

                            <div className="px-3 py-2 flex items-center justify-end gap-1.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label="Iniciar"
                                    variant="outline"
                                    size="icon"
                                    disabled={!canStart}
                                    onClick={() => openStartConfirm(x)}
                                  >
                                    <Play className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Iniciar
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label="Pausar"
                                    variant="outline"
                                    size="icon"
                                    disabled={!canPause}
                                    onClick={() => void handlePause(x)}
                                  >
                                    <Pause className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Pausar
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label="Parar"
                                    variant="outline"
                                    size="icon"
                                    disabled={!canStop}
                                    onClick={() => updateItem(x.matchId, { status: 'stopped' })}
                                  >
                                    <Square className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Parar
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button aria-label="Excluir" variant="destructive" size="icon" onClick={() => void handleRemove(x)}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Excluir
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label="Ver detalhes"
                                    variant="outline"
                                    size="icon"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      clearClickTimer(x.matchId);
                                      void openMarketsForItem(x);
                                    }}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Detalhes
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );

                return (
                  <div key={g.key}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm font-bold text-gray-900">{dayLabel(g.day)}</div>
                      <Badge variant="outline" className="tabular-nums">
                        {g.live.length + g.upcoming.length}
                      </Badge>
                    </div>

                    {g.live.length > 0 ? (
                      <div className="mb-4">
                        <div className="text-xs font-semibold text-gray-700 mb-2">Ao vivo</div>
                        {renderRows(g.live)}
                      </div>
                    ) : null}

                    {g.upcoming.length > 0 ? (
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2">A seguir</div>
                        {renderRows(g.upcoming)}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-4 mt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-gray-900">Ordens (bots/agentes)</div>
              <div className="text-sm text-gray-600 mt-1">
                Atualiza automaticamente a cada 10s enquanto houver operação ativa.
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-600">Última checagem</div>
              <div className="text-xs tabular-nums text-gray-900">
                {botOrdersLastRefreshedAt ? new Date(botOrdersLastRefreshedAt).toLocaleTimeString('pt-BR', { hour12: false }) : '—'}
              </div>
            </div>
          </div>

          {(() => {
            const rows = botOrders;
            if (rows.length === 0) {
              return <div className="mt-3 text-sm text-gray-600">Nenhuma ordem encontrada.</div>;
            }

            const isOpenOrder = (r: BotOrderRow) => {
              const sm = Number(r.sizeMatched);
              const sr = Number(r.sizeRemaining);
              const hasMatched = Number.isFinite(sm) && sm > 0;
              const hasRemaining = Number.isFinite(sr) && sr > 0;
              const st = String(r.status ?? '').trim().toUpperCase();
              if (r.error) return true;
              if (st && /FAIL|ERROR|REJECT|VIOLATION/.test(st)) return true;
              if (hasRemaining) return true;
              if (st === 'EXECUTABLE') return true;
              if (hasMatched) return false;
              return false;
            };

            const openRows = rows.filter(isOpenOrder);
            const finishedRows = rows.filter((r) => !isOpenOrder(r));

            const statusLabel = (r: BotOrderRow) => {
              const sm = Number(r.sizeMatched);
              const sr = Number(r.sizeRemaining);
              const hasMatched = Number.isFinite(sm) && sm > 0;
              const hasRemaining = Number.isFinite(sr) && sr > 0;
              const st = String(r.status ?? '').trim().toUpperCase();
              if (r.error) return 'ERRO';
              if (st && /FAIL|ERROR|REJECT|VIOLATION/.test(st)) return 'ERRO';
              if (st === 'EXECUTION_COMPLETE' || (!hasRemaining && hasMatched)) return 'CORRESPONDIDA';
              if (hasMatched && hasRemaining) return 'PARCIAL';
              if (!hasMatched && hasRemaining) return 'PENDENTE';
              if (!hasMatched && !hasRemaining) return 'ENCERRADA';
              return st || '—';
            };

            const rowTone = (r: BotOrderRow) => {
              const sm = Number(r.sizeMatched);
              const sr = Number(r.sizeRemaining);
              const hasMatched = Number.isFinite(sm) && sm > 0;
              const hasRemaining = Number.isFinite(sr) && sr > 0;
              const st = String(r.status ?? '').trim().toUpperCase();
              if (r.error) return 'bg-red-100';
              if (st && /FAIL|ERROR|REJECT|VIOLATION/.test(st)) return 'bg-red-100';
              if (hasMatched) return 'bg-emerald-100';
              if (hasRemaining) return 'bg-amber-100';
              return 'bg-gray-50';
            };

            const fmtTime = (iso: string | null) => {
              const s = String(iso ?? '').trim();
              if (!s) return '—';
              const d = new Date(s);
              if (!Number.isFinite(d.getTime())) return '—';
              return d.toLocaleTimeString('pt-BR', { hour12: false });
            };

            const fmtSignedMoney = (v: number | null) => {
              if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
              const abs = Math.abs(v);
              const sign = v > 0 ? '+' : v < 0 ? '-' : '';
              return `${sign}${formatMoneyBR(abs)}`;
            };

            const potentialPnl = (r: BotOrderRow) => {
              const p = Number(r.price);
              const side = r.side;
              const sm = Number(r.sizeMatched);
              const sr = Number(r.sizeRemaining);
              const size = Number.isFinite(sm) && sm > 0 ? sm : Number.isFinite(sr) && sr > 0 ? sr : NaN;
              if (!(Number.isFinite(p) && p > 1)) return null;
              if (!(Number.isFinite(size) && size > 0)) return null;
              const v = (p - 1) * size;
              if (side === 'BACK') return Math.round(v * 100) / 100;
              if (side === 'LAY') return -Math.round(v * 100) / 100;
              return null;
            };

            const marketLabel = (r: BotOrderRow) => {
              const match = items.find((x) => x.matchId === r.matchId) ?? null;
              const mid = String(r.marketId ?? '').trim();
              if (!match || !mid) return { text: mid || '—', className: 'text-gray-900', sub: mid || null };
              const base = String(match.betfair?.marketId ?? '').trim();
              const cs = String(match.betfair?.correctScore?.marketId ?? '').trim();
              const resolvedName = marketNameByMarketId[mid] ? String(marketNameByMarketId[mid] ?? '').trim() : '';

              const humanize = (name: string) => {
                const raw = String(name ?? '').trim();
                if (!raw) return '';
                if (/^match\s*odds$/i.test(raw)) return 'Resultado da Partida';
                if (/correct\s*score/i.test(raw)) return 'Placar Correto';
                const ou = raw.match(/over\s*\/\s*under\s*([0-9]+(?:\.[0-9]+)?)/i) || raw.match(/overunder\s*([0-9]+(?:\.[0-9]+)?)/i);
                if (ou) {
                  const line = String(ou[1] ?? '').trim();
                  return `Mais/Menos ${line} Gols`;
                }
                return raw;
              };

              const baseLabel =
                mid && base && mid === base
                  ? 'Resultado da Partida'
                  : mid && cs && mid === cs
                    ? 'Placar Correto'
                    : humanize(resolvedName) || resolvedName || mid;

              const side = r.side;
              const prefix = side === 'BACK' ? 'À favor em ' : side === 'LAY' ? 'Contra ' : '';
              const color = side === 'BACK' ? 'text-emerald-700' : side === 'LAY' ? 'text-red-700' : 'text-gray-900';
              return { text: `${prefix}${baseLabel}`, className: color, sub: mid };
            };

            const agentLabel = (r: BotOrderRow) => {
              if (r.agent === 'scalpingTicks') return 'Scalping Ticks';
              if (r.agent === 'scalpingGoals') return 'Scalping Gols';
              if (r.agent === 'overGoalsLimit') return 'Over Limite';
              if (r.agent === 'asianHandicap') return 'Handicap';
              if (r.agent === 'correctScore') return 'Correct Score';
              return r.agent || '—';
            };

            const renderOrdersTable = (tableRows: BotOrderRow[]) => {
              if (tableRows.length === 0) {
                return <div className="mt-2 text-sm text-gray-600">Nenhuma.</div>;
              }
              return (
                <div className="mt-3 overflow-x-auto border border-gray-200 rounded-lg bg-white">
                  <div className="min-w-[980px]">
                    <div className="grid grid-cols-[180px_92px_1fr_92px_120px_160px_140px] text-xs font-semibold text-gray-700 bg-gray-100 border-b border-gray-200">
                      <div className="px-3 py-2">ID/Refª</div>
                      <div className="px-3 py-2 text-center">Hora</div>
                      <div className="px-3 py-2">Mercado</div>
                      <div className="px-3 py-2 text-center">Cotação</div>
                      <div className="px-3 py-2 text-right">Apostado</div>
                      <div className="px-3 py-2 text-right">Possível Lucro/Perda</div>
                      <div className="px-3 py-2 text-right">Status</div>
                    </div>

                    {tableRows.map((r) => {
                      const match = items.find((x) => x.matchId === r.matchId) ?? null;
                      const title = match ? `${match.homeTeam ?? '—'} x ${match.awayTeam ?? '—'} • ${agentLabel(r)}` : agentLabel(r);
                      const sm = Number(r.sizeMatched);
                      const sr = Number(r.sizeRemaining);
                      const matchedSafe = Number.isFinite(sm) && sm >= 0 ? sm : 0;
                      const remainingSafe = Number.isFinite(sr) && sr >= 0 ? sr : 0;
                      const total = matchedSafe + remainingSafe;
                      const st = statusLabel(r);
                      const statusText = r.error ? `${st} (${String(r.error).slice(0, 120)})` : st;

                      return (
                        <Tooltip key={r.key}>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                'grid grid-cols-[180px_92px_1fr_92px_120px_160px_140px] border-b border-gray-100 text-sm',
                                rowTone(r),
                              )}
                            >
                              <div className="px-3 py-2">
                                <div className="font-semibold tabular-nums truncate">{r.betId ?? r.customerRef ?? '—'}</div>
                                <div className="text-[11px] text-gray-700 tabular-nums truncate">{r.customerRef ? `Ref: ${r.customerRef}` : `Bot: ${agentLabel(r)}`}</div>
                              </div>
                              <div className="px-3 py-2 text-center tabular-nums">{fmtTime(r.placedAt ?? r.updatedAt)}</div>
                              {(() => {
                                const m = marketLabel(r);
                                return (
                                  <div className="px-3 py-2 truncate tabular-nums">
                                    <div className={cn('truncate', m.className)}>{m.text}</div>
                                    {m.sub ? <div className="text-[11px] text-gray-600 truncate">{m.sub}</div> : null}
                                  </div>
                                );
                              })()}
                              <div className="px-3 py-2 text-center tabular-nums">{formatOdd(r.price)}</div>
                              <div className="px-3 py-2 text-right tabular-nums">
                                {total > 0 ? `${matchedSafe.toFixed(2)}/${total.toFixed(2)}` : '—'}
                              </div>
                              <div className="px-3 py-2 text-right tabular-nums">{fmtSignedMoney(potentialPnl(r))}</div>
                              <div
                                className={cn(
                                  'px-3 py-2 text-right tabular-nums font-semibold',
                                  r.error ? 'text-red-900' : st === 'PENDENTE' ? 'text-amber-900' : st === 'CORRESPONDIDA' ? 'text-emerald-900' : 'text-gray-900',
                                )}
                              >
                                {statusText}
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" sideOffset={6}>
                            {title}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              );
            };

            return (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-gray-700">Ordens em aberto</div>
                  <Badge variant="outline" className="tabular-nums">
                    {openRows.length}
                  </Badge>
                </div>
                {renderOrdersTable(openRows)}

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-gray-700">Ordens finalizadas</div>
                  <Badge variant="outline" className="tabular-nums">
                    {finishedRows.length}
                  </Badge>
                </div>
                {renderOrdersTable(finishedRows)}
              </div>
            );
          })()}
        </Card>

        <Card className="p-4 mt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-gray-900">Jogos finalizados</div>
              <div className="text-sm text-gray-600 mt-1">Histórico de jogos que já terminaram e dados finais para auditoria.</div>
            </div>
            <Badge variant="outline" className="tabular-nums">
              {finishedItems.length}
            </Badge>
          </div>

          {finishedItems.length === 0 ? (
            <div className="mt-3 text-sm text-gray-600">Nenhum jogo finalizado ainda.</div>
          ) : (
            <div className="mt-4 overflow-x-auto border border-gray-200 rounded-lg bg-white">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[92px_1fr_92px_140px_200px_160px_140px] text-xs font-semibold text-gray-700 bg-gray-100 border-b border-gray-200">
                  <div className="px-3 py-2 text-center">Data</div>
                  <div className="px-3 py-2">Jogo</div>
                  <div className="px-3 py-2 text-center">Placar</div>
                  <div className="px-3 py-2">Robô</div>
                  <div className="px-3 py-2 text-right">Ordens (T/M/E)</div>
                  <div className="px-3 py-2 text-right">Atualizado</div>
                  <div className="px-3 py-2 text-right">Status</div>
                </div>

                {finishedItems.map((x) => {
                  const agent = normalizeAgent(x.strategy?.agent);
                  const d = kickoffDate(x);
                  const day = d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
                  const apiLive = apiFootballLiveByMatchId[x.matchId] ?? null;
                  const h = typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : x.scoreHome;
                  const a = typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : x.scoreAway;

                  const rows = botOrders.filter((r) => r.matchId === x.matchId);
                  const total = rows.length;
                  const matched = rows.filter((r) => Number(r.sizeMatched) > 0).length;
                  const err = rows.filter((r) => Boolean(r.error) || /FAIL|ERROR|REJECT|VIOLATION/.test(String(r.status ?? '').toUpperCase())).length;

                  const updatedIso = String(x.updatedAt ?? x.createdAt ?? '').trim();
                  const updatedAt = (() => {
                    if (!updatedIso) return '—';
                    const dt = new Date(updatedIso);
                    if (!Number.isFinite(dt.getTime())) return '—';
                    return dt.toLocaleString('pt-BR', { hour12: false });
                  })();

                  const agentLabel =
                    agent === 'scalpingGoals'
                      ? 'Scalping Gols'
                      : agent === 'scalpingTicks'
                        ? 'Scalping Ticks'
                        : agent === 'overGoalsLimit'
                          ? 'Over Limite'
                          : agent === 'asianHandicap'
                            ? 'Handicap'
                            : agent === 'correctScore'
                              ? 'Correct Score'
                              : agent || '—';

                  return (
                    <div key={x.matchId} className="grid grid-cols-[92px_1fr_92px_140px_200px_160px_140px] border-b border-gray-100 text-sm">
                      <div className="px-3 py-2 text-center tabular-nums">{day}</div>
                      <div className="px-3 py-2 truncate">
                        <span className="font-semibold text-gray-900">{x.homeTeam ?? '—'}</span>
                        <span className="mx-2 opacity-60">x</span>
                        <span className="font-semibold text-gray-900">{x.awayTeam ?? '—'}</span>
                      </div>
                      <div className="px-3 py-2 text-center tabular-nums">{typeof h === 'number' && typeof a === 'number' ? `${h}-${a}` : '—'}</div>
                      <div className="px-3 py-2 truncate">{agentLabel}</div>
                      <div className="px-3 py-2 text-right tabular-nums">
                        {total}/{matched}/{err}
                      </div>
                      <div className="px-3 py-2 text-right tabular-nums">{updatedAt}</div>
                      <div className="px-3 py-2 text-right">
                        <Badge variant="secondary" className="tabular-nums">
                          Finalizado
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
