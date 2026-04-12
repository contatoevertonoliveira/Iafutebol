import { Match, Prediction } from '../data/mockData';
import { Calendar, Clock, TrendingUp, Star, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';
import { useEffect, useMemo, useState } from 'react';
import { AgentEnsemble, getDynamicAgentProfiles } from '../services/aiAgents';
import type { FootballMatch } from '../services/footballDataService';

type AgentMarketSummary = {
  agentName: string;
  hits: number;
  total: number;
  percent: number;
  winnerHit: boolean;
  overUnderHit: boolean;
  bttsHit: boolean;
};

interface MatchCardProps {
  match: Match & {
    result?: {
      home: number | null;
      away: number | null;
    };
    liveElapsed?: number | null;
    liveStatusShort?: string;
  };
  prediction: Prediction;
  onViewDetails: (matchId: string) => void;
  homeCrest?: string;
  awayCrest?: string;
  footballMatch?: FootballMatch;
  isFavorite?: boolean;
  onToggleFavorite?: (matchId: string) => void;
  onRefreshMatch?: (matchId: string) => void;
  isRefreshing?: boolean;
  lastUpdatedAt?: Date | null;
}

export function MatchCard({
  match,
  prediction,
  onViewDetails,
  homeCrest,
  awayCrest,
  footballMatch,
  isFavorite = false,
  onToggleFavorite,
  onRefreshMatch,
  isRefreshing = false,
  lastUpdatedAt,
}: MatchCardProps) {
  const [showResult, setShowResult] = useState(false);
  const isFinished = match.status === 'finished';
  const isLive = match.status === 'live';
  const [agentMarketSummaries, setAgentMarketSummaries] = useState<AgentMarketSummary[] | null>(null);
  const [isLoadingAgentMarkets, setIsLoadingAgentMarkets] = useState(false);
  const [tick, setTick] = useState(0);

  const resolvedLive = useMemo(() => {
    const rawElapsed = match.liveElapsed ?? footballMatch?.live?.elapsed ?? null;
    const elapsed =
      typeof rawElapsed === 'number'
        ? rawElapsed
        : typeof rawElapsed === 'string'
          ? Number(rawElapsed)
          : null;

    const statusShort =
      match.liveStatusShort ??
      footballMatch?.live?.statusShort ??
      (typeof footballMatch?.status === 'string' ? footballMatch.status : undefined);

    return {
      elapsed: Number.isFinite(elapsed) ? (elapsed as number) : null,
      statusShort: typeof statusShort === 'string' ? statusShort : undefined,
    };
  }, [footballMatch?.live?.elapsed, footballMatch?.live?.statusShort, footballMatch?.status, match.liveElapsed, match.liveStatusShort]);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  const liveClockLabel = useMemo(() => {
    if (!isLive) return null;
    if (typeof resolvedLive.elapsed !== 'number') return null;

    const baseSeconds = Math.max(0, Math.floor(resolvedLive.elapsed) * 60);
    const last = lastUpdatedAt ? lastUpdatedAt.getTime() : Date.now();
    const deltaSeconds = Math.max(0, Math.floor((Date.now() - last) / 1000));
    const totalSeconds = baseSeconds + deltaSeconds;

    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    const mmss = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    const short = String(resolvedLive.statusShort || '').toUpperCase();
    if (short === '1H') return `1º Tempo - ${mmss}`;
    if (short === '2H') return `2º Tempo - ${mmss}`;
    if (short === 'ET') return `Prorrogação - ${mmss}`;
    if (short === 'HT') return 'Intervalo';
    return `Ao vivo - ${mmss}`;
  }, [isLive, resolvedLive.elapsed, resolvedLive.statusShort, lastUpdatedAt, tick]);

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

  const resultAvailable =
    match.status === 'finished' &&
    typeof match.result?.home === 'number' &&
    typeof match.result?.away === 'number';

  const liveScoreAvailable =
    match.status === 'live' &&
    typeof match.result?.home === 'number' &&
    typeof match.result?.away === 'number';

  const actualWinner = (() => {
    if (!resultAvailable) return null;
    if (match.result!.home! > match.result!.away!) return 'home' as const;
    if (match.result!.home! < match.result!.away!) return 'away' as const;
    return 'draw' as const;
  })();

  const predictedWinner = prediction.winner.prediction;
  const winnerHit = actualWinner ? actualWinner === predictedWinner : null;

  const actualScoreText = resultAvailable ? `${match.result!.home}-${match.result!.away}` : null;
  const predictedScoreText = prediction.correctScore.score;
  const scoreHit = actualScoreText ? actualScoreText === predictedScoreText : null;

  const totalGoals = resultAvailable ? match.result!.home! + match.result!.away! : null;
  const actualOverUnder =
    totalGoals === null ? null : totalGoals > prediction.overUnder.line ? ('over' as const) : ('under' as const);
  const overUnderHit = actualOverUnder ? actualOverUnder === prediction.overUnder.prediction : null;

  const actualBtts =
    resultAvailable ? ((match.result!.home! > 0 && match.result!.away! > 0 ? 'yes' : 'no') as const) : null;
  const bttsHit = actualBtts ? actualBtts === prediction.btts.prediction : null;

  const marketHits = {
    winner: winnerHit === true,
    overUnder: overUnderHit === true,
    btts: bttsHit === true,
  };

  const marketTotal = resultAvailable ? 3 : 0;
  const marketCorrect = resultAvailable ? (Number(marketHits.winner) + Number(marketHits.overUnder) + Number(marketHits.btts)) : 0;
  const marketPercent = marketTotal === 0 ? 0 : Math.round((marketCorrect / marketTotal) * 100);

  const buildFallbackFootballMatch = (): FootballMatch => {
    const toNumericId = (id: string) => {
      const text = String(id ?? '');
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        h = (h << 5) - h + text.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h) || 1;
    };

    const now = new Date();
    const utcDate = match.date ? new Date(match.date).toISOString() : now.toISOString();
    const homeTeamId = toNumericId(`home:${match.homeTeam}`);
    const awayTeamId = toNumericId(`away:${match.awayTeam}`);

    return {
      id: typeof match.id === 'string' ? toNumericId(match.id) : toNumericId(String(match.id)),
      utcDate,
      status: isFinished ? 'FINISHED' : match.status === 'live' ? 'IN_PLAY' : 'SCHEDULED',
      matchday: 1,
      homeTeam: {
        id: homeTeamId,
        name: match.homeTeam,
        shortName: match.homeTeam,
        tla: match.homeTeam.substring(0, 3).toUpperCase(),
        crest: homeCrest || '',
      },
      awayTeam: {
        id: awayTeamId,
        name: match.awayTeam,
        shortName: match.awayTeam,
        tla: match.awayTeam.substring(0, 3).toUpperCase(),
        crest: awayCrest || '',
      },
      score: {
        fullTime: {
          home: resultAvailable ? match.result!.home : null,
          away: resultAvailable ? match.result!.away : null,
        },
      },
      competition: {
        id: 1,
        name: match.league,
        code: 'NA',
        emblem: '',
        area: {
          name: match.country,
          code: 'NA',
          flag: '',
        },
      },
    };
  };

  const loadAgentMarketBreakdown = async () => {
    if (!resultAvailable || !actualWinner || !actualOverUnder || !actualBtts) return;
    if (isLoadingAgentMarkets) return;

    setIsLoadingAgentMarkets(true);
    try {
      const baseMatch = footballMatch ?? buildFallbackFootballMatch();
      const profiles = getDynamicAgentProfiles();
      const ensemble = new AgentEnsemble(profiles);
      const preds = await ensemble.predictWithAllAgents(baseMatch);

      const summaries = preds.map((p) => {
        const winnerOk = p.winner === actualWinner;
        const ouOk = p.overUnder.prediction === actualOverUnder;
        const bttsOk = p.btts.prediction === actualBtts;
        const hits = Number(winnerOk) + Number(ouOk) + Number(bttsOk);
        const total = 3;
        return {
          agentName: p.agentName,
          hits,
          total,
          percent: Math.round((hits / total) * 100),
          winnerHit: winnerOk,
          overUnderHit: ouOk,
          bttsHit: bttsOk,
        };
      }).sort((a, b) => b.percent - a.percent);

      setAgentMarketSummaries(summaries);
    } finally {
      setIsLoadingAgentMarkets(false);
    }
  };

  const handleToggleResult = () => {
    const next = !showResult;
    setShowResult(next);
    if (next && resultAvailable && !agentMarketSummaries) {
      void loadAgentMarketBreakdown();
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (!isFinished || !resultAvailable) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button')) return;
    handleToggleResult();
  };

  return (
    <Card
      className={`overflow-hidden hover:shadow-lg transition-shadow ${
        isFinished ? 'bg-gray-100 text-gray-700 grayscale cursor-pointer' : ''
      }`}
      onClick={handleCardClick}
    >
      {/* Header com Liga e País */}
      <div
        className={`text-white px-4 py-2 flex items-center justify-between ${
          isFinished ? 'bg-gradient-to-r from-gray-600 to-gray-800' : 'bg-gradient-to-r from-blue-600 to-blue-700'
        }`}
      >
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          <span className="font-semibold text-sm">{match.league}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-white/20 text-white border-0">
            {match.country}
          </Badge>
          {onRefreshMatch && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefreshMatch(match.id);
              }}
              disabled={isRefreshing}
              className={`p-1 rounded-md hover:bg-white/20 transition-colors ${isRefreshing ? 'opacity-70 cursor-not-allowed' : ''}`}
              aria-label="Atualizar jogo"
              title="Atualizar jogo"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            onClick={() => onToggleFavorite?.(match.id)}
            className="p-1 rounded-md hover:bg-white/20 transition-colors"
            aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Star className={`w-4 h-4 ${isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-white'}`} />
          </button>
        </div>
      </div>

      {/* Informações da Partida */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>{new Date(match.date).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            {liveClockLabel ? (
              <span>{liveClockLabel}</span>
            ) : (
              <span>{match.time}</span>
            )}
          </div>
        </div>

        {/* Times com Escudos */}
        {(resultAvailable || liveScoreAvailable) ? (
          <div className="grid grid-cols-[1fr_3rem] gap-x-3 gap-y-3 items-center mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={false} />
              <div className="font-medium text-lg truncate">{match.homeTeam}</div>
            </div>
            <div className="text-right text-xl font-bold text-gray-900 tabular-nums">{match.result!.home}</div>

            <div className="flex items-center gap-2 min-w-0">
              <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={false} />
              <div className="font-medium text-lg truncate">{match.awayTeam}</div>
            </div>
            <div className="text-right text-xl font-bold text-gray-900 tabular-nums">{match.result!.away}</div>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={true} />
            <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={true} />
          </div>
        )}

        {isLive && (
          <div className="mb-4 flex justify-end">
            <Badge className="bg-green-100 text-green-700 border-green-300">AO VIVO</Badge>
          </div>
        )}

        {resultAvailable && showResult && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Mercados (Pré-jogo)</div>
              <div className="text-sm font-semibold text-gray-900">
                {marketCorrect}/{marketTotal} ({marketPercent}%)
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Vencedor</div>
                  <div className="font-semibold text-sm truncate">{getPredictionLabel(predictedWinner)}</div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.winner ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {marketHits.winner ? 'Acertou' : 'Errou'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Over/Under {prediction.overUnder.line}</div>
                  <div className="font-semibold text-sm truncate">
                    {prediction.overUnder.prediction === 'over' ? 'Over' : 'Under'}
                  </div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.overUnder ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {marketHits.overUnder ? 'Acertou' : 'Errou'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Ambos Marcam</div>
                  <div className="font-semibold text-sm truncate">
                    {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'}
                  </div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${marketHits.btts ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {marketHits.btts ? 'Acertou' : 'Errou'}
                </div>
              </div>

              <div className="bg-gray-50 p-2 rounded flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-gray-600 mb-1">Placar Exato</div>
                  <div className="font-semibold text-sm truncate">{predictedScoreText}</div>
                </div>
                <div className={`text-xs font-semibold px-2 py-1 rounded ${scoreHit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {scoreHit ? 'Acertou' : 'Errou'}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold text-gray-900">Agentes</div>
                {isLoadingAgentMarkets && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Calculando...
                  </div>
                )}
              </div>

              {agentMarketSummaries && agentMarketSummaries.length > 0 && (
                <div className="space-y-2">
                  {agentMarketSummaries.map((a) => (
                    <div key={a.agentName} className="bg-gray-50 rounded p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900">{a.agentName}</div>
                        <div className="text-sm font-semibold text-gray-900">
                          {a.hits}/{a.total} ({a.percent}%)
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className={`px-2 py-1 rounded ${a.winnerHit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>Vencedor</span>
                        <span className={`px-2 py-1 rounded ${a.overUnderHit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>Over/Under</span>
                        <span className={`px-2 py-1 rounded ${a.bttsHit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>Ambos</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confiança da IA */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600">Confiança da IA</span>
            <span className={`text-sm font-semibold ${
              prediction.aiConfidence >= 80 ? 'text-green-600' :
              prediction.aiConfidence >= 60 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {prediction.aiConfidence}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                prediction.aiConfidence >= 80 ? 'bg-green-600' :
                prediction.aiConfidence >= 60 ? 'bg-yellow-600' : 'bg-red-600'
              }`}
              style={{ width: `${prediction.aiConfidence}%` }}
            />
          </div>
        </div>

        {/* Preview de Previsões */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-gray-50 p-2 rounded">
            <div className="text-xs text-gray-600 mb-1">Vencedor</div>
            <div className="font-semibold text-sm truncate">
              {getPredictionLabel(prediction.winner.prediction)}
            </div>
            <div className="text-xs text-gray-500">{prediction.winner.confidence}%</div>
          </div>
          
          <div className="bg-gray-50 p-2 rounded">
            <div className="text-xs text-gray-600 mb-1">Over/Under {prediction.overUnder.line}</div>
            <div className="font-semibold text-sm">
              {prediction.overUnder.prediction === 'over' ? 'Over' : 'Under'}
            </div>
            <div className="text-xs text-gray-500">{prediction.overUnder.confidence}%</div>
          </div>

          <div className="bg-gray-50 p-2 rounded">
            <div className="text-xs text-gray-600 mb-1">Ambos Marcam</div>
            <div className="font-semibold text-sm">
              {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'}
            </div>
            <div className="text-xs text-gray-500">{prediction.btts.confidence}%</div>
          </div>

          <div className="bg-gray-50 p-2 rounded">
            <div className="text-xs text-gray-600 mb-1">Placar Exato</div>
            <div className="font-semibold text-sm">{prediction.correctScore.score}</div>
            <div className="text-xs text-gray-500">{prediction.correctScore.confidence}%</div>
          </div>
        </div>

        <button
          onClick={() => onViewDetails(match.id)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold transition-colors"
        >
          Ver Análise Completa
        </button>
      </div>
    </Card>
  );
}
