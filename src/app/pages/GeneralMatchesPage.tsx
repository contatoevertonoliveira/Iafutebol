import { useEffect, useMemo, useState } from 'react';
import { Globe, Loader2, RefreshCcw, Search, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballLeague, ApiFootballMatch, ApiFootballService } from '../services/apiFootballService';
import { TeamLogo } from '../components/TeamLogo';
import { cn } from '../components/ui/utils';

type MatchBucket = 'all' | 'live' | 'scheduled' | 'finished';

type FixtureStatsResponseItem = {
  team?: { id?: number; name?: string; logo?: string };
  statistics?: Array<{ type: string; value: any }>;
};

const TIME_ZONE = 'America/Sao_Paulo';

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
    const store =
      parsed && typeof parsed === 'object' && (parsed as any).version === 1 && (parsed as any).items
        ? (parsed as { version: 1; items: Record<string, { fixtureId: number; requestedAt: string; source: string }> })
        : { version: 1 as const, items: {} as Record<string, { fixtureId: number; requestedAt: string; source: string }> };

    store.items[id] = { fixtureId: Number(id), requestedAt: new Date().toISOString(), source: 'api-football' };
    localStorage.setItem(storeKey, JSON.stringify(store));
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
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished';
  if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'].includes(short)) return 'live';
  return 'scheduled';
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

const statusLabel = (m: ApiFootballMatch) => {
  const short = String(m?.fixture?.status?.short ?? '').toUpperCase();
  const long = String(m?.fixture?.status?.long ?? '').trim();
  const elapsed = m?.fixture?.status?.elapsed;
  if (elapsed !== null && elapsed !== undefined && Number.isFinite(Number(elapsed))) return `${elapsed}'`;
  if (short) return short;
  if (long) return long;
  return '—';
};

export default function GeneralMatchesPage() {
  const [config, setConfig] = useState(() => loadApiConfig());
  const [date, setDate] = useState(() => getDayKey(new Date()));
  const [bucket, setBucket] = useState<MatchBucket>('all');
  const [country, setCountry] = useState<string>('all');
  const [leagueKey, setLeagueKey] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [famousOnly, setFamousOnly] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [fixtures, setFixtures] = useState<ApiFootballMatch[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selected, setSelected] = useState<ApiFootballMatch | null>(null);
  const [statsByFixtureId, setStatsByFixtureId] = useState<Record<string, FixtureStatsResponseItem[] | null>>({});
  const [loadingStatsId, setLoadingStatsId] = useState<string | null>(null);

  useEffect(() => {
    const onConfig = () => {
      setConfig(loadApiConfig());
      try {
        for (let i = localStorage.length - 1; i >= 0; i -= 1) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith('generalFixturesCache_v1:') || k.startsWith('generalFixturesCache_v2:')) {
            localStorage.removeItem(k);
          }
        }
      } catch {}
    };
    window.addEventListener('apiConfigChanged' as any, onConfig as any);
    return () => window.removeEventListener('apiConfigChanged' as any, onConfig as any);
  }, [date]);

  const disabledLeagueIds = useMemo(() => {
    const cfg = config;
    const ids = Array.isArray(cfg?.apiFootballDisabledLeagueIds) ? cfg?.apiFootballDisabledLeagueIds : [];
    return new Set(ids.map(Number).filter(Number.isFinite));
  }, [config?.apiFootballDisabledLeagueIds]);

  const apiFootballKey = useMemo(() => String(config?.apiFootballKey ?? '').trim(), [config?.apiFootballKey]);

  const cachedLeagues = useMemo(() => {
    try {
      return readLeaguesCatalogCache();
    } catch {
      return [] as ApiFootballLeague[];
    }
  }, [config?.apiFootballKey]);

  const activeLeagues = useMemo(() => {
    if (!cachedLeagues || cachedLeagues.length === 0) return [] as ApiFootballLeague[];
    if (disabledLeagueIds.size === 0) return cachedLeagues;
    return cachedLeagues.filter((l) => !disabledLeagueIds.has(Number(l.id)));
  }, [cachedLeagues, disabledLeagueIds]);

  const activeLeagueKey = useMemo(() => {
    return activeLeagues
      .map((l) => Number(l.id))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .join(',');
  }, [activeLeagues]);

  const loadFixtures = async (opts?: { force?: boolean }) => {
    if (!apiFootballKey) {
      setFixtures([]);
      setError('API-Football não configurada');
      return;
    }

    const cacheKey = `generalFixturesCache_v2:${date}:${activeLeagueKey || 'all'}`;
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
      const from = date;
      const to = addDaysYmd(date, 1);
      const seasonsFallback = new Date().getFullYear();

      let items: ApiFootballMatch[] = [];
      if (activeLeagues.length > 0 && activeLeagues.length <= 50) {
        const unique = new Map<number, ApiFootballMatch>();
        const queue = activeLeagues.slice();
        const concurrency = 4;
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(async () => {
          while (queue.length > 0) {
            const league = queue.shift();
            if (!league) return;
            const leagueId = Number(league.id);
            const season = Number(league.season) || seasonsFallback;
            if (!Number.isFinite(leagueId)) continue;
            const chunk = await service.getFixturesOnce({ league: leagueId, season, from, to, timezone: TIME_ZONE });
            for (const m of chunk) {
              const id = Number(m?.fixture?.id);
              if (!Number.isFinite(id)) continue;
              if (!unique.has(id)) unique.set(id, m);
            }
          }
        });
        await Promise.all(workers);
        items = Array.from(unique.values());
      } else {
        items = await service.getFixturesOnce({ date, timezone: TIME_ZONE });
      }

      const dayItems = items.filter((m) => fixtureLocalDayKey(m) === date);
      setFixtures(dayItems);
      const fetchedAt = new Date().toISOString();
      setLastUpdatedAt(new Date(fetchedAt));
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt, items: dayItems }));
      } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar jogos da API-Football';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadFixtures();
  }, [date, apiFootballKey, activeLeagueKey]);

  const allowedFixtures = useMemo(() => {
    let items = fixtures;
    if (disabledLeagueIds.size > 0) {
      items = items.filter((m) => {
        const id = Number(m?.league?.id);
        if (!Number.isFinite(id)) return false;
        return !disabledLeagueIds.has(id);
      });
    }
    return items;
  }, [fixtures, disabledLeagueIds]);

  const filtered = useMemo(() => {
    let items = allowedFixtures;
    if (bucket !== 'all') items = items.filter((m) => toBucket(m) === bucket);
    if (famousOnly) items = items.filter(isFamousLeague);
    if (country !== 'all') items = items.filter((m) => String(m?.league?.country ?? '') === country);
    if (leagueKey !== 'all') items = items.filter((m) => `${m?.league?.id ?? ''}` === leagueKey);
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
  }, [allowedFixtures, bucket, country, leagueKey, search, famousOnly]);

  const countries = useMemo(() => {
    const s = new Set<string>();
    for (const m of allowedFixtures) {
      const c = String(m?.league?.country ?? '').trim();
      if (c) s.add(c);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [allowedFixtures]);

  const leagues = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; country: string }>();
    for (const m of allowedFixtures) {
      const id = String(m?.league?.id ?? '').trim();
      if (!id) continue;
      if (byId.has(id)) continue;
      byId.set(id, { id, name: String(m?.league?.name ?? 'Unknown'), country: String(m?.league?.country ?? '') });
    }
    return Array.from(byId.values()).sort((a, b) => {
      const c = a.country.localeCompare(b.country);
      if (c !== 0) return c;
      return a.name.localeCompare(b.name);
    });
  }, [allowedFixtures]);

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
    for (const m of allowedFixtures) {
      const b = toBucket(m);
      if (b === 'live') live += 1;
      else if (b === 'finished') finished += 1;
      else scheduled += 1;
    }
    return { live, scheduled, finished, total: allowedFixtures.length };
  }, [allowedFixtures]);

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
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-700" />
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Jogos em Geral</h1>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              Panorama global de jogos (filtrado pelas ligas ativas em Configurações).
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        {apiFootballKey && cachedLeagues.length === 0 ? (
          <Card className="p-4 border border-yellow-200 bg-yellow-50 text-yellow-900">
            Lista de ligas ainda não carregada. Vá em Configurações → Campeonatos e clique em “Atualizar lista” para sincronizar as ligas e permitir o filtro por ligas ativas.
          </Card>
        ) : null}

        {apiFootballKey && cachedLeagues.length > 0 && activeLeagues.length === 0 ? (
          <Card className="p-4 border border-yellow-200 bg-yellow-50 text-yellow-900">
            Nenhuma liga ativa encontrada. Ajuste as ligas em Configurações → Campeonatos.
          </Card>
        ) : null}

        {error ? (
          <Card className="p-4 border border-red-200 bg-red-50 text-red-900">
            Erro: {error}
          </Card>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Ligas no catálogo: {cachedLeagues.length}</Badge>
          <Badge variant="outline">Ligas ativas: {activeLeagues.length}</Badge>
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
          <div className="grid md:grid-cols-5 gap-3">
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
            <div className="md:col-span-1">
              <Label>País</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {countries.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-1">
              <Label>Liga</Label>
              <Select value={leagueKey} onValueChange={setLeagueKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {leagues.slice(0, 500).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.country ? `${l.country} • ` : ''}{l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            <Button
              size="sm"
              variant={famousOnly ? 'default' : 'outline'}
              onClick={() => setFamousOnly((v) => !v)}
              className={cn(famousOnly ? 'bg-orange-600 hover:bg-orange-700' : '')}
            >
              <Trophy className="w-4 h-4 mr-2" />
              Ligas famosas
            </Button>

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

        {!isLoading && fixtures.length > 0 && allowedFixtures.length === 0 ? (
          <Card className="p-6 text-gray-700">
            Os jogos do dia foram carregados, mas todos foram filtrados pelas ligas desativadas. Ajuste as ligas ativas em Configurações → Campeonatos.
          </Card>
        ) : null}

        {!isLoading && filtered.length === 0 ? (
          <Card className="p-6 text-gray-700">
            Nenhum jogo encontrado com os filtros atuais.
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
                    <div className="divide-y">
                      {l.matches.map((m) => {
                        const fixtureId = String(m?.fixture?.id ?? '');
                        const home = m?.teams?.home;
                        const away = m?.teams?.away;
                        const goalsHome = m?.goals?.home;
                        const goalsAway = m?.goals?.away;
                        const b = toBucket(m);
                        const status = statusLabel(m);
                        const score =
                          goalsHome !== null && goalsHome !== undefined && goalsAway !== null && goalsAway !== undefined
                            ? `${goalsHome} - ${goalsAway}`
                            : '—';

                        return (
                          <div
                            key={fixtureId || `${home?.id}-${away?.id}-${m.fixture?.timestamp}`}
                            className="w-full px-3 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                          >
                            <button className="flex items-center gap-3 min-w-0 flex-1 text-left" onClick={() => void openDetails(m)}>
                              <div className="w-12 text-xs text-gray-600 tabular-nums">{formatKickoff(m)}</div>
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <TeamLogo teamName={home?.name ?? '—'} logoUrl={home?.logo ?? ''} size="xs" showName={false} />
                                  <div className="truncate text-sm font-semibold text-gray-900">{home?.name ?? '—'}</div>
                                </div>
                                <div className="w-16 text-center font-bold tabular-nums text-sm text-gray-900">{score}</div>
                                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                                  <div className="truncate text-sm font-semibold text-gray-900 text-right">{away?.name ?? '—'}</div>
                                  <TeamLogo teamName={away?.name ?? '—'} logoUrl={away?.logo ?? ''} size="xs" showName={false} />
                                </div>
                              </div>
                              <Badge
                                className={cn(
                                  b === 'live'
                                    ? 'bg-red-100 text-red-800 border-red-300'
                                    : b === 'finished'
                                      ? 'bg-green-100 text-green-800 border-green-300'
                                      : 'bg-blue-100 text-blue-800 border-blue-300',
                                )}
                              >
                                {status}
                              </Badge>
                            </button>

                            {fixtureId ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  requestFixturePrediction(fixtureId);
                                  toast.success('Previsão solicitada. A partida foi adicionada ao Dashboard.');
                                }}
                              >
                                Previsão
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
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
    </div>
  );
}
