import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Activity, Calendar, RefreshCw, TrendingUp } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type { FootballMatch } from '../services/footballDataService';
import type { Prediction } from '../data/mockData';
import { AgentEnsemble, AI_AGENTS_BASE, getDynamicAgentProfiles } from '../services/aiAgents';

type ApiSource = 'api-football' | 'football-data' | 'openligadb' | 'mock';

type MatchesCacheV1 = {
  version: 1;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  apiSource: ApiSource;
  matches: FootballMatch[];
  predictions: Record<string, Prediction>;
};

type AgentDayPerf = {
  agentName: string;
  totalMarkets: number;
  correctMarkets: number;
  percent: number;
};

type MatchRow = {
  id: string;
  league: string;
  country: string;
  date: Date;
  time: string;
  homeTeam: string;
  awayTeam: string;
  score: { home: number; away: number };
  prediction: Prediction | null;
  marketCorrect: number;
  marketTotal: number;
  marketPercent: number;
};

export default function DailyOverviewPage() {
  const navigate = useNavigate();
  const [agentPerf, setAgentPerf] = useState<AgentDayPerf[] | null>(null);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const TIME_ZONE = 'America/Sao_Paulo';
  const getDayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const parseApiDate = (value: string) => {
    const raw = String(value || '');
    if (!raw) return new Date(NaN);
    if (/[zZ]$/.test(raw) || /[+-]\d\d:\d\d$/.test(raw)) return new Date(raw);
    return new Date(`${raw}Z`);
  };

  const cache = useMemo(() => {
    const raw = localStorage.getItem('matchesCache_v1');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as MatchesCacheV1;
      if (!parsed || parsed.version !== 1) return null;
      if (!parsed.generatedAt || !parsed.matches || !parsed.predictions) return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const cacheMeta = useMemo(() => {
    if (!cache) return null;
    const generatedAt = new Date(cache.generatedAt);
    const ageMs = Date.now() - generatedAt.getTime();
    const maxAgeMs = 1000 * 60 * 15;
    return { generatedAt, ageMs, isFresh: ageMs >= 0 && ageMs < maxAgeMs };
  }, [cache]);

  const toMatchStatus = (status: string): 'scheduled' | 'live' | 'finished' => {
    const normalized = String(status || '').toUpperCase();
    if (['FINISHED', 'FT', 'AET', 'PEN'].includes(normalized)) return 'finished';
    if (['IN_PLAY', 'LIVE', '1H', '2H', 'HT', 'ET', 'P'].includes(normalized)) return 'live';
    return 'scheduled';
  };

  const finishedToday = useMemo(() => {
    if (!cache) return [] as FootballMatch[];
    const todayKey = getDayKey(new Date());
    return cache.matches
      .filter((m) => getDayKey(parseApiDate(m.utcDate)) === todayKey)
      .filter((m) => toMatchStatus(m.status) === 'finished')
      .filter((m) => typeof m.score?.fullTime?.home === 'number' && typeof m.score?.fullTime?.away === 'number');
  }, [cache]);

  const matchRows = useMemo(() => {
    if (!cache) return [] as MatchRow[];

    const rows = finishedToday.map((m) => {
      const id = m.id.toString();
      const prediction = cache.predictions[id] ?? null;
      const home = m.score.fullTime.home as number;
      const away = m.score.fullTime.away as number;

      const actualWinner = home > away ? 'home' : home < away ? 'away' : 'draw';
      const totalGoals = home + away;
      const actualOverUnder = prediction ? (totalGoals > prediction.overUnder.line ? 'over' : 'under') : null;
      const actualBtts = home > 0 && away > 0 ? 'yes' : 'no';

      const marketTotal = prediction ? 3 : 0;
      const marketCorrect = prediction
        ? Number(prediction.winner.prediction === actualWinner) +
          Number(prediction.overUnder.prediction === actualOverUnder) +
          Number(prediction.btts.prediction === actualBtts)
        : 0;
      const marketPercent = marketTotal === 0 ? 0 : Math.round((marketCorrect / marketTotal) * 100);

      const date = parseApiDate(m.utcDate);
      const time = date.toLocaleTimeString('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });

      return {
        id,
        league: m.competition?.name ?? 'Unknown',
        country: m.competition?.area?.name ?? 'Unknown',
        date,
        time,
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        score: { home, away },
        prediction,
        marketCorrect,
        marketTotal,
        marketPercent,
      };
    });

    rows.sort((a, b) => b.date.getTime() - a.date.getTime());
    return rows;
  }, [cache, finishedToday]);

  const dayTotals = useMemo(() => {
    const totalFinished = matchRows.length;
    const withPrediction = matchRows.filter((r) => !!r.prediction);
    const totalMarkets = withPrediction.reduce((sum, r) => sum + r.marketTotal, 0);
    const correctMarkets = withPrediction.reduce((sum, r) => sum + r.marketCorrect, 0);
    const percent = totalMarkets === 0 ? 0 : Math.round((correctMarkets / totalMarkets) * 100);
    return { totalFinished, withPrediction: withPrediction.length, totalMarkets, correctMarkets, percent };
  }, [matchRows]);

  const learningSummary = useMemo(() => {
    const raw = localStorage.getItem('agent_learning_history');
    if (!raw) return { total: 0, correct: 0 };
    try {
      const parsed = JSON.parse(raw) as Record<string, { total: number; correct: number }>;
      const values = Object.values(parsed || {});
      const total = values.reduce((sum, v) => sum + (v?.total ?? 0), 0);
      const correct = values.reduce((sum, v) => sum + (v?.correct ?? 0), 0);
      return { total, correct };
    } catch {
      return { total: 0, correct: 0 };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!cache) return;
      if (finishedToday.length === 0) {
        setAgentPerf([]);
        return;
      }

      setIsLoadingAgents(true);
      try {
        const profiles = getDynamicAgentProfiles();
        const ensemble = new AgentEnsemble(profiles);

        const allPreds = await Promise.all(finishedToday.map((m) => ensemble.predictWithAllAgents(m)));
        if (cancelled) return;

        const totalsByAgent: Record<string, { total: number; correct: number }> = {};

        for (let i = 0; i < finishedToday.length; i++) {
          const match = finishedToday[i];
          const home = match.score.fullTime.home as number;
          const away = match.score.fullTime.away as number;

          const actualWinner = home > away ? 'home' : home < away ? 'away' : 'draw';
          const totalGoals = home + away;
          const actualBtts = home > 0 && away > 0 ? 'yes' : 'no';

          for (const p of allPreds[i]) {
            if (!totalsByAgent[p.agentName]) totalsByAgent[p.agentName] = { total: 0, correct: 0 };

            const actualOverUnder = totalGoals > p.overUnder.line ? 'over' : 'under';
            const hits =
              Number(p.winner === actualWinner) + Number(p.overUnder.prediction === actualOverUnder) + Number(p.btts.prediction === actualBtts);

            totalsByAgent[p.agentName].total += 3;
            totalsByAgent[p.agentName].correct += hits;
          }
        }

        const rows: AgentDayPerf[] = Object.entries(totalsByAgent)
          .map(([agentName, v]) => {
            const percent = v.total === 0 ? 0 : Math.round((v.correct / v.total) * 100);
            return { agentName, totalMarkets: v.total, correctMarkets: v.correct, percent };
          })
          .sort((a, b) => b.percent - a.percent);

        setAgentPerf(rows);
      } finally {
        if (!cancelled) setIsLoadingAgents(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [cache, finishedToday]);

  const agentCards = useMemo(() => {
    const profiles = getDynamicAgentProfiles();
    const perfByName = new Map((agentPerf ?? []).map((p) => [p.agentName, p]));
    return profiles
      .map((p) => {
        const base = AI_AGENTS_BASE.find((a) => a.id === p.id);
        const delta = base ? p.accuracy - base.accuracy : 0;
        const perf = perfByName.get(p.name) ?? null;
        return { ...p, delta, perf };
      })
      .sort((a, b) => b.accuracy - a.accuracy);
  }, [agentPerf]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Activity className="w-10 h-10 text-purple-600" />
              <div>
                <h1 className="text-4xl font-bold text-gray-900">Panorama do Dia</h1>
                <p className="text-gray-600 text-lg">Resultados do dia e evolução dos agentes</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => navigate('/')} className="shrink-0">
              <RefreshCw className="w-4 h-4 mr-2" />
              Atualizar partidas
            </Button>
          </div>
          {cacheMeta && (
            <div className="mt-3 text-sm text-gray-600">
              Cache: {cacheMeta.generatedAt.toLocaleString('pt-BR')} •{' '}
              <span className={cacheMeta.isFresh ? 'text-green-700 font-semibold' : 'text-orange-700 font-semibold'}>
                {cacheMeta.isFresh ? 'atualizado' : 'desatualizado'}
              </span>
            </div>
          )}
        </div>

        {!cache ? (
          <Card className="p-6">
            <div className="text-lg font-semibold text-gray-900 mb-2">Sem dados em cache</div>
            <div className="text-gray-600 mb-4">
              Para evitar requisições a cada página, o panorama usa os jogos já carregados e salvos temporariamente.
            </div>
            <Button onClick={() => navigate('/')}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Ir para o Início e carregar partidas
            </Button>
          </Card>
        ) : (
          <>
            <div className="grid md:grid-cols-5 gap-4 mb-8">
              <Card className="p-6">
                <div className="flex items-center gap-2 text-gray-700 mb-2">
                  <Calendar className="w-5 h-5" />
                  <div className="text-sm font-semibold">Jogos finalizados (hoje)</div>
                </div>
                <div className="text-3xl font-bold text-gray-900">{dayTotals.totalFinished}</div>
              </Card>
              <Card className="p-6">
                <div className="text-sm text-gray-600 mb-1">Mercados avaliados (consenso)</div>
                <div className="text-3xl font-bold text-blue-700">
                  {dayTotals.correctMarkets}/{dayTotals.totalMarkets}
                </div>
                <div className="text-sm text-gray-500">{dayTotals.percent}%</div>
              </Card>
              <Card className="p-6">
                <div className="text-sm text-gray-600 mb-1">Aproveitamento do dia</div>
                <div className="text-3xl font-bold text-green-700">{dayTotals.percent}%</div>
                <div className="text-sm text-gray-600">
                  Erros: {dayTotals.totalMarkets === 0 ? '-' : `${100 - dayTotals.percent}%`}
                </div>
              </Card>
              <Card className="p-6">
                <div className="text-sm text-gray-600 mb-1">Aprendizado acumulado</div>
                <div className="text-3xl font-bold text-purple-700">
                  {learningSummary.correct}/{learningSummary.total}
                </div>
                <div className="text-sm text-gray-500">
                  {learningSummary.total === 0 ? '-' : `${Math.round((learningSummary.correct / learningSummary.total) * 100)}%`}
                </div>
              </Card>
              <Card className="p-6">
                <div className="text-sm text-gray-600 mb-1">Agentes</div>
                <div className="text-3xl font-bold text-gray-900">{agentCards.length}</div>
                <div className="text-sm text-gray-500">{isLoadingAgents ? 'calculando...' : 'prontos'}</div>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-blue-600" />
                    Resultados do dia
                  </div>
                  <Badge variant="outline">Hoje</Badge>
                </div>

                {matchRows.length === 0 ? (
                  <div className="text-gray-600">Nenhum jogo finalizado hoje.</div>
                ) : (
                  <div className="space-y-3">
                    {matchRows.map((r) => (
                      <div key={r.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-gray-600 truncate">
                              {r.league} • {r.time}
                            </div>
                            <div className="text-base font-semibold text-gray-900 truncate">
                              {r.homeTeam} {r.score.home} x {r.score.away} {r.awayTeam}
                            </div>
                          </div>
                          {r.prediction ? (
                            <div className={`shrink-0 text-sm font-semibold px-3 py-1 rounded-full ${
                              r.marketPercent >= 67 ? 'bg-green-100 text-green-700' : r.marketPercent >= 34 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {r.marketPercent}%
                            </div>
                          ) : (
                            <div className="shrink-0 text-sm font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-600">
                              sem previsão
                            </div>
                          )}
                        </div>
                        {r.prediction && (
                          <div className="mt-2 text-xs text-gray-600">
                            Consenso: {r.prediction.winner.prediction === 'home' ? 'Casa' : r.prediction.winner.prediction === 'away' ? 'Fora' : 'Empate'} •{' '}
                            OU {r.prediction.overUnder.prediction === 'over' ? 'Over' : 'Under'} {r.prediction.overUnder.line} •{' '}
                            Ambos {r.prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xl font-bold text-gray-900">Aproveitamento dos agentes (hoje)</div>
                  <Badge variant="outline">{isLoadingAgents ? 'calculando' : 'ok'}</Badge>
                </div>

                <div className="space-y-3">
                  {agentCards.map((a) => (
                    <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-semibold text-gray-900 truncate">
                            {a.avatar} {a.name}
                          </div>
                          <div className="text-xs text-gray-600 truncate">{a.specialty}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-gray-900">{a.accuracy.toFixed(1)}%</div>
                          <div className={`text-xs font-semibold ${a.delta >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {a.delta >= 0 ? '+' : ''}{a.delta.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="text-xs text-gray-600">Hoje (mercados)</div>
                        <div className="text-xs font-semibold text-gray-900">
                          {a.perf ? `${a.perf.correctMarkets}/${a.perf.totalMarkets} (${a.perf.percent}%)` : '-'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
