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
  validateApiFootballKey,
  ApiConfig
} from '../services/apiConfig';
import { toast } from 'sonner';
import { ApiFootballMatch, ApiFootballService, ApiFootballLeague } from '../services/apiFootballService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';

type SettingsProps = {
  initialTab?: 'apis' | 'competitions' | 'betfair';
  mode?: 'default' | 'leagues';
};

export default function Settings({ initialTab = 'apis', mode = 'default' }: SettingsProps) {
  const [tab, setTab] = useState<'apis' | 'competitions' | 'betfair'>(initialTab);
  const [config, setConfig] = useState<ApiConfig>({
    apiFootballKey: '',
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
  const [isValidatingApiFootball, setIsValidatingApiFootball] = useState(false);
  const [validationStatusApiFootball, setValidationStatusApiFootball] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [isValidatingGoogleKey, setIsValidatingGoogleKey] = useState(false);
  const [betfairTest, setBetfairTest] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'error';
    message: string;
    tokenPreview: string | null;
    fetchedAt: string | null;
    eventTypesCount: number | null;
  }>({ status: 'idle', message: '', tokenPreview: null, fetchedAt: null, eventTypesCount: null });
  const [betfairFunds, setBetfairFunds] = useState<{
    status: 'idle' | 'loading' | 'ok' | 'error';
    availableToBetBalance: number | null;
    exposure: number | null;
    currencyCode: string | null;
    fetchedAt: string | null;
    message: string;
  }>({ status: 'idle', availableToBetBalance: null, exposure: null, currencyCode: null, fetchedAt: null, message: '' });
  const [leagues, setLeagues] = useState<ApiFootballLeague[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState('');
  const [selectedLeagueCountry, setSelectedLeagueCountry] = useState('all');
  const [countryQuery, setCountryQuery] = useState('');
  const [leaguesLastSource, setLeaguesLastSource] = useState<'api' | 'fixtures' | 'cache' | 'none'>('none');
  const [leaguesLastError, setLeaguesLastError] = useState<string>('');
  const [mobileExpandedApi, setMobileExpandedApi] = useState<'api-football' | null>(null);
  const [leaguesProgress, setLeaguesProgress] = useState<{ page: number; total: number; count: number } | null>(null);

  const googleModelPresets = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'] as const;
  const getEdgeHeaders = async () => {
    const { publicAnonKey } = await import('/utils/supabase/info');
    return {
      'Content-Type': 'application/json',
      apikey: publicAnonKey,
      Authorization: `Bearer ${publicAnonKey}`,
    } as const;
  };
  const validateGoogleGeminiKey = async () => {
    if (isValidatingGoogleKey) return;
    const apiKey = String(config.googleApiKey ?? '').trim();
    const model = String(config.googleModel ?? '').trim() || googleModelPresets[0];
    if (!apiKey) {
      toast.error('Informe a API key do Gemini para validar.');
      return;
    }
    setIsValidatingGoogleKey(true);
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/validate-server-1119702f/validate-api/google-gemini`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ apiKey, model }),
      });

      const raw = await res.text().catch(() => '');
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      if (!res.ok || !data?.valid) {
        const details = data?.details ? (typeof data.details === 'string' ? data.details : JSON.stringify(data.details)) : raw;
        throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`) + (details ? ` - ${details}` : ''));
      }

      toast.success('Chave do Gemini válida', { description: String(data?.model ?? model) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Chave do Gemini inválida', { description: msg.slice(0, 220) });
    } finally {
      setIsValidatingGoogleKey(false);
    }
  };

  const testBetfairConnection = async () => {
    if (betfairTest.status === 'testing') return;
    setBetfairTest({ status: 'testing', message: 'Testando…', tokenPreview: null, fetchedAt: null, eventTypesCount: null });
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const sessionRes = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/session`, {
        method: 'POST',
        headers,
        body: '{}',
      });

      const sessionRaw = await sessionRes.text().catch(() => '');
      let sessionData: any = null;
      try {
        sessionData = sessionRaw ? JSON.parse(sessionRaw) : null;
      } catch {
        sessionData = null;
      }
      if (!sessionRes.ok || !sessionData?.ok || !sessionData?.hasSession) {
        const err = String(sessionData?.error ?? `HTTP ${sessionRes.status} ${sessionRes.statusText}`);
        throw new Error(err);
      }

      const rpcRes = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'SportsAPING/v1.0/listEventTypes',
          params: { filter: {} },
        }),
      });

      const rpcRaw = await rpcRes.text().catch(() => '');
      let rpcData: any = null;
      try {
        rpcData = rpcRaw ? JSON.parse(rpcRaw) : null;
      } catch {
        rpcData = null;
      }
      if (!rpcRes.ok || !rpcData?.ok) {
        const err = String(rpcData?.error ?? `HTTP ${rpcRes.status} ${rpcRes.statusText}`);
        throw new Error(err);
      }

      const count = Array.isArray(rpcData?.result) ? rpcData.result.length : null;
      setBetfairTest({
        status: 'ok',
        message: 'Conexão OK',
        tokenPreview: typeof sessionData?.tokenPreview === 'string' ? sessionData.tokenPreview : null,
        fetchedAt: typeof sessionData?.fetchedAt === 'string' ? sessionData.fetchedAt : null,
        eventTypesCount: typeof count === 'number' ? count : null,
      });
      toast.success('Betfair OK', {
        description: `Sessão criada${count !== null ? ` • eventTypes: ${count}` : ''}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint =
        msg.includes('CERT_AUTH_REQUIRED') || msg.toLowerCase().includes('certificado')
          ? 'Verifique se o .crt está vinculado na conta Betfair e se o CERT/KEY (PEM) nos secrets correspondem ao mesmo par.'
          : msg.includes('INVALID_USERNAME_OR_PASSWORD')
            ? 'Verifique BETFAIR_USERNAME/BETFAIR_PASSWORD (e caracteres especiais).'
            : msg.includes('MIGRATION_REQUIRED') || msg.includes('TERMS_AND_CONDITIONS')
              ? 'Faça login no site da Betfair e conclua migração/aceites pendentes.'
              : msg.includes('APP_KEY') || msg.includes('X-Application')
                ? 'Verifique BETFAIR_APP_KEY (Application Key).'
                : '';
      setBetfairTest({ status: 'error', message: `${msg}${hint ? ` • ${hint}` : ''}`, tokenPreview: null, fetchedAt: null, eventTypesCount: null });
      toast.error('Falha ao conectar na Betfair', { description: hint ? hint : msg.slice(0, 220) });
    }
  };

  const fetchBetfairFunds = async () => {
    if (betfairFunds.status === 'loading') return;
    const adminToken = String(config.automationAdminToken ?? '').trim();
    if (!adminToken) {
      toast.error('Informe o Automation Admin Token em Configurações → Betfair.');
      return;
    }
    setBetfairFunds((prev) => ({ ...prev, status: 'loading', message: 'Buscando…' }));
    try {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/automation/betfair/account/funds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ adminToken }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));

      const available = typeof data?.summary?.availableToBetBalance === 'number' ? data.summary.availableToBetBalance : null;
      const exposure = typeof data?.summary?.exposure === 'number' ? data.summary.exposure : null;
      const currencyCode = typeof data?.summary?.currencyCode === 'string' ? data.summary.currencyCode : null;
      const fetchedAt = typeof data?.fetchedAt === 'string' ? data.fetchedAt : null;

      setBetfairFunds({
        status: 'ok',
        availableToBetBalance: available,
        exposure,
        currencyCode,
        fetchedAt,
        message: 'Banca carregada',
      });

      if (typeof available === 'number' && Number.isFinite(available)) {
        setConfig((prev) => ({ ...prev, betfairBankroll: available }));
        toast.success('Banca atualizada', { description: `Disponível para apostar: ${available.toFixed(2)} ${currencyCode ?? ''}`.trim() });
      } else {
        toast.error('Falha ao ler saldo disponível da Betfair');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBetfairFunds((prev) => ({ ...prev, status: 'error', message: msg.slice(0, 220) }));
      toast.error('Falha ao buscar banca da Betfair', { description: msg.slice(0, 220) });
    }
  };
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
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: {
          parts: [
            {
              text: 'Preencha e retorne somente o JSON solicitado. Não inclua markdown, listas, explicações ou texto extra.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Responda com {"ok":"OK GEMMA 4"}' }],
          },
        ],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 32,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              ok: { type: 'string' },
            },
            required: ['ok'],
          },
        },
      };

      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/ai-proxy-server-1119702f/proxy/google`, {
        method: 'POST',
        headers,
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

      const extractJsonObject = (s: string) => {
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start < 0 || end < 0 || end <= start) return null;
        const candidate = s.slice(start, end + 1);
        try {
          return JSON.parse(candidate) as any;
        } catch {
          return null;
        }
      };

      const parsed =
        (() => {
          try {
            return JSON.parse(text);
          } catch {
            return extractJsonObject(text);
          }
        })() ?? null;
      const ok = String(parsed?.ok ?? '').trim();
      if (ok.toUpperCase() === 'OK GEMMA 4') {
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
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/cache-server-1119702f/cache/api-football/leagues/get`,
        {
          method: 'POST',
          headers,
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
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      await fetch(
        `https://${projectId}.supabase.co/functions/v1/cache-server-1119702f/cache/api-football/leagues/set`,
        {
          method: 'POST',
          headers,
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
      const { betfairMarketPercents: _removed, ...cleaned } = (config as any) ?? {};
      saveApiConfig(cleaned as ApiConfig);
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
  const activeSourcesCount = hasApiFootball ? 2 : 1;
  const apiOverallStatus = hasApiFootball ? 'Online' : 'Parcial';

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
          <Button variant={tab === 'betfair' ? 'default' : 'outline'} onClick={() => setTab('betfair')}>
            <Plug className="w-4 h-4 mr-2" />
            Betfair
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

        {tab === 'betfair' && (
          <div className="space-y-6">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Plug className="w-5 h-5 text-emerald-700" />
                    Betfair Exchange
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Teste o login não-interativo (certificado) e uma chamada simples na API (listEventTypes) usando os secrets do Supabase.
                  </p>
                </div>
                <Button variant="outline" onClick={testBetfairConnection} disabled={betfairTest.status === 'testing'}>
                  {betfairTest.status === 'testing' ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Testando...
                    </>
                  ) : (
                    'Testar conexão'
                  )}
                </Button>
              </div>

              <div className="mt-4 grid md:grid-cols-3 gap-3">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-600">Status</div>
                  <div className="mt-1 font-semibold text-gray-900">
                    {betfairTest.status === 'ok' ? 'OK' : betfairTest.status === 'error' ? 'Erro' : betfairTest.status === 'testing' ? 'Testando…' : '—'}
                  </div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-600">Sessão</div>
                  <div className="mt-1 font-semibold text-gray-900 tabular-nums">{betfairTest.tokenPreview ?? '—'}</div>
                  <div className="text-[11px] text-gray-600 tabular-nums mt-1">{betfairTest.fetchedAt ?? ''}</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-600">Event Types</div>
                  <div className="mt-1 font-semibold text-gray-900 tabular-nums">
                    {typeof betfairTest.eventTypesCount === 'number' ? betfairTest.eventTypesCount : '—'}
                  </div>
                </div>
              </div>

              {betfairTest.message ? (
                <div className={`mt-4 rounded-lg border p-3 text-sm ${betfairTest.status === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                  {betfairTest.message}
                </div>
              ) : null}

              <div className="mt-6 border-t pt-4">
                <div className="text-sm font-semibold text-gray-900">Operações reais (placeOrders)</div>
                <div className="text-sm text-gray-600 mt-1">
                  Token local para liberar ações de trade no backend. Necessário para entradas manuais/automação.
                </div>

                <div className="mt-3">
                  <Label htmlFor="automationAdminToken">Automation Admin Token</Label>
                  <Input
                    id="automationAdminToken"
                    type="password"
                    placeholder="Cole aqui o token"
                    value={String(config.automationAdminToken ?? '')}
                    onChange={(e) => setConfig({ ...config, automationAdminToken: e.target.value })}
                    className="mt-2"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button onClick={handleSave} disabled={isSaving}>
                      {isSaving ? 'Salvando…' : 'Salvar token'}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t pt-4">
                <div className="text-sm font-semibold text-gray-900">Banca total</div>
                <div className="text-sm text-gray-600 mt-1">
                  Define o valor total da banca/carteira usada para os cálculos de stake por porcentagem.
                </div>

                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-sm text-gray-700">
                      {betfairFunds.status === 'ok' && typeof betfairFunds.availableToBetBalance === 'number'
                        ? `Betfair disponível: ${betfairFunds.availableToBetBalance.toFixed(2)} ${betfairFunds.currencyCode ?? ''}`.trim()
                        : 'Betfair disponível: —'}
                      {betfairFunds.fetchedAt ? (
                        <div className="text-[11px] text-gray-600 tabular-nums mt-1">{betfairFunds.fetchedAt}</div>
                      ) : null}
                    </div>
                    <Button variant="outline" onClick={fetchBetfairFunds} disabled={betfairFunds.status === 'loading'}>
                      {betfairFunds.status === 'loading' ? 'Buscando…' : 'Buscar banca na Betfair'}
                    </Button>
                  </div>

                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <Label htmlFor="betfairBankroll">Banca total (R$)</Label>
                      <Input
                        id="betfairBankroll"
                        inputMode="decimal"
                        placeholder="Ex: 1000"
                        value={String(config.betfairBankroll ?? '')}
                        onChange={(e) => {
                          const raw = String(e.target.value ?? '').replace(',', '.');
                          const n = Number(raw);
                          setConfig({ ...config, betfairBankroll: Number.isFinite(n) ? n : 0 });
                        }}
                        className="mt-2"
                      />
                    </div>
                    <div className="flex items-end justify-end">
                      <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Salvando…' : 'Salvar banca'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t pt-4">
                <div className="text-sm font-semibold text-gray-900">Limites dos robôs</div>
                <div className="text-sm text-gray-600 mt-1">
                  Ajusta os parâmetros operacionais dos robôs (independentes das previsões).
                </div>

                {(() => {
                  const raw = (config.betfairRobotLimits && typeof config.betfairRobotLimits === 'object') ? config.betfairRobotLimits : {};
                  const ticks = (raw as any)?.scalpingTicks && typeof (raw as any).scalpingTicks === 'object' ? (raw as any).scalpingTicks : {};
                  const over = (raw as any)?.overGoalsLimit && typeof (raw as any).overGoalsLimit === 'object' ? (raw as any).overGoalsLimit : {};
                  const overHT = (raw as any)?.overGoalsHT && typeof (raw as any).overGoalsHT === 'object' ? (raw as any).overGoalsHT : {};
                  const asian = (raw as any)?.asianHandicap && typeof (raw as any).asianHandicap === 'object' ? (raw as any).asianHandicap : {};
                  const correctScore = (raw as any)?.correctScore && typeof (raw as any).correctScore === 'object' ? (raw as any).correctScore : {};
                  const favoriteRescue =
                    (raw as any)?.favoriteRescue && typeof (raw as any).favoriteRescue === 'object' ? (raw as any).favoriteRescue : {};

                  const setLimits = (patch: any) => {
                    const next = {
                      ...(config.betfairRobotLimits ?? {}),
                      ...(patch ?? {}),
                    };
                    setConfig({ ...config, betfairRobotLimits: next });
                  };

                  const setTicks = (patch: any) => {
                    setLimits({
                      scalpingTicks: {
                        ...(config.betfairRobotLimits?.scalpingTicks ?? {}),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const setOver = (patch: any) => {
                    setLimits({
                      overGoalsLimit: {
                        ...(config.betfairRobotLimits?.overGoalsLimit ?? {}),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const setOverHT = (patch: any) => {
                    setLimits({
                      overGoalsHT: {
                        ...(((config.betfairRobotLimits as any)?.overGoalsHT ?? {}) as any),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const setAsian = (patch: any) => {
                    setLimits({
                      asianHandicap: {
                        ...(((config.betfairRobotLimits as any)?.asianHandicap ?? {}) as any),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const setCorrectScore = (patch: any) => {
                    setLimits({
                      correctScore: {
                        ...(((config.betfairRobotLimits as any)?.correctScore ?? {}) as any),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const setFavoriteRescue = (patch: any) => {
                    setLimits({
                      favoriteRescue: {
                        ...(((config.betfairRobotLimits as any)?.favoriteRescue ?? {}) as any),
                        ...(patch ?? {}),
                      },
                    });
                  };

                  const stTargetTicks = Number(ticks?.targetTicks);
                  const stEntryOffsetTicks = Number(ticks?.entryOffsetTicks);
                  const stEntryMaxWaitSeconds = Number((ticks as any)?.entryMaxWaitSeconds);
                  const stMaxSpreadTicks = Number(ticks?.maxSpreadTicks);
                  const stMinSecondsBetweenCycles = Number(ticks?.minSecondsBetweenCycles);
                  const stStakePct = Number(ticks?.stakePct);
                  const stStakeAbs = Number((ticks as any)?.stakeAbs);
                  const stStakeModeRaw = String((ticks as any)?.stakeMode ?? '').trim().toLowerCase();
                  const stStakeModeAbs =
                    stStakeModeRaw === 'abs' ? true
                      : stStakeModeRaw === 'pct' ? false
                      : (Number.isFinite(stStakeAbs) && stStakeAbs > 0);
                  const stMaxCycles = Number(ticks?.maxCycles);
                  const stSecondsToWaitMatch = Number(ticks?.secondsToWaitMatch);
                  const stInvertVolumePct = Number(ticks?.invertVolumePct);
                  const stOverReevalMinMinutes = Number((ticks as any)?.overReevalMinMinutes);
                  const stOverReevalMaxMinutes = Number((ticks as any)?.overReevalMaxMinutes);
                  const stLateNoGoalEnabled = Boolean((ticks as any)?.lateNoGoalEnabled ?? true);
                  const stLateNoGoalMinMinute = Number((ticks as any)?.lateNoGoalMinMinute);
                  const stLateUnderLimitEnabled = Boolean((ticks as any)?.lateUnderLimitEnabled ?? true);
                  const stLateUnderLimitMinMinute = Number((ticks as any)?.lateUnderLimitMinMinute);
                  const stLateUnderLimitTargetTicksMin = Number((ticks as any)?.lateUnderLimitTargetTicksMin);
                  const stLateUnderLimitTargetTicksMax = Number((ticks as any)?.lateUnderLimitTargetTicksMax);
                  const stLateUnderLimitMinSecondsBetweenCycles = Number((ticks as any)?.lateUnderLimitMinSecondsBetweenCycles);
                  const stHedgeUnderEnabled = Boolean((ticks as any)?.hedgeUnderEnabled ?? true);
                  const stHedgeUnderAboveGoals = Number((ticks as any)?.hedgeUnderAboveGoals);
                  const stHedgeUnderMinMinute = Number((ticks as any)?.hedgeUnderMinMinute);
                  const stHedgeUnderStakePct = Number((ticks as any)?.hedgeUnderStakePct);
                  const stHedgeUnderTargetTicks = Number((ticks as any)?.hedgeUnderTargetTicks);
                  const stMomentOverThreshold = Number(ticks?.momentOverThreshold);
                  const stMomentOverThresholdLate = Number(ticks?.momentOverThresholdLate);
                  const stMomentOverThresholdOffDelta = Number(ticks?.momentOverThresholdOffDelta);
                  const stMomentWindowMinSec = Number(ticks?.momentWindowMinSec);
                  const stMomentWindowMaxSec = Number(ticks?.momentWindowMaxSec);
                  const stMinMarketMatched = Number(ticks?.minMarketMatched);
                  const stMinRunnerMatched = Number(ticks?.minRunnerMatched);
                  const stAfterGoalWaitSeconds = Number(ticks?.afterGoalWaitSeconds);
                  const stRecoveryEnabled = Boolean((ticks as any)?.recoveryEnabled ?? true);
                  const stRecoveryIncreasePct = Number((ticks as any)?.recoveryIncreasePct);
                  const stRecoveryMaxStakeAbs = Number((ticks as any)?.recoveryMaxStakeAbs);
                  const ogMinOdds = Number(over?.minOdds);
                  const ogMaxEntries = Number(over?.maxEntries);
                  const ogProfitPct = Number(over?.profitTargetPct);
                  const ogMinDelta = Number(over?.minDeltaTraded);
                  const ogDominance = Number(over?.dominanceRatio);
                  const ogMinSeconds = Number(over?.minSecondsBetweenEntries);
                  const ogStakePct = Number(over?.stakePct);
                  const ogStakeAbs = Number((over as any)?.stakeAbs);
                  const ogEntryOffsetTicks = Number(over?.entryOffsetTicks);
                  const ogSecondsToWaitMatch = Number(over?.secondsToWaitMatch);
                  const ohtEnabled = Boolean((overHT as any)?.enabled ?? false);
                  const ohtAutoEnabled = Boolean((overHT as any)?.autoEnabled ?? false);
                  const ohtAutoMinConfidence = Number((overHT as any)?.autoMinConfidence);
                  const ohtPreMinConfidence = Number((overHT as any)?.preMinConfidence);
                  const ohtObserveMinMinute = Number((overHT as any)?.observeMinMinute);
                  const ohtObserveMaxMinute = Number((overHT as any)?.observeMaxMinute);
                  const ohtMaxMinute = Number((overHT as any)?.maxMinute);
                  const ohtMinOdds = Number((overHT as any)?.minOdds);
                  const ohtMaxEntries = Number((overHT as any)?.maxEntries);
                  const ohtEntryOffsetTicks = Number((overHT as any)?.entryOffsetTicks);
                  const ohtSecondsToWaitMatch = Number((overHT as any)?.secondsToWaitMatch);
                  const ohtStakePct = Number((overHT as any)?.stakePct);
                  const ohtStakeAbs = Number((overHT as any)?.stakeAbs);
                  const ohtStakeModeRaw = String((overHT as any)?.stakeMode ?? '').trim().toLowerCase();
                  const ohtStakeModeAbs =
                    ohtStakeModeRaw === 'abs' ? true
                      : ohtStakeModeRaw === 'pct' ? false
                      : (Number.isFinite(ohtStakeAbs) && ohtStakeAbs > 0);
                  const ohtMomentOverThreshold = Number((overHT as any)?.momentOverThreshold);
                  const ohtMomentOverThresholdOffDelta = Number((overHT as any)?.momentOverThresholdOffDelta);
                  const ohtMomentWindowMinSec = Number((overHT as any)?.momentWindowMinSec);
                  const ohtMomentWindowMaxSec = Number((overHT as any)?.momentWindowMaxSec);
                  const ahTargetTicks = Number(asian?.targetTicks);
                  const ahMaxSpreadTicks = Number(asian?.maxSpreadTicks);
                  const ahMinMarketMatched = Number(asian?.minMarketMatched);
                  const ahMinRunnerMatched = Number(asian?.minRunnerMatched);
                  const ahStakePct = Number(asian?.stakePct);
                  const ahStakeAbs = Number((asian as any)?.stakeAbs);
                  const ahProfitPct = Number(asian?.profitTargetPct);
                  const ahSecondsToWaitMatch = Number(asian?.secondsToWaitMatch);
                  const ahMaxEntries = Number((asian as any)?.maxEntries);
                  const ahEntryMaxWaitSeconds = Number((asian as any)?.entryMaxWaitSeconds);
                  const ahEntryOffsetTicks = Number((asian as any)?.entryOffsetTicks);
                  const ahAutoEnabled = Boolean((asian as any)?.autoEnabled ?? false);
                  const ahAutoOnlyRequestedFixtures = Boolean((asian as any)?.autoOnlyRequestedFixtures ?? true);
                  const ahAutoMinConfidence = Number((asian as any)?.autoMinConfidence);
                  const ahAutoCooldownMinutes = Number((asian as any)?.autoCooldownMinutes);
                  const ahAutoMaxPerDay = Number((asian as any)?.autoMaxPerDay);
                  const csMaxSelections = Number(correctScore?.maxSelections);
                  const csMinProfitPct = Number(correctScore?.minProfitPct);
                  const csEntryScoresCsv = String(correctScore?.entryScoresCsv ?? '0-0,0-1,1-0,1-1');
                  const csMinMarketMatched = Number((correctScore as any)?.minMarketMatched);
                  const csStakeAbs = Number((correctScore as any)?.stakeAbs);
                  const csStakePct = Number((correctScore as any)?.stakePct);
                  const csStakeModeRaw = String((correctScore as any)?.stakeMode ?? '').trim().toLowerCase();
                  const csStakeModeAbs =
                    csStakeModeRaw === 'abs' ? true
                      : csStakeModeRaw === 'pct' ? false
                      : (Number.isFinite(csStakeAbs) && csStakeAbs > 0);

                  const frEnabled = Boolean(favoriteRescue?.enabled ?? true);
                  const frMinFavProb = Number(favoriteRescue?.minFavWinProb);
                  const frMinHomeWinRate = Number(favoriteRescue?.minHomeWinRate);
                  const frAwayOdds01 = Number(favoriteRescue?.awayOddsMinLosing01);
                  const frAwayOdds02 = Number(favoriteRescue?.awayOddsMinLosing02);
                  const frAwayOddsMax01 = Number((favoriteRescue as any)?.awayOddsMaxLosing01);
                  const frAwayOddsMax02 = Number((favoriteRescue as any)?.awayOddsMaxLosing02);
                  const frStakeMO = Number(favoriteRescue?.matchOddsLayStakeAbs);
                  const frStakeCS = Number(favoriteRescue?.correctScoreLayStakeAbs);
                  const frTakeMin = Number(favoriteRescue?.matchOddsTakeProfitMinPct);
                  const frTakeMax = Number(favoriteRescue?.matchOddsTakeProfitMaxPct);
                  const frCsTake = Number(favoriteRescue?.correctScoreTakeProfitPct);
                  const frExtremeCsv = String(favoriteRescue?.extremeCorrectScoresCsv ?? '0-3,0-4,1-4,0-5');

                  return (
                    <div className="mt-4 space-y-4">
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-semibold text-gray-900">Scalping em Ticks</div>
                        <div className="text-xs text-gray-600 mt-1">Scalping no Under 0.5 acima do placar (0x0 → U1.5, 1 gol → U2.5, …).</div>
                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="st_targetTicks">Ticks por ciclo</Label>
                            <Input
                              id="st_targetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(stTargetTicks) ? String(Math.max(1, Math.floor(stTargetTicks))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 10;
                                setTicks({ targetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_entryOffsetTicks">Ticks de entrada (±)</Label>
                            <Input
                              id="st_entryOffsetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 2"
                              value={Number.isFinite(stEntryOffsetTicks) ? String(Math.max(-10, Math.min(10, Math.trunc(stEntryOffsetTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(-10, Math.min(10, Math.trunc(n))) : 2;
                                setTicks({ entryOffsetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_entryMaxWaitSeconds">Reofertar entrada (s)</Label>
                            <Input
                              id="st_entryMaxWaitSeconds"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(stEntryMaxWaitSeconds) ? String(Math.max(2, Math.min(120, Math.floor(stEntryMaxWaitSeconds)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(120, Math.floor(n))) : 15;
                                setTicks({ entryMaxWaitSeconds: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_maxSpreadTicks">Spread máx. (ticks)</Label>
                            <Input
                              id="st_maxSpreadTicks"
                              inputMode="numeric"
                              placeholder="Ex: 2"
                              value={Number.isFinite(stMaxSpreadTicks) ? String(Math.max(0, Math.floor(stMaxSpreadTicks))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 2;
                                setTicks({ maxSpreadTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_minSecondsBetweenCycles">Cooldown (s)</Label>
                            <Input
                              id="st_minSecondsBetweenCycles"
                              inputMode="numeric"
                              placeholder="Ex: 8"
                              value={Number.isFinite(stMinSecondsBetweenCycles) ? String(Math.max(0, Math.floor(stMinSecondsBetweenCycles))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(600, Math.floor(n))) : 8;
                                setTicks({ minSecondsBetweenCycles: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <Label htmlFor="st_secondsToWaitMatch">Esperar corresponder (s)</Label>
                            <Input
                              id="st_secondsToWaitMatch"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(stSecondsToWaitMatch) ? String(Math.max(1, Math.min(120, Math.floor(stSecondsToWaitMatch)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(120, Math.floor(n))) : 10;
                                setTicks({ secondsToWaitMatch: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="st_stake_value">Stake</Label>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-gray-600">% banca</div>
                                <Switch
                                  checked={stStakeModeAbs}
                                  onCheckedChange={(checked) => {
                                    const bankroll = Number(config.betfairBankroll ?? 0);
                                    if (checked) {
                                      const pct = Number(stStakePct);
                                      const nextAbs =
                                        Number.isFinite(stStakeAbs) && stStakeAbs > 0
                                          ? Math.round(stStakeAbs * 100) / 100
                                          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(pct) && pct > 0
                                            ? Math.max(2, Math.round(((bankroll * pct) / 100) * 100) / 100)
                                            : 2;
                                      setTicks({ stakeMode: 'abs', stakeAbs: nextAbs, stakePct: 0 });
                                      return;
                                    }
                                    const abs = Number(stStakeAbs);
                                    const nextPct =
                                      Number.isFinite(stStakePct) && stStakePct > 0
                                        ? Math.round(stStakePct * 10000) / 10000
                                        : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(abs) && abs > 0
                                          ? Math.max(0, Math.round(((abs / bankroll) * 100) * 10000) / 10000)
                                          : 1;
                                    setTicks({ stakeMode: 'pct', stakePct: nextPct, stakeAbs: 0 });
                                  }}
                                />
                                <div className="text-[11px] text-gray-600">R$</div>
                              </div>
                            </div>
                            <Input
                              id="st_stake_value"
                              inputMode="decimal"
                              placeholder={stStakeModeAbs ? 'Ex: 2' : 'Ex: 1'}
                              value={
                                stStakeModeAbs
                                  ? (Number.isFinite(stStakeAbs) ? String(Math.round(stStakeAbs * 100) / 100) : '')
                                  : (Number.isFinite(stStakePct) ? String(Math.round(stStakePct * 10000) / 10000) : '')
                              }
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                if (stStakeModeAbs) {
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n * 100) / 100)) : 2;
                                  setTicks({ stakeMode: 'abs', stakeAbs: v, stakePct: 0 });
                                  return;
                                }
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10000) / 10000)) : 1;
                                setTicks({ stakeMode: 'pct', stakePct: v, stakeAbs: 0 });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_maxCycles">Máx. ciclos</Label>
                            <Input
                              id="st_maxCycles"
                              inputMode="numeric"
                              placeholder="Ex: 50"
                              value={Number.isFinite(stMaxCycles) ? String(Math.max(1, Math.floor(stMaxCycles))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(500, Math.floor(n))) : 50;
                                setTicks({ maxCycles: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_invertVolumePct">Inversão volume (%)</Label>
                            <Input
                              id="st_invertVolumePct"
                              inputMode="numeric"
                              placeholder="Ex: 300"
                              value={Number.isFinite(stInvertVolumePct) ? String(Math.max(50, Math.floor(stInvertVolumePct))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(50, Math.min(1000, Math.floor(n))) : 300;
                                setTicks({ invertVolumePct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_overReevalMinMinutes">Reavaliar OVER (min)</Label>
                            <Input
                              id="st_overReevalMinMinutes"
                              inputMode="numeric"
                              placeholder="Ex: 5"
                              value={Number.isFinite(stOverReevalMinMinutes) ? String(Math.max(1, Math.floor(stOverReevalMinMinutes))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(60, Math.floor(n))) : 5;
                                setTicks({ overReevalMinMinutes: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_overReevalMaxMinutes">Reavaliar OVER (max)</Label>
                            <Input
                              id="st_overReevalMaxMinutes"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(stOverReevalMaxMinutes) ? String(Math.max(1, Math.floor(stOverReevalMaxMinutes))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(60, Math.floor(n))) : 10;
                                setTicks({ overReevalMaxMinutes: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="st_lateNoGoalEnabled">Late 0x0 (capturar ticks)</Label>
                              <Switch
                                id="st_lateNoGoalEnabled"
                                checked={Boolean(stLateNoGoalEnabled)}
                                onCheckedChange={(checked) => setTicks({ lateNoGoalEnabled: Boolean(checked) })}
                              />
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="st_lateNoGoalMinMinute">Late 0x0 (minuto)</Label>
                            <Input
                              id="st_lateNoGoalMinMinute"
                              inputMode="numeric"
                              placeholder="Ex: 80"
                              value={Number.isFinite(stLateNoGoalMinMinute) ? String(Math.max(60, Math.floor(stLateNoGoalMinMinute))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(60, Math.min(120, Math.floor(n))) : 80;
                                setTicks({ lateNoGoalMinMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="st_lateUnderLimitEnabled">Scalp Under limite (75+)</Label>
                              <Switch
                                id="st_lateUnderLimitEnabled"
                                checked={Boolean(stLateUnderLimitEnabled)}
                                onCheckedChange={(checked) => setTicks({ lateUnderLimitEnabled: Boolean(checked) })}
                              />
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="st_lateUnderLimitMinMinute">Scalp Under limite (minuto)</Label>
                            <Input
                              id="st_lateUnderLimitMinMinute"
                              inputMode="numeric"
                              placeholder="Ex: 75"
                              value={Number.isFinite(stLateUnderLimitMinMinute) ? String(Math.max(0, Math.floor(stLateUnderLimitMinMinute))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(120, Math.floor(n))) : 75;
                                setTicks({ lateUnderLimitMinMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_lateUnderLimitTargetTicksMin">Scalp ticks (min)</Label>
                            <Input
                              id="st_lateUnderLimitTargetTicksMin"
                              inputMode="numeric"
                              placeholder="Ex: 5"
                              value={Number.isFinite(stLateUnderLimitTargetTicksMin) ? String(Math.max(2, Math.floor(stLateUnderLimitTargetTicksMin))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(50, Math.floor(n))) : 5;
                                setTicks({ lateUnderLimitTargetTicksMin: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_lateUnderLimitTargetTicksMax">Scalp ticks (max)</Label>
                            <Input
                              id="st_lateUnderLimitTargetTicksMax"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(stLateUnderLimitTargetTicksMax) ? String(Math.max(2, Math.floor(stLateUnderLimitTargetTicksMax))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(50, Math.floor(n))) : 10;
                                setTicks({ lateUnderLimitTargetTicksMax: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_lateUnderLimitMinSecondsBetweenCycles">Scalp cooldown (s)</Label>
                            <Input
                              id="st_lateUnderLimitMinSecondsBetweenCycles"
                              inputMode="numeric"
                              placeholder="Ex: 4"
                              value={Number.isFinite(stLateUnderLimitMinSecondsBetweenCycles) ? String(Math.max(1, Math.floor(stLateUnderLimitMinSecondsBetweenCycles))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(120, Math.floor(n))) : 4;
                                setTicks({ lateUnderLimitMinSecondsBetweenCycles: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="st_hedgeUnderEnabled">Hedge Under acima</Label>
                              <Switch
                                id="st_hedgeUnderEnabled"
                                checked={Boolean(stHedgeUnderEnabled)}
                                onCheckedChange={(checked) => setTicks({ hedgeUnderEnabled: Boolean(checked) })}
                              />
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="st_hedgeUnderAboveGoals">Hedge (gols acima)</Label>
                            <Input
                              id="st_hedgeUnderAboveGoals"
                              inputMode="numeric"
                              placeholder="Ex: 2"
                              value={Number.isFinite(stHedgeUnderAboveGoals) ? String(Math.max(1, Math.floor(stHedgeUnderAboveGoals))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(4, Math.floor(n))) : 2;
                                setTicks({ hedgeUnderAboveGoals: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_hedgeUnderMinMinute">Hedge (minuto)</Label>
                            <Input
                              id="st_hedgeUnderMinMinute"
                              inputMode="numeric"
                              placeholder="Ex: 70"
                              value={Number.isFinite(stHedgeUnderMinMinute) ? String(Math.max(0, Math.floor(stHedgeUnderMinMinute))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(120, Math.floor(n))) : 70;
                                setTicks({ hedgeUnderMinMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_hedgeUnderStakePct">Hedge stake (% do stake)</Label>
                            <Input
                              id="st_hedgeUnderStakePct"
                              inputMode="decimal"
                              placeholder="Ex: 25"
                              value={Number.isFinite(stHedgeUnderStakePct) ? String(Math.round(stHedgeUnderStakePct * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(5, Math.min(100, n)) / 100 : 0.25;
                                setTicks({ hedgeUnderStakePct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_hedgeUnderTargetTicks">Hedge TP (ticks)</Label>
                            <Input
                              id="st_hedgeUnderTargetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 6"
                              value={Number.isFinite(stHedgeUnderTargetTicks) ? String(Math.max(2, Math.floor(stHedgeUnderTargetTicks))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(50, Math.floor(n))) : 6;
                                setTicks({ hedgeUnderTargetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_momentOverThreshold">Threshold momento OVER</Label>
                            <Input
                              id="st_momentOverThreshold"
                              inputMode="decimal"
                              placeholder="Ex: 0.70"
                              value={Number.isFinite(stMomentOverThreshold) ? String(Math.round(stMomentOverThreshold * 10000) / 10000) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 0.7;
                                setTicks({ momentOverThreshold: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_momentOverThresholdLate">Threshold 75+ (late)</Label>
                            <Input
                              id="st_momentOverThresholdLate"
                              inputMode="decimal"
                              placeholder="Ex: 0.85"
                              value={Number.isFinite(stMomentOverThresholdLate) ? String(Math.round(stMomentOverThresholdLate * 10000) / 10000) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 0.85;
                                setTicks({ momentOverThresholdLate: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_momentOverThresholdOffDelta">Histerese (desliga alerta)</Label>
                            <Input
                              id="st_momentOverThresholdOffDelta"
                              inputMode="decimal"
                              placeholder="Ex: 0.15"
                              value={Number.isFinite(stMomentOverThresholdOffDelta) ? String(Math.round(stMomentOverThresholdOffDelta * 10000) / 10000) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.15;
                                setTicks({ momentOverThresholdOffDelta: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_momentWindowMinSec">Janela min (s)</Label>
                            <Input
                              id="st_momentWindowMinSec"
                              inputMode="numeric"
                              placeholder="Ex: 8"
                              value={Number.isFinite(stMomentWindowMinSec) ? String(Math.max(1, Math.floor(stMomentWindowMinSec))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(300, Math.floor(n))) : 8;
                                setTicks({ momentWindowMinSec: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_momentWindowMaxSec">Janela máx (s)</Label>
                            <Input
                              id="st_momentWindowMaxSec"
                              inputMode="numeric"
                              placeholder="Ex: 180"
                              value={Number.isFinite(stMomentWindowMaxSec) ? String(Math.max(2, Math.floor(stMomentWindowMaxSec))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(600, Math.floor(n))) : 180;
                                setTicks({ momentWindowMaxSec: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_minMarketMatched">Min. volume mercado</Label>
                            <Input
                              id="st_minMarketMatched"
                              inputMode="numeric"
                              placeholder="Ex: 15000"
                              value={Number.isFinite(stMinMarketMatched) ? String(Math.max(0, Math.floor(stMinMarketMatched))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(10_000_000, Math.floor(n))) : 15000;
                                setTicks({ minMarketMatched: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_minRunnerMatched">Min. volume runner</Label>
                            <Input
                              id="st_minRunnerMatched"
                              inputMode="numeric"
                              placeholder="Ex: 2500"
                              value={Number.isFinite(stMinRunnerMatched) ? String(Math.max(0, Math.floor(stMinRunnerMatched))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(5_000_000, Math.floor(n))) : 2500;
                                setTicks({ minRunnerMatched: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_afterGoalWaitSeconds">Pós-gol: esperar (s)</Label>
                            <Input
                              id="st_afterGoalWaitSeconds"
                              inputMode="numeric"
                              placeholder="Ex: 30"
                              value={Number.isFinite(stAfterGoalWaitSeconds) ? String(Math.max(0, Math.floor(stAfterGoalWaitSeconds))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(600, Math.floor(n))) : 30;
                                setTicks({ afterGoalWaitSeconds: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs text-gray-600">Recuperação de perdas</div>
                                <div className="text-[11px] text-gray-500 mt-1">Se tomar gol em operação, fecha e aumenta a próxima stake.</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-gray-600">Ativo</div>
                                <Switch checked={stRecoveryEnabled} onCheckedChange={(checked) => setTicks({ recoveryEnabled: checked })} />
                              </div>
                            </div>
                          </div>

                          <div>
                            <Label htmlFor="st_recoveryIncreasePct">Aumento (%)</Label>
                            <Input
                              id="st_recoveryIncreasePct"
                              inputMode="decimal"
                              placeholder="Ex: 25"
                              value={Number.isFinite(stRecoveryIncreasePct) ? String(Math.round(stRecoveryIncreasePct * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(200, n)) / 100 : 0.25;
                                setTicks({ recoveryIncreasePct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="st_recoveryMaxStakeAbs">Stake máx. (R$)</Label>
                            <Input
                              id="st_recoveryMaxStakeAbs"
                              inputMode="decimal"
                              placeholder="Ex: 100"
                              value={Number.isFinite(stRecoveryMaxStakeAbs) ? String(Math.round(stRecoveryMaxStakeAbs * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(10000, n)) : 100;
                                setTicks({ recoveryMaxStakeAbs: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-semibold text-gray-900">Handicap Asiático</div>
                        <div className="text-xs text-gray-600 mt-1">Scalping por ticks no mercado Asian Handicap com saída automática (TP).</div>
                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="ah_profitTargetPct">Meta de lucro (%)</Label>
                            <Input
                              id="ah_profitTargetPct"
                              inputMode="decimal"
                              placeholder="Ex: 3"
                              value={Number.isFinite(ahProfitPct) ? String(Math.round(ahProfitPct * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(50, n)) / 100 : 0.03;
                                setAsian({ profitTargetPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="ah_stake_value">Stake</Label>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-gray-600">% banca</div>
                                <Switch
                                  checked={Number.isFinite(ahStakeAbs) && ahStakeAbs > 0 ? true : String((asian as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs'}
                                  onCheckedChange={(checked) => {
                                    const bankroll = Number(config.betfairBankroll ?? 0);
                                    if (checked) {
                                      const pct = Number(ahStakePct);
                                      const nextAbs =
                                        Number.isFinite(ahStakeAbs) && ahStakeAbs > 0
                                          ? Math.round(ahStakeAbs * 100) / 100
                                          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(pct) && pct > 0
                                            ? Math.max(2, Math.round(((bankroll * pct) / 100) * 100) / 100)
                                            : 2;
                                      setAsian({ stakeMode: 'abs', stakeAbs: nextAbs, stakePct: 0 });
                                      return;
                                    }
                                    const abs = Number(ahStakeAbs);
                                    const nextPct =
                                      Number.isFinite(ahStakePct) && ahStakePct > 0
                                        ? Math.round(ahStakePct * 10000) / 10000
                                        : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(abs) && abs > 0
                                          ? Math.max(0, Math.round(((abs / bankroll) * 100) * 10000) / 10000)
                                          : 1;
                                    setAsian({ stakeMode: 'pct', stakePct: nextPct, stakeAbs: 0 });
                                  }}
                                />
                                <div className="text-[11px] text-gray-600">R$</div>
                              </div>
                            </div>
                            <Input
                              id="ah_stake_value"
                              inputMode="decimal"
                              placeholder={
                                (Number.isFinite(ahStakeAbs) && ahStakeAbs > 0) || String((asian as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs'
                                  ? 'Ex: 2'
                                  : 'Ex: 1'
                              }
                              value={
                                ((Number.isFinite(ahStakeAbs) && ahStakeAbs > 0) || String((asian as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs')
                                  ? (Number.isFinite(ahStakeAbs) ? String(Math.round(ahStakeAbs * 100) / 100) : '')
                                  : (Number.isFinite(ahStakePct) ? String(Math.round(ahStakePct * 10000) / 10000) : '')
                              }
                              onChange={(e) => {
                                const modeAbs = (Number.isFinite(ahStakeAbs) && ahStakeAbs > 0) || String((asian as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs';
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                if (modeAbs) {
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n * 100) / 100)) : 2;
                                  setAsian({ stakeMode: 'abs', stakeAbs: v, stakePct: 0 });
                                  return;
                                }
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10000) / 10000)) : 1;
                                setAsian({ stakeMode: 'pct', stakePct: v, stakeAbs: 0 });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_targetTicks">Alvo (ticks)</Label>
                            <Input
                              id="ah_targetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(ahTargetTicks) ? String(Math.max(1, Math.min(50, Math.floor(ahTargetTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 10;
                                setAsian({ targetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_entryMaxWaitSeconds">Reapregoar (s)</Label>
                            <Input
                              id="ah_entryMaxWaitSeconds"
                              inputMode="numeric"
                              placeholder="Ex: 15"
                              value={Number.isFinite(ahEntryMaxWaitSeconds) ? String(Math.max(2, Math.min(120, Math.floor(ahEntryMaxWaitSeconds)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(120, Math.floor(n))) : 15;
                                setAsian({ entryMaxWaitSeconds: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_entryOffsetTicks">Offset entrada (ticks)</Label>
                            <Input
                              id="ah_entryOffsetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 0"
                              value={Number.isFinite(ahEntryOffsetTicks) ? String(Math.max(0, Math.min(10, Math.floor(ahEntryOffsetTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 0;
                                setAsian({ entryOffsetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_maxEntries">Máx. entradas</Label>
                            <Input
                              id="ah_maxEntries"
                              inputMode="numeric"
                              placeholder="Ex: 3"
                              value={Number.isFinite(ahMaxEntries) ? String(Math.max(1, Math.min(20, Math.floor(ahMaxEntries)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : 3;
                                setAsian({ maxEntries: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_maxSpreadTicks">Spread máx (ticks)</Label>
                            <Input
                              id="ah_maxSpreadTicks"
                              inputMode="numeric"
                              placeholder="Ex: 2"
                              value={Number.isFinite(ahMaxSpreadTicks) ? String(Math.max(0, Math.min(10, Math.floor(ahMaxSpreadTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 2;
                                setAsian({ maxSpreadTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_minMarketMatched">Min. volume mercado</Label>
                            <Input
                              id="ah_minMarketMatched"
                              inputMode="numeric"
                              placeholder="Ex: 120000"
                              value={Number.isFinite(ahMinMarketMatched) ? String(Math.max(0, Math.floor(ahMinMarketMatched))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(50_000_000, Math.floor(n))) : 120000;
                                setAsian({ minMarketMatched: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_minRunnerMatched">Min. volume runner</Label>
                            <Input
                              id="ah_minRunnerMatched"
                              inputMode="numeric"
                              placeholder="Ex: 20000"
                              value={Number.isFinite(ahMinRunnerMatched) ? String(Math.max(0, Math.floor(ahMinRunnerMatched))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(50_000_000, Math.floor(n))) : 20000;
                                setAsian({ minRunnerMatched: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="ah_secondsToWaitMatch">Esperar jogo (s)</Label>
                            <Input
                              id="ah_secondsToWaitMatch"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(ahSecondsToWaitMatch) ? String(Math.max(0, Math.min(600, Math.floor(ahSecondsToWaitMatch)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(600, Math.floor(n))) : 10;
                                setAsian({ secondsToWaitMatch: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                        </div>

                        <div className="mt-3 border-t pt-3">
                          <div className="text-xs font-semibold text-gray-800">Auto (agente independente)</div>
                          <div className="text-xs text-gray-600 mt-1">
                            Quando ativado, o agente independente pode iniciar o robô automaticamente em jogos selecionados.
                          </div>

                          <div className="mt-3 grid md:grid-cols-3 gap-3">
                            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-900">Auto iniciar</div>
                                <div className="text-xs text-gray-600">Enfileira na Automação e começa sozinho</div>
                              </div>
                              <Switch checked={ahAutoEnabled} onCheckedChange={(checked) => setAsian({ autoEnabled: checked })} />
                            </div>

                            <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-gray-900">Somente selecionados</div>
                                <div className="text-xs text-gray-600">Só jogos marcados/solicitados</div>
                              </div>
                              <Switch
                                checked={ahAutoOnlyRequestedFixtures}
                                onCheckedChange={(checked) => setAsian({ autoOnlyRequestedFixtures: checked })}
                              />
                            </div>

                            <div>
                              <Label htmlFor="ah_autoMinConfidence">Confiança mín. (%)</Label>
                              <Input
                                id="ah_autoMinConfidence"
                                inputMode="numeric"
                                placeholder="Ex: 75"
                                value={Number.isFinite(ahAutoMinConfidence) ? String(Math.max(50, Math.min(95, Math.floor(ahAutoMinConfidence)))) : ''}
                                onChange={(e) => {
                                  const raw = String(e.target.value ?? '').replace(',', '.');
                                  const n = Number(raw);
                                  const v = Number.isFinite(n) ? Math.max(50, Math.min(95, Math.floor(n))) : 75;
                                  setAsian({ autoMinConfidence: v });
                                }}
                                className="mt-2"
                              />
                            </div>

                            <div>
                              <Label htmlFor="ah_autoCooldownMinutes">Cooldown (min)</Label>
                              <Input
                                id="ah_autoCooldownMinutes"
                                inputMode="numeric"
                                placeholder="Ex: 20"
                                value={Number.isFinite(ahAutoCooldownMinutes) ? String(Math.max(0, Math.min(240, Math.floor(ahAutoCooldownMinutes)))) : ''}
                                onChange={(e) => {
                                  const raw = String(e.target.value ?? '').replace(',', '.');
                                  const n = Number(raw);
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(240, Math.floor(n))) : 20;
                                  setAsian({ autoCooldownMinutes: v });
                                }}
                                className="mt-2"
                              />
                            </div>

                            <div>
                              <Label htmlFor="ah_autoMaxPerDay">Máx. por dia</Label>
                              <Input
                                id="ah_autoMaxPerDay"
                                inputMode="numeric"
                                placeholder="Ex: 8"
                                value={Number.isFinite(ahAutoMaxPerDay) ? String(Math.max(0, Math.min(50, Math.floor(ahAutoMaxPerDay)))) : ''}
                                onChange={(e) => {
                                  const raw = String(e.target.value ?? '').replace(',', '.');
                                  const n = Number(raw);
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(50, Math.floor(n))) : 8;
                                  setAsian({ autoMaxPerDay: v });
                                }}
                                className="mt-2"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-semibold text-gray-900">Correct Score (Dutching)</div>
                        <div className="text-xs text-gray-600 mt-1">Entra com dutching nos placares definidos e distribui a stake pela inversa das odds.</div>
                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="cs_minProfitPct">Lucro p/ hedge (% banca)</Label>
                            <Input
                              id="cs_minProfitPct"
                              inputMode="decimal"
                              placeholder="Ex: 3"
                              value={Number.isFinite(csMinProfitPct) ? String(Math.round(csMinProfitPct * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(50, n)) / 100 : 0.03;
                                setCorrectScore({ minProfitPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <Label htmlFor="cs_minMarketMatched">Mín. correspondido (R$)</Label>
                            <Input
                              id="cs_minMarketMatched"
                              inputMode="numeric"
                              placeholder="Ex: 0"
                              value={Number.isFinite(csMinMarketMatched) ? String(Math.max(0, Math.floor(csMinMarketMatched))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
                                setCorrectScore({ minMarketMatched: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="cs_stake_value">Stake por placar</Label>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-gray-600">% banca</div>
                                <Switch
                                  checked={csStakeModeAbs}
                                  onCheckedChange={(checked) => {
                                    const bankroll = Number(config.betfairBankroll ?? 0);
                                    if (checked) {
                                      const pct = Number(csStakePct);
                                      const nextAbs =
                                        Number.isFinite(csStakeAbs) && csStakeAbs > 0
                                          ? Math.round(csStakeAbs * 100) / 100
                                          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(pct) && pct > 0
                                            ? Math.max(2, Math.round(((bankroll * pct) / 100) * 100) / 100)
                                            : 2;
                                      setCorrectScore({ stakeMode: 'abs', stakeAbs: nextAbs, stakePct: 0 });
                                      return;
                                    }
                                    const abs = Number(csStakeAbs);
                                    const nextPct =
                                      Number.isFinite(csStakePct) && csStakePct > 0
                                        ? Math.round(csStakePct * 10000) / 10000
                                        : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(abs) && abs > 0
                                          ? Math.max(0, Math.round(((abs / bankroll) * 100) * 10000) / 10000)
                                          : 1;
                                    setCorrectScore({ stakeMode: 'pct', stakePct: nextPct, stakeAbs: 0 });
                                  }}
                                />
                                <div className="text-[11px] text-gray-600">R$</div>
                              </div>
                            </div>
                            <Input
                              id="cs_stake_value"
                              inputMode="decimal"
                              placeholder={csStakeModeAbs ? 'Ex: 2' : 'Ex: 1'}
                              value={
                                csStakeModeAbs
                                  ? (Number.isFinite(csStakeAbs) ? String(Math.round(csStakeAbs * 100) / 100) : '')
                                  : (Number.isFinite(csStakePct) ? String(Math.round(csStakePct * 10000) / 10000) : '')
                              }
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                if (csStakeModeAbs) {
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n * 100) / 100)) : 2;
                                  setCorrectScore({ stakeMode: 'abs', stakeAbs: v, stakePct: 0 });
                                  return;
                                }
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10000) / 10000)) : 1;
                                setCorrectScore({ stakeMode: 'pct', stakePct: v, stakeAbs: 0 });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Label htmlFor="cs_entryScoresCsv">Placares iniciais (CSV)</Label>
                            <Input
                              id="cs_entryScoresCsv"
                              placeholder="Ex: 0-0,0-1,1-0,1-1"
                              value={csEntryScoresCsv}
                              onChange={(e) => {
                                const v = String(e.target.value ?? '').trim();
                                setCorrectScore({ entryScoresCsv: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <Label htmlFor="cs_maxSelections">Máx. seleções</Label>
                            <Input
                              id="cs_maxSelections"
                              inputMode="numeric"
                              placeholder="Ex: 4"
                              value={Number.isFinite(csMaxSelections) ? String(Math.max(1, Math.min(20, Math.floor(csMaxSelections)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : 4;
                                setCorrectScore({ maxSelections: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">Agente: Favorito perdendo (LAY visitante)</div>
                            <div className="text-xs text-gray-600 mt-1">
                              Detecta favorito pré-live (probabilidade mínima) perdendo 0x1/0x2 no 1º tempo com odds do visitante acima do limite e adiciona na automação com entrada automática.
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-600">Ativo</div>
                            <Switch checked={frEnabled} onCheckedChange={(checked) => setFavoriteRescue({ enabled: checked })} />
                          </div>
                        </div>

                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="fr_minFavProb">Favorito pré-live (mín. %)</Label>
                            <Input
                              id="fr_minFavProb"
                              inputMode="decimal"
                              placeholder="Ex: 55"
                              value={Number.isFinite(frMinFavProb) ? String(Math.round(frMinFavProb * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(95, n)) / 100 : 0.55;
                                setFavoriteRescue({ minFavWinProb: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_minHomeWinRate">Aproveitamento casa (mín. %)</Label>
                            <Input
                              id="fr_minHomeWinRate"
                              inputMode="decimal"
                              placeholder="Ex: 80"
                              value={Number.isFinite(frMinHomeWinRate) ? String(Math.round(frMinHomeWinRate * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.8;
                                setFavoriteRescue({ minHomeWinRate: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_awayOdds01">Odds visitante (0x1) mín.</Label>
                            <Input
                              id="fr_awayOdds01"
                              inputMode="decimal"
                              placeholder="Ex: 1.65"
                              value={Number.isFinite(frAwayOdds01) ? String(Math.round(frAwayOdds01 * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(50, n)) : 1.65;
                                setFavoriteRescue({ awayOddsMinLosing01: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_awayOdds02">Odds visitante (0x2) mín.</Label>
                            <Input
                              id="fr_awayOdds02"
                              inputMode="decimal"
                              placeholder="Ex: 1.30"
                              value={Number.isFinite(frAwayOdds02) ? String(Math.round(frAwayOdds02 * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(50, n)) : 1.3;
                                setFavoriteRescue({ awayOddsMinLosing02: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_awayOddsMax01">Odds visitante (0x1) máx.</Label>
                            <Input
                              id="fr_awayOddsMax01"
                              inputMode="decimal"
                              placeholder="Ex: 4.00"
                              value={Number.isFinite(frAwayOddsMax01) ? String(Math.round(frAwayOddsMax01 * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(50, n)) : 4;
                                setFavoriteRescue({ awayOddsMaxLosing01: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_awayOddsMax02">Odds visitante (0x2) máx.</Label>
                            <Input
                              id="fr_awayOddsMax02"
                              inputMode="decimal"
                              placeholder="Ex: 3.00"
                              value={Number.isFinite(frAwayOddsMax02) ? String(Math.round(frAwayOddsMax02 * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(50, n)) : 3;
                                setFavoriteRescue({ awayOddsMaxLosing02: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_stakeMO">Stake LAY (Match Odds) £</Label>
                            <Input
                              id="fr_stakeMO"
                              inputMode="decimal"
                              placeholder="Ex: 10"
                              value={Number.isFinite(frStakeMO) ? String(Math.round(frStakeMO * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(10000, n)) : 10;
                                setFavoriteRescue({ matchOddsLayStakeAbs: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_stakeCS">Stake LAY (Correct Score) £</Label>
                            <Input
                              id="fr_stakeCS"
                              inputMode="decimal"
                              placeholder="Ex: 2"
                              value={Number.isFinite(frStakeCS) ? String(Math.round(frStakeCS * 100) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(10000, n)) : 2;
                                setFavoriteRescue({ correctScoreLayStakeAbs: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_takeMin">Saída MO (mín. % banca)</Label>
                            <Input
                              id="fr_takeMin"
                              inputMode="decimal"
                              placeholder="Ex: 10"
                              value={Number.isFinite(frTakeMin) ? String(Math.round(frTakeMin * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.1;
                                setFavoriteRescue({ matchOddsTakeProfitMinPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_takeMax">Saída MO (máx. % banca)</Label>
                            <Input
                              id="fr_takeMax"
                              inputMode="decimal"
                              placeholder="Ex: 15"
                              value={Number.isFinite(frTakeMax) ? String(Math.round(frTakeMax * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.15;
                                setFavoriteRescue({ matchOddsTakeProfitMaxPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="fr_csTake">Saída CS (% banca)</Label>
                            <Input
                              id="fr_csTake"
                              inputMode="decimal"
                              placeholder="Ex: 3"
                              value={Number.isFinite(frCsTake) ? String(Math.round(frCsTake * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.03;
                                setFavoriteRescue({ correctScoreTakeProfitPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div className="md:col-span-3">
                            <Label htmlFor="fr_extremes">Placar “goleada visitante” (CSV)</Label>
                            <Input
                              id="fr_extremes"
                              placeholder="Ex: 0-3,0-4,1-4,0-5"
                              value={frExtremeCsv}
                              onChange={(e) => setFavoriteRescue({ extremeCorrectScoresCsv: String(e.target.value ?? '') })}
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-semibold text-gray-900">Over Gols Limite</div>
                        <div className="text-xs text-gray-600 mt-1">Entradas por leitura de volume no próximo Over (limite de gols).</div>

                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="og_minOdds">Odd mínima</Label>
                            <Input
                              id="og_minOdds"
                              inputMode="decimal"
                              placeholder="Ex: 1.30"
                              value={Number.isFinite(ogMinOdds) ? String(ogMinOdds) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(10, n)) : 1.3;
                                setOver({ minOdds: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="og_maxEntries">Máx. entradas</Label>
                            <Input
                              id="og_maxEntries"
                              inputMode="numeric"
                              placeholder="Ex: 3"
                              value={Number.isFinite(ogMaxEntries) ? String(Math.max(0, Math.floor(ogMaxEntries))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 3;
                                setOver({ maxEntries: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="og_profitTargetPct">Meta lucro (%)</Label>
                            <Input
                              id="og_profitTargetPct"
                              inputMode="decimal"
                              placeholder="Ex: 2"
                              value={Number.isFinite(ogProfitPct) ? String(Math.round(ogProfitPct * 10000) / 100) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) / 100 : 0.02;
                                setOver({ profitTargetPct: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="og_minDeltaTraded">Delta volume mín.</Label>
                            <Input
                              id="og_minDeltaTraded"
                              inputMode="decimal"
                              placeholder="Ex: 200"
                              value={Number.isFinite(ogMinDelta) ? String(ogMinDelta) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(1_000_000, n)) : 200;
                                setOver({ minDeltaTraded: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="og_dominanceRatio">Dominância (x)</Label>
                            <Input
                              id="og_dominanceRatio"
                              inputMode="decimal"
                              placeholder="Ex: 1.25"
                              value={Number.isFinite(ogDominance) ? String(ogDominance) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(10, n)) : 1.25;
                                setOver({ dominanceRatio: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="og_minSecondsBetweenEntries">Cooldown (s)</Label>
                            <Input
                              id="og_minSecondsBetweenEntries"
                              inputMode="numeric"
                              placeholder="Ex: 30"
                              value={Number.isFinite(ogMinSeconds) ? String(Math.max(0, Math.floor(ogMinSeconds))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(600, Math.floor(n))) : 30;
                                setOver({ minSecondsBetweenEntries: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="og_stake_value">Stake</Label>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-gray-600">% banca</div>
                                <Switch
                                  checked={Number.isFinite(ogStakeAbs) && ogStakeAbs > 0 ? true : String((over as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs'}
                                  onCheckedChange={(checked) => {
                                    const bankroll = Number(config.betfairBankroll ?? 0);
                                    if (checked) {
                                      const pct = Number(ogStakePct);
                                      const nextAbs =
                                        Number.isFinite(ogStakeAbs) && ogStakeAbs > 0
                                          ? Math.round(ogStakeAbs * 100) / 100
                                          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(pct) && pct > 0
                                            ? Math.max(2, Math.round(((bankroll * pct) / 100) * 100) / 100)
                                            : 2;
                                      setOver({ stakeMode: 'abs', stakeAbs: nextAbs, stakePct: 0 });
                                      return;
                                    }
                                    const abs = Number(ogStakeAbs);
                                    const nextPct =
                                      Number.isFinite(ogStakePct) && ogStakePct > 0
                                        ? Math.round(ogStakePct * 10000) / 10000
                                        : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(abs) && abs > 0
                                          ? Math.max(0, Math.round(((abs / bankroll) * 100) * 10000) / 10000)
                                          : 1;
                                    setOver({ stakeMode: 'pct', stakePct: nextPct, stakeAbs: 0 });
                                  }}
                                />
                                <div className="text-[11px] text-gray-600">R$</div>
                              </div>
                            </div>
                            <Input
                              id="og_stake_value"
                              inputMode="decimal"
                              placeholder={
                                (Number.isFinite(ogStakeAbs) && ogStakeAbs > 0) || String((over as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs'
                                  ? 'Ex: 2'
                                  : 'Ex: 1'
                              }
                              value={
                                ((Number.isFinite(ogStakeAbs) && ogStakeAbs > 0) || String((over as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs')
                                  ? (Number.isFinite(ogStakeAbs) ? String(Math.round(ogStakeAbs * 100) / 100) : '')
                                  : (Number.isFinite(ogStakePct) ? String(Math.round(ogStakePct * 10000) / 10000) : '')
                              }
                              onChange={(e) => {
                                const modeAbs = (Number.isFinite(ogStakeAbs) && ogStakeAbs > 0) || String((over as any)?.stakeMode ?? '').trim().toLowerCase() === 'abs';
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                if (modeAbs) {
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n * 100) / 100)) : 2;
                                  setOver({ stakeMode: 'abs', stakeAbs: v, stakePct: 0 });
                                  return;
                                }
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10000) / 10000)) : 1;
                                setOver({ stakeMode: 'pct', stakePct: v, stakeAbs: 0 });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <Label htmlFor="og_entryOffsetTicks">Ticks de entrada (±)</Label>
                            <Input
                              id="og_entryOffsetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 2"
                              value={Number.isFinite(ogEntryOffsetTicks) ? String(Math.max(-10, Math.min(10, Math.trunc(ogEntryOffsetTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(-10, Math.min(10, Math.trunc(n))) : 2;
                                setOver({ entryOffsetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                          <div>
                            <Label htmlFor="og_secondsToWaitMatch">Esperar corresponder (s)</Label>
                            <Input
                              id="og_secondsToWaitMatch"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(ogSecondsToWaitMatch) ? String(Math.max(1, Math.min(120, Math.floor(ogSecondsToWaitMatch)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(120, Math.floor(n))) : 10;
                                setOver({ secondsToWaitMatch: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="text-sm font-semibold text-gray-900">Over Gol HT</div>
                        <div className="text-xs text-gray-600 mt-1">Entrada no Over 0.5 no 1º tempo com base em histórico e alerta de gol.</div>

                        <div className="mt-3 grid md:grid-cols-3 gap-3">
                          <div className="md:col-span-3 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-700">Ativo</div>
                            <Switch checked={ohtEnabled} onCheckedChange={(checked) => setOverHT({ enabled: checked })} />
                          </div>

                          <div className="md:col-span-3 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-700">Auto (Agente Universal)</div>
                            <Switch checked={ohtAutoEnabled} onCheckedChange={(checked) => setOverHT({ autoEnabled: checked })} />
                          </div>

                          <div>
                            <Label htmlFor="oht_autoMinConfidence">Auto: confiança mín. (%)</Label>
                            <Input
                              id="oht_autoMinConfidence"
                              inputMode="numeric"
                              placeholder="Ex: 70"
                              value={Number.isFinite(ohtAutoMinConfidence) ? String(Math.max(0, Math.min(95, Math.floor(ohtAutoMinConfidence)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(95, Math.floor(n))) : 70;
                                setOverHT({ autoMinConfidence: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_preMinConfidence">Pré-live: confiança mín. (%)</Label>
                            <Input
                              id="oht_preMinConfidence"
                              inputMode="numeric"
                              placeholder="Ex: 75"
                              value={Number.isFinite(ohtPreMinConfidence) ? String(Math.max(0, Math.min(95, Math.floor(ohtPreMinConfidence)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(95, Math.floor(n))) : 75;
                                setOverHT({ preMinConfidence: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_maxMinute">Máx. minuto</Label>
                            <Input
                              id="oht_maxMinute"
                              inputMode="numeric"
                              placeholder="Ex: 46"
                              value={Number.isFinite(ohtMaxMinute) ? String(Math.max(1, Math.min(60, Math.floor(ohtMaxMinute)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(60, Math.floor(n))) : 46;
                                setOverHT({ maxMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_observeMinMinute">Observar a partir (min)</Label>
                            <Input
                              id="oht_observeMinMinute"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(ohtObserveMinMinute) ? String(Math.max(0, Math.min(45, Math.floor(ohtObserveMinMinute)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(45, Math.floor(n))) : 10;
                                setOverHT({ observeMinMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_observeMaxMinute">Observar até (min)</Label>
                            <Input
                              id="oht_observeMaxMinute"
                              inputMode="numeric"
                              placeholder="Ex: 15"
                              value={Number.isFinite(ohtObserveMaxMinute) ? String(Math.max(0, Math.min(45, Math.floor(ohtObserveMaxMinute)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(45, Math.floor(n))) : 15;
                                setOverHT({ observeMaxMinute: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_minOdds">Odd mínima</Label>
                            <Input
                              id="oht_minOdds"
                              inputMode="decimal"
                              placeholder="Ex: 1.25"
                              value={Number.isFinite(ohtMinOdds) ? String(ohtMinOdds) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1.01, Math.min(100, n)) : 1.25;
                                setOverHT({ minOdds: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_maxEntries">Máx. entradas</Label>
                            <Input
                              id="oht_maxEntries"
                              inputMode="numeric"
                              placeholder="Ex: 1"
                              value={Number.isFinite(ohtMaxEntries) ? String(Math.max(0, Math.floor(ohtMaxEntries))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 1;
                                setOverHT({ maxEntries: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <Label htmlFor="oht_stake_value">Stake</Label>
                              <div className="flex items-center gap-2">
                                <div className="text-[11px] text-gray-600">% banca</div>
                                <Switch
                                  checked={ohtStakeModeAbs}
                                  onCheckedChange={(checked) => {
                                    const bankroll = Number(config.betfairBankroll ?? 0);
                                    if (checked) {
                                      const pct = Number(ohtStakePct);
                                      const nextAbs =
                                        Number.isFinite(ohtStakeAbs) && ohtStakeAbs > 0
                                          ? Math.round(ohtStakeAbs * 100) / 100
                                          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(pct) && pct > 0
                                            ? Math.max(2, Math.round(((bankroll * pct) / 100) * 100) / 100)
                                            : 2;
                                      setOverHT({ stakeMode: 'abs', stakeAbs: nextAbs, stakePct: 0 });
                                      return;
                                    }
                                    const abs = Number(ohtStakeAbs);
                                    const nextPct =
                                      Number.isFinite(ohtStakePct) && ohtStakePct > 0
                                        ? Math.round(ohtStakePct * 10000) / 10000
                                        : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(abs) && abs > 0
                                          ? Math.max(0, Math.round(((abs / bankroll) * 100) * 10000) / 10000)
                                          : 1;
                                    setOverHT({ stakeMode: 'pct', stakePct: nextPct, stakeAbs: 0 });
                                  }}
                                />
                                <div className="text-[11px] text-gray-600">R$</div>
                              </div>
                            </div>
                            <Input
                              id="oht_stake_value"
                              inputMode="decimal"
                              placeholder={ohtStakeModeAbs ? 'Ex: 2' : 'Ex: 1'}
                              value={
                                ohtStakeModeAbs
                                  ? (Number.isFinite(ohtStakeAbs) ? String(Math.round(ohtStakeAbs * 100) / 100) : '')
                                  : (Number.isFinite(ohtStakePct) ? String(Math.round(ohtStakePct * 10000) / 10000) : '')
                              }
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                if (ohtStakeModeAbs) {
                                  const v = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.round(n * 100) / 100)) : 2;
                                  setOverHT({ stakeMode: 'abs', stakeAbs: v, stakePct: 0 });
                                  return;
                                }
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10000) / 10000)) : 1;
                                setOverHT({ stakeMode: 'pct', stakePct: v, stakeAbs: 0 });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_entryOffsetTicks">Ticks de entrada (±)</Label>
                            <Input
                              id="oht_entryOffsetTicks"
                              inputMode="numeric"
                              placeholder="Ex: 0"
                              value={Number.isFinite(ohtEntryOffsetTicks) ? String(Math.max(-10, Math.min(10, Math.trunc(ohtEntryOffsetTicks)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(-10, Math.min(10, Math.trunc(n))) : 0;
                                setOverHT({ entryOffsetTicks: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_secondsToWaitMatch">Esperar corresponder (s)</Label>
                            <Input
                              id="oht_secondsToWaitMatch"
                              inputMode="numeric"
                              placeholder="Ex: 10"
                              value={Number.isFinite(ohtSecondsToWaitMatch) ? String(Math.max(1, Math.min(120, Math.floor(ohtSecondsToWaitMatch)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(120, Math.floor(n))) : 10;
                                setOverHT({ secondsToWaitMatch: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_momentOverThreshold">Alerta: threshold</Label>
                            <Input
                              id="oht_momentOverThreshold"
                              inputMode="decimal"
                              placeholder="Ex: 0.75"
                              value={Number.isFinite(ohtMomentOverThreshold) ? String(ohtMomentOverThreshold) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0.1, Math.min(2, n)) : 0.75;
                                setOverHT({ momentOverThreshold: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_momentOverThresholdOffDelta">Alerta OFF (delta)</Label>
                            <Input
                              id="oht_momentOverThresholdOffDelta"
                              inputMode="decimal"
                              placeholder="Ex: 0.15"
                              value={Number.isFinite(ohtMomentOverThresholdOffDelta) ? String(ohtMomentOverThresholdOffDelta) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.15;
                                setOverHT({ momentOverThresholdOffDelta: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_momentWindowMinSec">Janela mín. (s)</Label>
                            <Input
                              id="oht_momentWindowMinSec"
                              inputMode="numeric"
                              placeholder="Ex: 8"
                              value={Number.isFinite(ohtMomentWindowMinSec) ? String(Math.max(1, Math.min(300, Math.floor(ohtMomentWindowMinSec)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(1, Math.min(300, Math.floor(n))) : 8;
                                setOverHT({ momentWindowMinSec: v });
                              }}
                              className="mt-2"
                            />
                          </div>

                          <div>
                            <Label htmlFor="oht_momentWindowMaxSec">Janela máx. (s)</Label>
                            <Input
                              id="oht_momentWindowMaxSec"
                              inputMode="numeric"
                              placeholder="Ex: 180"
                              value={Number.isFinite(ohtMomentWindowMaxSec) ? String(Math.max(2, Math.min(600, Math.floor(ohtMomentWindowMaxSec)))) : ''}
                              onChange={(e) => {
                                const raw = String(e.target.value ?? '').replace(',', '.');
                                const n = Number(raw);
                                const v = Number.isFinite(n) ? Math.max(2, Math.min(600, Math.floor(n))) : 180;
                                setOverHT({ momentWindowMaxSec: v });
                              }}
                              className="mt-2"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button onClick={handleSave} disabled={isSaving}>
                          {isSaving ? 'Salvando…' : 'Salvar limites dos robôs'}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </Card>
          </div>
        )}

        {/* API Configuration */}
        {tab === 'apis' && (
        <div className="space-y-6">
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
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="outline"
                      onClick={validateGoogleGeminiKey}
                      disabled={isValidatingGoogleKey || !String(config.googleApiKey ?? '').trim()}
                    >
                      {isValidatingGoogleKey ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Validando...
                        </>
                      ) : (
                        'Validar chave'
                      )}
                    </Button>
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
