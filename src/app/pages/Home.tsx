import { useState, useMemo } from 'react';
import { mockMatches, mockPredictions, countries, leagues, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { TrendingUp } from 'lucide-react';

export default function Home() {
  const [selectedDate, setSelectedDate] = useState('all');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

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

  const selectedMatch = selectedMatchId 
    ? mockMatches.find(m => m.id === selectedMatchId) 
    : null;
  const selectedPrediction = selectedMatchId 
    ? mockPredictions.find(p => p.matchId === selectedMatchId) 
    : null;

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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Previsões de Futebol com IA
          </h1>
          <p className="text-gray-600">
            Análises detalhadas geradas por inteligência artificial para partidas de futebol ao redor do mundo
          </p>
        </div>

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
            <div className="text-sm text-gray-600 mb-1">Ligas</div>
            <div className="text-2xl font-bold text-orange-600">
              {new Set(filteredMatches.map(m => m.league)).size}
            </div>
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
                        onViewDetails={setSelectedMatchId}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalhes */}
      {selectedMatch && selectedPrediction && (
        <PredictionDetails
          match={selectedMatch}
          prediction={selectedPrediction}
          onClose={() => setSelectedMatchId(null)}
        />
      )}
    </div>
  );
}
