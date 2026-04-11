import { Match, Prediction } from '../data/mockData';
import { X, TrendingUp, Target, BarChart3, Trophy, Timer, Hash } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';

interface PredictionDetailsProps {
  match: Match;
  prediction: Prediction;
  onClose: () => void;
}

export function PredictionDetails({ match, prediction, onClose }: PredictionDetailsProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'bg-green-100 text-green-800 border-green-300';
    if (confidence >= 50) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-4xl w-full my-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-xl relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5" />
            <span className="font-semibold">{match.league}</span>
            <Badge variant="secondary" className="bg-white/20 text-white border-0">
              {match.country}
            </Badge>
          </div>

          <div className="space-y-2">
            <div className="text-2xl font-bold">{match.homeTeam}</div>
            <div className="text-lg opacity-90">vs</div>
            <div className="text-2xl font-bold">{match.awayTeam}</div>
          </div>

          <div className="mt-4 text-sm opacity-90">
            {new Date(match.date).toLocaleDateString('pt-BR', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })} às {match.time}
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
        <div className="p-6 space-y-4">
          {/* Vencedor */}
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

          {/* Primeiro e Segundo Tempo */}
          <div className="grid md:grid-cols-2 gap-4">
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

          {/* Over/Under */}
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

          {/* Handicap Asiático */}
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Target className="w-6 h-6 text-orange-600" />
              </div>
              <div className="flex-1">
                <div className="font-semibold mb-1">Handicap Asiático</div>
                <div className="text-2xl font-bold text-orange-600 mb-2">
                  {prediction.asianHandicap.team === 'home' ? match.homeTeam : match.awayTeam}
                  {' '}
                  ({prediction.asianHandicap.line > 0 ? '+' : ''}{prediction.asianHandicap.line})
                </div>
                <Badge className={getConfidenceColor(prediction.asianHandicap.confidence)}>
                  Confiança: {prediction.asianHandicap.confidence}%
                </Badge>
              </div>
            </div>
          </Card>

          {/* Placar Exato e BTTS */}
          <div className="grid md:grid-cols-2 gap-4">
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
    </div>
  );
}
