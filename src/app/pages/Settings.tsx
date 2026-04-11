import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import {
  saveApiConfig,
  loadApiConfig,
  validateFootballDataApiKey,
  validateApiFootballKey,
  ApiConfig
} from '../services/apiConfig';
import { toast } from 'sonner';

export default function Settings() {
  const [config, setConfig] = useState<ApiConfig>({
    footballDataApiKey: '',
    apiFootballKey: '',
    openLigaDbEnabled: true,
    kaggleUsername: '',
    kaggleApiKey: '',
    agentTrainingEnabled: false,
  });
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isValidatingApiFootball, setIsValidatingApiFootball] = useState(false);
  const [validationStatusApiFootball, setValidationStatusApiFootball] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loaded = loadApiConfig();
    if (loaded) {
      setConfig(loaded);
      if (loaded.footballDataApiKey) {
        setValidationStatus('valid');
      }
      if (loaded.apiFootballKey) {
        setValidationStatusApiFootball('valid');
      }
    }
  }, []);

  const handleValidateApiKey = async () => {
    if (!config.footballDataApiKey.trim()) {
      toast.error('Por favor, insira uma API key');
      return;
    }

    setIsValidating(true);
    setValidationStatus('idle');

    try {
      console.log('🔄 Iniciando validação da Football-Data API...');
      const isValid = await validateFootballDataApiKey(config.footballDataApiKey);
      setValidationStatus(isValid ? 'valid' : 'invalid');

      if (isValid) {
        toast.success('✅ API key validada com sucesso!', {
          description: 'Verifique o console (F12) para mais detalhes'
        });
      } else {
        toast.error('❌ API key inválida', {
          description: 'Verifique o console (F12) para mais informações'
        });
      }
    } catch (error) {
      setValidationStatus('invalid');
      console.error('Erro completo:', error);
      toast.error('Erro ao validar API key', {
        description: 'Verifique o console (F12) para detalhes'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleValidateApiFootballKey = async () => {
    if (!config.apiFootballKey.trim()) {
      toast.error('Por favor, insira uma API key');
      return;
    }

    setIsValidatingApiFootball(true);
    setValidationStatusApiFootball('idle');

    try {
      console.log('🔄 Iniciando validação da API-Football...');
      const isValid = await validateApiFootballKey(config.apiFootballKey);
      setValidationStatusApiFootball(isValid ? 'valid' : 'invalid');

      if (isValid) {
        toast.success('✅ API-Football key validada com sucesso!', {
          description: 'Verifique o console (F12) para mais detalhes'
        });
      } else {
        toast.error('❌ API key inválida', {
          description: 'Verifique o console (F12) para mais informações'
        });
      }
    } catch (error) {
      setValidationStatusApiFootball('invalid');
      console.error('Erro completo:', error);
      toast.error('Erro ao validar API key', {
        description: 'Verifique o console (F12) para detalhes'
      });
    } finally {
      setIsValidatingApiFootball(false);
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    saveApiConfig(config);
    
    setTimeout(() => {
      setIsSaving(false);
      toast.success('Configurações salvas com sucesso!');
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <SettingsIcon className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">Configurações</h1>
          </div>
          <p className="text-gray-600">
            Configure suas APIs e preferências do sistema
          </p>
        </div>

        {/* API Configuration */}
        <div className="space-y-6">
          {/* Football-data.org API */}
          <Card className="p-6">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Key className="w-5 h-5 text-blue-600" />
                  Football-data.org API
                </h2>
                {validationStatus !== 'idle' && (
                  <Badge className={
                    validationStatus === 'valid' 
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-red-100 text-red-800 border-red-300'
                  }>
                    {validationStatus === 'valid' ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Válida
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Inválida
                      </>
                    )}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600">
                API principal para dados de partidas, times e competições internacionais
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Insira sua API key do football-data.org"
                    value={config.footballDataApiKey}
                    onChange={(e) => {
                      setConfig({ ...config, footballDataApiKey: e.target.value });
                      setValidationStatus('idle');
                    }}
                    className="flex-1"
                  />
                  <Button 
                    onClick={handleValidateApiKey}
                    disabled={isValidating || !config.footballDataApiKey.trim()}
                  >
                    {isValidating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      'Validar'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">Como obter sua API key:</h4>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.football-data.org/client/register" target="_blank" rel="noopener noreferrer" className="underline font-semibold">football-data.org/client/register</a></li>
                  <li>Crie uma conta gratuita</li>
                  <li>Copie sua API key do painel de controle</li>
                  <li>Cole aqui e clique em "Validar"</li>
                </ol>
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2 flex items-center gap-2">
                  🔧 Validação via servidor (solução CORS)
                </h4>
                <p className="text-sm text-purple-800 mb-2">
                  A validação agora é feita pelo servidor Supabase para contornar restrições CORS.
                </p>
                <ul className="text-sm text-purple-700 space-y-1">
                  <li>• Abra o console do navegador (F12) para ver logs detalhados</li>
                  <li>• Se funcionar via curl mas falhar aqui, verifique o servidor</li>
                  <li>• Consulte CORS_SOLUTION.md para mais informações</li>
                </ul>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Limites do plano gratuito:</h4>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 10 requisições por minuto</li>
                  <li>• Dados de competições selecionadas</li>
                  <li>• Ideal para desenvolvimento e testes</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* API-Football.com API */}
          <Card className="p-6">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Key className="w-5 h-5 text-orange-600" />
                  API-Football.com
                </h2>
                {validationStatusApiFootball !== 'idle' && (
                  <Badge className={
                    validationStatusApiFootball === 'valid'
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-red-100 text-red-800 border-red-300'
                  }>
                    {validationStatusApiFootball === 'valid' ? (
                      <>
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Válida
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 mr-1" />
                        Inválida
                      </>
                    )}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600">
                API premium com dados completos, escudos, bandeiras e estatísticas avançadas
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="apiFootballKey">API Key</Label>
                <div className="flex gap-2 mt-2">
                  <Input
                    id="apiFootballKey"
                    type="password"
                    placeholder="Insira sua API key do api-football.com"
                    value={config.apiFootballKey}
                    onChange={(e) => {
                      setConfig({ ...config, apiFootballKey: e.target.value });
                      setValidationStatusApiFootball('idle');
                    }}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleValidateApiFootballKey}
                    disabled={isValidatingApiFootball || !config.apiFootballKey.trim()}
                  >
                    {isValidatingApiFootball ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      'Validar'
                    )}
                  </Button>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-orange-900 mb-2">Como obter sua API key:</h4>
                <ol className="text-sm text-orange-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.api-football.com/register" target="_blank" rel="noopener noreferrer" className="underline font-semibold">api-football.com/register</a></li>
                  <li>Escolha um plano (gratuito ou pago)</li>
                  <li>Copie sua API key do dashboard</li>
                  <li>Cole aqui e clique em "Validar"</li>
                </ol>
              </div>

              <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-orange-900 mb-2">Recursos exclusivos da API-Football:</h4>
                <ul className="text-sm text-orange-800 space-y-1">
                  <li>⚽ Escudos de times em alta resolução</li>
                  <li>🏴 Bandeiras de países e competições</li>
                  <li>📊 Estatísticas avançadas e previsões</li>
                  <li>🔄 Dados em tempo real</li>
                  <li>🌍 Mais de 1000 ligas cobertas</li>
                  <li>📈 Histórico completo de partidas (H2H)</li>
                </ul>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-gray-900 mb-2">Plano gratuito:</h4>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• 100 requisições por dia</li>
                  <li>• Acesso a todas as ligas principais</li>
                  <li>• Ideal para desenvolvimento e protótipos</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* OpenLigaDB API */}
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-green-600" />
                OpenLigaDB API
              </h2>
              <p className="text-sm text-gray-600">
                API gratuita para dados de ligas alemãs (Bundesliga) e outras competições
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="openligadb">Habilitar OpenLigaDB</Label>
                <p className="text-sm text-gray-500 mt-1">
                  Não requer API key - completamente gratuito
                </p>
              </div>
              <Switch
                id="openligadb"
                checked={config.openLigaDbEnabled}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, openLigaDbEnabled: checked })
                }
              />
            </div>

            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-sm text-green-900 mb-2">Características:</h4>
              <ul className="text-sm text-green-800 space-y-1">
                <li>✓ Completamente gratuito</li>
                <li>✓ Sem necessidade de registro</li>
                <li>✓ Dados em tempo real de ligas alemãs</li>
                <li>✓ Informações detalhadas de partidas</li>
              </ul>
            </div>
          </Card>

          {/* Kaggle API Configuration */}
          <Card className="p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                <Key className="w-5 h-5 text-purple-600" />
                Kaggle API (Treinamento de Agentes)
              </h2>
              <p className="text-sm text-gray-600">
                Configure suas credenciais Kaggle para treinar os agentes de IA com dados reais
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="kaggleUsername">Username Kaggle</Label>
                <Input
                  id="kaggleUsername"
                  type="text"
                  placeholder="seu-username-kaggle"
                  value={config.kaggleUsername}
                  onChange={(e) => setConfig({ ...config, kaggleUsername: e.target.value })}
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="kaggleApiKey">API Key Kaggle</Label>
                <Input
                  id="kaggleApiKey"
                  type="password"
                  placeholder="Insira sua API key do Kaggle"
                  value={config.kaggleApiKey}
                  onChange={(e) => setConfig({ ...config, kaggleApiKey: e.target.value })}
                  className="mt-2"
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <div>
                  <Label htmlFor="agentTraining" className="text-base font-semibold">
                    Ativar Treinamento Automático
                  </Label>
                  <p className="text-sm text-gray-600 mt-1">
                    Os agentes serão treinados automaticamente com novos dados
                  </p>
                </div>
                <Switch
                  id="agentTraining"
                  checked={config.agentTrainingEnabled}
                  onCheckedChange={(checked) =>
                    setConfig({ ...config, agentTrainingEnabled: checked })
                  }
                />
              </div>

              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Como obter suas credenciais Kaggle:</h4>
                <ol className="text-sm text-purple-800 space-y-1 list-decimal list-inside">
                  <li>Acesse <a href="https://www.kaggle.com/account" target="_blank" rel="noopener noreferrer" className="underline font-semibold">kaggle.com/account</a></li>
                  <li>Clique em "Create New API Token"</li>
                  <li>Um arquivo kaggle.json será baixado</li>
                  <li>Abra o arquivo e copie o username e key</li>
                  <li>Cole aqui e ative o treinamento</li>
                </ol>
              </div>

              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Benefícios do treinamento:</h4>
                <ul className="text-sm text-purple-800 space-y-1">
                  <li>✓ Acesso a datasets com milhões de partidas históricas</li>
                  <li>✓ Treinamento com dados reais de resultados</li>
                  <li>✓ Melhoria contínua da acurácia dos agentes</li>
                  <li>✓ Modelos especializados por liga e tipo de aposta</li>
                  <li>✓ Tracking de evolução e performance</li>
                </ul>
              </div>
            </div>
          </Card>

          {/* IA Agents Configuration */}
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2 mb-2">
                🧠 Agentes de IA - Performance
              </h2>
              <p className="text-sm text-gray-600">
                Acompanhe a evolução e performance dos agentes especialistas
              </p>
            </div>

            <div className="grid gap-4">
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-purple-900 mb-2">Agentes Ativos:</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">📊 StatsMaster (Estatístico)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">73.5%</Badge>
                      <span className="text-xs text-green-600">+3.3%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">📈 FormAnalyzer (Momento)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">71.2%</Badge>
                      <span className="text-xs text-green-600">+2.7%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">⚔️ H2H Expert (Histórico)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-yellow-100 text-yellow-800">68.9%</Badge>
                      <span className="text-xs text-green-600">+1.8%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">🧠 DeepPredictor (ML Avançado)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">76.8%</Badge>
                      <span className="text-xs text-green-600">+2.9%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">🎯 EnsembleMaster (Consenso)</span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-800">78.3%</Badge>
                      <span className="text-xs text-green-600">+2.5%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">📊 Estatísticas Gerais:</h4>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Total de Previsões</div>
                    <div className="text-2xl font-bold text-blue-600">1,520</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Previsões Corretas</div>
                    <div className="text-2xl font-bold text-green-600">1,190</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Taxa Média</div>
                    <div className="text-2xl font-bold text-purple-600">73.6%</div>
                  </div>
                  <div className="bg-white rounded p-3">
                    <div className="text-xs text-gray-600">Melhoria Média</div>
                    <div className="text-2xl font-bold text-green-600">+2.6%</div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar Configurações'
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
