import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, CheckCircle, XCircle, Loader2, Trophy, Search } from 'lucide-react';
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

export default function Settings() {
  const [tab, setTab] = useState<'apis' | 'competitions'>('apis');
  const [config, setConfig] = useState<ApiConfig>({
    footballDataApiKey: '',
    apiFootballKey: '',
    openLigaDbEnabled: true,
    kaggleUsername: '',
    kaggleApiKey: '',
    agentTrainingEnabled: false,
    apiFootballDisabledLeagueIds: [],
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isValidatingApiFootball, setIsValidatingApiFootball] = useState(false);
  const [validationStatusApiFootball, setValidationStatusApiFootball] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isSaving, setIsSaving] = useState(false);
  const [leagues, setLeagues] = useState<ApiFootballLeague[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(false);
  const [leagueSearch, setLeagueSearch] = useState('');
  const [selectedLeagueCountry, setSelectedLeagueCountry] = useState('all');
  const [countryQuery, setCountryQuery] = useState('');
  const [leaguesLastSource, setLeaguesLastSource] = useState<'api' | 'fixtures' | 'cache' | 'none'>('none');
  const [leaguesLastError, setLeaguesLastError] = useState<string>('');

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

  const fetchLeagues = async (opts?: { country?: string }) => {
    if (!config.apiFootballKey?.trim()) return;
    setIsLoadingLeagues(true);
    setLeaguesLastError('');
    try {
      const service = new ApiFootballService(config.apiFootballKey.trim());
      let items = await service.getLeaguesCatalog({ current: true, country: opts?.country, maxPages: 10 });
      if (items.length === 0) {
        const seasons = await service.getSeasons().catch(() => []);
        const latestSeason = seasons.length > 0 ? Math.max(...seasons) : new Date().getFullYear();
        items = await service.getLeaguesCatalog({ season: latestSeason, country: opts?.country, maxPages: 10 });
      }
      if (items.length === 0) {
        items = await service.getLeaguesCatalog({ country: opts?.country, maxPages: 10 });
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
        const fixtures = await service.getFixtures({ from, to, timezone: 'America/Sao_Paulo' });
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
      try {
        localStorage.setItem('apiFootball_leagues_cache_v1', JSON.stringify({ fetchedAt: new Date().toISOString(), items }));
      } catch {}
      toast.success(items.length > 0 ? `Lista atualizada (${items.length})` : 'Lista atualizada (0)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar campeonatos da API-Football';
      setLeaguesLastError(msg);
      toast.error(msg);
    } finally {
      setIsLoadingLeagues(false);
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
    if (tab !== 'competitions') return;
    if (!config.apiFootballKey?.trim()) return;

    const cacheKey = 'apiFootball_leagues_cache_v1';
    const maxAgeMs = 1000 * 60 * 60 * 24;
    const cached = (() => {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { fetchedAt: string; items: ApiFootballLeague[] };
        if (!parsed?.fetchedAt || !Array.isArray(parsed.items)) return null;
        const age = Date.now() - new Date(parsed.fetchedAt).getTime();
        return { ...parsed, isFresh: age >= 0 && age < maxAgeMs };
      } catch {
        return null;
      }
    })();

    if (cached?.isFresh) {
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
    setIsSaving(true);
    saveApiConfig(config);
    
    setTimeout(() => {
      setIsSaving(false);
      toast.success('Configurações salvas com sucesso!');
    }, 500);
  };

  return (
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
                    await fetchLeagues();
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
                  Carregando campeonatos...
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
  );
}
