import { Match, Prediction } from '../data/mockData';
import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Target, BarChart3, Trophy, Timer, Hash, RefreshCw, Loader2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballEvent, ApiFootballService } from '../services/apiFootballService';

interface PredictionDetailsProps {
  match: Match & {
    homeCrest?: string;
    awayCrest?: string;
    homeTeamId?: number;
    awayTeamId?: number;
    liveElapsed?: number | null;
    liveStatusShort?: string;
    liveExtra?: number | null;
  };
  prediction: Prediction;
  apiSource?: string;
  lastUpdatedAt?: Date | null;
}

export function PredictionDetails({ match, prediction, apiSource, lastUpdatedAt }: PredictionDetailsProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'bg-green-100 text-green-800 border-green-300';
    if (confidence >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const toMatchStatus = (status: string | undefined): 'scheduled' | 'live' | 'finished' => {
    const normalized = String(status || '').toUpperCase();
    if (['FINISHED', 'FT', 'AET', 'PEN'].includes(normalized)) return 'finished';
    if (['IN_PLAY', 'PAUSED', 'BREAK', 'LIVE', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'SUSPENDED', 'INTERRUPTED'].includes(normalized)) return 'live';
    return 'scheduled';
  };

  const derivedStatus = useMemo(() => {
    const fromShort = toMatchStatus(match.liveStatusShort);
    if (fromShort !== 'scheduled') return fromShort;
    return match.status as 'scheduled' | 'live' | 'finished';
  }, [match.liveStatusShort, match.status]);

  const isFinished = derivedStatus === 'finished';
  const isLive = derivedStatus === 'live';
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isLive) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [isLive]);

  const liveClockLabel = useMemo(() => {
    if (!isLive) return null;

    const short = String(match.liveStatusShort || '').toUpperCase();
    if (short === 'HT') return 'Intervalo';

    const getMinuteText = (m: number, extra: number | null) => {
      if (typeof extra === 'number' && extra > 0) return `${m}+${extra}'`;
      return `${m}'`;
    };

    if (typeof match.liveElapsed === 'number') {
      const minute = Math.max(0, Math.floor(match.liveElapsed));
      const minuteText = getMinuteText(minute, match.liveExtra ?? null);

      if (short === '1H') return `1º Tempo - ${minuteText}`;
      if (short === '2H') return `2º Tempo - ${minuteText}`;
      if (short === 'ET') return `Prorrogação - ${minuteText}`;
      if (short === 'IN_PLAY' || short === 'LIVE' || short === 'PAUSED' || short === 'BREAK') return `Ao vivo - ${minuteText}`;
      return `Ao vivo - ${minuteText}`;
    }

    if (short === '1H') return '1º Tempo';
    if (short === '2H') return '2º Tempo';
    if (short === 'ET') return 'Prorrogação';
    if (short === 'IN_PLAY' || short === 'LIVE' || short === 'PAUSED' || short === 'BREAK') return 'Ao vivo';
    return 'Ao vivo';

  }, [isLive, match.date, match.liveElapsed, match.liveExtra, match.liveStatusShort, tick]);

  const [events, setEvents] = useState<ApiFootballEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string>('');

  const loadEvents = async () => {
    if (!isLive) return;
    if (apiSource !== 'api-football') return;
    const config = loadApiConfig();
    const key = config?.apiFootballKey?.trim();
    if (!key) return;
    const fixtureId = Number(match.id);
    if (!Number.isFinite(fixtureId)) return;

    setIsLoadingEvents(true);
    setEventsError('');
    try {
      const service = new ApiFootballService(key);
      const items = await service.getFixtureEvents(fixtureId);
      setEvents(Array.isArray(items) ? items : []);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : 'Erro ao carregar eventos');
      setEvents([]);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [isLive, apiSource, match.id]);

  const { homeEvents, awayEvents } = useMemo(() => {
    const goalsOrCards = events.filter((e) => {
      const t = String(e.type || '').toLowerCase();
      return t === 'goal' || t === 'card';
    });

    const home: ApiFootballEvent[] = [];
    const away: ApiFootballEvent[] = [];

    for (const e of goalsOrCards) {
      const teamId = e.team?.id ?? null;
      if (typeof match.homeTeamId === 'number' && teamId === match.homeTeamId) {
        home.push(e);
        continue;
      }
      if (typeof match.awayTeamId === 'number' && teamId === match.awayTeamId) {
        away.push(e);
        continue;
      }

      const teamName = String(e.team?.name || '');
      if (teamName === match.homeTeam) home.push(e);
      else if (teamName === match.awayTeam) away.push(e);
      else home.push(e);
    }

    const sortByMinute = (a: ApiFootballEvent, b: ApiFootballEvent) => {
      const aa = (a.time?.elapsed ?? 0) * 100 + (a.time?.extra ?? 0);
      const bb = (b.time?.elapsed ?? 0) * 100 + (b.time?.extra ?? 0);
      return aa - bb;
    };

    home.sort(sortByMinute);
    away.sort(sortByMinute);

    return { homeEvents: home, awayEvents: away };
  }, [events, match.awayTeam, match.homeTeam]);

  const formatEventMinute = (e: ApiFootballEvent) => {
    const min = e.time?.elapsed;
    const extra = e.time?.extra;
    if (typeof min !== 'number') return '';
    if (typeof extra === 'number' && extra > 0) return `${min}+${extra}'`;
    return `${min}'`;
  };

  const eventIcon = (e: ApiFootballEvent) => {
    const type = String(e.type || '').toLowerCase();
    const detail = String(e.detail || '').toLowerCase();
    if (type === 'goal') return '⚽';
    if (type === 'card') {
      if (detail.includes('red')) return '🟥';
      return '🟨';
    }
    return '•';
  };

  const eventLabel = (e: ApiFootballEvent) => {
    const type = String(e.type || '').toLowerCase();
    const detail = String(e.detail || '').toLowerCase();
    if (type === 'goal') {
      if (detail.includes('penalty')) return 'Pênalti';
      if (detail.includes('own')) return 'Contra';
      return 'Gol';
    }
    if (type === 'card') {
      if (detail.includes('red')) return 'Vermelho';
      return 'Amarelo';
    }
    return e.detail;
  };

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

  return (
    <div className="bg-white rounded-xl">
      <div
        className={`text-white p-6 rounded-t-xl ${
          isFinished ? 'bg-gradient-to-r from-gray-600 to-gray-800' : 'bg-gradient-to-r from-blue-600 to-blue-700'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TrendingUp className="w-5 h-5 shrink-0" />
            <span className="font-semibold truncate">{match.league}</span>
            <Badge variant="secondary" className="bg-white/20 text-white border-0">
              {match.country}
            </Badge>
          </div>
          <div className="text-sm opacity-90">
            {new Date(match.date).toLocaleDateString('pt-BR', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}{' '}
            • {liveClockLabel ?? match.time}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 md:gap-8">
          <div className="flex-1 min-w-0 flex justify-end">
            <TeamLogo
              teamName={match.homeTeam}
              logoUrl={match.homeCrest}
              size="xl"
              showName={true}
              className="min-w-0"
            />
          </div>
          <div className="shrink-0 px-4 py-2 rounded-full bg-white/15 border border-white/20 font-bold tracking-widest">
            VS
          </div>
          <div className="flex-1 min-w-0 flex justify-start">
            <TeamLogo
              teamName={match.awayTeam}
              logoUrl={match.awayCrest}
              size="xl"
              showName={true}
              className="min-w-0 flex-row-reverse"
            />
          </div>
        </div>

        {isLive && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <Badge className="bg-green-100 text-green-700 border-green-300">AO VIVO</Badge>
            {apiSource === 'api-football' && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  void loadEvents();
                }}
                disabled={isLoadingEvents}
                className={`p-2 rounded-lg bg-white/15 border border-white/20 ${isLoadingEvents ? 'opacity-70 cursor-not-allowed' : 'hover:bg-white/20'}`}
                aria-label="Atualizar eventos"
                title="Atualizar eventos"
              >
                {isLoadingEvents ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            )}
          </div>
        )}

        {isLive && (homeEvents.length > 0 || awayEvents.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-4 bg-white/10 border border-white/15 rounded-lg p-3">
            <div className="space-y-2 min-w-0">
              {homeEvents.map((e, idx) => (
                <div key={`${e.type}-${e.detail}-${idx}`} className="text-sm text-white/95 flex items-start gap-2">
                  <span className="shrink-0">{formatEventMinute(e)}</span>
                  <span className="shrink-0">{eventIcon(e)}</span>
                  <span className="truncate">{e.player?.name ?? e.detail}</span>
                  <span className="shrink-0 text-white/70">({eventLabel(e)})</span>
                </div>
              ))}
            </div>
            <div className="space-y-2 min-w-0 text-right">
              {awayEvents.map((e, idx) => (
                <div key={`${e.type}-${e.detail}-${idx}`} className="text-sm text-white/95 flex items-start gap-2 justify-end">
                  <span className="shrink-0 text-white/70">({eventLabel(e)})</span>
                  <span className="truncate">{e.player?.name ?? e.detail}</span>
                  <span className="shrink-0">{eventIcon(e)}</span>
                  <span className="shrink-0">{formatEventMinute(e)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isLive && eventsError && (
          <div className="mt-4 bg-white/10 border border-white/20 rounded-lg p-3 text-sm text-white/90">
            {eventsError}
          </div>
        )}
        </div>

        {/* Confiança Geral */}
        <div className="p-6 border-b">
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-2">Confiança Geral da IA</div>
            <div className="text-5xl font-bold text-blue-600 mb-2">{prediction.aiConfidence}%</div>
            <div className="w-full max-w-md mx-auto bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full ${
                  prediction.aiConfidence >= 80 ? 'bg-green-600' :
                  prediction.aiConfidence >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                }`}
                style={{ width: `${prediction.aiConfidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* Previsões Detalhadas */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Trophy className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">Resultado Final</div>
                  <div className="text-2xl font-bold text-blue-600 mb-2">
                    {getPredictionLabel(prediction.winner.prediction)}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getConfidenceColor(prediction.winner.confidence)}>
                      Confiança: {prediction.winner.confidence}%
                    </Badge>
                    <Badge variant="outline">
                      Odds: {prediction.winner.odds.toFixed(2)}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">Over/Under Gols</div>
                  <div className="text-2xl font-bold text-green-600 mb-2">
                    {prediction.overUnder.prediction === 'over' ? 'Over' : 'Under'} {prediction.overUnder.line}
                  </div>
                  <Badge className={getConfidenceColor(prediction.overUnder.confidence)}>
                    Confiança: {prediction.overUnder.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Target className="w-6 h-6 text-orange-600" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold mb-1">Handicap Asiático</div>
                  <div className="text-2xl font-bold text-orange-600 mb-2">
                    {prediction.asianHandicap.team === 'home' ? match.homeTeam : match.awayTeam}{' '}
                    ({prediction.asianHandicap.line > 0 ? '+' : ''}{prediction.asianHandicap.line})
                  </div>
                  <Badge className={getConfidenceColor(prediction.asianHandicap.confidence)}>
                    Confiança: {prediction.asianHandicap.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-teal-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-teal-600" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-600 mb-1">Ambos os Times Marcam</div>
                  <div className="text-xl font-bold mb-1">
                    {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'}
                  </div>
                  <Badge className={getConfidenceColor(prediction.btts.confidence)} size="sm">
                    {prediction.btts.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <Hash className="w-5 h-5 text-red-600" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-600 mb-1">Placar Exato Mais Provável</div>
                  <div className="text-xl font-bold mb-1">{prediction.correctScore.score}</div>
                  <Badge className={getConfidenceColor(prediction.correctScore.confidence)} size="sm">
                    {prediction.correctScore.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Timer className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-600 mb-1">Primeiro Tempo</div>
                  <div className="text-xl font-bold mb-1">
                    {getPredictionLabel(prediction.firstHalf.prediction)}
                  </div>
                  <Badge className={getConfidenceColor(prediction.firstHalf.confidence)} size="sm">
                    {prediction.firstHalf.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Timer className="w-5 h-5 text-indigo-600" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-gray-600 mb-1">Segundo Tempo</div>
                  <div className="text-xl font-bold mb-1">
                    {getPredictionLabel(prediction.secondHalf.prediction)}
                  </div>
                  <Badge className={getConfidenceColor(prediction.secondHalf.confidence)} size="sm">
                    {prediction.secondHalf.confidence}%
                  </Badge>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 rounded-b-xl">
          <div className="text-xs text-gray-500 text-center">
            As previsões são geradas por algoritmos de inteligência artificial e baseadas em análise estatística.
            Não garantem resultados e devem ser utilizadas apenas como referência informativa.
          </div>
        </div>
    </div>
  );
}
