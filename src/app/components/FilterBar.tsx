import { Calendar, Globe, Loader2, Plus, RefreshCw, Trophy } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';

interface FilterBarProps {
  selectedDate: string;
  selectedCountry: string;
  selectedLeague: string;
  onDateChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onLeagueChange: (value: string) => void;
  countries: string[];
  leagues: string[];
  selectedStatus: 'all' | 'live' | 'upcoming' | 'finished';
  onStatusChange: (value: 'all' | 'live' | 'upcoming' | 'finished') => void;
  groupMode: 'leagues' | 'championships';
  onGroupModeChange: (value: 'leagues' | 'championships') => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onAddMatch?: () => void;
}

export function FilterBar({
  selectedDate,
  selectedCountry,
  selectedLeague,
  onDateChange,
  onCountryChange,
  onLeagueChange,
  countries,
  leagues,
  selectedStatus,
  onStatusChange,
  groupMode,
  onGroupModeChange,
  onRefresh,
  isRefreshing,
  onAddMatch,
}: FilterBarProps) {
  return (
    <div className="bg-white border-b border-gray-200 p-4 sticky top-0 z-10 shadow-sm">
      <div className="flex flex-wrap gap-4">
        {/* Filtro de Data */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            Período
          </label>
          <Select value={selectedDate} onValueChange={onDateChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as datas</SelectItem>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="tomorrow">Amanhã</SelectItem>
              <SelectItem value="week">Próximos 7 dias</SelectItem>
              <SelectItem value="fortnight">Próximos 15 dias</SelectItem>
              <SelectItem value="month">Próximos 30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filtro de País */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Globe className="w-4 h-4" />
            País
          </label>
          <Select value={selectedCountry} onValueChange={onCountryChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o país" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os países</SelectItem>
              {countries.map((country) => (
                <SelectItem key={country} value={country}>
                  {country}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Filtro de Liga */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
            <Trophy className="w-4 h-4" />
            Liga/Campeonato
          </label>
          <Select value={selectedLeague} onValueChange={onLeagueChange}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a liga" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as ligas</SelectItem>
              {leagues.map((league) => (
                <SelectItem key={league} value={league}>
                  {league}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="shrink-0 min-w-[180px] flex items-end gap-2">
          {onAddMatch ? (
            <Button variant="outline" onClick={onAddMatch} className="h-10">
              <Plus className="w-4 h-4 mr-2" />
              Adicionar jogo
            </Button>
          ) : null}
          {onRefresh ? (
            <Button onClick={onRefresh} disabled={isRefreshing} className="h-10">
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Atualizar
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold text-gray-600">Status</div>
          <Button
            size="sm"
            variant={selectedStatus === 'all' ? 'default' : 'outline'}
            onClick={() => onStatusChange('all')}
          >
            Todos
          </Button>
          <Button
            size="sm"
            variant={selectedStatus === 'live' ? 'default' : 'outline'}
            onClick={() => onStatusChange('live')}
          >
            Ao vivo
          </Button>
          <Button
            size="sm"
            variant={selectedStatus === 'upcoming' ? 'default' : 'outline'}
            onClick={() => onStatusChange('upcoming')}
          >
            Próximos
          </Button>
          <Button
            size="sm"
            variant={selectedStatus === 'finished' ? 'default' : 'outline'}
            onClick={() => onStatusChange('finished')}
          >
            Finalizados
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-semibold text-gray-600">Agrupar</div>
          <Button
            size="sm"
            variant={groupMode === 'leagues' ? 'default' : 'outline'}
            onClick={() => onGroupModeChange('leagues')}
          >
            Ligas
          </Button>
          <Button
            size="sm"
            variant={groupMode === 'championships' ? 'default' : 'outline'}
            onClick={() => onGroupModeChange('championships')}
          >
            Campeonatos
          </Button>
        </div>
      </div>

      {/* Stats rápidos */}
      <div className="mt-4 flex gap-4 text-sm">
        <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full font-semibold">
          <span className="text-blue-900">Partidas:</span> {selectedDate === 'today' ? 'Hoje' : 'Filtradas'}
        </div>
        <div className="px-3 py-1 bg-green-50 text-green-700 rounded-full font-semibold">
          <span className="text-green-900">Alta Confiança:</span> IA {'>'}80%
        </div>
      </div>
    </div>
  );
}
