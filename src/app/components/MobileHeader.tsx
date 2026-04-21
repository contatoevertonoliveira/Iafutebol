import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { Brain, CircleUser, RefreshCw } from 'lucide-react';

export function MobileHeader() {
  const location = useLocation();
  const showRefresh = useMemo(() => location.pathname === '/', [location.pathname]);

  return (
    <div className="sticky top-0 z-40 bg-white md:hidden">
      <div className="h-14 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="font-bold text-gray-900">AI Football</div>
        </div>
        <div className="flex items-center">
          {showRefresh && (
            <button
              className="p-2 rounded-md hover:bg-gray-100"
              aria-label="Atualizar partidas"
              title="Atualizar partidas"
              onClick={() => window.dispatchEvent(new CustomEvent('manualRefreshMatches'))}
            >
              <RefreshCw className="w-5 h-5 text-gray-700" />
            </button>
          )}
          <button className="p-2 rounded-md hover:bg-gray-100" aria-label="Perfil" title="Perfil">
            <CircleUser className="w-5 h-5 text-gray-700" />
          </button>
        </div>
      </div>
    </div>
  );
}
