import { useMemo, useRef, useState, useEffect } from 'react';
import { 
  Play, Pause, StopCircle, RefreshCw, Download, 
  Bell, BellOff, Settings, BarChart3, Clock,
  CheckCircle, XCircle, AlertCircle
} from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { toast } from 'sonner';
import {
  trainingWorker,
  getTrainingAgentConfigs,
  loadTrainingSessions,
  loadNotificationConfig,
  saveNotificationConfig,
  loadIncrementalDatasets,
  downloadIncrementalDataset,
  getTrainingSummary,
  cleanupOldSessions,
  canResumeTraining,
  type TrainingSession,
  type NotificationConfig,
  type IncrementalDataset
} from '../services/optimizedTrainingService';

interface TrainingControlPanelProps {
  className?: string;
}

export default function TrainingControlPanel({ className = '' }: TrainingControlPanelProps) {
  const queueKey = 'training_queue_v1';
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [currentSession, setCurrentSession] = useState<TrainingSession | null>(null);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>(loadNotificationConfig());
  const [datasets, setDatasets] = useState<IncrementalDataset[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [summary, setSummary] = useState(getTrainingSummary());
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [trainingQueue, setTrainingQueue] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(queueKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const isStartingFromQueueRef = useRef(false);

  const agentConfigs = useMemo(() => getTrainingAgentConfigs(), []);

  // Atualizar dados periodicamente
  useEffect(() => {
    refreshData();
    
    const interval = setInterval(() => {
      refreshData();
    }, 5000); // Atualizar a cada 5 segundos
    
    return () => clearInterval(interval);
  }, []);

  const refreshData = () => {
    setSessions(loadTrainingSessions());
    setCurrentSession(trainingWorker.getCurrentSession());
    setDatasets(loadIncrementalDatasets());
    setSummary(getTrainingSummary());
  };

  useEffect(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(trainingQueue));
    } catch {}
  }, [trainingQueue]);

  useEffect(() => {
    if (isStartingFromQueueRef.current) return;
    if (currentSession) return;
    if (trainingQueue.length === 0) return;

    const nextAgentId = trainingQueue[0];
    isStartingFromQueueRef.current = true;
    void trainingWorker
      .startTraining(nextAgentId)
      .then(() => {
        toast.success(`Treinamento iniciado para ${nextAgentId}`);
        setTrainingQueue((q) => q.slice(1));
        refreshData();
      })
      .catch((error) => {
        toast.error(`Erro ao iniciar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        setTrainingQueue((q) => q.slice(1));
      })
      .finally(() => {
        isStartingFromQueueRef.current = false;
      });
  }, [currentSession, trainingQueue]);

  const enqueueAgents = (agentIds: string[]) => {
    const valid = agentIds.filter((id) => agentConfigs.some((c) => c.agentId === id));
    if (valid.length === 0) return;
    setTrainingQueue((q) => {
      const set = new Set(q);
      valid.forEach((id) => set.add(id));
      return Array.from(set);
    });
    toast.success(`${valid.length} agente(s) adicionado(s) à fila`);
  };

  const toggleSelected = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(agentId)) return prev.filter((id) => id !== agentId);
      return [...prev, agentId];
    });
  };

  const latestSessionByAgent = useMemo(() => {
    const map = new Map<string, TrainingSession>();
    for (const s of sessions) {
      const prev = map.get(s.agentId);
      if (!prev || new Date(s.startTime).getTime() > new Date(prev.startTime).getTime()) {
        map.set(s.agentId, s);
      }
    }
    return map;
  }, [sessions]);

  const handleStartTraining = async (agentId: string) => {
    try {
      const sessionId = await trainingWorker.startTraining(agentId);
      toast.success(`Treinamento iniciado para ${agentId}`);
      refreshData();
    } catch (error) {
      toast.error(`Erro ao iniciar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handlePauseTraining = async () => {
    try {
      await trainingWorker.pauseTraining();
      toast.info('Treinamento pausado');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao pausar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleResumeTraining = async () => {
    try {
      await trainingWorker.resumeTraining();
      toast.info('Treinamento retomado');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao retomar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleStopTraining = async () => {
    try {
      await trainingWorker.stopTraining();
      toast.warning('Treinamento interrompido');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao interromper treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleDownloadDataset = async (datasetId: string) => {
    setIsDownloading(true);
    try {
      const dataset = await downloadIncrementalDataset(datasetId);
      toast.success(`Dataset atualizado: ${dataset.newMatches} novas partidas`);
      setDatasets(loadIncrementalDatasets());
    } catch (error) {
      toast.error(`Erro ao baixar dataset: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleNotificationToggle = (key: keyof NotificationConfig) => {
    const newConfig = { ...notificationConfig, [key]: !notificationConfig[key] };
    setNotificationConfig(newConfig);
    saveNotificationConfig(newConfig);
    toast.success('Configurações de notificação atualizadas');
  };

  const handleCleanup = () => {
    cleanupOldSessions(7); // Manter apenas últimas 7 dias
    toast.info('Sessões antigas removidas');
    refreshData();
  };

  const getStatusColor = (status: TrainingSession['status']) => {
    switch (status) {
      case 'running': return 'bg-green-100 text-green-800 border-green-300';
      case 'paused': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'completed': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'failed': return 'bg-red-100 text-red-800 border-red-300';
      case 'stopped': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: TrainingSession['status']) => {
    switch (status) {
      case 'running': return <Play className="w-4 h-4" />;
      case 'paused': return <Pause className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'failed': return <XCircle className="w-4 h-4" />;
      case 'stopped': return <StopCircle className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Status do Worker */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Controle de Treinamento
          </h3>
          <Badge className={currentSession ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
            {currentSession ? 'Worker Ativo' : 'Worker Inativo'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Button
            onClick={() => enqueueAgents(selectedAgentIds)}
            disabled={selectedAgentIds.length === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Treinar selecionados
          </Button>
          <Button onClick={() => enqueueAgents(agentConfigs.map((c) => c.agentId))} variant="outline">
            <Play className="w-4 h-4 mr-2" />
            Treinar todos
          </Button>
          <Button onClick={() => setSelectedAgentIds([])} variant="outline">
            Limpar seleção
          </Button>
          <Button onClick={() => setTrainingQueue([])} variant="outline">
            Limpar fila
          </Button>

          <div className="flex-1" />

          <Button
            onClick={handlePauseTraining}
            disabled={!currentSession || currentSession.status !== 'running'}
            variant="outline"
            className="border-yellow-500 text-yellow-700 hover:bg-yellow-50"
          >
            <Pause className="w-4 h-4 mr-2" />
            Pausar
          </Button>

          <Button
            onClick={handleResumeTraining}
            disabled={!currentSession || !canResumeTraining(currentSession.sessionId)}
            variant="outline"
            className="border-blue-500 text-blue-700 hover:bg-blue-50"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retomar
          </Button>

          <Button
            onClick={handleStopTraining}
            disabled={!currentSession}
            variant="outline"
            className="border-red-500 text-red-700 hover:bg-red-50"
          >
            <StopCircle className="w-4 h-4 mr-2" />
            Parar
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="font-semibold text-gray-900 mb-2">Agentes</div>
            <div className="space-y-2">
              {agentConfigs.map((cfg) => {
                const checked = selectedAgentIds.includes(cfg.agentId);
                const latest = latestSessionByAgent.get(cfg.agentId) ?? null;
                return (
                  <div key={cfg.agentId} className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(cfg.agentId)}
                      />
                      <span className="font-medium text-gray-900 truncate">{cfg.name}</span>
                      <span className="text-xs text-gray-500 truncate">({cfg.maxEpochs} épocas)</span>
                    </label>

                    <div className="flex items-center gap-2 shrink-0">
                      {latest && (
                        <Badge className={getStatusColor(latest.status)}>
                          {getStatusIcon(latest.status)}
                          <span className="ml-1">{latest.status}</span>
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          if (currentSession) enqueueAgents([cfg.agentId]);
                          else void handleStartTraining(cfg.agentId);
                        }}
                        disabled={!!currentSession && trainingQueue.includes(cfg.agentId)}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Treinar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-gray-900">Fila</div>
              <Badge variant="outline">{trainingQueue.length}</Badge>
            </div>
            {trainingQueue.length === 0 ? (
              <div className="text-sm text-gray-600">Nenhum agente na fila.</div>
            ) : (
              <div className="space-y-2">
                {trainingQueue.map((agentId, idx) => {
                  const cfg = agentConfigs.find((c) => c.agentId === agentId);
                  return (
                    <div key={`${agentId}-${idx}`} className="flex items-center justify-between">
                      <div className="text-sm text-gray-900">
                        {idx + 1}. {cfg?.name ?? agentId}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTrainingQueue((q) => q.filter((id, i) => !(i === idx && id === agentId)))}
                      >
                        Remover
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sessão Atual */}
        {currentSession && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-gray-900">{currentSession.agentId}</h4>
                <p className="text-sm text-gray-600">
                  Sessão: {currentSession.sessionId.substring(0, 8)}...
                </p>
              </div>
              <Badge className={getStatusColor(currentSession.status)}>
                {getStatusIcon(currentSession.status)}
                <span className="ml-1">{currentSession.status}</span>
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso:</span>
                <span>{currentSession.completedEpochs}/{currentSession.totalEpochs} épocas</span>
              </div>
              <Progress 
                value={(currentSession.completedEpochs / currentSession.totalEpochs) * 100} 
                className="h-2"
              />
              
              <div className="flex justify-between text-sm">
                <span>Melhor Accuracy:</span>
                <span className="font-semibold">{currentSession.bestAccuracy.toFixed(2)}%</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span>Checkpoints:</span>
                <span>{currentSession.checkpoints.length} salvos</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Estatísticas */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5" />
          Estatísticas de Treinamento
        </h3>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="text-sm text-blue-700 mb-1">Sessões Totais</div>
            <div className="text-2xl font-bold text-blue-900">{summary.totalSessions}</div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="text-sm text-green-700 mb-1">Concluídas</div>
            <div className="text-2xl font-bold text-green-900">{summary.completedSessions}</div>
          </div>
          
          <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
            <div className="text-sm text-yellow-700 mb-1">Tempo Total</div>
            <div className="text-2xl font-bold text-yellow-900">{summary.totalTrainingTime}h</div>
          </div>
          
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <div className="text-sm text-purple-700 mb-1">Melhoria Média</div>
            <div className="text-2xl font-bold text-purple-900">+{summary.averageAccuracyImprovement}%</div>
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={handleCleanup}>
            Limpar Sessões Antigas
          </Button>
        </div>
      </Card>

      {/* Datasets Incrementais */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          <Download className="w-5 h-5" />
          Datasets Incrementais
        </h3>
        
        <div className="space-y-4">
          {datasets.map(dataset => (
            <div key={dataset.datasetId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
              <div>
                <h4 className="font-semibold">{dataset.name}</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>Total: {dataset.totalMatches.toLocaleString()} partidas</div>
                  <div>Novas: {dataset.newMatches.toLocaleString()} partidas</div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Último download: {new Date(dataset.lastDownloaded).toLocaleDateString()}
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-2">
                <Badge className={dataset.incrementalUpdates ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                  {dataset.incrementalUpdates ? 'Incremental' : 'Completo'}
                </Badge>
                <Button 
                  size="sm" 
                  onClick={() => handleDownloadDataset(dataset.datasetId)}
                  disabled={isDownloading}
                >
                  {isDownloading ? 'Baixando...' : 'Atualizar'}
                </Button>
              </div>
            </div>
          ))}
          
          {datasets.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Download className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum dataset configurado</p>
              <p className="text-sm mt-1">Configure o Kaggle API para começar</p>
            </div>
          )}
        </div>
      </Card>

      {/* Notificações */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          {notificationConfig.enableToast ? (
            <Bell className="w-5 h-5 text-green-600" />
          ) : (
            <BellOff className="w-5 h-5 text-gray-400" />
          )}
          Configurações de Notificação
        </h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="toast-notifications" className="font-semibold">
                Notificações Toast
              </Label>
              <p className="text-sm text-gray-600">Mostrar notificações no navegador</p>
            </div>
            <Switch
              id="toast-notifications"
              checked={notificationConfig.enableToast}
              onCheckedChange={() => handleNotificationToggle('enableToast')}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-complete" className="font-semibold">
                Notificar Conclusão
              </Label>
              <p className="text-sm text-gray-600">Quando treinamento for concluído</p>
            </div>
            <Switch
              id="notify-complete"
              checked={notificationConfig.notifyOnComplete}
              onCheckedChange={() => handleNotificationToggle('notifyOnComplete')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-error" className="font-semibold">
                Notificar Erros
              </Label>
              <p className="text-sm text-gray-600">Quando ocorrer erro no treinamento</p>
            </div>
            <Switch
              id="notify-error"
              checked={notificationConfig.notifyOnError}
              onCheckedChange={() => handleNotificationToggle('notifyOnError')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-early-stop" className="font-semibold">
                Notificar Early Stopping
              </Label>
              <p className="text-sm text-gray-600">Quando early stopping for ativado</p>
            </div>
            <Switch
              id="notify-early-stop"
              checked={notificationConfig.notifyOnEarlyStop}
              onCheckedChange={() => handleNotificationToggle('notifyOnEarlyStop')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
        </div>
      </Card>

      {/* Histórico de Sessões */}
      <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">Histórico de Sessões</h3>
        
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {sessions.slice().reverse().map(session => (
            <div key={session.sessionId} className="p-3 border rounded-lg hover:bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(session.status)}
                  <span className="font-semibold">{session.agentId}</span>
                  <Badge className={getStatusColor(session.status)}>
                    {session.status}
                  </Badge>
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(session.startTime).toLocaleDateString()}
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Épocas:</span>{' '}
                  <span className="font-semibold">{session.completedEpochs}/{session.totalEpochs}</span>
                </div>
                <div>
                  <span className="text-gray-600">Accuracy:</span>{' '}
                  <span className="font-semibold">{session.bestAccuracy.toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-gray-600">Checkpoints:</span>{' '}
                  <span className="font-semibold">{session.checkpoints.length}</span>
                </div>
                <div>
                  <span className="text-gray-600">Duração:</span>{' '}
                  <span className="font-semibold">
                    {session.endTime ? (
                      `${Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000)}min`
                    ) : 'Em andamento'}
                  </span>
                </div>
              </div>
              
              {session.checkpoints.length > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Primeiro checkpoint: {session.checkpoints[0].accuracy.toFixed(2)}%</span>
                    <span>Último checkpoint: {session.checkpoints[session.checkpoints.length - 1].accuracy.toFixed(2)}%</span>
                  </div>
                  <Progress 
                    value={((session.checkpoints.length * session.config.checkpointInterval) / session.totalEpochs) * 100}
                    className="h-1"
                  />
                </div>
              )}
            </div>
          ))}
          
          {sessions.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhuma sessão de treinamento registrada</p>
              <p className="text-sm mt-1">Inicie um treinamento para ver o histórico</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
