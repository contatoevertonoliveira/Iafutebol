import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Activity, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { cn } from '../components/ui/utils';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { loadApiConfig } from '../services/apiConfig';

type QueueStatus = 'queued' | 'running' | 'paused' | 'stopped' | string;

type QueueItem = {
  matchId: string;
  source: string | null;
  utcDate: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  prediction: unknown;
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

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { hour12: false });
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

  const loadQueue = async () => {
    setStatus('loading');
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
      setStatus('idle');
    } catch (e) {
      setStatus('error');
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha ao carregar automações', { description: msg.slice(0, 220) });
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

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
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
                Os jogos adicionados aparecem agrupados por data, com coluna de 1/X/2 (odds serão preenchidas quando o marketId estiver mapeado).
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
                        const title = `${x.homeTeam ?? '—'} x ${x.awayTeam ?? '—'}`;
                        const k = kickoffDate(x);
                        const canPause = x.status === 'running';
                        const canStart = x.status === 'queued' || x.status === 'paused';
                        const canStop = x.status === 'running' || x.status === 'paused';
                        const mapped = Boolean(x.betfair?.marketId);
                        const matched = x.betfair?.matchedVolume ?? null;

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
                          >
                            <div className="font-semibold">{formatOdd(v.price)}</div>
                            <div className="text-[10px] opacity-80">{formatSize(v.size)}</div>
                          </div>
                          );
                        };

                        return (
                          <div key={x.matchId} className="grid grid-cols-[64px_1fr_120px_repeat(6,72px)_220px] border-b border-gray-100">
                            <div className={cn('px-2 py-2 text-center tabular-nums font-semibold', isLive(x) ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-800')}>
                              {timeOrMinute(x)}
                            </div>

                            <div className="px-3 py-2 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="font-semibold text-gray-900 truncate">{title}</div>
                                <Badge variant={statusVariant(x.status) as any}>{statusLabel(x.status)}</Badge>
                                <Badge variant={mapped ? 'default' : (x.mappingStatus === 'unmapped' ? 'destructive' : 'secondary') as any}>
                                  {mapped ? 'Mapeado' : x.mappingStatus === 'unmapped' ? 'Não mapeado' : 'Mapeando'}
                                </Badge>
                              </div>
                              <div className="text-[11px] text-gray-600 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                                <span className="tabular-nums">{k ? k.toLocaleString('pt-BR', { hour12: false }) : '—'}</span>
                                {x.source ? <span>Fonte: {x.source}</span> : null}
                                <span className="tabular-nums">ID: {x.matchId}</span>
                                {mapped && x.betfair?.marketId ? <span className="tabular-nums">Market: {x.betfair.marketId}</span> : null}
                              </div>
                              {!mapped && x.mappingError ? (
                                <div className="mt-1 text-[11px] text-red-700">
                                  {x.mappingError}
                                </div>
                              ) : null}
                              {x.prediction ? (
                                <details className="mt-1">
                                  <summary className="text-[11px] font-semibold text-gray-700 cursor-pointer">Insights</summary>
                                  <pre className="mt-2 p-3 rounded-md bg-gray-900 text-gray-100 text-xs overflow-auto max-h-64">
                                    {JSON.stringify(x.prediction, null, 2)}
                                  </pre>
                                </details>
                              ) : null}
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

                            <div className="px-3 py-2 flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canStart}
                                onClick={() => updateItem(x.matchId, { status: 'running' })}
                              >
                                <Play className="w-4 h-4 mr-2" />
                                Iniciar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canPause}
                                onClick={() => updateItem(x.matchId, { status: 'paused' })}
                              >
                                <Pause className="w-4 h-4 mr-2" />
                                Pausar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!canStop}
                                onClick={() => updateItem(x.matchId, { status: 'stopped' })}
                              >
                                Parar
                              </Button>
                              <Button variant="destructive" size="sm" onClick={() => removeItem(x.matchId)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
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
