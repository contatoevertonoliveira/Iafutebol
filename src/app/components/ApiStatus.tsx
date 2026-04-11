import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { Badge } from './ui/badge';
import { loadApiConfig } from '../services/apiConfig';

export function ApiStatus() {
  const [hasFootballDataApi, setHasFootballDataApi] = useState(false);
  const [hasApiFootball, setHasApiFootball] = useState(false);
  const [hasOpenLigaDb, setHasOpenLigaDb] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const config = loadApiConfig();
      setHasFootballDataApi(Boolean(config?.footballDataApiKey?.trim()));
      setHasApiFootball(Boolean(config?.apiFootballKey?.trim()));
      setHasOpenLigaDb(config?.openLigaDbEnabled ?? true);
    };

    refresh();

    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === 'apiConfig') refresh();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    window.addEventListener('apiConfigChanged' as any, refresh as any);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('apiConfigChanged' as any, refresh as any);
    };
  }, []);

  if (!hasApiFootball && !hasFootballDataApi && !hasOpenLigaDb) {
    return (
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 mr-3" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-yellow-800 mb-1">
              APIs não configuradas
            </h3>
            <p className="text-sm text-yellow-700 mb-2">
              Configure suas APIs em <strong>Configurações</strong> para carregar dados reais de partidas.
            </p>
            <p className="text-xs text-yellow-600">
              Por enquanto, você está vendo dados de exemplo.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
      <div className="flex items-start">
        <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 mr-3" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-green-800 mb-2">
            APIs Ativas
          </h3>
          <div className="flex flex-wrap gap-2">
            {hasApiFootball && (
              <Badge className="bg-orange-100 text-orange-800 border-orange-300">
                <Wifi className="w-3 h-3 mr-1" />
                API-Football.com
              </Badge>
            )}
            {hasFootballDataApi && (
              <Badge className="bg-green-100 text-green-800 border-green-300">
                <Wifi className="w-3 h-3 mr-1" />
                Football-data.org
              </Badge>
            )}
            {hasOpenLigaDb && (
              <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                <Wifi className="w-3 h-3 mr-1" />
                OpenLigaDB
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ApiStatusIndicatorProps {
  isLoading?: boolean;
  error?: string | null;
  matchCount?: number;
}

export function ApiStatusIndicator({ isLoading, error, matchCount }: ApiStatusIndicatorProps) {
  if (isLoading) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
        <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
        Carregando dados da API...
      </div>
    );
  }

  if (error) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm">
        <WifiOff className="w-4 h-4" />
        Erro ao carregar dados
      </div>
    );
  }

  if (matchCount !== undefined && matchCount > 0) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm">
        <CheckCircle className="w-4 h-4" />
        {matchCount} partidas carregadas
      </div>
    );
  }

  return null;
}
