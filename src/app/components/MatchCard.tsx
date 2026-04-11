import { Match, Prediction } from '../data/mockData';
import { Calendar, Clock, TrendingUp } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';
import { useState } from 'react';

interface MatchCardProps {
  match: Match & {
    result?: {
      home: number | null;
      away: number | null;
    };
  };
  prediction: Prediction;
  onViewDetails: (matchId: string) => void;
  homeCrest?: string;
  awayCrest?: string;
}

export function MatchCard({ match, prediction, onViewDetails, homeCrest, awayCrest }: MatchCardProps) {
  const [showResult, setShowResult] = useState(false);

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

  const resultAvailable =
    match.status === 'finished' &&
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

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      {/* Header com Liga e País */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          <span className="font-semibold text-sm">{match.league}</span>
        </div>
        <Badge variant="secondary" className="bg-white/20 text-white border-0">
          {match.country}
        </Badge>
      </div>

      {/* Informações da Partida */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="w-4 h-4" />
            <span>{new Date(match.date).toLocaleDateString('pt-BR')}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            <span>{match.time}</span>
          </div>
        </div>

        {/* Times com Escudos */}
        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <TeamLogo
              teamName={match.homeTeam}
              logoUrl={homeCrest}
              size="lg"
              showName={true}
            />
            {prediction.winner.prediction === 'home' && (
              <Badge className="bg-green-100 text-green-800 border-green-300">
                Favorito
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <TeamLogo
              teamName={match.awayTeam}
              logoUrl={awayCrest}
              size="lg"
              showName={true}
            />
            {prediction.winner.prediction === 'away' && (
              <Badge className="bg-green-100 text-green-800 border-green-300">
                Favorito
              </Badge>
            )}
          </div>
        </div>

        {resultAvailable && showResult && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">Placar final</div>
              <div className="text-lg font-bold text-gray-900">{actualScoreText}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="bg-gray-50 p-2 rounded">
                <div className="text-xs text-gray-600 mb-1">Vencedor (IA)</div>
                <div className="font-semibold text-sm truncate">{getPredictionLabel(predictedWinner)}</div>
                <div className="text-xs text-gray-500">
                  {winnerHit === null ? '-' : winnerHit ? 'Acertou' : 'Errou'}
                </div>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <div className="text-xs text-gray-600 mb-1">Vencedor (Real)</div>
                <div className="font-semibold text-sm truncate">{actualWinner ? getPredictionLabel(actualWinner) : '-'}</div>
                <div className="text-xs text-gray-500">&nbsp;</div>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <div className="text-xs text-gray-600 mb-1">Placar (IA)</div>
                <div className="font-semibold text-sm">{predictedScoreText}</div>
                <div className="text-xs text-gray-500">{scoreHit === null ? '-' : scoreHit ? 'Acertou' : 'Errou'}</div>
              </div>
              <div className="bg-gray-50 p-2 rounded">
                <div className="text-xs text-gray-600 mb-1">Over/Under</div>
                <div className="font-semibold text-sm">
                  {actualOverUnder ? (actualOverUnder === 'over' ? 'Over' : 'Under') : '-'}
                </div>
                <div className="text-xs text-gray-500">
                  {overUnderHit === null ? '-' : overUnderHit ? 'Acertou' : 'Errou'}
                </div>
              </div>
              <div className="bg-gray-50 p-2 rounded col-span-2">
                <div className="text-xs text-gray-600 mb-1">Ambos Marcam</div>
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-sm">
                    Real: {actualBtts ? (actualBtts === 'yes' ? 'Sim' : 'Não') : '-'}
                  </div>
                  <div className="text-sm text-gray-600">
                    IA: {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'} ({bttsHit === null ? '-' : bttsHit ? 'Acertou' : 'Errou'})
                  </div>
                </div>
              </div>
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

        {/* Botão Ver Mais */}
        {match.status === 'finished' && (
          <button
            onClick={() => setShowResult((v) => !v)}
            disabled={!resultAvailable}
            className={`w-full mb-2 py-2 rounded-lg font-semibold transition-colors ${
              resultAvailable
                ? 'bg-gray-900 hover:bg-gray-800 text-white'
                : 'bg-gray-200 text-gray-500 cursor-not-allowed'
            }`}
          >
            {showResult ? 'Ocultar Resultado' : 'Ver Resultado'}
          </button>
        )}
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
