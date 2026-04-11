import { AgentPrediction, AgentProfile } from '../services/aiAgents';
import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { TrendingUp, Award } from 'lucide-react';

interface AgentAnalysisProps {
  predictions: AgentPrediction[];
  profiles: AgentProfile[];
}

export function AgentAnalysis({ predictions, profiles }: AgentAnalysisProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Award className="w-5 h-5 text-purple-600" />
        <h3 className="text-lg font-bold">Análise dos Agentes de IA</h3>
      </div>

      <div className="grid gap-4">
        {predictions.map((prediction, idx) => {
          const profile = profiles.find(p => p.name === prediction.agentName);
          if (!profile) return null;

          return (
            <Card key={idx} className="p-4 hover:shadow-lg transition-shadow">
              <div className="flex items-start gap-4">
                {/* Avatar do Agente */}
                <div className="text-4xl">{profile.avatar}</div>

                {/* Informações do Agente */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-bold text-lg">{profile.name}</h4>
                    <Badge variant="outline" className="text-xs">
                      {profile.accuracy.toFixed(1)}% accuracy
                    </Badge>
                    <Badge className="bg-purple-100 text-purple-800 border-purple-300 text-xs">
                      {profile.type}
                    </Badge>
                  </div>

                  <p className="text-sm text-gray-600 mb-3">{profile.description}</p>

                  {/* Especialidade */}
                  <div className="mb-3">
                    <span className="text-xs text-gray-500">Especialidade: </span>
                    <span className="text-sm font-semibold text-blue-600">{profile.specialty}</span>
                  </div>

                  {/* Previsão Principal */}
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">Previsão:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-blue-600">
                          {prediction.winner === 'home' ? 'Casa' : 
                           prediction.winner === 'away' ? 'Fora' : 'Empate'}
                        </span>
                        <Badge className={
                          prediction.confidence >= 75 ? 'bg-green-100 text-green-800' :
                          prediction.confidence >= 60 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }>
                          {prediction.confidence.toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                    <div className="w-full bg-white rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${
                          prediction.confidence >= 75 ? 'bg-green-500' :
                          prediction.confidence >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${prediction.confidence}%` }}
                      />
                    </div>
                  </div>

                  {/* Mini Previsões */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-600">Over/Under</div>
                      <div className="font-semibold text-sm">
                        {prediction.overUnder.prediction}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-600">BTTS</div>
                      <div className="font-semibold text-sm">
                        {prediction.btts.prediction === 'yes' ? 'Sim' : 'Não'}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-center">
                      <div className="text-xs text-gray-600">Placar</div>
                      <div className="font-semibold text-sm">
                        {prediction.correctScore.score}
                      </div>
                    </div>
                  </div>

                  {/* Reasoning */}
                  <div className="bg-gray-50 rounded-lg p-3 mb-3">
                    <div className="text-xs text-gray-600 mb-1">Raciocínio:</div>
                    <p className="text-sm text-gray-700 italic">"{prediction.reasoning}"</p>
                  </div>

                  {/* Fatores de Análise */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Forma:</span>
                      <div className="flex-1 mx-2 bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${prediction.factors.formWeight * 100}%` }}
                        />
                      </div>
                      <span className="font-semibold">{(prediction.factors.formWeight * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">H2H:</span>
                      <div className="flex-1 mx-2 bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-purple-500 h-1.5 rounded-full"
                          style={{ width: `${prediction.factors.h2hWeight * 100}%` }}
                        />
                      </div>
                      <span className="font-semibold">{(prediction.factors.h2hWeight * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Stats:</span>
                      <div className="flex-1 mx-2 bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-green-500 h-1.5 rounded-full"
                          style={{ width: `${prediction.factors.statsWeight * 100}%` }}
                        />
                      </div>
                      <span className="font-semibold">{(prediction.factors.statsWeight * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Casa:</span>
                      <div className="flex-1 mx-2 bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-orange-500 h-1.5 rounded-full"
                          style={{ width: `${prediction.factors.homeAdvantage * 100}%` }}
                        />
                      </div>
                      <span className="font-semibold">{(prediction.factors.homeAdvantage * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Strengths */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {profile.strengths.map((strength, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        {strength}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
