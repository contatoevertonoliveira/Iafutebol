import { Match, Prediction } from '../data/mockData';
import { Calendar, Clock, TrendingUp } from 'lucide-react';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TeamLogo } from './TeamLogo';

interface MatchCardProps {
  match: Match;
  prediction: Prediction;
  onViewDetails: (matchId: string) => void;
  homeCrest?: string;
  awayCrest?: string;
}

export function MatchCard({ match, prediction, onViewDetails, homeCrest, awayCrest }: MatchCardProps) {
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 70) return 'text-green-600 bg-green-50';
    if (confidence >= 50) return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getPredictionLabel = (pred: 'home' | 'away' | 'draw') => {
    if (pred === 'home') return match.homeTeam;
    if (pred === 'away') return match.awayTeam;
    return 'Empate';
  };

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