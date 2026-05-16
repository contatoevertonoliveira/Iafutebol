import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Activity, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { cn } from '../components/ui/utils';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Switch } from '../components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { loadApiConfig } from '../services/apiConfig';

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
    oddsFetchedAt?: string | null;
  } | null;
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

export default function AutomationPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [view, setView] = useState<'all' | 'live' | 'today' | 'tomorrow' | 'next'>('all');
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [marketsItemId, setMarketsItemId] = useState<string | null>(null);
  const [marketsDraft, setMarketsDraft] = useState<AutomationMarketToggle[]>([]);
  const isRefreshingOddsRef = useRef(false);
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const clickTimersRef = useRef<Record<string, number>>({});
  const [marketId, setMarketId] = useState('');
  const [selectionId, setSelectionId] = useState('');
  const [side, setSide] = useState<'BACK' | 'LAY'>('BACK');
  const [price, setPrice] = useState('2.0');
  const [size, setSize] = useState('2.0');
  const [bookResult, setBookResult] = useState<any>(null);
  const [placeResult, setPlaceResult] = useState<any>(null);
  const [isQueryingBook, setIsQueryingBook] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return copy;
  }, [items]);

  const now = useMemo(() => new Date(), [items.length]);

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
      out.push({ key: 'winner', label, enabled: true, details: Number.isFinite(winnerConf) ? `${Math.round(winnerConf)}%` : null });
    }

    const ouPred = String(p?.overUnder?.prediction ?? '').trim();
    const ouLine = Number(p?.overUnder?.line);
    const ouConf = Number(p?.overUnder?.confidence);
    if (ouPred && Number.isFinite(ouLine)) {
      const side = ouPred === 'over' ? 'Over' : ouPred === 'under' ? 'Under' : 'OU';
      out.push({ key: 'overUnder', label: `${side} ${ouLine}`, enabled: true, details: Number.isFinite(ouConf) ? `${Math.round(ouConf)}%` : null });
    }

    const bttsPred = String(p?.btts?.prediction ?? '').trim();
    const bttsConf = Number(p?.btts?.confidence);
    if (bttsPred) {
      out.push({
        key: 'btts',
        label: `Ambas marcam: ${bttsPred === 'yes' ? 'Sim' : 'Não'}`,
        enabled: true,
        details: Number.isFinite(bttsConf) ? `${Math.round(bttsConf)}%` : null,
      });
    }

    const cs = String(p?.correctScore?.score ?? '').trim();
    const csConf = Number(p?.correctScore?.confidence);
    if (cs) {
      out.push({ key: 'correctScore', label: `Placar correto: ${cs}`, enabled: true, details: Number.isFinite(csConf) ? `${Math.round(csConf)}%` : null });
    }

    const ahTeam = String(p?.asianHandicap?.team ?? '').trim();
    const ahLine = Number(p?.asianHandicap?.line);
    const ahConf = Number(p?.asianHandicap?.confidence);
    if (ahTeam && Number.isFinite(ahLine)) {
      const teamLabel = ahTeam === 'home' ? h : a;
      const lineLabel = ahLine > 0 ? `+${ahLine}` : `${ahLine}`;
      out.push({
        key: 'asianHandicap',
        label: `Handicap: ${teamLabel} (${lineLabel})`,
        enabled: true,
        details: Number.isFinite(ahConf) ? `${Math.round(ahConf)}%` : null,
      });
    }

    const fh = String(p?.firstHalf?.prediction ?? '').trim();
    const fhConf = Number(p?.firstHalf?.confidence);
    if (fh) {
      const label = fh === 'home' ? h : fh === 'away' ? a : 'Empate';
      out.push({ key: 'firstHalf', label: `1º tempo: ${label}`, enabled: true, details: Number.isFinite(fhConf) ? `${Math.round(fhConf)}%` : null });
    }

    const sh = String(p?.secondHalf?.prediction ?? '').trim();
    const shConf = Number(p?.secondHalf?.confidence);
    if (sh) {
      const label = sh === 'home' ? h : sh === 'away' ? a : 'Empate';
      out.push({ key: 'secondHalf', label: `2º tempo: ${label}`, enabled: true, details: Number.isFinite(shConf) ? `${Math.round(shConf)}%` : null });
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

  const TeamCrest = ({ src, name }: { src: string | null | undefined; name: string | null | undefined }) => {
    const label = String(name ?? '').trim() || '—';
    const url = String(src ?? '').trim() || '';
    const fallback = label
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => t[0]?.toUpperCase())
      .join('');

    const buildTeamBaseCandidates = (teamName: string) => {
      const raw = String(teamName ?? '').trim().toLowerCase();
      if (!raw) return [];

      const cleanSpaces = raw.replace(/\s+/g, ' ').trim();
      const keep = (s: string) =>
        s
          .normalize('NFC')
          .replace(/['’]/g, '')
          .replace(/[()]/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const removePrefix = (s: string) => s.replace(/^(fc|cf|sc|ac|cd|ud|afc|cfc)\s+/i, '').trim();
      const baseA = keep(cleanSpaces);
      const baseB = keep(removePrefix(cleanSpaces));
      const baseC = keep(cleanSpaces.replace(/^(\d+)\.\s*(fc|cf|sc|ac|cd|ud)\s+/i, '$1.$2 '));

      const toFileBase = (s: string) =>
        s
          .replace(/\s+/g, '_')
          .replace(/[^0-9a-zA-Z\u00C0-\u024F\u1E00-\u1EFF._-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '');

      const variants = [
        toFileBase(baseA),
        toFileBase(baseB),
        toFileBase(baseC),
        toFileBase(baseA).replace(/\./g, ''),
        toFileBase(baseB).replace(/\./g, ''),
      ]
        .map((x) => x.trim())
        .filter(Boolean);

      return Array.from(new Set(variants));
    };

    const localCandidates = buildTeamBaseCandidates(label).flatMap((b) => [
      encodeURI(`/assets/times/${b}.png`),
      encodeURI(`/assets/times/${b}.svg`),
      encodeURI(`/assets/times/${b}.webp`),
    ]);

    const sources = Array.from(
      new Set([...(localCandidates || []), ...(url ? [encodeURI(url)] : [])].filter(Boolean)),
    );

    const [sourceIndex, setSourceIndex] = useState(0);
    const currentSrc = sources[sourceIndex] ?? '';
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
                  return next < sources.length ? next : prev;
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
  };

  const kickoffDate = (x: QueueItem) => {
    const iso = x.utcDate || x.createdAt;
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
    const k = kickoffDate(x);
    if (!k) return false;
    const diffMin = Math.floor((now.getTime() - k.getTime()) / 60000);
    if (diffMin < 0) return false;
    if (diffMin > 130) return false;
    if (x.status === 'stopped') return false;
    return true;
  };

  const timeOrMinute = (x: QueueItem) => {
    const k = kickoffDate(x);
    if (!k) return '—';
    if (isLive(x)) {
      const diffMin = Math.max(0, Math.floor((now.getTime() - k.getTime()) / 60000));
      return `${diffMin}’`;
    }
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

    return sorted.filter(byView);
  }, [sorted, view, now]);

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
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/automation/betfair/queue/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
        body: '{}',
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) {
        throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      }
      setItems(Array.isArray(data?.items) ? (data.items as QueueItem[]) : []);
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
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/automation/betfair/queue/refreshOdds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
        body: JSON.stringify({
          max: 12,
          minFreshSeconds: 10,
          includeCorrectScore: false,
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) return;
      await loadQueue({ silent: true });
    } catch {
      return;
    } finally {
      isRefreshingOddsRef.current = false;
    }
  };

  const queryMarketBook = async () => {
    if (isQueryingBook) return;
    const mid = marketId.trim();
    if (!mid) {
      toast.error('Informe o marketId para consultar o book.');
      return;
    }
    setIsQueryingBook(true);
    setBookResult(null);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/betfair/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
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
      setBookResult(data.result ?? null);
      toast.success('Book carregado');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao consultar book', { description: msg.slice(0, 220) });
    } finally {
      setIsQueryingBook(false);
    }
  };

  const placeOrder = async () => {
    if (isPlacing) return;
    const cfg = loadApiConfig();
    const adminToken = String(cfg?.automationAdminToken ?? '').trim();
    if (!adminToken) {
      toast.error('Informe o Automation Admin Token em Configurações → Betfair.');
      return;
    }
    const mid = marketId.trim();
    const sid = selectionId.trim();
    const p = Number(price);
    const s = Number(size);
    if (!mid) return toast.error('Informe o marketId.');
    if (!sid) return toast.error('Informe o selectionId.');
    if (!Number.isFinite(p) || p <= 1) return toast.error('Preço inválido.');
    if (!Number.isFinite(s) || s <= 0) return toast.error('Stake inválida.');

    setIsPlacing(true);
    setPlaceResult(null);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/betfair/placeOrders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
          'x-automation-token': adminToken,
        },
        body: JSON.stringify({
          marketId: mid,
          instructions: [
            {
              selectionId: Number(sid),
              handicap: 0,
              side,
              orderType: 'LIMIT',
              limitOrder: { size: s, price: p, persistenceType: 'LAPSE' },
            },
          ],
          customerRef: `web_${Date.now().toString(16)}`.slice(0, 32),
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      setPlaceResult(data.result ?? null);
      toast.success('Ordem enviada');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao enviar ordem', { description: msg.slice(0, 220) });
    } finally {
      setIsPlacing(false);
    }
  };

  const updateItem = async (matchId: string, patch: Partial<QueueItem>) => {
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/automation/betfair/queue/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
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

  const openMarketsForItem = async (x: QueueItem) => {
    const base = Array.isArray(x.markets) ? x.markets : deriveMarketsFromPrediction(x);
    setMarketsItemId(x.matchId);
    setMarketsDraft(base);
    setMarketsOpen(true);
    if (!Array.isArray(x.markets) && base.length > 0) {
      await updateItem(x.matchId, { markets: base });
    }
  };

  const updateMarketToggle = async (matchId: string, key: string, enabled: boolean) => {
    const current = marketsDraft;
    const idx = current.findIndex((m) => m.key === key);
    if (idx === -1) return;
    const next = current.map((m) => (m.key === key ? { ...m, enabled } : m));
    setMarketsDraft(next);
    setItems((prev) => prev.map((x) => (x.matchId === matchId ? { ...x, markets: next } : x)));
    const ok = await updateItem(matchId, { markets: next });
    if (!ok) {
      setMarketsDraft(current);
      setItems((prev) => prev.map((x) => (x.matchId === matchId ? { ...x, markets: current } : x)));
    }
  };

  const removeItem = async (matchId: string) => {
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/automation/betfair/queue/remove`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
          apikey: publicAnonKey,
        },
        body: JSON.stringify({ matchId }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      setItems((prev) => prev.filter((x) => x.matchId !== matchId));
      toast.success('Item removido da automação');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao remover item', { description: msg.slice(0, 220) });
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  useEffect(() => {
    void refreshOdds();
    const id = window.setInterval(() => {
      void refreshOdds();
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <Dialog open={marketsOpen} onOpenChange={setMarketsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Mercados da automação</DialogTitle>
            <DialogDescription>
              Ligue/desligue mercados sugeridos pelos agentes para este jogo.
            </DialogDescription>
          </DialogHeader>

          {marketsDraft.length === 0 ? (
            <div className="text-sm text-gray-600">Nenhum mercado disponível para este item.</div>
          ) : (
            <div className="mt-2 space-y-2">
              {marketsDraft.map((m) => (
                <div key={m.key} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{m.label}</div>
                    {m.details ? <div className="text-xs text-gray-600">{m.details}</div> : null}
                  </div>
                  <Switch
                    checked={Boolean(m.enabled)}
                    onCheckedChange={(v) => {
                      if (!marketsItemId) return;
                      void updateMarketToggle(marketsItemId, m.key, Boolean(v));
                    }}
                  />
                </div>
              ))}
            </div>
          )}
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

          <Button variant="outline" onClick={loadQueue} disabled={status === 'loading'}>
            <RefreshCw className={cn('w-4 h-4 mr-2', status === 'loading' ? 'animate-spin' : '')} />
            Atualizar
          </Button>
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
                      <div className="grid grid-cols-[64px_1fr_120px_repeat(6,72px)_220px] text-xs font-semibold text-gray-700 bg-gray-100 border-b border-gray-200">
                        <div className="px-2 py-2 text-center">Tempo</div>
                        <div className="px-3 py-2">Jogo</div>
                        <div className="px-3 py-2 text-right">Correspondido</div>
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
                        const canPause = x.status === 'running';
                        const canStart = x.status === 'queued' || x.status === 'paused';
                        const canStop = x.status === 'running' || x.status === 'paused';
                        const mapped = Boolean(x.betfair?.marketId);
                        const matched = x.betfair?.matchedVolume ?? null;
                        const markets = Array.isArray(x.markets) ? x.markets : deriveMarketsFromPrediction(x);

                        const pickOdds = (sideKey: 'home' | 'draw' | 'away', kind: 'back' | 'lay') => {
                          const o = x.betfair?.odds?.[sideKey] ?? null;
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
                              kind === 'back' ? 'bg-sky-50 text-sky-900' : 'bg-rose-50 text-rose-900'
                            )}
                            style={{ fontFamily: 'var(--price-button-font-family), Tahoma, Verdana, Arial, sans-serif' }}
                          >
                            <div className="font-semibold">{formatOdd(v.price)}</div>
                            <div className="text-[10px] opacity-80">{formatSize(v.size)}</div>
                          </div>
                          );
                        };

                        return (
                          <div
                            key={x.matchId}
                            className="grid grid-cols-[64px_1fr_120px_repeat(6,72px)_220px] border-b border-gray-100"
                            onDoubleClick={(e) => {
                              const el = e.target as HTMLElement | null;
                              if (el?.closest('button')) return;
                              clearClickTimer(x.matchId);
                              void openMarketsForItem(x);
                            }}
                          >
                            <div className={cn('px-2 py-2 text-center tabular-nums font-semibold', isLive(x) ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-800')}>
                              {timeOrMinute(x)}
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
                                const homeScore = typeof x.scoreHome === 'number' ? x.scoreHome : predicted?.home ?? null;
                                const awayScore = typeof x.scoreAway === 'number' ? x.scoreAway : predicted?.away ?? null;
                                const expanded = Boolean(expandedById[x.matchId]);
                                const homeName = x.homeTeam ?? '—';
                                const awayName = x.awayTeam ?? '—';

                                return (
                                  <>
                                    <div className="flex items-center gap-2 min-w-0">
                                      <TeamCrest src={x.homeCrest} name={homeName} />
                                      <div className="tabular-nums font-semibold text-gray-900">
                                        <span>{homeScore ?? '—'}</span>
                                        <span className="mx-1 text-gray-400">x</span>
                                        <span>{awayScore ?? '—'}</span>
                                      </div>
                                      <TeamCrest src={x.awayCrest} name={awayName} />
                                      <div className="ml-auto text-xs text-gray-600">
                                        {expanded ? 'Ocultar' : 'Detalhes'}
                                      </div>
                                    </div>

                                    {expanded ? (
                                      <div className="mt-2">
                                        <div className="flex items-center flex-wrap gap-2">
                                          <Badge variant={statusVariant(x.status) as any}>{statusLabel(x.status)}</Badge>
                                          <Badge variant={mapped ? 'default' : (x.mappingStatus === 'unmapped' ? 'destructive' : 'secondary') as any}>
                                            {mapped ? 'Mapeado' : x.mappingStatus === 'unmapped' ? 'Não mapeado' : 'Mapeando'}
                                          </Badge>
                                          {x.source ? (
                                            <Badge variant="outline">Fonte: {x.source}</Badge>
                                          ) : null}
                                        </div>

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

                            <div className="px-3 py-2 text-right tabular-nums text-sm text-gray-800 bg-gray-50">
                              {formatMoneyBR(matched)}
                            </div>

                            <OddCell kind="back" sideKey="home" />
                            <OddCell kind="lay" sideKey="home" />
                            <OddCell kind="back" sideKey="draw" />
                            <OddCell kind="lay" sideKey="draw" />
                            <OddCell kind="back" sideKey="away" />
                            <OddCell kind="lay" sideKey="away" />

                            <div className="px-3 py-2 flex items-center justify-end gap-1.5">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    aria-label="Iniciar"
                                    variant="outline"
                                    size="icon"
                                    disabled={!canStart}
                                    onClick={() => updateItem(x.matchId, { status: 'running' })}
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
                                    onClick={() => updateItem(x.matchId, { status: 'paused' })}
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
                                  <Button aria-label="Excluir" variant="destructive" size="icon" onClick={() => removeItem(x.matchId)}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" sideOffset={6}>
                                  Excluir
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

        <Card className="p-4 mt-6">
          <div className="font-semibold text-gray-900">Entrada manual (Betfair)</div>
          <div className="text-sm text-gray-600 mt-1">
            Use marketId/selectionId do Exchange para consultar o book e enviar uma ordem LIMIT.
          </div>

          <div className="mt-4 grid md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <Label htmlFor="marketId">marketId</Label>
              <Input id="marketId" value={marketId} onChange={(e) => setMarketId(e.target.value)} placeholder="Ex: 1.23456789" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="selectionId">selectionId</Label>
              <Input id="selectionId" value={selectionId} onChange={(e) => setSelectionId(e.target.value)} placeholder="Ex: 12345" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="side">Side</Label>
              <select
                id="side"
                value={side}
                onChange={(e) => setSide(e.target.value === 'LAY' ? 'LAY' : 'BACK')}
                className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="BACK">BACK</option>
                <option value="LAY">LAY</option>
              </select>
            </div>
            <div>
              <Label htmlFor="price">Preço</Label>
              <Input id="price" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex: 2.0" className="mt-2" />
            </div>
            <div>
              <Label htmlFor="size">Stake</Label>
              <Input id="size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Ex: 2.0" className="mt-2" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={queryMarketBook} disabled={isQueryingBook}>
              <RefreshCw className={cn('w-4 h-4 mr-2', isQueryingBook ? 'animate-spin' : '')} />
              listMarketBook
            </Button>
            <Button onClick={placeOrder} disabled={isPlacing}>
              {isPlacing ? 'Enviando…' : 'placeOrders'}
            </Button>
          </div>

          {bookResult ? (
            <details className="mt-4">
              <summary className="text-sm font-semibold text-gray-800 cursor-pointer">Resposta listMarketBook</summary>
              <pre className="mt-2 p-3 rounded-md bg-gray-900 text-gray-100 text-xs overflow-auto max-h-80">
                {JSON.stringify(bookResult, null, 2)}
              </pre>
            </details>
          ) : null}

          {placeResult ? (
            <details className="mt-4">
              <summary className="text-sm font-semibold text-gray-800 cursor-pointer">Resposta placeOrders</summary>
              <pre className="mt-2 p-3 rounded-md bg-gray-900 text-gray-100 text-xs overflow-auto max-h-80">
                {JSON.stringify(placeResult, null, 2)}
              </pre>
            </details>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
