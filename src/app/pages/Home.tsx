import { useState, useMemo, useRef } from 'react';
import { mockMatches, mockPredictions, countries, leagues, Match, Prediction } from '../data/mockData';
import { MatchCard } from '../components/MatchCard';
import { PredictionDetails } from '../components/PredictionDetails';
import { FilterBar } from '../components/FilterBar';
import { TrendingUp } from 'lucide-react';
import { DraggableWindow } from '../components/DraggableWindow';

export default function Home() {
  const [selectedDate, setSelectedDate] = useState('all');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedLeague, setSelectedLeague] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'live' | 'upcoming' | 'finished'>('all');
  const [groupMode, setGroupMode] = useState<'leagues' | 'championships'>('leagues');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const zRef = useRef(70);
  const [detailsZ, setDetailsZ] = useState(60);

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

      if (selectedStatus !== 'all') {
        if (selectedStatus === 'live' && match.status !== 'live') return false;
        if (selectedStatus === 'upcoming' && match.status !== 'scheduled') return false;
        if (selectedStatus === 'finished' && match.status !== 'finished') return false;
      }

      return true;
    });
  }, [selectedDate, selectedCountry, selectedLeague, selectedStatus]);

  // Agrupar partidas por liga
  const groupedMatches = useMemo(() => {
    type MatchStatus = 'scheduled' | 'live' | 'finished';
    const statusRank = (status: MatchStatus) => (status === 'live' ? 0 : status === 'scheduled' ? 1 : 2);
    const groups: Record<string, Match[]> = {};
    
    filteredMatches.forEach((match) => {
      const key = groupMode === 'championships' ? match.league : `${match.country} - ${match.league}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(match);
    });

    const sortMatches = (a: Match, b: Match) => {
      const rankA = statusRank(a.status as MatchStatus);
      const rankB = statusRank(b.status as MatchStatus);
      if (rankA !== rankB) return rankA - rankB;

      const timeA = new Date(a.date).getTime();
      const timeB = new Date(b.date).getTime();

      if (rankA === 2) return timeB - timeA;
      return timeA - timeB;
    };

    const entries = Object.entries(groups).map(([key, matches]) => {
      const sorted = [...matches].sort(sortMatches);
      return [key, sorted] as const;
    });

    const groupBestRank = (matches: Match[]) => Math.min(...matches.map((m) => statusRank(m.status as MatchStatus)));
    const groupBestTime = (matches: Match[]) => {
      const best = groupBestRank(matches);
      const times = matches
        .filter((m) => statusRank(m.status as MatchStatus) === best)
        .map((m) => new Date(m.date).getTime());
      return times.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...times);
    };

    entries.sort((a, b) => {
      const rankA = groupBestRank(a[1]);
      const rankB = groupBestRank(b[1]);
      if (rankA !== rankB) return rankA - rankB;
      return groupBestTime(a[1]) - groupBestTime(b[1]);
    });

    return entries;
  }, [filteredMatches, groupMode]);

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
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
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
        {groupedMatches.length === 0 ? (
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
            {groupedMatches.map(([leagueKey, matches]) => (
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
                        apiSource="mock"
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
        <div className="fixed inset-0 z-50 pointer-events-none">
          <DraggableWindow
            title="Análise Completa (Previsão)"
            onClose={() => setSelectedMatchId(null)}
            initialPosition={{ x: 80, y: 80 }}
            initialSize={{ width: 980, height: 760 }}
            zIndex={detailsZ}
            onFocus={() => {
              zRef.current += 1;
              setDetailsZ(zRef.current);
            }}
          >
            <PredictionDetails match={selectedMatch} prediction={selectedPrediction} />
          </DraggableWindow>
        </div>
      )}
    </div>
  );
}
