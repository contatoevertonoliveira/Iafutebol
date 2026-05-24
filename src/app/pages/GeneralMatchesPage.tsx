import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Clock, Dices, Eye, Globe, Loader2, RefreshCcw, Search, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballLeague, ApiFootballMatch, ApiFootballService } from '../services/apiFootballService';
import { TeamLogo } from '../components/TeamLogo';
import { cn } from '../components/ui/utils';
import type { Prediction } from '../data/mockData';

type MatchBucket = 'all' | 'live' | 'scheduled' | 'finished';

type FixtureStatsResponseItem = {
  team?: { id?: number; name?: string; logo?: string };
  statistics?: Array<{ type: string; value: any }>;
};

const TIME_ZONE = 'America/Sao_Paulo';

type ApiSource = 'api-football' | 'betfair' | 'mock';

type MatchesCache = {
  version: number;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  apiSource: ApiSource;
  matches: Array<{ id: number }>;
  predictions: Record<string, Prediction>;
};

const getDayKey = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const addDaysYmd = (ymd: string, days: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d) + days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
};

const fixtureLocalDayKey = (m: ApiFootballMatch) => {
  const raw = String(m?.fixture?.date ?? '');
  const dt = raw ? new Date(raw) : new Date(NaN);
  if (!Number.isFinite(dt.getTime())) return '';
  return getDayKey(dt);
};

const requestFixturePrediction = (fixtureId: string) => {
  const id = String(fixtureId ?? '').trim();
  if (!id) return;

  try {
    const storeKey = 'requested_fixtures_v1';
    const raw = localStorage.getItem(storeKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    const nextStore = (() => {
      if (parsed && typeof parsed === 'object' && (parsed as any).version === 2 && (parsed as any).items && typeof (parsed as any).items === 'object') {
        return { version: 2 as const, items: { ...((parsed as any).items as Record<string, any>) } };
      }
      if (parsed && typeof parsed === 'object' && (parsed as any).version === 1 && (parsed as any).items && typeof (parsed as any).items === 'object') {
        const v1 = (parsed as any).items as Record<string, { fixtureId?: number }>;
        const items: Record<string, { source: 'api-football'; fixtureId: number }> = {};
        for (const k of Object.keys(v1)) {
          const fid = Number(v1[k]?.fixtureId ?? k);
          if (!Number.isFinite(fid) || fid <= 0) continue;
          items[String(fid)] = { source: 'api-football', fixtureId: fid };
        }
        return { version: 2 as const, items };
      }
      return { version: 2 as const, items: {} as Record<string, { source: 'api-football'; fixtureId: number }> };
    })();

    const fid = Number(id);
    if (Number.isFinite(fid) && fid > 0) {
      nextStore.items[id] = { source: 'api-football', fixtureId: fid };
    }
    localStorage.setItem(storeKey, JSON.stringify(nextStore));
    window.dispatchEvent(new Event('requestedFixturesChanged'));
  } catch {}

  try {
    const favoritesKey = 'favorite_matches_v1';
    const raw = localStorage.getItem(favoritesKey) || '[]';
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed.map(String) : [];
    if (!list.includes(id)) {
      const next = [...list, id];
      localStorage.setItem(favoritesKey, JSON.stringify(next));
      window.dispatchEvent(new Event('favoritesChanged'));
    }
  } catch {}
};

const readRequestedFixtureIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem('requested_fixtures_v1');
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { version?: number; items?: Record<string, any> };
    if (!parsed || !parsed.items || typeof parsed.items !== 'object') return new Set();
    if (parsed.version !== 1 && parsed.version !== 2) return new Set();
    return new Set(Object.keys(parsed.items).map(String));
  } catch {
    return new Set();
  }
};

const readPredictionsCache = (): Record<string, Prediction> => {
  const keys = ['matchesCache_v3', 'matchesCache_v2', 'matchesCache_v1'];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as MatchesCache;
      if (!parsed || !parsed.predictions || typeof parsed.predictions !== 'object') continue;
      return parsed.predictions;
    } catch {}
  }
  return {};
};

const formatWinnerShort = (p: Prediction | null | undefined) => {
  const w = p?.winner?.prediction;
  if (w === 'home') return 'Casa';
  if (w === 'away') return 'Fora';
  if (w === 'draw') return 'Empate';
  return '';
};

const formatBttsShort = (p: Prediction | null | undefined) => {
  const b = p?.btts?.prediction;
  if (b === 'yes') return 'BTTS Sim';
  if (b === 'no') return 'BTTS Não';
  return '';
};

const formatOverUnderShort = (p: Prediction | null | undefined) => {
  const ou = p?.overUnder;
  if (!ou) return '';
  const line = Number.isFinite(Number(ou.line)) ? Number(ou.line) : 2.5;
  return ou.prediction === 'over' ? `Over ${line}` : `Under ${line}`;
};

const readLeaguesCatalogCache = (): ApiFootballLeague[] => {
  const keys = [
    'apiFootball_leagues_cache_v2_all',
    'apiFootball_leagues_cache_v2',
    'apiFootball_leagues_cache_v1',
  ];

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { fetchedAt?: string; items?: ApiFootballLeague[] };
      if (!parsed?.items || !Array.isArray(parsed.items)) continue;
      return parsed.items;
    } catch {
      continue;
    }
  }
  return [];
};

const toBucket = (m: ApiFootballMatch): MatchBucket => {
  const short = String(m?.fixture?.status?.short ?? '').toUpperCase();
  if (['FT', 'AET', 'PEN', 'FINISHED', 'CLOSED', 'SETTLED', 'ENDED', 'END', 'RESULT', 'ABANDONED', 'CANCELLED', 'CANCELED'].includes(short)) {
    return 'finished';
  }
  if (
    [
      '1H',
      '2H',
      'HT',
      'ET',
      'BT',
      'P',
      'LIVE',
      'IN_PLAY',
      'INPLAY',
      'PAUSED',
      'BREAK',
      'INT',
      'SUSP',
      'SUSPENDED',
      'INTERRUPTED',
    ].includes(short)
  ) {
    return 'live';
  }
  return 'scheduled';
};

const toMatchStatus = (status: string): Exclude<MatchBucket, 'all'> => {
  const short = String(status ?? '').trim().toUpperCase();
  if (['FT', 'AET', 'PEN', 'FINISHED', 'CLOSED', 'SETTLED', 'ENDED', 'END', 'RESULT', 'ABANDONED', 'CANCELLED', 'CANCELED'].includes(short)) {
    return 'finished';
  }
  if (
    [
      '1H',
      '2H',
      'HT',
      'ET',
      'BT',
      'P',
      'LIVE',
      'IN_PLAY',
      'INPLAY',
      'PAUSED',
      'BREAK',
      'INT',
      'SUSP',
      'SUSPENDED',
      'INTERRUPTED',
    ].includes(short)
  ) {
    return 'live';
  }
  return 'scheduled';
};

const betfairToApiFootballMatch = (m: any): ApiFootballMatch => {
  const utcDate = String(m?.utcDate ?? '').trim() || new Date().toISOString();
  const date = new Date(utcDate);
  const ts = Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : 0;

  const statusShort = String(m?.status ?? '').trim() || 'NS';
  const elapsedRaw = m?.live?.elapsed;
  const elapsed = Number(elapsedRaw);
  const goalsHome = m?.score?.fullTime?.home;
  const goalsAway = m?.score?.fullTime?.away;

  const leagueName = String(m?.competition?.name ?? '').trim() || 'Soccer';
  const leagueCountry = String(m?.competition?.area?.name ?? '').trim() || '';

  const homeName = String(m?.homeTeam?.name ?? '').trim() || 'Home';
  const awayName = String(m?.awayTeam?.name ?? '').trim() || 'Away';
  const homeLogo = String(m?.homeTeam?.crest ?? '').trim() || '';
  const awayLogo = String(m?.awayTeam?.crest ?? '').trim() || '';

  const fixtureId = Number(m?.id);
  const id = Number.isFinite(fixtureId) ? fixtureId : Math.floor(9_000_000_000 + Math.random() * 900_000_000);
  const season = Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();

  return {
    fixture: {
      id,
      referee: null,
      timezone: 'UTC',
      date: utcDate,
      timestamp: ts,
      venue: { id: null, name: null, city: null },
      status: {
        long: statusShort,
        short: statusShort,
        elapsed: Number.isFinite(elapsed) ? elapsed : null,
        extra: null,
      },
    },
    league: {
      id: 0,
      name: leagueName,
      type: 'League',
      logo: '',
      country: leagueCountry,
      flag: '',
      season,
    },
    teams: {
      home: { id: 0, name: homeName, code: '', country: '', founded: 0, national: false, logo: homeLogo },
      away: { id: 0, name: awayName, code: '', country: '', founded: 0, national: false, logo: awayLogo },
    },
    goals: {
      home: typeof goalsHome === 'number' ? goalsHome : null,
      away: typeof goalsAway === 'number' ? goalsAway : null,
    },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: typeof goalsHome === 'number' ? goalsHome : null, away: typeof goalsAway === 'number' ? goalsAway : null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
};

const isFamousLeague = (m: ApiFootballMatch): boolean => {
  const country = String(m?.league?.country ?? '').toLowerCase();
  const name = String(m?.league?.name ?? '').toLowerCase();
  if (country.includes('england') && name.includes('premier')) return true;
  if (country.includes('spain') && name.includes('la liga')) return true;
  if (country.includes('germany') && name.includes('bundesliga')) return true;
  if (country.includes('italy') && (name.includes('serie a') || name === 'serie a')) return true;
  if (country.includes('france') && name.includes('ligue 1')) return true;
  if (country.includes('brazil') && (name.includes('serie a') || name.includes('brasile')) ) return true;
  if (name.includes('champions league')) return true;
  if (name.includes('europa league')) return true;
  return false;
};

const formatKickoff = (m: ApiFootballMatch) => {
  const raw = String(m?.fixture?.date ?? '');
  const date = raw ? new Date(raw) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
};

const formatFixtureLabel = (m: ApiFootballMatch) => {
  const raw = String(m?.fixture?.date ?? '');
  const date = raw ? new Date(raw) : new Date(NaN);
  if (!Number.isFinite(date.getTime())) return '—';
  const dateShort = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' }).format(date);
  const time = formatKickoff(m);
  const todayKey = getDayKey(new Date());
  const yesterdayKey = getDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const key = getDayKey(date);
  const word = key === todayKey ? 'Hoje' : key === yesterdayKey ? 'Ontem' : '';
  return `${dateShort}${word ? ` • ${word}` : ''} • ${time}`;
};

const statusLabel = (m: ApiFootballMatch) => {
  const short = String(m?.fixture?.status?.short ?? '').toUpperCase();
  const long = String(m?.fixture?.status?.long ?? '').trim();
  const elapsed = m?.fixture?.status?.elapsed;
  if (elapsed !== null && elapsed !== undefined && Number.isFinite(Number(elapsed))) return `${elapsed}'`;
  if (short) return short;
  if (long) return long;
  return '—';
};

const normalizeName = (input: unknown) => {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const stripTeamNoise = (value: string) => {
  const n = normalizeName(value);
  if (!n) return '';
  const stop = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ud', 'sv', 'de', 'da', 'do', 'the', 'club', 'clube']);
  return n
    .split(' ')
    .filter((t) => t && t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
    .join(' ')
    .trim();
};

const scoreTeams = (homeA: string, awayA: string, homeB: string, awayB: string) => {
  const ha = stripTeamNoise(homeA);
  const aa = stripTeamNoise(awayA);
  const hb = stripTeamNoise(homeB);
  const ab = stripTeamNoise(awayB);
  if (!ha || !aa || !hb || !ab) return 0;

  const tok = (s: string) => new Set(s.split(' ').filter(Boolean));
  const haT = tok(ha);
  const aaT = tok(aa);
  const hbT = tok(hb);
  const abT = tok(ab);

  const inter = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    for (const t of a) if (b.has(t)) n += 1;
    return n;
  };

  const exactBonus = (x: string, y: string) => (x === y ? 6 : 0);
  const firstTokBonus = (x: string, y: string) => {
    const a0 = x.split(' ')[0] ?? '';
    const b0 = y.split(' ')[0] ?? '';
    return a0 && b0 && a0 === b0 ? 2 : 0;
  };

  const direct =
    inter(haT, hbT) * 2 + inter(aaT, abT) * 2 + exactBonus(ha, hb) + exactBonus(aa, ab) + firstTokBonus(ha, hb) + firstTokBonus(aa, ab);

  const swapped =
    inter(haT, abT) * 2 + inter(aaT, hbT) * 2 + exactBonus(ha, ab) + exactBonus(aa, hb) + firstTokBonus(ha, ab) + firstTokBonus(aa, hb);

  return Math.max(direct, swapped - 2);
};

export default function GeneralMatchesPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(() => loadApiConfig());
  const [date, setDate] = useState(() => getDayKey(new Date()));
  const [bucket, setBucket] = useState<MatchBucket>('live');
  const [search, setSearch] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [fixtures, setFixtures] = useState<ApiFootballMatch[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [betfairMatches, setBetfairMatches] = useState<any[]>([]);
  const [dataSource, setDataSource] = useState<ApiSource>('api-football');

  const betfairById = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of Array.isArray(betfairMatches) ? betfairMatches : []) {
      const id = String((row as any)?.id ?? '').trim();
      if (!id) continue;
      if (!map.has(id)) map.set(id, row);
    }
    return map;
  }, [betfairMatches]);

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
    const items: Record<string, any> = {};
    for (const fx of fixtures) {
      const fixtureId = Number((fx as any)?.fixture?.id ?? NaN);
      if (!Number.isFinite(fixtureId)) continue;
      const matchId = String(fixtureId);
      const statusShort = String((fx as any)?.fixture?.status?.short ?? '').trim() || null;
      const elapsedRaw = (fx as any)?.fixture?.status?.elapsed;
      const liveElapsed = typeof elapsedRaw === 'number' ? elapsedRaw : typeof elapsedRaw === 'string' ? Number(elapsedRaw) : null;
      const scoreHome = typeof (fx as any)?.goals?.home === 'number' ? (fx as any).goals.home : null;
      const scoreAway = typeof (fx as any)?.goals?.away === 'number' ? (fx as any).goals.away : null;
      const status = toMatchStatus(statusShort || 'NS');
      const bf = betfairById.get(matchId) ?? null;

      items[matchId] = {
        updatedAt: nowIso,
        status,
        utcDate: typeof (fx as any)?.fixture?.date === 'string' ? (fx as any).fixture.date : null,
        homeTeam: typeof (fx as any)?.teams?.home?.name === 'string' ? (fx as any).teams.home.name : null,
        awayTeam: typeof (fx as any)?.teams?.away?.name === 'string' ? (fx as any).teams.away.name : null,
        liveElapsed: Number.isFinite(Number(liveElapsed)) ? Number(liveElapsed) : null,
        liveStatusShort: statusShort,
        scoreHome,
        scoreAway,
        betfair: (bf as any)?.betfair ?? null,
      };
    }
    try {
      const raw = localStorage.getItem(feedKey);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const prevItems = parsed?.version === 1 && parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
      const nextItems = { ...prevItems, ...items };
      const prunedEntries = Object.entries(nextItems)
        .map(([id, v]) => [id, v] as const)
        .filter(([, v]) => v && typeof v === 'object')
        .slice(0, 1000);
      localStorage.setItem(feedKey, JSON.stringify({ version: 1, updatedAt: nowIso, items: Object.fromEntries(prunedEntries) }));
      window.dispatchEvent(new Event('favoriteRescueFeedChanged'));
    } catch {}
  }, [fixtures, betfairById]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<ApiFootballMatch | null>(null);
  const [statsByFixtureId, setStatsByFixtureId] = useState<Record<string, FixtureStatsResponseItem[] | null>>({});
  const [loadingStatsId, setLoadingStatsId] = useState<string | null>(null);
  const [predictionsByMatchId, setPredictionsByMatchId] = useState<Record<string, Prediction>>(() => readPredictionsCache());
  const [requestedFixtureIds, setRequestedFixtureIds] = useState<Set<string>>(() => readRequestedFixtureIds());
  const [automationIds, setAutomationIds] = useState<Set<string>>(() => new Set());
  const [automationTarget, setAutomationTarget] = useState<ApiFootballMatch | null>(null);
  const [automationActionOpen, setAutomationActionOpen] = useState(false);
  const [automationIsBusy, setAutomationIsBusy] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [guardMatchId, setGuardMatchId] = useState<string | null>(null);
  const [guardOrdersCount, setGuardOrdersCount] = useState(0);
  const [guardMatchedCount, setGuardMatchedCount] = useState(0);
  const [guardIsBusy, setGuardIsBusy] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setRequestedFixtureIds(readRequestedFixtureIds());
      setPredictionsByMatchId(readPredictionsCache());
    };
    const onRequested = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === 'requested_fixtures_v1' || e.key.startsWith('matchesCache_v')) refresh();
    };
    window.addEventListener('requestedFixturesChanged' as any, onRequested as any);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('requestedFixturesChanged' as any, onRequested as any);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const openPredictionShortcut = (fixtureId: string) => {
    const id = String(fixtureId ?? '').trim();
    if (!id) return;
    navigate(`/favorites?open=${encodeURIComponent(id)}`);
  };

  const loadAutomationQueueIds = async () => {
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
      if (!res.ok || !data?.ok) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      const ids = new Set<string>(items.map((x: any) => String(x?.matchId ?? '').trim()).filter(Boolean));
      setAutomationIds(ids);
    } catch {}
  };

  useEffect(() => {
    void loadAutomationQueueIds();
    const onFocus = () => void loadAutomationQueueIds();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const getAdminTokenOrToast = () => {
    const cfg = loadApiConfig();
    const adminToken = String(cfg?.automationAdminToken ?? '').trim();
    if (!adminToken) {
      toast.error('Informe o Automation Admin Token em Configurações → Betfair.');
      return null;
    }
    return adminToken;
  };

  const getEdgeHeaders = async () => {
    const { publicAnonKey } = await import('/utils/supabase/info');
    return {
      'Content-Type': 'application/json',
      apikey: publicAnonKey,
      Authorization: `Bearer ${publicAnonKey}`,
    } as const;
  };

  const fetchOrdersSummary = async (matchId: string) => {
    const adminToken = getAdminTokenOrToast();
    if (!adminToken) return null;
    const { projectId } = await import('/utils/supabase/info');
    const headers = await getEdgeHeaders();
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/openOrdersSummary`,
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
    const data = raw ? JSON.parse(raw) : null;
    if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
    return true;
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

  const broadcastAutomationQueueChanged = (payload?: { action?: 'add' | 'remove'; matchId?: string }) => {
    try {
      localStorage.setItem(
        'automation_queue_changed_v1',
        JSON.stringify({ at: new Date().toISOString(), action: payload?.action ?? null, matchId: payload?.matchId ?? null }),
      );
    } catch {}
    window.dispatchEvent(new Event('automationQueueChanged'));
  };

  const removeFromAutomation = async (matchId: string) => {
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
      setAutomationIds((prev) => {
        const next = new Set(prev);
        next.delete(matchId);
        return next;
      });
      broadcastAutomationQueueChanged({ action: 'remove', matchId });
      toast.success('Item removido da automação');
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao remover item', { description: msg.slice(0, 220) });
      return false;
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

  const enqueueAutomation = async (m: ApiFootballMatch, prediction: Prediction | null) => {
    const fixtureId = String(m?.fixture?.id ?? '').trim();
    if (!fixtureId) return false;
    const utcDate = String(m?.fixture?.date ?? '').trim();
    const homeTeam = String(m?.teams?.home?.name ?? '').trim();
    const awayTeam = String(m?.teams?.away?.name ?? '').trim();
    const homeCrest = String((m as any)?.teams?.home?.logo ?? '').trim();
    const awayCrest = String((m as any)?.teams?.away?.logo ?? '').trim();
    const scoreHome = typeof m?.goals?.home === 'number' ? m.goals.home : null;
    const scoreAway = typeof m?.goals?.away === 'number' ? m.goals.away : null;

    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchId: fixtureId,
          fixtureId: Number(fixtureId),
          source: 'api-football',
          utcDate: utcDate || null,
          homeTeam: homeTeam || null,
          awayTeam: awayTeam || null,
          homeCrest: homeCrest || null,
          awayCrest: awayCrest || null,
          scoreHome,
          scoreAway,
          prediction: prediction ?? null,
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));

      setAutomationIds((prev) => new Set([...prev, fixtureId]));
      const mapped = Boolean(data?.item?.betfair?.marketId);
      const msg = mapped ? 'Jogo adicionado e mapeado na Betfair' : 'Jogo adicionado. Mapeamento Betfair pendente';
      const desc = !mapped && data?.item?.mappingError ? String(data.item.mappingError).slice(0, 220) : undefined;
      toast.success(msg, desc ? { description: desc } : undefined);
      broadcastAutomationQueueChanged({ action: 'add', matchId: fixtureId });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao adicionar à automação', { description: msg.slice(0, 220) });
      return false;
    }
  };

  const ensurePredictionForFixture = async (fixtureId: string) => {
    const id = String(fixtureId ?? '').trim();
    if (!id) return null;
    const existing = predictionsByMatchId[id] ?? null;
    if (existing) return existing;

    requestFixturePrediction(id);
    const startedAt = Date.now();
    const timeoutMs = 6_000;
    const intervalMs = 1_000;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const cache = readPredictionsCache();
      const p = cache[id] ?? null;
      if (p) {
        setPredictionsByMatchId(cache);
        return p;
      }
    }
    return null;
  };

  useEffect(() => {
    const onConfig = () => {
      setConfig(loadApiConfig());
      try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (
            k.startsWith('generalFixturesCache_v1:') ||
            k.startsWith('generalFixturesCache_v2:') ||
            k.startsWith('generalFixturesCache_v3:') ||
            k.startsWith('generalFixturesCache_v4:')
          ) {
            localStorage.removeItem(k);
          }
        }
      } catch {}
    };
    window.addEventListener('apiConfigChanged' as any, onConfig as any);
    return () => window.removeEventListener('apiConfigChanged' as any, onConfig as any);
  }, [date]);

  const apiFootballKey = useMemo(() => String(config?.apiFootballKey ?? '').trim(), [config?.apiFootballKey]);
  const warnedQuotaRef = useRef(false);

  useEffect(() => {
    const run = async () => {
      try {
        const { projectId, publicAnonKey } = await import('/utils/supabase/info');
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-server-1119702f/betfair/matches/list`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: publicAnonKey,
            Authorization: `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ dateFrom: date, dateTo: date, maxResults: 500 }),
        });
        const raw = await res.text().catch(() => '');
        const data = raw ? JSON.parse(raw) : null;
        if (!res.ok || !data?.ok) {
          setBetfairMatches([]);
          return;
        }
        const matches = Array.isArray(data?.matches) ? data.matches : [];
        setBetfairMatches(matches);
      } catch {
        setBetfairMatches([]);
      }
    };
    void run();
  }, [date]);

  const loadFixtures = async (opts?: { force?: boolean }) => {
    const betfairFallback = Array.isArray(betfairMatches) ? betfairMatches.map(betfairToApiFootballMatch) : [];

    if (!apiFootballKey) {
      if (betfairFallback.length > 0) {
        setFixtures(betfairFallback);
        setError('');
        setLastUpdatedAt(new Date());
        setDataSource('betfair');
        return;
      }
      setFixtures([]);
      setError('API-Football não configurada');
      setDataSource('api-football');
      return;
    }

    const isToday = date === getDayKey(new Date());
    const includeLive = bucket === 'live' || isToday;
    const cacheKey = `generalFixturesCache_v4:${date}:${includeLive ? 'live' : 'date'}`;
    const cacheMaxAgeMs = 1000 * 60 * 3;

    if (!opts?.force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { fetchedAt: string; items: ApiFootballMatch[] };
          if (parsed?.fetchedAt && Array.isArray(parsed.items)) {
            const age = Date.now() - new Date(parsed.fetchedAt).getTime();
            if (age >= 0 && age < cacheMaxAgeMs) {
              if (parsed.items.length > 0) {
                setFixtures(parsed.items);
                setLastUpdatedAt(new Date(parsed.fetchedAt));
                setError('');
                return;
              }
              setLastUpdatedAt(new Date(parsed.fetchedAt));
            }
          }
        }
      } catch {}
    }

    setIsLoading(true);
    setError('');
    try {
      const service = new ApiFootballService(apiFootballKey);
      const dateItems = await service.getFixtures({ date, timezone: TIME_ZONE, maxPages: 12 });
      const dayItems = (Array.isArray(dateItems) ? dateItems : []).filter((m) => fixtureLocalDayKey(m) === date);

      let merged = dayItems.slice();
      if (includeLive) {
        const liveItems = await service.getFixtures({ live: 'all', timezone: TIME_ZONE, maxPages: 6 }).catch(() => []);
        const liveFiltered = (Array.isArray(liveItems) ? liveItems : []).filter((m) => fixtureLocalDayKey(m) === date);
        const unique = new Map<number, ApiFootballMatch>();
        for (const m of merged) {
          const id = Number(m?.fixture?.id);
          if (!Number.isFinite(id)) continue;
          unique.set(id, m);
        }
        for (const m of liveFiltered) {
          const id = Number(m?.fixture?.id);
          if (!Number.isFinite(id)) continue;
          if (!unique.has(id)) unique.set(id, m);
        }
        merged = Array.from(unique.values());
      }

      const mergedWithBetfair = (() => {
        const unique = new Map<number, ApiFootballMatch>();
        for (const m of merged) {
          const id = Number(m?.fixture?.id);
          if (!Number.isFinite(id)) continue;
          unique.set(id, m);
        }
        for (const m of betfairFallback) {
          const id = Number(m?.fixture?.id);
          if (!Number.isFinite(id)) continue;
          if (!unique.has(id)) unique.set(id, m);
        }
        return Array.from(unique.values());
      })();

      setFixtures(mergedWithBetfair);
      const fetchedAt = new Date().toISOString();
      setLastUpdatedAt(new Date(fetchedAt));
      setDataSource('api-football');
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt, items: mergedWithBetfair }));
      } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar jogos da API-Football';
      const isQuota = /request limit for the day|reached the request limit|you have reached the request limit|\brequests\b\s*:/i.test(msg);
      if (isQuota) {
        if (!warnedQuotaRef.current) {
          warnedQuotaRef.current = true;
          toast.warning('Cota diária da API-Football atingida. Exibindo Betfair como fallback.');
        }
        setFixtures(betfairFallback);
        setError('');
        setDataSource('betfair');
      } else {
        setError(msg);
        setDataSource('api-football');
        toast.error(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFixtures();
  }, [date, apiFootballKey, bucket, betfairMatches]);

  const filtered = useMemo(() => {
    let items = fixtures;
    if (bucket !== 'all') items = items.filter((m) => toBucket(m) === bucket);
    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((m) => {
        const home = String(m?.teams?.home?.name ?? '');
        const away = String(m?.teams?.away?.name ?? '');
        const league = String(m?.league?.name ?? '');
        const c = String(m?.league?.country ?? '');
        return `${home} ${away} ${league} ${c}`.toLowerCase().includes(q);
      });
    }
    return items.slice().sort((a, b) => {
      const at = Number(a?.fixture?.timestamp ?? 0);
      const bt = Number(b?.fixture?.timestamp ?? 0);
      if (at !== bt) return at - bt;
      const ac = String(a?.league?.country ?? '').localeCompare(String(b?.league?.country ?? ''));
      if (ac !== 0) return ac;
      const al = String(a?.league?.name ?? '').localeCompare(String(b?.league?.name ?? ''));
      if (al !== 0) return al;
      return String(a?.teams?.home?.name ?? '').localeCompare(String(b?.teams?.home?.name ?? ''));
    });
  }, [fixtures, bucket, search]);

  const groups = useMemo(() => {
    const byCountry = new Map<string, Map<string, ApiFootballMatch[]>>();
    for (const m of filtered) {
      const c = String(m?.league?.country ?? 'Outros').trim() || 'Outros';
      const l = String(m?.league?.name ?? 'Unknown').trim() || 'Unknown';
      if (!byCountry.has(c)) byCountry.set(c, new Map());
      const byLeague = byCountry.get(c)!;
      if (!byLeague.has(l)) byLeague.set(l, []);
      byLeague.get(l)!.push(m);
    }
    const orderedCountries = Array.from(byCountry.keys()).sort((a, b) => a.localeCompare(b));
    return orderedCountries.map((c) => {
      const leaguesMap = byCountry.get(c)!;
      const orderedLeagues = Array.from(leaguesMap.keys()).sort((a, b) => a.localeCompare(b));
      return { country: c, leagues: orderedLeagues.map((l) => ({ league: l, matches: leaguesMap.get(l)! })) };
    });
  }, [filtered]);

  const counts = useMemo(() => {
    let live = 0;
    let scheduled = 0;
    let finished = 0;
    for (const m of fixtures) {
      const b = toBucket(m);
      if (b === 'live') live += 1;
      else if (b === 'finished') finished += 1;
      else scheduled += 1;
    }
    return { live, scheduled, finished, total: fixtures.length };
  }, [fixtures]);

  const openDetails = async (m: ApiFootballMatch) => {
    setSelected(m);
    setDetailsOpen(true);
    const id = String(m?.fixture?.id ?? '');
    if (!id) return;
    if (statsByFixtureId[id] !== undefined) return;
    if (!apiFootballKey) return;
    try {
      setLoadingStatsId(id);
      const service = new ApiFootballService(apiFootballKey);
      const stats = (await service.getFixtureStatistics(Number(id))) as FixtureStatsResponseItem[];
      setStatsByFixtureId((prev) => ({ ...prev, [id]: Array.isArray(stats) ? stats : null }));
    } catch (e) {
      setStatsByFixtureId((prev) => ({ ...prev, [id]: null }));
    } finally {
      setLoadingStatsId(null);
    }
  };

  const statsTable = useMemo(() => {
    const fixtureId = String(selected?.fixture?.id ?? '');
    const stats = fixtureId ? statsByFixtureId[fixtureId] : undefined;
    if (!Array.isArray(stats) || stats.length === 0) return null;

    const home = stats[0];
    const away = stats.length > 1 ? stats[1] : undefined;
    const homeStats = Array.isArray(home?.statistics) ? home.statistics : [];
    const awayStats = Array.isArray(away?.statistics) ? away.statistics : [];

    const byType = new Map<string, { home: any; away: any }>();
    for (const s of homeStats) {
      const type = String(s?.type ?? '').trim();
      if (!type) continue;
      byType.set(type, { home: s?.value ?? null, away: null });
    }
    for (const s of awayStats) {
      const type = String(s?.type ?? '').trim();
      if (!type) continue;
      const cur = byType.get(type) ?? { home: null, away: null };
      cur.away = s?.value ?? null;
      byType.set(type, cur);
    }

    const rows = Array.from(byType.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([type, v]) => ({ type, home: v.home, away: v.away }));

    return { rows, homeTeam: home?.team, awayTeam: away?.team };
  }, [selected, statsByFixtureId]);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-700" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Jogos em Geral</h1>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              Todos os jogos do dia (sem filtros). Use para adicionar manualmente jogos ao dashboard/automação.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={dataSource === 'betfair' ? 'secondary' : 'outline'}>
                Fonte: {!apiFootballKey || dataSource === 'betfair' ? 'Betfair' : 'API-Football + Betfair'}
              </Badge>
              {lastUpdatedAt ? (
                <div className="text-[11px] text-gray-500 tabular-nums">
                  Atualizado: {lastUpdatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!apiFootballKey || isLoading || filtered.length === 0}
              onClick={() => {
                const candidates = filtered.filter((m) => String(m?.fixture?.id ?? '').trim());
                if (candidates.length === 0) {
                  toast.error('Nenhum jogo disponível para previsão');
                  return;
                }
                const pick = candidates[Math.floor(Math.random() * candidates.length)];
                const id = String(pick.fixture.id);
                requestFixturePrediction(id);
                toast.success('Previsão solicitada. Abrindo a análise...');
                openPredictionShortcut(id);
              }}
            >
              <Dices className="w-4 h-4 mr-2" />
              Previsão aleatória
            </Button>
            <Button
              variant="outline"
              disabled={!apiFootballKey || isLoading}
              onClick={async () => {
                await loadFixtures({ force: true });
              }}
            >
              {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
              Atualizar
            </Button>
          </div>
        </div>

        {!apiFootballKey ? (
          <Card className="p-4 border border-orange-200 bg-orange-50 text-orange-900">
            Configure sua API key da API-Football em Configurações para carregar os jogos.
          </Card>
        ) : null}

        {error ? (
          <Card className="p-4 border border-red-200 bg-red-50 text-red-900">
            Erro: {error}
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Jogos carregados: {fixtures.length}</Badge>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs text-gray-600">Ao vivo</div>
            <div className="text-2xl font-bold text-red-600 tabular-nums">{counts.live}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-gray-600">Próximos</div>
            <div className="text-2xl font-bold text-blue-700 tabular-nums">{counts.scheduled}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-gray-600">Finalizados</div>
            <div className="text-2xl font-bold text-green-700 tabular-nums">{counts.finished}</div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <Label htmlFor="date">Data</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Busca</Label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Time, liga ou país..."
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            {([
              { key: 'all', label: 'Todos' },
              { key: 'live', label: 'Ao vivo' },
              { key: 'scheduled', label: 'Próximos' },
              { key: 'finished', label: 'Finalizados' },
            ] as Array<{ key: MatchBucket; label: string }>).map((t) => (
              <Button
                key={t.key}
                size="sm"
                variant={bucket === t.key ? 'default' : 'outline'}
                onClick={() => setBucket(t.key)}
              >
                {t.label}
              </Button>
            ))}
            <div className="ml-auto text-xs text-gray-600 tabular-nums">
              {lastUpdatedAt ? `Atualizado: ${lastUpdatedAt.toLocaleString('pt-BR')}` : '—'}
              {' • '}
              {filtered.length} jogos visíveis
            </div>
          </div>
        </Card>

        {isLoading ? (
          <Card className="p-6 flex items-center gap-3 text-gray-700">
            <Loader2 className="w-5 h-5 animate-spin" />
            Carregando jogos...
          </Card>
        ) : null}

        {!isLoading && filtered.length === 0 ? (
          <Card className="p-6 text-gray-700">
            Nenhum jogo encontrado{search.trim() ? ' para a busca atual.' : ' para a data selecionada.'}
          </Card>
        ) : null}

        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.country} className="p-4">
              <div className="text-sm font-bold text-gray-900">{g.country}</div>
              <div className="mt-3 space-y-4">
                {g.leagues.map((l) => (
                  <div key={l.league} className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
                      <div className="font-semibold text-gray-900 text-sm">{l.league}</div>
                      <Badge variant="outline" className="tabular-nums">
                        {l.matches.length}
                      </Badge>
                    </div>
                    <div className="overflow-x-auto bg-white">
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

                        {(() => {
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
                            return formatMoneyBR(Math.round(value));
                          };

                          const pickBetfair = (m: ApiFootballMatch) => {
                            const fixtureId = String(m?.fixture?.id ?? '').trim();
                            if (fixtureId) {
                              const direct = betfairById.get(fixtureId) ?? null;
                              if (direct) return direct;
                            }
                            const homeName = String(m?.teams?.home?.name ?? '').trim();
                            const awayName = String(m?.teams?.away?.name ?? '').trim();
                            const fixtureDate = String(m?.fixture?.date ?? '').trim();
                            const fixtureMs = fixtureDate ? new Date(fixtureDate).getTime() : NaN;
                            let best: { row: any; score: number } | null = null;
                            for (const row of betfairMatches) {
                              const bh = String(row?.homeTeam?.name ?? '').trim();
                              const ba = String(row?.awayTeam?.name ?? '').trim();
                              if (!bh || !ba) continue;
                              const teamScore = scoreTeams(homeName, awayName, bh, ba);
                              if (teamScore <= 0) continue;
                              const startIso = String(row?.betfair?.marketStartTime ?? row?.utcDate ?? '').trim();
                              const startMs = startIso ? new Date(startIso).getTime() : NaN;
                              let timeBonus = 0;
                              if (Number.isFinite(fixtureMs) && Number.isFinite(startMs)) {
                                const diffMin = Math.abs(fixtureMs - startMs) / 60000;
                                timeBonus = Math.max(0, 6 - diffMin / 30);
                              }
                              const s = teamScore + timeBonus;
                              if (!best || s > best.score) best = { row, score: s };
                            }
                            return best?.row ?? null;
                          };

                          return l.matches.map((m) => {
                            const fixtureId = String(m?.fixture?.id ?? '');
                            const home = m?.teams?.home;
                            const away = m?.teams?.away;
                            const b = toBucket(m);

                            const bf = pickBetfair(m);
                            const bfElapsed = bf?.live?.elapsed;
                            const bfScoreHome = bf?.score?.fullTime?.home;
                            const bfScoreAway = bf?.score?.fullTime?.away;

                            const elapsed =
                              typeof bfElapsed === 'number' && Number.isFinite(bfElapsed) ? bfElapsed : m?.fixture?.status?.elapsed;
                            const extra = m?.fixture?.status?.extra;
                            const minute =
                              typeof elapsed === 'number' && Number.isFinite(elapsed)
                                ? typeof extra === 'number' && Number.isFinite(extra) && extra > 0
                                  ? `${Math.floor(elapsed)}+${Math.floor(extra)}’`
                                  : `${Math.floor(elapsed)}’`
                                : null;

                            const kickoff = formatKickoff(m);
                            const timeLabel = b === 'finished' ? 'FT' : b === 'live' ? minute || 'AO VIVO' : kickoff;
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

                            const goalsHome = typeof bfScoreHome === 'number' ? bfScoreHome : m?.goals?.home;
                            const goalsAway = typeof bfScoreAway === 'number' ? bfScoreAway : m?.goals?.away;
                            const scoreHome = typeof goalsHome === 'number' ? goalsHome : null;
                            const scoreAway = typeof goalsAway === 'number' ? goalsAway : null;

                            const prediction = fixtureId ? predictionsByMatchId[fixtureId] ?? null : null;
                            const hasPrediction = Boolean(prediction);
                            const wasRequested = fixtureId ? requestedFixtureIds.has(fixtureId) : false;
                            const isInAutomation = Boolean(fixtureId) && automationIds.has(fixtureId);

                            const marketStatus = String(bf?.betfair?.marketStatus ?? '').toUpperCase();
                            const isSuspended = marketStatus === 'SUSPENDED';
                            const odds = bf?.betfair?.odds ?? null;

                            const pickOdds = (sideKey: 'home' | 'draw' | 'away', kind: 'back' | 'lay') => {
                              const o = odds?.[sideKey] ?? null;
                              if (!o) return { price: null as number | null, size: null as number | null };
                              if (kind === 'back') return { price: o.back ?? null, size: o.backSize ?? null };
                              return { price: o.lay ?? null, size: o.laySize ?? null };
                            };

                            const OddCell = ({ kind, sideKey }: { kind: 'back' | 'lay'; sideKey: 'home' | 'draw' | 'away' }) => {
                              const v = pickOdds(sideKey, kind);
                              return (
                                <div
                                  className={cn(
                                    'h-full px-2 py-2 text-center text-xs tabular-nums border-l border-gray-200',
                                    b === 'finished' ? 'bg-gray-100 text-gray-600' : kind === 'back' ? 'bg-sky-50 text-sky-900' : 'bg-rose-50 text-rose-900',
                                  )}
                                >
                                  <div className={cn('font-semibold', b === 'finished' ? 'opacity-70' : '')}>{formatOdd(v.price)}</div>
                                  <div className={cn('text-[10px] opacity-80', b === 'finished' ? 'opacity-60' : '')}>{formatSize(v.size)}</div>
                                </div>
                              );
                            };

                            return (
                              <div
                                key={fixtureId || `${home?.id}-${away?.id}-${m.fixture?.timestamp}`}
                                className={cn(
                                  'grid grid-cols-[44px_72px_1fr_repeat(6,72px)_220px] border-b border-gray-100',
                                  b === 'finished' ? 'bg-gray-50 text-gray-600 grayscale' : 'bg-white',
                                  isInAutomation && b !== 'finished' ? 'bg-amber-100' : '',
                                )}
                              >
                                <div className="px-2 py-2 flex items-center justify-center bg-gray-50">
                                  <button
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 hover:bg-gray-100"
                                    type="button"
                                    aria-label="Favoritar"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                    }}
                                  >
                                    <Star className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="px-2 py-2 flex items-stretch justify-center bg-gray-50">
                                  <div className="w-full h-[72px] overflow-hidden rounded-md flex">
                                    <div
                                      className={cn(
                                        'w-1/2 h-full flex items-center justify-center tabular-nums font-semibold',
                                        b === 'live' ? 'bg-emerald-200 text-emerald-950' : b === 'finished' ? 'bg-gray-200 text-gray-700' : 'bg-gray-200 text-gray-700',
                                      )}
                                    >
                                  {renderTimeLabel(timeLabel)}
                                    </div>
                                    <div
                                      className={cn(
                                        'w-1/2 h-full flex flex-col items-center justify-center tabular-nums font-semibold',
                                        b === 'finished' ? 'bg-gray-200 text-gray-700' : 'bg-emerald-900 text-white',
                                      )}
                                    >
                                      <div className="leading-none">{scoreHome ?? '—'}</div>
                                      <div className="text-[10px] opacity-70 leading-none my-0.5">x</div>
                                      <div className="leading-none">{scoreAway ?? '—'}</div>
                                    </div>
                                  </div>
                                </div>

                                <div className="px-3 py-2 min-w-0">
                                  <div className="flex items-center justify-between gap-3 min-w-0">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <TeamLogo teamName={home?.name ?? '—'} logoUrl={home?.logo ?? ''} size="sm" showName={false} />
                                        <div className={cn('font-semibold truncate', b === 'finished' ? 'text-gray-700' : 'text-gray-900')}>
                                          {home?.name ?? '—'}
                                        </div>
                                      </div>
                                      <div className="mt-1 flex items-center gap-2 min-w-0">
                                        <TeamLogo teamName={away?.name ?? '—'} logoUrl={away?.logo ?? ''} size="sm" showName={false} />
                                        <div className={cn('font-semibold truncate', b === 'finished' ? 'text-gray-700' : 'text-gray-900')}>
                                          {away?.name ?? '—'}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {wasRequested && !hasPrediction ? (
                                        <Badge variant="outline" className="text-[11px]">
                                          Gerando…
                                        </Badge>
                                      ) : null}
                                      {hasPrediction ? (
                                        <Badge variant="outline" className="text-[11px]">
                                          IA pronta
                                        </Badge>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                {isSuspended ? (
                                  <div className="col-span-6 px-3 py-2 flex items-center justify-center bg-gray-100 text-gray-700 font-semibold border-l border-gray-200">
                                    SUSPENSO
                                  </div>
                                ) : (
                                  <>
                                    <OddCell kind="back" sideKey="home" />
                                    <OddCell kind="lay" sideKey="home" />
                                    <OddCell kind="back" sideKey="draw" />
                                    <OddCell kind="lay" sideKey="draw" />
                                    <OddCell kind="back" sideKey="away" />
                                    <OddCell kind="lay" sideKey="away" />
                                  </>
                                )}

                                <div className="px-3 py-2 flex items-center justify-end gap-1.5">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        aria-label={isInAutomation ? 'Remover da automação (Betfair)' : 'Adicionar à automação (Betfair)'}
                                        variant="outline"
                                        size="icon"
                                        className={cn(
                                          isInAutomation
                                            ? 'border-red-300 bg-red-50 hover:bg-red-100'
                                            : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100',
                                        )}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (!fixtureId) return;
                                          setAutomationTarget(m);
                                          setAutomationActionOpen(true);
                                        }}
                                      >
                                        <img src="/utils/betfair.png" alt="Betfair" className="w-4 h-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6}>
                                      {isInAutomation ? 'Remover da automação (Betfair)' : 'Adicionar à automação (Betfair)'}
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
                                          void openDetails(m);
                                        }}
                                      >
                                        <Eye className="w-4 h-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6}>
                                      Ver detalhes
                                    </TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        aria-label="Previsão"
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (b === 'finished') {
                                            void openDetails(m);
                                            return;
                                          }
                                          if (!fixtureId) return;
                                          if (!hasPrediction) requestFixturePrediction(fixtureId);
                                          toast.success(hasPrediction ? 'Abrindo a análise...' : 'Previsão solicitada. Abrindo a análise...');
                                          openPredictionShortcut(fixtureId);
                                        }}
                                      >
                                        <Dices className="w-4 h-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6}>
                                      Abrir análise
                                    </TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        aria-label="Solicitar análise e adicionar ao dashboard"
                                        variant="outline"
                                        size="icon"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (b === 'finished') {
                                            toast.info('Partida finalizada. Use “Ver detalhes”.');
                                            return;
                                          }
                                          if (!fixtureId) return;
                                          requestFixturePrediction(fixtureId);
                                          toast.success('Análise solicitada e card adicionado ao dashboard');
                                        }}
                                      >
                                        <Star className="w-4 h-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6}>
                                      Solicitar análise + adicionar card
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes da partida</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.teams?.home?.name ?? '—'} x ${selected.teams?.away?.name ?? '—'}` : '—'}
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-gray-700">
                  <div className="font-semibold">{selected.league?.name ?? '—'}</div>
                  <div className="text-xs text-gray-500">{selected.league?.country ?? '—'} • {formatKickoff(selected)} • {statusLabel(selected)}</div>
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {selected.goals?.home ?? '—'} - {selected.goals?.away ?? '—'}
                </div>
              </div>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-900">Estatísticas</div>
                  {loadingStatsId === String(selected.fixture?.id ?? '') ? (
                    <div className="text-xs text-gray-600 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando...
                    </div>
                  ) : null}
                </div>

                {statsTable ? (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600">
                          <th className="py-2 pr-3">Indicador</th>
                          <th className="py-2 px-3 text-right">{statsTable.homeTeam?.name ?? 'Casa'}</th>
                          <th className="py-2 pl-3 text-right">{statsTable.awayTeam?.name ?? 'Fora'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsTable.rows.map((r) => (
                          <tr key={r.type} className="border-t">
                            <td className="py-2 pr-3 text-gray-800">{r.type}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{r.home ?? '—'}</td>
                            <td className="py-2 pl-3 text-right tabular-nums">{r.away ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">
                    Estatísticas indisponíveis para esta partida.
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <div className="text-sm text-gray-600">Selecione uma partida.</div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={automationActionOpen} onOpenChange={(v) => (automationIsBusy ? null : setAutomationActionOpen(v))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Automação (Betfair)</DialogTitle>
            <DialogDescription>
              {automationTarget
                ? `${automationTarget.teams?.home?.name ?? '—'} x ${automationTarget.teams?.away?.name ?? '—'}`
                : '—'}
            </DialogDescription>
          </DialogHeader>

          {automationTarget ? (
            <div className="mt-2 text-sm text-gray-700">
              <div className="text-xs text-gray-600 tabular-nums">
                {formatFixtureLabel(automationTarget)}
              </div>
              <div className="mt-2 text-xs text-gray-600">
                Se não houver análise pronta, ela será solicitada e o jogo será incluído na automação (mapeamento Betfair pode ficar pendente).
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={automationIsBusy}
              onClick={() => {
                setAutomationActionOpen(false);
                setAutomationTarget(null);
              }}
            >
              Cancelar
            </Button>

            {(() => {
              const fixtureId = String(automationTarget?.fixture?.id ?? '').trim();
              const isInAutomation = Boolean(fixtureId) && automationIds.has(fixtureId);
              if (isInAutomation) {
                return (
                  <Button
                    variant="destructive"
                    disabled={automationIsBusy || !fixtureId}
                    onClick={async () => {
                      if (!fixtureId) return;
                      setAutomationIsBusy(true);
                      try {
                        setAutomationActionOpen(false);
                        await handleRemoveWithChecks(fixtureId);
                      } finally {
                        setAutomationIsBusy(false);
                        setAutomationTarget(null);
                      }
                    }}
                  >
                    Remover da automação
                  </Button>
                );
              }

              return (
                <Button
                  disabled={automationIsBusy || !fixtureId}
                  onClick={async () => {
                    if (!automationTarget || !fixtureId) return;
                    setAutomationIsBusy(true);
                    try {
                      const p = predictionsByMatchId[fixtureId] ?? null;
                      if (!p) requestFixturePrediction(fixtureId);
                      setAutomationActionOpen(false);
                      const ok = await enqueueAutomation(automationTarget, p);
                      if (!ok) return;
                      if (!p) toast.message('Análise solicitada', { description: 'A previsão está em geração; o jogo já foi adicionado à automação.' });
                    } finally {
                      setAutomationIsBusy(false);
                      setAutomationTarget(null);
                    }
                  }}
                >
                  Adicionar à automação
                </Button>
              );
            })()}
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
            <Button
              variant="outline"
              disabled={guardIsBusy}
              onClick={() => {
                setGuardOpen(false);
                setGuardMatchId(null);
                setGuardOrdersCount(0);
                setGuardMatchedCount(0);
              }}
            >
              Cancelar
            </Button>

            <Button
              variant="outline"
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
            >
              Cancelar ordens e remover
            </Button>

            <Button
              variant="destructive"
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
            >
              Cashout e remover
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
