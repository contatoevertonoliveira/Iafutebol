import { Brain, TrendingUp, Award, BarChart3, Target } from 'lucide-react';
import { AI_AGENTS } from '../services/aiAgents';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';

export default function AIAgentsPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-10 h-10 text-purple-600" />
            <h1 className="text-4xl font-bold text-gray-900">Agentes de IA</h1>
          </div>
          <p className="text-gray-600 text-lg">
            Conheça nossos 5 agentes especialistas em análise de futebol
          </p>
        </div>

        {/* Overview Stats */}
        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <Card className="p-6 bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <div className="flex items-center gap-3 mb-2">
              <Brain className="w-8 h-8" />
              <div className="text-sm opacity-90">Agentes Ativos</div>
            </div>
            <div className="text-4xl font-bold">{AI_AGENTS.length}</div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-green-500 to-green-600 text-white">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp className="w-8 h-8" />
              <div className="text-sm opacity-90">Accuracy Média</div>
            </div>
            <div className="text-4xl font-bold">
              {(AI_AGENTS.reduce((sum, a) => sum + a.accuracy, 0) / AI_AGENTS.length).toFixed(1)}%
            </div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <div className="flex items-center gap-3 mb-2">
              <BarChart3 className="w-8 h-8" />
              <div className="text-sm opacity-90">Total Previsões</div>
            </div>
            <div className="text-4xl font-bold">
              {AI_AGENTS.reduce((sum, a) => sum + a.totalPredictions, 0).toLocaleString()}
            </div>
          </Card>

          <Card className="p-6 bg-gradient-to-br from-orange-500 to-orange-600 text-white">
            <div className="flex items-center gap-3 mb-2">
              <Award className="w-8 h-8" />
              <div className="text-sm opacity-90">Melhor Agente</div>
            </div>
            <div className="text-2xl font-bold">
              {AI_AGENTS.reduce((best, agent) => 
                agent.accuracy > best.accuracy ? agent : best
              ).name}
            </div>
          </Card>
        </div>

        {/* Agent Details */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Perfis dos Agentes</h2>

          {AI_AGENTS.map((agent, idx) => (
            <Card key={agent.id} className="p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-start gap-6">
                {/* Avatar e Ranking */}
                <div className="text-center">
                  <div className="text-6xl mb-2">{agent.avatar}</div>
                  <Badge className="bg-purple-100 text-purple-800 border-purple-300">
                    #{idx + 1}
                  </Badge>
                </div>

                {/* Informações Principais */}
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-1">{agent.name}</h3>
                      <p className="text-gray-600 mb-2">{agent.description}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{agent.type}</Badge>
                        <Badge className="bg-blue-100 text-blue-800">
                          {agent.specialty}
                        </Badge>
                      </div>
                    </div>

                    {/* Accuracy Badge */}
                    <div className="text-center bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border-2 border-green-300">
                      <div className="text-sm text-green-700 font-semibold mb-1">Accuracy</div>
                      <div className="text-3xl font-bold text-green-800">{agent.accuracy.toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Estatísticas */}
                  <div className="grid md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-sm text-gray-600 mb-1">Total de Previsões</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {agent.totalPredictions.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-sm text-gray-600 mb-1">Previsões Corretas</div>
                      <div className="text-2xl font-bold text-green-600">
                        {agent.correctPredictions.toLocaleString()}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-sm text-gray-600 mb-1">Taxa de Acerto</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {((agent.correctPredictions / agent.totalPredictions) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Barra de Progresso */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">Performance</span>
                      <span className="text-sm text-gray-500">
                        {agent.correctPredictions}/{agent.totalPredictions}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full ${
                          agent.accuracy >= 75 ? 'bg-green-500' :
                          agent.accuracy >= 70 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${agent.accuracy}%` }}
                      />
                    </div>
                  </div>

                  {/* Strengths */}
                  <div>
                    <div className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Pontos Fortes:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {agent.strengths.map((strength, i) => (
                        <Badge key={i} className="bg-purple-100 text-purple-800 border-purple-300">
                          {strength}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tipo de Análise */}
              <div className="mt-6 pt-6 border-t">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <h4 className="font-semibold text-blue-900 mb-2">Metodologia</h4>
                    <p className="text-sm text-blue-800">
                      {agent.type === 'statistical' && 'Análise profunda de dados estatísticos como xG, posse de bola, finalizações e outras métricas avançadas.'}
                      {agent.type === 'form' && 'Foca no momento atual dos times, analisando os últimos jogos, sequências de vitórias/derrotas e moral.'}
                      {agent.type === 'head2head' && 'Especialista em confrontos diretos, analisando o histórico entre os times em diferentes contextos.'}
                      {agent.type === 'advanced' && 'Utiliza deep learning com mais de 50 variáveis para identificar padrões complexos não visíveis a olho nu.'}
                      {agent.type === 'ensemble' && 'Combina as previsões de todos os agentes usando ponderação inteligente baseada no histórico de accuracy.'}
                    </p>
                  </div>

                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <h4 className="font-semibold text-green-900 mb-2">Melhor Para</h4>
                    <p className="text-sm text-green-800">
                      {agent.type === 'statistical' && 'Apostas baseadas em estatísticas sólidas, over/under, cantos, cartões.'}
                      {agent.type === 'form' && 'Identificar times em grande momento, sequências e zebras.'}
                      {agent.type === 'head2head' && 'Clássicos, derbies e confrontos com histórico relevante.'}
                      {agent.type === 'advanced' && 'Situações complexas com múltiplas variáveis e padrões sutis.'}
                      {agent.type === 'ensemble' && 'Previsões gerais com maior confiabilidade e consenso entre especialistas.'}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Como Funcionam */}
        <Card className="mt-8 p-6 bg-gradient-to-br from-purple-50 to-blue-50">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            Como Funcionam os Agentes de IA
          </h2>
          <div className="space-y-4 text-gray-700">
            <p>
              Nossos agentes de IA são modelos especializados treinados em milhares de partidas históricas.
              Cada agente tem uma abordagem única e foca em aspectos diferentes do jogo.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-2">🎯 Processo de Análise</h3>
                <ul className="space-y-1 text-sm">
                  <li>• Coleta de dados das APIs (football-data.org, openligadb.de)</li>
                  <li>• Processamento e normalização das estatísticas</li>
                  <li>• Aplicação do modelo específico de cada agente</li>
                  <li>• Geração de previsão com nível de confiança</li>
                  <li>• Combinação via ensemble para consenso final</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold mb-2">🔄 Aprendizado Contínuo</h3>
                <ul className="space-y-1 text-sm">
                  <li>• Comparação de previsões com resultados reais</li>
                  <li>• Ajuste automático de pesos e parâmetros</li>
                  <li>• Melhoria contínua do accuracy</li>
                  <li>• Adaptação a mudanças no futebol moderno</li>
                  <li>• Feedback loop para otimização constante</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
