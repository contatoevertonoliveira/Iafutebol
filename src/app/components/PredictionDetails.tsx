import { Match, Prediction } from '../data/mockData';
import { TrendingUp, Target, BarChart3, Trophy, Timer, Hash } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';

interface PredictionDetailsProps {
  match: Match & { homeCrest?: string; awayCrest?: string };
  prediction: Prediction;
}

export function PredictionDetails({ match, prediction }: PredictionDetailsProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'bg-green-100 text-green-800 border-green-300';
    if (confidence >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const isFinished = match.status === 'finished';

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
            • {match.time}
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
