import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Zap } from 'lucide-react';
import type { FootballMatch } from '../services/footballDataService';
import type { Prediction } from '../data/mockData';
import { TeamLogo } from '../components/TeamLogo';
import { AgentEnsemble, getDynamicAgentProfiles } from '../services/aiAgents';
import { MobileBottomNav } from '../components/MobileBottomNav';

type ApiSource = 'api-football' | 'football-data' | 'openligadb' | 'mock';

type MatchesCache = {
  version: number;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  apiSource: ApiSource;
  matches: FootballMatch[];
  predictions: Record<string, Prediction>;
};

export default function MobileAnalysisPage() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [agentText, setAgentText] = useState<string>('');
  const [isLoadingAgentText, setIsLoadingAgentText] = useState(false);

  const cached = useMemo(() => {
    const keys = ['matchesCache_v3', 'matchesCache_v2', 'matchesCache_v1'];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as MatchesCache;
        if (!parsed || !parsed.matches || !parsed.predictions) continue;
        return parsed;
      } catch {}
    }
    return null;
  }, []);

  const match = useMemo(() => {
    if (!cached || !matchId) return null;
    const idNum = Number(matchId);
    if (Number.isFinite(idNum)) {
      return cached.matches.find((m) => m.id === idNum) ?? null;
    }
    return null;
  }, [cached, matchId]);

  const prediction = useMemo(() => {
    if (!cached || !matchId) return null;
    return cached.predictions[String(matchId)] ?? null;
  }, [cached, matchId]);

  const liveStatusShort = useMemo(() => {
    return match?.live?.statusShort ?? undefined;
  }, [match?.live?.statusShort]);

  const liveMinute = useMemo(() => {
    const elapsed = match?.live?.elapsed;
    if (typeof elapsed !== 'number') return null;
    const extra = match?.live?.extra;
    if (typeof extra === 'number' && extra > 0) return `${Math.floor(elapsed)}+${extra}'`;
    return `${Math.floor(elapsed)}'`;
  }, [match?.live?.elapsed, match?.live?.extra]);

  const statusLabel = useMemo(() => {
    const short = String(liveStatusShort || match?.status || '').toUpperCase();
    if (['FT', 'AET', 'PEN', 'FINISHED'].includes(short)) return 'FINALIZADO';
    if (short === 'HT') return 'INTERVALO';
    if (['1H', '2H', 'ET', 'IN_PLAY', 'LIVE', 'PAUSED', 'BREAK', 'BT', 'SUSP', 'INT'].includes(short)) return 'AO VIVO';
    return '';
  }, [liveStatusShort, match?.status]);

  const scoreHome = match?.score?.fullTime?.home ?? null;
  const scoreAway = match?.score?.fullTime?.away ?? null;

  const kickoffTime = useMemo(() => {
    if (!match?.utcDate) return '';
    const d = new Date(match.utcDate);
    return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  }, [match?.utcDate]);

  const calcOddsFromConfidence = (confidence: number) => {
    const c = Math.max(40, Math.min(95, confidence));
    const normalized = (95 - c) / (95 - 40);
    const odds = 1.2 + normalized * 3.3;
    return Number(odds.toFixed(2));
  };

  const mainPick = useMemo(() => {
    if (!prediction || !match) return null;
    const w = prediction.winner.prediction;
    const label = w === 'home' ? match.homeTeam.name : w === 'away' ? match.awayTeam.name : 'Empate';
    return { label, odds: calcOddsFromConfidence(prediction.winner.confidence) };
  }, [match, prediction]);

  const valuePick = useMemo(() => {
    if (!prediction) return null;
    const label = prediction.overUnder.prediction === 'over' ? `Mais de ${prediction.overUnder.line} gols` : `Menos de ${prediction.overUnder.line} gols`;
    const odds = calcOddsFromConfidence(prediction.overUnder.confidence);
    return { label, odds };
  }, [prediction]);

  useEffect(() => {
    if (!match) return;
    setIsLoadingAgentText(true);
    const run = async () => {
      try {
        const ensemble = new AgentEnsemble(getDynamicAgentProfiles());
        const consensus = await ensemble.getConsensusPrediction(match);
        setAgentText(consensus.reasoning || '');
      } catch {
        setAgentText('');
      } finally {
        setIsLoadingAgentText(false);
      }
    };
    void run();
  }, [match]);

  if (!match || !matchId) {
    return (
      <div className="md:hidden min-h-screen bg-gray-50 pb-20">
        <div className="sticky top-0 z-40 bg-white border-b border-gray-200">
          <div className="h-14 px-4 flex items-center gap-2">
            <button className="p-2 rounded-md hover:bg-gray-100" onClick={() => navigate(-1)} aria-label="Voltar">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="font-bold text-gray-900">Análise Completa</div>
          </div>
        </div>
        <div className="p-4 text-gray-700">Não foi possível carregar a partida.</div>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="md:hidden min-h-screen bg-gray-50 pb-20">
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="h-14 px-4 flex items-center justify-between">
          <button className="p-2 rounded-md hover:bg-gray-100" onClick={() => navigate(-1)} aria-label="Voltar" title="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="font-bold text-gray-900">Apex Prediction</div>
          <div className="w-9" />
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold text-gray-900">Análise Completa</div>
          {statusLabel && (
            <div className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">
              {statusLabel}
              {statusLabel === 'AO VIVO' && liveMinute ? ` ${liveMinute}` : ''}
            </div>
          )}
        </div>

        <div className="mt-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <div className="grid grid-cols-3 items-center">
            <div className="flex flex-col items-center gap-2 min-w-0">
              <TeamLogo teamName={match.homeTeam.name} logoUrl={match.homeTeam.crest} size="lg" showName={false} />
              <div className="text-sm font-semibold truncate">{match.homeTeam.shortName ?? match.homeTeam.name}</div>
            </div>

            <div className="flex flex-col items-center justify-center">
              {typeof scoreHome === 'number' && typeof scoreAway === 'number' ? (
                <div className="text-4xl font-bold text-gray-900 tabular-nums">
                  {scoreHome}-{scoreAway}
                </div>
              ) : (
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{kickoffTime}</div>
              )}
              <div className="mt-1 text-[11px] text-gray-500 font-semibold tracking-wide">{match.competition.name.toUpperCase()}</div>
            </div>

            <div className="flex flex-col items-center gap-2 min-w-0">
              <TeamLogo teamName={match.awayTeam.name} logoUrl={match.awayTeam.crest} size="lg" showName={false} />
              <div className="text-sm font-semibold truncate">{match.awayTeam.shortName ?? match.awayTeam.name}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-gray-900 text-white rounded-2xl p-4">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-white/80">
            <Zap className="w-4 h-4" />
            PROBABILIDADE IA
          </div>
          <div className="mt-2 text-5xl font-bold">{prediction ? prediction.aiConfidence : 0}%</div>
          <div className="mt-2 text-sm text-white/80">
            {prediction && mainPick ? `Confiança alta em ${mainPick.label}.` : 'Gerando previsão...'}
          </div>
          <div className="mt-3 h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: `${prediction ? prediction.aiConfidence : 0}%` }} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="text-[11px] font-bold text-gray-500">OVER/UNDER</div>
            <div className="mt-1 text-xl font-bold text-gray-900">
              {prediction ? `${prediction.overUnder.line}` : '—'}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {prediction ? (prediction.overUnder.prediction === 'over' ? 'Mais gols' : 'Menos gols') : ''}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="text-[11px] font-bold text-gray-500">BTTS</div>
            <div className="mt-1 text-xl font-bold text-gray-900">
              {prediction ? (prediction.btts.prediction === 'yes' ? 'Sim' : 'Não') : '—'}
            </div>
            <div className="mt-1 text-xs text-gray-500">Ambos marcam</div>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-bold text-gray-500 tracking-wide">DICAS DE APOSTAS (IA)</div>
          <div className="mt-3 space-y-3">
            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-blue-700">PALPITE PRINCIPAL</div>
                <div className="mt-1 font-semibold text-gray-900 truncate">{mainPick?.label ?? '—'}</div>
              </div>
              <div className="text-lg font-bold text-blue-700">{mainPick ? mainPick.odds.toFixed(2) : '—'}</div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-gray-600">VALOR</div>
                <div className="mt-1 font-semibold text-gray-900 truncate">{valuePick?.label ?? '—'}</div>
              </div>
              <div className="text-lg font-bold text-gray-700">{valuePick ? valuePick.odds.toFixed(2) : '—'}</div>
            </div>
          </div>
        </div>

        <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <div className="font-bold text-gray-900">O Oráculo</div>
          <div className="text-xs font-bold text-blue-700 tracking-wide">ANÁLISE DO CONSENSO</div>
          <div className="mt-3 text-sm text-gray-700">
            {isLoadingAgentText ? 'Gerando análise...' : agentText || 'Análise indisponível no momento.'}
          </div>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}

