import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, CheckCircle, XCircle, Loader2, Trophy, Search, Settings2, Link2Off, Plug } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  saveApiConfig,
  loadApiConfig,
  validateFootballDataApiKey,
  validateApiFootballKey,
  ApiConfig
} from '../services/apiConfig';
import { toast } from 'sonner';
import { ApiFootballMatch, ApiFootballService, ApiFootballLeague } from '../services/apiFootballService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

type SettingsProps = {
  initialTab?: 'apis' | 'competitions';
  mode?: 'default' | 'leagues';
};

export default function Settings({ initialTab = 'apis', mode = 'default' }: SettingsProps) {
  const [tab, setTab] = useState<'apis' | 'competitions'>(initialTab);
  const [config, setConfig] = useState<ApiConfig>({
    footballDataApiKey: '',
    apiFootballKey: '',
    openLigaDbEnabled: true,
    kaggleUsername: '',
    kaggleApiKey: '',
    agentTrainingEnabled: false,
    apiFootballDisabledLeagueIds: [],
    llmEnabled: false,
    llmProvider: 'none',
    deepseekApiKey: '',
    deepseekModel: 'deepseek-chat',
    openaiApiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicApiKey: '',
    anthropicModel: 'claude-3-5-sonnet-latest',
    googleApiKey: '',
    googleModel: 'gemma-4-26b-a4b-it',
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isValidatingApiFootball, setIsValidatingApiFootball] = useState(false);
  const [validationStatusApiFootball, setValidationStatusApiFootball] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [leagues, setLeagues] = useState<ApiFootballLeague[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState('');
  const [selectedLeagueCountry, setSelectedLeagueCountry] = useState('all');
  const [countryQuery, setCountryQuery] = useState('');
  const [leaguesLastSource, setLeaguesLastSource] = useState<'api' | 'fixtures' | 'cache' | 'none'>('none');
  const [leaguesLastError, setLeaguesLastError] = useState<string>('');
  const [mobileExpandedApi, setMobileExpandedApi] = useState<'api-football' | 'football-data' | 'openligadb' | null>(null);
  const [leaguesProgress, setLeaguesProgress] = useState<{ page: number; total: number; count: number } | null>(null);

  const googleModelPresets = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'] as const;
  const testGoogleLlm = async () => {
    if (isTestingLlm) return;
    const apiKey = String(config.googleApiKey ?? '').trim();
    const model = String(config.googleModel ?? '').trim() || googleModelPresets[0];
    if (!apiKey) {
      toast.error('Informe a API key do Gemini para testar.');
      return;
    }
    if (!model) {
      toast.error('Selecione um modelo para testar.');
      return;
    }
    setIsTestingLlm(true);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: 'Responda com exatamente uma linha e sem explicações.' }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Retorne exatamente: OK GEMMA 4' }],
          },
        ],
        generationConfig: { temperature: 0.0, maxOutputTokens: 16 },
      };

      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/proxy/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ url, apiKey, body }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            'Proxy Google (Gemini/Gemma) não encontrado no Supabase (404). Isso normalmente significa que a Edge Function ainda não foi atualizada/deployada com o endpoint /proxy/google.',
          );
        }
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${res.statusText}${t ? ` - ${t}` : ''}`);
      }
      const data = (await res.json().catch(() => null)) as any;
      const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
      const text = parts.map((p: any) => String(p?.text ?? '')).join('\n').trim();

      const normalized = text.replace(/\s+/g, ' ').trim();
      if (normalized.toUpperCase().includes('OK GEMMA 4')) {
        toast.success('Teste do Gemini/Gemma OK', { description: text ? text.slice(0, 180) : 'Resposta sem texto' });
      } else {
        toast.warning('Teste do Gemini/Gemma retornou algo inesperado', { description: text ? text.slice(0, 220) : 'Resposta sem texto' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Falha no teste do Gemini/Gemma', { description: msg });
    } finally {
      setIsTestingLlm(false);
    }
  };

  const derivedLeagues = (() => {
    try {
      const raw =
        localStorage.getItem('matchesCache_v3') ??
        localStorage.getItem('matchesCache_v2') ??
        localStorage.getItem('matchesCache_v1');
      if (!raw) return [] as ApiFootballLeague[];
      const parsed = JSON.parse(raw) as { version: number; apiSource: string; matches: any[] };
      if (!parsed || (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)) return [] as ApiFootballLeague[];
      if (parsed.apiSource !== 'api-football') return [] as ApiFootballLeague[];
      if (!Array.isArray(parsed.matches)) return [] as ApiFootballLeague[];

      const byId = new Map<number, ApiFootballLeague>();
      const nowYear = new Date().getFullYear();

      for (const m of parsed.matches) {
        const comp = m?.competition;
        const area = comp?.area;
        const id = Number(comp?.id);
        if (!Number.isFinite(id)) continue;
        if (byId.has(id)) continue;

        byId.set(id, {
          id,
          name: String(comp?.name ?? 'Unknown'),
          type: 'League',
          logo: String(comp?.emblem ?? ''),
          country: String(area?.name ?? 'Unknown'),
          flag: String(area?.flag ?? ''),
          season: nowYear,
        });
      }

      return Array.from(byId.values()).sort((a, b) => {
        const c = a.country.localeCompare(b.country);
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      });
    } catch {
      return [] as ApiFootballLeague[];
    }
  })();

  const leaguesCacheMaxAgeMs = 1000 * 60 * 60 * 24;
  const getLeaguesCacheKey = (country?: string) => {
    const c = String(country ?? '').trim();
    if (!c) return 'apiFootball_leagues_cache_v2_all';
    const normalized = c.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `apiFootball_leagues_cache_v2_country_${normalized || 'unknown'}`;
  };

  const readLeaguesCache = (cacheKey: string) => {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { fetchedAt: string; items: ApiFootballLeague[] };
      if (!parsed?.fetchedAt || !Array.isArray(parsed.items)) return null;
      const age = Date.now() - new Date(parsed.fetchedAt).getTime();
      return { ...parsed, isFresh: age >= 0 && age < leaguesCacheMaxAgeMs };
    } catch {
      return null;
    }
  };

  const readLeaguesCacheFromSupabase = async (country?: string) => {
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/cache/api-football/leagues/get`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({ country: country ?? null }),
        },
      );

      if (!res.ok) return null;
      const data = (await res.json()) as { ok?: boolean; value?: { fetchedAt: string; items: ApiFootballLeague[] } | null };
      const value = data?.value ?? null;
      if (!value?.fetchedAt || !Array.isArray(value.items)) return null;
      const age = Date.now() - new Date(value.fetchedAt).getTime();
      return { ...value, isFresh: age >= 0 && age < leaguesCacheMaxAgeMs };
    } catch {
      return null;
    }
  };

  const writeLeaguesCacheToSupabase = async (payload: { country?: string; fetchedAt: string; items: ApiFootballLeague[] }) => {
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-1119702f/cache/api-football/leagues/set`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({
            country: payload.country ?? null,
            payload: { fetchedAt: payload.fetchedAt, items: payload.items },
          }),
        },
      );
    } catch {}
  };

  const fetchLeagues = async (opts?: { country?: string; force?: boolean }) => {
    if (!config.apiFootballKey?.trim()) return;
    const cacheKey = getLeaguesCacheKey(opts?.country);
    if (!opts?.force) {
      const cached = readLeaguesCache(cacheKey);
      if (cached?.items?.length) {
        setLeaguesLastError('');
        setLeaguesProgress(null);
        setLeaguesLastSource('cache');
        setLeagues(cached.items);
        return;
      }
      const remoteCached = await readLeaguesCacheFromSupabase(opts?.country);
      if (remoteCached?.items?.length) {
        setLeaguesLastError('');
        setLeaguesProgress(null);
        setLeaguesLastSource('cache');
        setLeagues(remoteCached.items);
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: remoteCached.fetchedAt, items: remoteCached.items }));
          if (!opts?.country) {
            localStorage.setItem('apiFootball_leagues_cache_v2', JSON.stringify({ fetchedAt: remoteCached.fetchedAt, items: remoteCached.items }));
          }
        } catch {}
        return;
      }
    }
    setIsLoadingLeagues(true);
    setLeaguesLastError('');
    setLeaguesProgress(null);
    try {
      const service = new ApiFootballService(config.apiFootballKey.trim());
      const maxPages = opts?.country ? 25 : 10;
      let items = await service.getLeaguesCatalogWithProgress(
        { country: opts?.country, current: true, maxPages },
        (p) => setLeaguesProgress(p),
      );
      if (items.length === 0) {
        const seasons = await service.getSeasons().catch(() => []);
        const latestSeason = seasons.length > 0 ? Math.max(...seasons) : new Date().getFullYear();
        items = await service.getLeaguesCatalogWithProgress(
          { season: latestSeason, country: opts?.country, current: true, maxPages },
          (p) => setLeaguesProgress(p),
        );
      }
      if (items.length === 0 && opts?.country) {
        items = await service.getLeaguesCatalogWithProgress({ current: true, maxPages }, (p) => setLeaguesProgress(p));
      }
      if (items.length === 0) {
        const dayKey = (d: Date) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(d);

        const from = dayKey(new Date());
        const to = dayKey(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
        const fixtures = await service.getFixtures({ from, to, timezone: 'America/Sao_Paulo', maxPages: 3 });
        const byId = new Map<number, ApiFootballLeague>();
        for (const f of fixtures as ApiFootballMatch[]) {
          const l = f?.league;
          if (!l || !Number.isFinite(l.id)) continue;
          if (byId.has(l.id)) continue;
          byId.set(l.id, {
            id: l.id,
            name: l.name,
            type: l.type,
            logo: l.logo,
            country: l.country,
            flag: l.flag,
            season: l.season,
          });
        }
        items = Array.from(byId.values());
        setLeaguesLastSource('fixtures');
      } else {
        setLeaguesLastSource('api');
      }
      items.sort((a, b) => {
        const c = a.country.localeCompare(b.country);
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      });
      setLeagues(items);
      const fetchedAt = new Date().toISOString();
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt, items }));
        if (!opts?.country) {
          localStorage.setItem('apiFootball_leagues_cache_v2', JSON.stringify({ fetchedAt, items }));
        }
      } catch {}
      void writeLeaguesCacheToSupabase({ country: opts?.country, fetchedAt, items });
      toast.success(items.length > 0 ? `Lista atualizada (${items.length})` : 'Lista atualizada (0)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar campeonatos da API-Football';
      setLeaguesLastError(msg);
      toast.error(msg);
    } finally {
      setIsLoadingLeagues(false);
      setLeaguesProgress(null);
    }
  };

  useEffect(() => {
    const loaded = loadApiConfig();
    if (loaded) {
      setConfig(loaded);
      if (loaded.footballDataApiKey) {
        setValidationStatus('valid');
      }
      if (loaded.apiFootballKey) {
        setValidationStatusApiFootball('valid');
      }
    }
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'competitions') return;
    if (!config.apiFootballKey?.trim()) return;

    const cached =
      readLeaguesCache(getLeaguesCacheKey()) ??
      readLeaguesCache('apiFootball_leagues_cache_v2') ??
      readLeaguesCache('apiFootball_leagues_cache_v1');

    if (cached?.items?.length) {
      setLeaguesLastSource('cache');
      setLeagues(cached.items);
      return;
    }

    void fetchLeagues();
  }, [tab, config.apiFootballKey]);

  const handleValidateApiKey = async () => {
    if (!config.footballDataApiKey.trim()) {
      toast.error('Por favor, insira uma API key');
      return;
    }

    setIsValidating(true);
    setValidationStatus('idle');

    try {
      console.log('🔄 Iniciando validação da Football-Data API...');
      const isValid = await validateFootballDataApiKey(config.footballDataApiKey);
      setValidationStatus(isValid ? 'valid' : 'invalid');

      if (isValid) {
        toast.success('✅ API key validada com sucesso!', {
          description: 'Verifique o console (F12) para mais detalhes'
        });
      } else {
        toast.error('❌ API key inválida', {
          description: 'Verifique o console (F12) para mais informações'
        });
      }
    } catch (error) {
      setValidationStatus('invalid');
      console.error('Erro completo:', error);
      toast.error('Erro ao validar API key', {
        description: 'Verifique o console (F12) para detalhes'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleValidateApiFootballKey = async () => {
    if (!config.apiFootballKey.trim()) {
      toast.error('Por favor, insira uma API key');
      return;
    }

    setIsValidatingApiFootball(true);
    setValidationStatusApiFootball('idle');

    try {
      console.log('🔄 Iniciando validação da API-Football...');
      const isValid = await validateApiFootballKey(config.apiFootballKey);
      setValidationStatusApiFootball(isValid ? 'valid' : 'invalid');

      if (isValid) {
        toast.success('✅ API-Football key validada com sucesso!', {
          description: 'Verifique o console (F12) para mais detalhes'
        });
      } else {
        toast.error('❌ API key inválida', {
          description: 'Verifique o console (F12) para mais informações'
        });
      }
    } catch (error) {
      setValidationStatusApiFootball('invalid');
      console.error('Erro completo:', error);
      toast.error('Erro ao validar API key', {
        description: 'Verifique o console (F12) para detalhes'
      });
    } finally {
      setIsValidatingApiFootball(false);
    }
  };

  const handleSave = () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      saveApiConfig(config);
      toast.success('Configurações salvas com sucesso!');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar configurações';
      toast.error('Não foi possível salvar', { description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  if (mode === 'leagues') {
    const allLeagues = leagues.length > 0 ? leagues : derivedLeagues;
    const q = leagueSearch.trim().toLowerCase();
    const filtered = allLeagues.filter((l) => {
      if (!q) return true;
      return `${l.name} ${l.country} ${l.type}`.toLowerCase().includes(q);
    });

    const isElite = (l: ApiFootballLeague) => {
      const name = l.name.toLowerCase();
      const country = l.country.toLowerCase();
      if (country.includes('england') && name.includes('premier league')) return true;
      if (country.includes('spain') && name.includes('la liga')) return true;
      if (country.includes('germany') && name.includes('bundesliga')) return true;
      if (country.includes('italy') && name.includes('serie a')) return true;
      if (country.includes('france') && name.includes('ligue 1')) return true;
      return false;
    };

    const eliteLeagues = filtered.filter(isElite);
    const regionalLeagues = filtered.filter((l) => !isElite(l));

    const disabledIds = new Set(config.apiFootballDisabledLeagueIds ?? []);
    const setLeagueActive = (leagueId: number, active: boolean) => {
      const next = new Set(config.apiFootballDisabledLeagueIds ?? []);
      if (active) next.delete(leagueId);
      else next.add(leagueId);
      setConfig({ ...config, apiFootballDisabledLeagueIds: Array.from(next) });
    };

    const LeagueCard = ({ league }: { league: ApiFootballLeague }) => {
      const active = !disabledIds.has(league.id);
      const image = league.logo || league.flag || '';

      return (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                {image ? (
                  <img src={image} alt={league.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-gray-200" />
                )}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{league.name}</div>
                <div className="text-xs text-gray-600 truncate">
                  {league.country} • temporada {league.season}
                </div>
              </div>
            </div>
            <Switch checked={active} onCheckedChange={(checked) => setLeagueActive(league.id, checked)} />
          </div>
          <div className="px-4 pb-4 flex items-center justify-between text-[11px] text-gray-500">
            <div className="font-semibold tracking-wide">DADOS: API-FOOTBALL</div>
            <div className="w-4 h-4 rounded-full border border-gray-200 bg-gray-50" />
          </div>
        </div>
      );
    };

    return (
      <div className="min-h-screen bg-gray-50 px-4 pt-4 pb-28 md:hidden">
        <div className="mb-4">
          <div className="text-3xl font-bold text-gray-900">Ativação de Ligas</div>
          <div className="text-sm text-gray-600 mt-2">
            Personalize seu feed. Ative as ligas que deseja monitorar para receber insights em tempo real.
          </div>
        </div>

        <div className="mb-5">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-3 py-3 flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0">
              <Search className="w-4 h-4 text-gray-500" />
            </div>
            <Input
              value={leagueSearch}
              onChange={(e) => setLeagueSearch(e.target.value)}
              placeholder="Buscar liga..."
              className="border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
        </div>

        <div className="mb-5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={!config.apiFootballKey?.trim() || isLoadingLeagues}
            onClick={async () => {
              await fetchLeagues({ force: true });
            }}
          >
            {isLoadingLeagues ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Atualizar lista
          </Button>
          <div className="text-xs text-gray-600 tabular-nums">
            {leagues.length > 0 ? `${leagues.length} ligas` : derivedLeagues.length > 0 ? `${derivedLeagues.length} (cache)` : '—'}
          </div>
        </div>

        {!config.apiFootballKey?.trim() ? (
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 text-sm text-orange-800">
            Configure sua API key da API-Football em Perfil para listar e ativar ligas.
          </div>
        ) : isLoadingLeagues ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3 text-gray-700">
            <Loader2 className="w-5 h-5 animate-spin" />
            <div>
              <div>
                Carregando ligas
                {leaguesProgress ? ` (${leaguesProgress.page}/${leaguesProgress.total})` : ''}...
              </div>
              {leaguesProgress ? (
                <div className="text-xs text-gray-500 mt-1 tabular-nums">Itens: {leaguesProgress.count}</div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {leaguesLastError ? (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">
                Erro ao carregar ligas: {leaguesLastError}
              </div>
            ) : null}
            {eliteLeagues.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-1 rounded-full bg-blue-600" />
                    <div className="text-sm font-extrabold tracking-widest text-gray-900">ELITE LEAGUES</div>
                  </div>
                  <div className="text-[11px] font-bold px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                    AI PRIORITY
                  </div>
                </div>
                <div className="space-y-3">
                  {eliteLeagues.map((l) => (
                    <LeagueCard key={l.id} league={l} />
                  ))}
                </div>
              </div>
            )}

            {regionalLeagues.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-1 rounded-full bg-gray-300" />
                    <div className="text-sm font-extrabold tracking-widest text-gray-900">REGIONAL &amp; EMERGING</div>
                  </div>
                  <div className="text-[11px] font-bold px-3 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                    STANDARD
                  </div>
                </div>
                <div className="space-y-3">
                  {regionalLeagues.map((l) => (
                    <LeagueCard key={l.id} league={l} />
                  ))}
                </div>
              </div>
            )}

            {eliteLeagues.length === 0 && regionalLeagues.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4 text-sm text-gray-700">
                Nenhuma liga encontrada.
              </div>
            )}
          </div>
        )}

        <div className="fixed left-0 right-0 bottom-16 px-4 md:hidden">
          <div className="max-w-md mx-auto">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Alterações'
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const hasApiFootball = Boolean(config.apiFootballKey?.trim());
  const hasFootballData = Boolean(config.footballDataApiKey?.trim());
  const hasOpenLigaDb = config.openLigaDbEnabled ?? true;
  const activeSourcesCount = Number(hasApiFootball) + Number(hasFootballData) + Number(hasOpenLigaDb);
  const apiOverallStatus = activeSourcesCount > 0 ? 'Online' : 'Offline';

  const MobileApiCard = ({
    title,
    badgeText,
    badgeClassName,
    statusText,
    statusTone,
    isConfigured,
    onOpenSettings,
    onDisconnect,
  }: {
    title: string;
    badgeText: string;
    badgeClassName: string;
    statusText: string;
    statusTone: 'ok' | 'warn' | 'off';
    isConfigured: boolean;
    onOpenSettings: () => void;
    onDisconnect?: () => void;
  }) => {
    const statusClass =
      statusTone === 'ok'
        ? 'text-green-700'
        : statusTone === 'warn'
          ? 'text-orange-700'
          : 'text-gray-600';

    return (
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
        <div className="px-4 py-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 border border-gray-200 shrink-0 overflow-hidden">
              <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-100" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-semibold text-gray-900 truncate">{title}</div>
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeClassName}`}>{badgeText}</div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-gray-600">
                <div>
                  <div className="text-gray-500">Chave</div>
                  <div className="font-semibold">{isConfigured ? 'Configurada' : 'Não configurada'}</div>
                </div>
                <div>
                  <div className="text-gray-500">Status</div>
                  <div className={`font-semibold ${statusClass}`}>{statusText}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center"
              aria-label="Configurar"
              title="Configurar"
            >
              <Settings2 className="w-4 h-4 text-gray-700" />
            </button>
            {onDisconnect && (
              <button
                type="button"
                onClick={onDisconnect}
                className="w-10 h-10 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center"
                aria-label="Desconectar"
                title="Desconectar"
              >
                <Link2Off className="w-4 h-4 text-gray-700" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const mobileApis = (
    <div className="min-h-screen bg-gray-50 px-4 pt-4 pb-28 md:hidden">
      <div className="mb-4">
        <div className="text-3xl font-bold text-gray-900">Gerenciamento de APIs</div>
        <div className="text-sm text-gray-600 mt-2">
          Centralize as chaves de integração para alimentar o algoritmo preditivo.
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center shrink-0">
            <Plug className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900">Nova Conexão</div>
            <div className="text-sm text-gray-600 mt-1">
              Adicione ou atualize suas chaves para ampliar as fontes de dados.
            </div>
          </div>
        </div>
        <Button
          className="w-full mt-4 h-11 rounded-2xl bg-blue-600 hover:bg-blue-700"
          onClick={() => setMobileExpandedApi('api-football')}
        >
          <Key className="w-4 h-4 mr-2" />
          Adicionar Chave API
        </Button>
      </div>

      <div className="space-y-3 mb-5">
        <MobileApiCard
          title="API-Football"
          badgeText="PREMIUM"
          badgeClassName="bg-blue-50 text-blue-700 border-blue-200"
          statusText={hasApiFootball ? (validationStatusApiFootball === 'invalid' ? 'Inválida' : 'Ativa') : 'Desativada'}
          statusTone={hasApiFootball ? (validationStatusApiFootball === 'invalid' ? 'warn' : 'ok') : 'off'}
          isConfigured={hasApiFootball}
          onOpenSettings={() => setMobileExpandedApi((prev) => (prev === 'api-football' ? null : 'api-football'))}
          onDisconnect={
            hasApiFootball
              ? () => {
                  setConfig({ ...config, apiFootballKey: '' });
                  setValidationStatusApiFootball('idle');
                  toast.success('API-Football removida');
                }
              : undefined
          }
        />

        {mobileExpandedApi === 'api-football' && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
            <div className="text-sm font-bold text-gray-900 mb-3">Configurar API-Football</div>
            <Label htmlFor="mobile_apiFootballKey">API Key</Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="mobile_apiFootballKey"
                type="password"
                placeholder="Insira sua API key"
                value={config.apiFootballKey}
                onChange={(e) => {
                  setConfig({ ...config, apiFootballKey: e.target.value });
                  setValidationStatusApiFootball('idle');
                }}
              />
              <Button
                variant="outline"
                disabled={isValidatingApiFootball || !config.apiFootballKey.trim()}
                onClick={handleValidateApiFootballKey}
              >
                {isValidatingApiFootball ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Validar'}
              </Button>
            </div>
          </div>
        )}

        <MobileApiCard
          title="Football-Data.org"
          badgeText="FREE TIER"
          badgeClassName="bg-gray-100 text-gray-700 border-gray-200"
          statusText={hasFootballData ? (validationStatus === 'invalid' ? 'Inválida' : 'Ativa') : 'Desativada'}
          statusTone={hasFootballData ? (validationStatus === 'invalid' ? 'warn' : 'ok') : 'off'}
          isConfigured={hasFootballData}
          onOpenSettings={() => setMobileExpandedApi((prev) => (prev === 'football-data' ? null : 'football-data'))}
          onDisconnect={
            hasFootballData
              ? () => {
                  setConfig({ ...config, footballDataApiKey: '' });
                  setValidationStatus('idle');
                  toast.success('Football-Data removida');
                }
              : undefined
          }
        />

        {mobileExpandedApi === 'football-data' && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
            <div className="text-sm font-bold text-gray-900 mb-3">Configurar Football-Data.org</div>
            <Label htmlFor="mobile_footballDataApiKey">API Key</Label>
            <div className="flex gap-2 mt-2">
              <Input
                id="mobile_footballDataApiKey"
                type="password"
                placeholder="Insira sua API key"
                value={config.footballDataApiKey}
                onChange={(e) => {
                  setConfig({ ...config, footballDataApiKey: e.target.value });
                  setValidationStatus('idle');
                }}
              />
              <Button variant="outline" disabled={isValidating || !config.footballDataApiKey.trim()} onClick={handleValidateApiKey}>
                {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Validar'}
              </Button>
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="px-4 py-4 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 border border-gray-200 shrink-0 overflow-hidden">
                <div className="w-full h-full bg-gradient-to-br from-blue-200 to-blue-50" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">OpenLigaDB</div>
                <div className="mt-2 text-[11px] text-gray-600">
                  <div className="text-gray-500">Status</div>
                  <div className={`font-semibold ${hasOpenLigaDb ? 'text-green-700' : 'text-gray-600'}`}>
                    {hasOpenLigaDb ? 'Ativa' : 'Desativada'}
                  </div>
                </div>
              </div>
            </div>
            <Switch
              checked={hasOpenLigaDb}
              onCheckedChange={(checked) => {
                setConfig({ ...config, openLigaDbEnabled: checked });
              }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="text-[11px] font-bold tracking-widest text-gray-500">STATUS DAS CONEXÕES</div>
          <div className="text-2xl font-extrabold text-gray-900 mt-1">{apiOverallStatus}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
            <div className="text-[11px] font-bold tracking-widest text-gray-500">FONTES ATIVAS</div>
            <div className="text-2xl font-extrabold text-gray-900 mt-1 tabular-nums">{activeSourcesCount}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
            <div className="text-[11px] font-bold tracking-widest text-gray-500">LIGAS ATIVAS</div>
            <div className="text-2xl font-extrabold text-gray-900 mt-1 tabular-nums">
              {hasApiFootball ? '—' : '-'}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed left-0 right-0 bottom-16 px-4 md:hidden">
        <div className="max-w-md mx-auto">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar Alterações'
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {mobileApis}
      <div className="hidden md:block">
        <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <SettingsIcon className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Configurações</h1>
          </div>
          <p className="text-gray-600">
            Configure suas APIs e preferências do sistema
          </p>
        </div>

        <div className="flex gap-2 mb-6">
          <Button variant={tab === 'apis' ? 'default' : 'outline'} onClick={() => setTab('apis')}>
            APIs
          </Button>
          <Button variant={tab === 'competitions' ? 'default' : 'outline'} onClick={() => setTab('competitions')}>
            <Trophy className="w-4 h-4 mr-2" />
            Campeonatos
          </Button>
        </div>

        {tab === 'competitions' && (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-orange-600" />
                    Campeonatos (API-Football)
                  </h2>
                  <p className="text-sm text-gray-600">
                    Ative/desative competições usadas no dia a dia. O sistema filtra os jogos vindos da API-Football.
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={!config.apiFootballKey?.trim() || isLoadingLeagues}
                  onClick={async () => {
                    await fetchLeagues({ force: true });
                  }}
                >
                  {isLoadingLeagues ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Atualizar lista
                </Button>
              </div>

              {!config.apiFootballKey?.trim() ? (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm text-orange-800">
                  Configure e valide sua API key da API-Football para listar os campeonatos.
                </div>
              ) : isLoadingLeagues ? (
                <div className="bg-white border border-gray-200 rounded-lg p-6 flex items-center gap-3 text-gray-700">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <div>
                    <div>
                      Carregando campeonatos
                      {leaguesProgress ? ` (${leaguesProgress.page}/${leaguesProgress.total})` : ''}...
                    </div>
                    {leaguesProgress ? (
                      <div className="text-xs text-gray-500 mt-1 tabular-nums">Itens: {leaguesProgress.count}</div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  {leagues.length === 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 mb-4">
                      Nenhum campeonato retornado pelo endpoint /leagues. A lista abaixo usa as competições detectadas nos jogos já carregados no dashboard (cache API-Football).
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <Label htmlFor="countryQuery">Carregar por país (API)</Label>
                      <div className="flex gap-2 mt-2">
                        <Input
                          id="countryQuery"
                          placeholder="Ex: Brazil, England, Spain"
                          value={countryQuery}
                          onChange={(e) => setCountryQuery(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          disabled={isLoadingLeagues || !countryQuery.trim()}
                          onClick={async () => {
                            await fetchLeagues({ country: countryQuery.trim() });
                            setSelectedLeagueCountry('all');
                          }}
                        >
                          Buscar
                        </Button>
                      </div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
                      <div>Total API: {leagues.length}</div>
                      <div>Total cache: {derivedLeagues.length}</div>
                      <div>
                        Fonte:{' '}
                        {leaguesLastSource === 'api'
                          ? 'API /leagues'
                          : leaguesLastSource === 'fixtures'
                            ? 'API /fixtures (derivado)'
                            : derivedLeagues.length > 0
                              ? 'Cache dashboard'
                              : '-'}
                      </div>
                      {leaguesLastError && <div className="text-red-700 mt-1">Erro: {leaguesLastError}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="min-w-[220px]">
                      <Label>País</Label>
                      <Select value={selectedLeagueCountry} onValueChange={setSelectedLeagueCountry}>
                        <SelectTrigger className="mt-2">
                          <SelectValue placeholder="Selecione um país" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          {Array.from(
                            new Set((leagues.length > 0 ? leagues : derivedLeagues).map((l) => l.country).filter(Boolean)),
                          )
                            .sort((a, b) => a.localeCompare(b))
                            .map((country) => (
                              <SelectItem key={country} value={country}>
                                {country}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="flex-1 min-w-[240px]">
                      <Label htmlFor="leagueSearch">Buscar campeonato</Label>
                      <div className="relative mt-2">
                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="leagueSearch"
                          placeholder="Ex: Premier League, Copa do Brasil..."
                          value={leagueSearch}
                          onChange={(e) => setLeagueSearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          const allIds = leagues.map((l) => l.id);
                          setConfig({ ...config, apiFootballDisabledLeagueIds: allIds });
                        }}
                        disabled={leagues.length === 0}
                      >
                        Desativar todos
                      </Button>
                      <Button
                        onClick={() => setConfig({ ...config, apiFootballDisabledLeagueIds: [] })}
                        disabled={leagues.length === 0}
                      >
                        Ativar todos
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 mb-4">
                    <Badge className="bg-green-100 text-green-800 border-green-300">
                      Ativos: {(leagues.length > 0 ? leagues.length : derivedLeagues.length) - (config.apiFootballDisabledLeagueIds?.length ?? 0)}
                    </Badge>
                    <Badge className="bg-gray-100 text-gray-800 border-gray-300">
                      Desativados: {config.apiFootballDisabledLeagueIds?.length ?? 0}
                    </Badge>
                    <Badge variant="outline">
                      Total: {leagues.length > 0 ? leagues.length : derivedLeagues.length}
                    </Badge>
                  </div>

                  <div className="space-y-3 max-h-[520px] overflow-auto pr-1">
                    {(leagues.length > 0 ? leagues : derivedLeagues)
                      .filter((l) => {
                        const q = leagueSearch.trim().toLowerCase();
                        if (!q) return true;
                        return `${l.name} ${l.country} ${l.type}`.toLowerCase().includes(q);
                      })
                      .filter((l) => selectedLeagueCountry === 'all' || l.country === selectedLeagueCountry)
                      .map((l) => {
                        const disabledIds = config.apiFootballDisabledLeagueIds ?? [];
                        const isActive = !disabledIds.includes(l.id);
                        return (
                          <div key={l.id} className="flex items-center justify-between gap-3 p-3 bg-white border rounded-lg">
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-900 truncate">{l.name}</div>
                              <div className="text-xs text-gray-600 truncate">
                                {l.country} • {l.type} • temporada {l.season}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <Badge
                                className={
                                  isActive
                                    ? 'bg-green-100 text-green-800 border-green-300'
                                    : 'bg-gray-100 text-gray-800 border-gray-300'
                                }
                              >
                                {isActive ? 'Ativo' : 'Desativado'}
                              </Badge>
                              <Switch
                                checked={isActive}
                                onCheckedChange={(checked) => {
                                  const current = new Set(config.apiFootballDisabledLeagueIds ?? []);
                                  if (checked) current.delete(l.id);
                                  else current.add(l.id);
                                  setConfig({ ...config, apiFootballDisabledLeagueIds: Array.from(current) });
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  <div className="mt-4 flex justify-end gap-3">
                    <Button variant="outline" onClick={() => window.location.reload()}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-700">
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        'Salvar Configurações'
                      )}
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {/* API Configuration */}
        {tab === 'apis' && (
        <div className="space-y-6">
          {/* Football-data.org API */}
          <Card className="p-6">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Key className="w-5 h-5 text-blue-600" />
                  Football-data.org API
                </h2>
                {validationStatus !== 'idle' && (
                  <Badge className={
                    validationStatus === 'valid' 
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-red-100 text-red-800 border-red-300'
                  }>
                    {validationStatus === 'valid' ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Válida
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Inválida
                      </>
                    )}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600">
                API principal para dados de partidas, times e competições internacionais
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Insira sua API key do football-data.org"
                    value={config.footballDataApiKey}
                    onChange={(e) => {
                      setConfig({ ...config, footballDataApiKey: e.target.value });
                      setValidationStatus('idle');
                    }}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleValidateApiKey}
                    disabled={isValidating || !config.footballDataApiKey.trim()}
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      'Validar'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">Como obter sua API key:</h4>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.football-data.org/client/register" target="_blank" rel="noopener noreferrer" className="underline font-semibold">football-data.org/client/register</a></li>
                  <li>Crie uma conta gratuita</li>
                  <li>Copie sua API key do painel de controle</li>
                  <li>Cole aqui e clique em "Validar"</li>
                </ol>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2 flex items-center gap-2">
                  🔧 Validação via servidor (solução CORS)
                </h4>
                <p className="text-sm text-purple-800 mb-2">
                  A validação agora é feita pelo servidor Supabase para contornar restrições CORS.
                </p>
                <ul className="text-sm text-purple-700 space-y-1">
                  <li>• Abra o console do navegador (F12) para ver logs detalhados</li>
                  <li>• Se funcionar via curl mas falhar aqui, verifique o servidor</li>
                  <li>• Consulte CORS_SOLUTION.md para mais informações</li>
                </ul>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Limites do plano gratuito:</h4>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 10 requisições por minuto</li>
                  <li>• Dados de competições selecionadas</li>
                  <li>• Ideal para desenvolvimento e testes</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* API-Football.com API */}
          <Card className="p-6">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Key className="w-5 h-5 text-orange-600" />
                  API-Football.com
                </h2>
                {validationStatusApiFootball !== 'idle' && (
                  <Badge className={
                    validationStatusApiFootball === 'valid'
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-red-100 text-red-800 border-red-300'
                  }>
                    {validationStatusApiFootball === 'valid' ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Válida
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Inválida
                      </>
                    )}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600">
                API premium com dados completos, escudos, bandeiras e estatísticas avançadas
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="apiFootballKey">API Key</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="apiFootballKey"
                    type="password"
                    placeholder="Insira sua API key do api-football.com"
                    value={config.apiFootballKey}
                    onChange={(e) => {
                      setConfig({ ...config, apiFootballKey: e.target.value });
                      setValidationStatusApiFootball('idle');
                    }}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleValidateApiFootballKey}
                    disabled={isValidatingApiFootball || !config.apiFootballKey.trim()}
                  >
                    {isValidatingApiFootball ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      'Validar'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-orange-900 mb-2">Como obter sua API key:</h4>
                <ol className="text-sm text-orange-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.api-football.com/register" target="_blank" rel="noopener noreferrer" className="underline font-semibold">api-football.com/register</a></li>
                  <li>Escolha um plano (gratuito ou pago)</li>
                  <li>Copie sua API key do dashboard</li>
                  <li>Cole aqui e clique em "Validar"</li>
                </ol>
              </div>

              <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-orange-900 mb-2">Recursos exclusivos da API-Football:</h4>
                <ul className="text-sm text-orange-800 space-y-1">
                  <li>⚽ Escudos de times em alta resolução</li>
                  <li>🏴 Bandeiras de países e competições</li>
                  <li>📊 Estatísticas avançadas e previsões</li>
                  <li>🔄 Dados em tempo real</li>
                  <li>🌍 Mais de 1000 ligas cobertas</li>
                  <li>📈 Histórico completo de partidas (H2H)</li>
                </ul>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Plano gratuito:</h4>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 100 requisições por dia</li>
                  <li>• Acesso a todas as ligas principais</li>
                  <li>• Ideal para desenvolvimento e protótipos</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* OpenLigaDB API */}
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-green-600" />
                OpenLigaDB API
              </h2>
              <p className="text-sm text-gray-600">
                API gratuita para dados de ligas alemãs (Bundesliga) e outras competições
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="openligadb">Habilitar OpenLigaDB</Label>
                <p className="text-sm text-gray-500 mt-1">
                  Não requer API key - completamente gratuito
                </p>
              </div>
              <Switch
                id="openligadb"
                checked={config.openLigaDbEnabled}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, openLigaDbEnabled: checked })
                }
              />
            </div>

            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-green-900 mb-2">Características:</h4>
              <ul className="text-sm text-green-800 space-y-1">
                <li>✓ Completamente gratuito</li>
                <li>✓ Sem necessidade de registro</li>
                <li>✓ Dados em tempo real de ligas alemãs</li>
                <li>✓ Informações detalhadas de partidas</li>
              </ul>
            </div>
          </Card>

          {/* Kaggle API Configuration */}
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-purple-600" />
                Kaggle API (Treinamento de Agentes)
              </h2>
              <p className="text-sm text-gray-600">
                Configure suas credenciais Kaggle para treinar os agentes de IA com dados reais
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="kaggleUsername">Username Kaggle</Label>
                <Input
                  id="kaggleUsername"
                  type="text"
                  placeholder="seu-username-kaggle"
                  value={config.kaggleUsername}
                  onChange={(e) => setConfig({ ...config, kaggleUsername: e.target.value })}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="kaggleApiKey">API Key Kaggle</Label>
                <Input
                  id="kaggleApiKey"
                  type="password"
                  placeholder="Insira sua API key do Kaggle"
                  value={config.kaggleApiKey}
                  onChange={(e) => setConfig({ ...config, kaggleApiKey: e.target.value })}
                  className="mt-2"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div>
                  <Label htmlFor="agentTraining" className="text-base font-semibold">
                    Ativar Treinamento Automático
                  </Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Os agentes serão treinados automaticamente com novos dados
                  </p>
                </div>
                <Switch
                  id="agentTraining"
                  checked={config.agentTrainingEnabled}
                  onCheckedChange={(checked) =>
                    setConfig({ ...config, agentTrainingEnabled: checked })
                  }
                />
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Como obter suas credenciais Kaggle:</h4>
                <ol className="text-sm text-purple-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.kaggle.com/account" target="_blank" rel="noopener noreferrer" className="underline font-semibold">kaggle.com/account</a></li>
                  <li>Clique em "Create New API Token"</li>
                  <li>Um arquivo kaggle.json será baixado</li>
                  <li>Abra o arquivo e copie o username e key</li>
                  <li>Cole aqui e ative o treinamento</li>
                </ol>
              </div>

              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Benefícios do treinamento:</h4>
                <ul className="text-sm text-purple-800 space-y-1">
                  <li>✓ Acesso a datasets com milhões de partidas históricas</li>
                  <li>✓ Treinamento com dados reais de resultados</li>
                  <li>✓ Melhoria contínua da acurácia dos agentes</li>
                  <li>✓ Modelos especializados por liga e tipo de aposta</li>
                  <li>✓ Tracking de evolução e performance</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* IAs Externas (LLMs) */}
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-indigo-600" />
                IAs Externas (DeepSeek / ChatGPT / Claude)
              </h2>
              <p className="text-sm text-gray-600">
                Ative um motor externo para reforçar insights no chat de Bots (refinamento contínuo de estratégias).
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div>
                  <Label htmlFor="llmEnabled" className="text-base font-semibold">
                    Ativar IA externa no chat de Bots
                  </Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Quando ativado, o chat do menu Bots usa a IA selecionada e mantém fallback local se falhar.
                  </p>
                </div>
                <Switch
                  id="llmEnabled"
                  checked={Boolean(config.llmEnabled)}
                  onCheckedChange={(checked) => setConfig({ ...config, llmEnabled: checked })}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Fornecedor</Label>
                  <Select
                    value={String(config.llmProvider ?? 'none')}
                    onValueChange={(v) => setConfig({ ...config, llmProvider: v as any })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="google">Google Gemini</SelectItem>
                      <SelectItem value="openai">ChatGPT (OpenAI)</SelectItem>
                      <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Modelo</Label>
                  {config.llmProvider === 'google' ? (
                    <div className="mt-2 space-y-2">
                      <Select
                        value={
                          googleModelPresets.includes(String(config.googleModel ?? '').trim() as any)
                            ? String(config.googleModel ?? '').trim()
                            : googleModelPresets[0]
                        }
                        onValueChange={(v) => setConfig({ ...config, googleModel: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o modelo" />
                        </SelectTrigger>
                        <SelectContent>
                          {googleModelPresets.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <Input
                      className="mt-2"
                      value={
                        config.llmProvider === 'deepseek'
                          ? String(config.deepseekModel ?? '')
                          : config.llmProvider === 'openai'
                            ? String(config.openaiModel ?? '')
                            : config.llmProvider === 'anthropic'
                              ? String(config.anthropicModel ?? '')
                              : ''
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (config.llmProvider === 'deepseek') setConfig({ ...config, deepseekModel: value });
                        if (config.llmProvider === 'openai') setConfig({ ...config, openaiModel: value });
                        if (config.llmProvider === 'anthropic') setConfig({ ...config, anthropicModel: value });
                      }}
                      placeholder={
                        config.llmProvider === 'deepseek'
                          ? 'deepseek-chat'
                          : config.llmProvider === 'openai'
                            ? 'gpt-4o-mini'
                            : config.llmProvider === 'anthropic'
                              ? 'claude-3-5-sonnet-latest'
                              : 'Selecione um fornecedor'
                      }
                      disabled={!config.llmProvider || config.llmProvider === 'none'}
                    />
                  )}
                </div>
              </div>

              {config.llmProvider === 'deepseek' ? (
                <div>
                  <Label>API Key (DeepSeek)</Label>
                  <Input
                    type="password"
                    className="mt-2"
                    value={String(config.deepseekApiKey ?? '')}
                    onChange={(e) => setConfig({ ...config, deepseekApiKey: e.target.value })}
                    placeholder="Cole sua API key do DeepSeek"
                  />
                </div>
              ) : null}

              {config.llmProvider === 'google' ? (
                <div>
                  <Label>API Key (Google Gemini)</Label>
                  <Input
                    type="password"
                    className="mt-2"
                    value={String(config.googleApiKey ?? '')}
                    onChange={(e) => setConfig({ ...config, googleApiKey: e.target.value })}
                    placeholder="Cole sua API key do Gemini"
                  />
                  <div className="mt-3">
                    <Button variant="outline" onClick={testGoogleLlm} disabled={isTestingLlm || !String(config.googleApiKey ?? '').trim()}>
                      {isTestingLlm ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Testando...
                        </>
                      ) : (
                        'Testar Gemma 4'
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}

              {config.llmProvider === 'openai' ? (
                <div>
                  <Label>API Key (OpenAI)</Label>
                  <Input
                    type="password"
                    className="mt-2"
                    value={String(config.openaiApiKey ?? '')}
                    onChange={(e) => setConfig({ ...config, openaiApiKey: e.target.value })}
                    placeholder="Cole sua API key da OpenAI"
                  />
                </div>
              ) : null}

              {config.llmProvider === 'anthropic' ? (
                <div>
                  <Label>API Key (Anthropic)</Label>
                  <Input
                    type="password"
                    className="mt-2"
                    value={String(config.anthropicApiKey ?? '')}
                    onChange={(e) => setConfig({ ...config, anthropicApiKey: e.target.value })}
                    placeholder="Cole sua API key da Anthropic"
                  />
                </div>
              ) : null}
            </div>
          </Card>

          {/* IA Agents Configuration */}
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                🧠 Agentes de IA - Performance
              </h2>
              <p className="text-sm text-gray-600">
                Acompanhe a evolução e performance dos agentes especialistas
              </p>
            </div>

            <div className="grid gap-4">
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Agentes Ativos:</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">📊 StatsMaster (Estatístico)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">73.5%</Badge>
                      <span className="text-xs text-green-600">+3.3%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">📈 FormAnalyzer (Momento)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">71.2%</Badge>
                      <span className="text-xs text-green-600">+2.7%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">⚔️ H2H Expert (Histórico)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-yellow-100 text-yellow-800">68.9%</Badge>
                      <span className="text-xs text-green-600">+1.8%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">🧠 DeepPredictor (ML Avançado)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">76.8%</Badge>
                      <span className="text-xs text-green-600">+2.9%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">🎯 EnsembleMaster (Consenso)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">78.3%</Badge>
                      <span className="text-xs text-green-600">+2.5%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">📊 Estatísticas Gerais:</h4>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Total de Previsões</div>
                    <div className="text-2xl font-bold text-blue-600">1,520</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Previsões Corretas</div>
                    <div className="text-2xl font-bold text-green-600">1,190</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Taxa Média</div>
                    <div className="text-2xl font-bold text-purple-600">73.6%</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Melhoria Média</div>
                    <div className="text-2xl font-bold text-green-600">+2.6%</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Configurações'
              )}
            </Button>
          </div>
        </div>
        )}
      </div>
        </div>
      </div>
    </>
  );
}
