import { useState, useMemo, useEffect } from 'react';
import { mockMatches, mockPredictions, countries, leagues, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { PremiumCarousel } from '../components/PremiumCarousel';
import { AgentAnalysis } from '../components/AgentAnalysis';
import { ApiStatus } from '../components/ApiStatus';
import { TrendingUp, Brain, Loader2 } from 'lucide-react';
import { AI_AGENTS, AgentEnsemble, AgentPrediction } from '../services/aiAgents';
import { loadApiConfig } from '../services/apiConfig';
import { FootballDataService, FootballMatch } from '../services/footballDataService';
import { toast } from 'sonner';

export default function Home() {
  const [selectedDate, setSelectedDate] = useState('all');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [showAgentAnalysis, setShowAgentAnalysis] = useState(false);
  const [agentPredictions, setAgentPredictions] = useState<AgentPrediction[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [realMatches, setRealMatches] = useState<FootballMatch[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);

  // Carregar partidas reais da API se configurada
  useEffect(() => {
    const config = loadApiConfig();
    if (config?.footballDataApiKey) {
      loadRealMatches(config.footballDataApiKey);
    }
  }, []);

  const loadRealMatches = async (apiKey: string) => {
    setIsLoadingMatches(true);
    try {
      const service = new FootballDataService(apiKey);
      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      const matches = await service.getMatches(
        undefined,
        today.toISOString().split('T')[0],
        nextWeek.toISOString().split('T')[0]
      );
      
      setRealMatches(matches);
      toast.success(`${matches.length} partidas carregadas da API`);
    } catch (error) {
      console.error('Erro ao carregar partidas:', error);
      toast.error('Erro ao carregar partidas. Usando dados de exemplo.');
    } finally {
      setIsLoadingMatches(false);
    }
  };

  // Filtrar partidas
  const filteredMatches = useMemo(() => {
    return mockMatches.filter((match) => {
      // Filtro de data
      if (selectedDate !== 'all') {
        const today = new Date('2026-04-10');
        const matchDate = new Date(match.date);
        
        if (selectedDate === 'today') {
          if (matchDate.toDateString() !== today.toDateString()) return false;
        } else if (selectedDate === 'tomorrow') {
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          if (matchDate.toDateString() !== tomorrow.toDateString()) return false;
        } else if (selectedDate === 'week') {
          const weekLater = new Date(today);
          weekLater.setDate(weekLater.getDate() + 7);
          if (matchDate < today || matchDate > weekLater) return false;
        } else if (selectedDate === 'fortnight') {
          const fortnightLater = new Date(today);
          fortnightLater.setDate(fortnightLater.getDate() + 15);
          if (matchDate < today || matchDate > fortnightLater) return false;
        } else if (selectedDate === 'month') {
          const monthLater = new Date(today);
          monthLater.setDate(monthLater.getDate() + 30);
          if (matchDate < today || matchDate > monthLater) return false;
        }
      }

      // Filtro de país
      if (selectedCountry !== 'all' && match.country !== selectedCountry) {
        return false;
      }

      // Filtro de liga
      if (selectedLeague !== 'all' && match.league !== selectedLeague) {
        return false;
      }

      return true;
    });
  }, [selectedDate, selectedCountry, selectedLeague]);

  // Agrupar partidas por liga
  const groupedMatches = useMemo(() => {
    const groups: { [key: string]: Match[] } = {};
    
    filteredMatches.forEach((match) => {
      const key = `${match.country} - ${match.league}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(match);
    });

    return groups;
  }, [filteredMatches]);

  // Jogos premium (alta confiança + melhor retorno)
  const premiumMatches = useMemo(() => {
    return mockMatches
      .filter(match => {
        const prediction = mockPredictions.find(p => p.matchId === match.id);
        return prediction && prediction.aiConfidence >= 80;
      })
      .slice(0, 5)
      .map(match => {
        const prediction = mockPredictions.find(p => p.matchId === match.id)!;
        return {
          id: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeCrest: '', // Será preenchido com dados da API
          awayCrest: '',
          league: match.league,
          time: `${new Date(match.date).toLocaleDateString('pt-BR')} - ${match.time}`,
          aiConfidence: prediction.aiConfidence,
          prediction: prediction.winner.prediction === 'home' 
            ? `Vitória ${match.homeTeam}`
            : prediction.winner.prediction === 'away'
            ? `Vitória ${match.awayTeam}`
            : 'Empate',
          odds: prediction.winner.odds,
          potentialReturn: Math.round((prediction.winner.odds - 1) * 100),
          isPremium: true,
          tags: [
            'Alta Confiança',
            `${prediction.aiConfidence}% IA`,
            'Recomendado',
          ],
        };
      });
  }, []);

  const selectedMatch = selectedMatchId 
    ? mockMatches.find(m => m.id === selectedMatchId) 
    : null;
  const selectedPrediction = selectedMatchId 
    ? mockPredictions.find(p => p.matchId === selectedMatchId) 
    : null;

  // Carregar análise dos agentes de IA
  const loadAgentAnalysis = async (matchId: string) => {
    setIsLoadingAgents(true);
    setShowAgentAnalysis(true);

    // Simular carregamento (em produção seria chamada real aos modelos)
    setTimeout(async () => {
      const match = mockMatches.find(m => m.id === matchId);
      if (match) {
        // Converter para formato FootballMatch (simplificado)
        const footballMatch: FootballMatch = {
          id: parseInt(matchId),
          utcDate: match.date.toISOString(),
          status: match.status,
          matchday: 1,
          homeTeam: {
            id: 1,
            name: match.homeTeam,
            shortName: match.homeTeam,
            tla: match.homeTeam.substring(0, 3).toUpperCase(),
            crest: '',
          },
          awayTeam: {
            id: 2,
            name: match.awayTeam,
            shortName: match.awayTeam,
            tla: match.awayTeam.substring(0, 3).toUpperCase(),
            crest: '',
          },
          score: {
            fullTime: { home: null, away: null },
          },
          competition: {
            id: 1,
            name: match.league,
            code: match.league.substring(0, 2).toUpperCase(),
            emblem: '',
            area: {
              name: match.country,
              code: match.country.substring(0, 2).toUpperCase(),
              flag: '',
            },
          },
        };

        const ensemble = new AgentEnsemble(AI_AGENTS);
        const predictions = await ensemble.predictWithAllAgents(footballMatch);
        setAgentPredictions(predictions);
      }
      setIsLoadingAgents(false);
    }, 1500);
  };

  const handleViewDetails = (matchId: string) => {
    setSelectedMatchId(matchId);
    loadAgentAnalysis(matchId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <FilterBar
        selectedDate={selectedDate}
        selectedCountry={selectedCountry}
        selectedLeague={selectedLeague}
        onDateChange={setSelectedDate}
        onCountryChange={setSelectedCountry}
        onLeagueChange={setSelectedLeague}
        countries={countries}
        leagues={leagues}
      />

      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-8 h-8 text-purple-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Previsões de Futebol com IA
            </h1>
          </div>
          <p className="text-gray-600">
            Análises detalhadas geradas por 5 agentes de IA especializados em diferentes aspectos do futebol
          </p>
        </div>

        {/* API Status */}
        <ApiStatus />

        {/* Carrossel Premium */}
        {premiumMatches.length > 0 && (
          <PremiumCarousel
            matches={premiumMatches}
            onMatchClick={handleViewDetails}
          />
        )}

        {/* Estatísticas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Total de Partidas</div>
            <div className="text-2xl font-bold text-blue-600">{filteredMatches.length}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Alta Confiança</div>
            <div className="text-2xl font-bold text-green-600">
              {mockPredictions.filter(p => 
                p.aiConfidence >= 80 && 
                filteredMatches.some(m => m.id === p.matchId)
              ).length}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Países</div>
            <div className="text-2xl font-bold text-purple-600">
              {new Set(filteredMatches.map(m => m.country)).size}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
            <div className="text-sm text-gray-600 mb-1">Agentes IA Ativos</div>
            <div className="text-2xl font-bold text-orange-600">{AI_AGENTS.length}</div>
          </div>
        </div>

        {/* Lista de partidas agrupadas */}
        {Object.keys(groupedMatches).length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <TrendingUp className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Nenhuma partida encontrada
            </h3>
            <p className="text-gray-600">
              Tente ajustar os filtros para ver mais resultados
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedMatches).map(([leagueKey, matches]) => (
              <div key={leagueKey}>
                <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  {leagueKey}
                  <span className="text-sm font-normal text-gray-500">
                    ({matches.length} {matches.length === 1 ? 'partida' : 'partidas'})
                  </span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {matches.map((match) => {
                    const prediction = mockPredictions.find(p => p.matchId === match.id);
                    if (!prediction) return null;
                    
                    return (
                      <MatchCard
                        key={match.id}
                        match={match}
                        prediction={prediction}
                        onViewDetails={handleViewDetails}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalhes com análise dos agentes */}
      {selectedMatch && selectedPrediction && (
        <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto">
          <div className="min-h-screen p-4 flex items-start justify-center">
            <div className="bg-white rounded-xl max-w-6xl w-full my-8">
              <PredictionDetails
                match={selectedMatch}
                prediction={selectedPrediction}
                onClose={() => {
                  setSelectedMatchId(null);
                  setShowAgentAnalysis(false);
                  setAgentPredictions([]);
                }}
              />

              {/* Análise dos Agentes de IA */}
              <div className="p-6 border-t">
                {isLoadingAgents ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                    <span className="ml-3 text-gray-600">Consultando agentes de IA...</span>
                  </div>
                ) : agentPredictions.length > 0 ? (
                  <AgentAnalysis predictions={agentPredictions} profiles={AI_AGENTS} />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}