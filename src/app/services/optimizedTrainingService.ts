import { loadApiConfig, saveApiConfig } from './apiConfig';
import { toast } from 'sonner';
import { getTrainingSamplesCountFromServer, pushLocalMetaModelToServer, trainMetaModelFromLocalSamples } from './aiAgents';

// ==================== TIPOS E INTERFACES ====================

export interface AgentTrainingConfig {
  agentId: string;
  name: string;
  maxEpochs: number;
  checkpointInterval: number; // Salvar a cada N épocas
  earlyStoppingPatience: number; // Parar se não melhorar em N épocas
  minImprovement: number; // Melhoria mínima para continuar
  batchSize: number;
  learningRate: number;
}

export interface TrainingCheckpoint {
  epoch: number;
  accuracy: number;
  loss: number;
  timestamp: string;
  modelState: any; // Estado do modelo serializado
  optimizerState: any; // Estado do otimizador
}

export interface TrainingSession {
  sessionId: string;
  agentId: string;
  startTime: string;
  endTime: string | null;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
  totalEpochs: number;
  completedEpochs: number;
  bestAccuracy: number;
  checkpoints: TrainingCheckpoint[];
  datasetVersion: string;
  simulated?: boolean;
  errorMessage?: string;
  config: AgentTrainingConfig;
}

export interface IncrementalDataset {
  datasetId: string;
  name: string;
  lastDownloaded: string;
  totalMatches: number;
  newMatches: number;
  version: string;
  incrementalUpdates: boolean;
}

export interface NotificationConfig {
  enableToast: boolean;
  enableEmail: boolean;
  enableSlack: boolean;
  emailAddress: string;
  slackWebhook: string;
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  notifyOnEarlyStop: boolean;
}

// ==================== CONFIGURAÇÕES ====================

const TRAINING_SESSIONS_KEY = 'training_sessions';
const TRAINING_CHECKPOINTS_KEY = 'training_checkpoints';
const INCREMENTAL_DATASETS_KEY = 'incremental_datasets';
const NOTIFICATION_CONFIG_KEY = 'notification_config';
const WORKER_STATUS_KEY = 'training_worker_status';

const isQuotaExceededError = (error: unknown) => {
  const e = error as any;
  const name = String(e?.name ?? '');
  const msg = String(e?.message ?? '');
  return name === 'QuotaExceededError' || msg.toLowerCase().includes('exceeded the quota');
};

const clampSessionForStorage = (s: TrainingSession, maxCheckpoints: number): TrainingSession => {
  const cps = Array.isArray(s.checkpoints) ? s.checkpoints : [];
  return {
    ...s,
    checkpoints: cps.length > maxCheckpoints ? cps.slice(-maxCheckpoints) : cps,
  };
};

const persistSessionsWithBackoff = (sessions: TrainingSession[]): void => {
  const variants: Array<{ maxSessions: number; maxCheckpoints: number }> = [
    { maxSessions: 200, maxCheckpoints: 25 },
    { maxSessions: 80, maxCheckpoints: 15 },
    { maxSessions: 40, maxCheckpoints: 8 },
    { maxSessions: 20, maxCheckpoints: 4 },
    { maxSessions: 10, maxCheckpoints: 2 },
  ];

  for (const v of variants) {
    try {
      const sliced = sessions.slice(-v.maxSessions).map((s) => clampSessionForStorage(s, v.maxCheckpoints));
      localStorage.setItem(TRAINING_SESSIONS_KEY, JSON.stringify(sliced));
      return;
    } catch (e) {
      if (!isQuotaExceededError(e)) throw e;
    }
  }

  try {
    localStorage.removeItem(TRAINING_SESSIONS_KEY);
  } catch {}
};

// Configurações padrão dos agentes
const DEFAULT_AGENT_CONFIGS: AgentTrainingConfig[] = [
  {
    agentId: 'statsmaster',
    name: 'StatsMaster',
    maxEpochs: 200,
    checkpointInterval: 10,
    earlyStoppingPatience: 20,
    minImprovement: 0.001,
    batchSize: 32,
    learningRate: 0.01,
  },
  {
    agentId: 'formanalyzer',
    name: 'FormAnalyzer',
    maxEpochs: 150,
    checkpointInterval: 10,
    earlyStoppingPatience: 15,
    minImprovement: 0.001,
    batchSize: 64,
    learningRate: 0.02,
  },
  {
    agentId: 'h2hexpert',
    name: 'H2H Expert',
    maxEpochs: 100,
    checkpointInterval: 5,
    earlyStoppingPatience: 10,
    minImprovement: 0.002,
    batchSize: 128,
    learningRate: 0.03,
  },
  {
    agentId: 'deeppredictor',
    name: 'DeepPredictor',
    maxEpochs: 300,
    checkpointInterval: 25,
    earlyStoppingPatience: 30,
    minImprovement: 0.0005,
    batchSize: 16,
    learningRate: 0.001,
  },
  {
    agentId: 'ensemblemaster',
    name: 'EnsembleMaster',
    maxEpochs: 50,
    checkpointInterval: 5,
    earlyStoppingPatience: 10,
    minImprovement: 0.001,
    batchSize: 256,
    learningRate: 0.05,
  },
  {
    agentId: 'goalsoverunder',
    name: 'GoalLine',
    maxEpochs: 180,
    checkpointInterval: 10,
    earlyStoppingPatience: 18,
    minImprovement: 0.001,
    batchSize: 64,
    learningRate: 0.015,
  },
  {
    agentId: 'bttsspecialist',
    name: 'BTTS Scout',
    maxEpochs: 170,
    checkpointInterval: 10,
    earlyStoppingPatience: 17,
    minImprovement: 0.001,
    batchSize: 64,
    learningRate: 0.016,
  },
  {
    agentId: 'metamodel',
    name: 'MetaModel',
    maxEpochs: 60,
    checkpointInterval: 5,
    earlyStoppingPatience: 12,
    minImprovement: 0.001,
    batchSize: 256,
    learningRate: 0.05,
  },
  {
    agentId: 'correctscore',
    name: 'ScoreOracle',
    maxEpochs: 220,
    checkpointInterval: 10,
    earlyStoppingPatience: 22,
    minImprovement: 0.001,
    batchSize: 32,
    learningRate: 0.012,
  },
];

export function getTrainingAgentConfigs(): AgentTrainingConfig[] {
  return DEFAULT_AGENT_CONFIGS.slice();
}

function readLocalTrainingSampleCountForAgent(agentId: string): number {
  const agentNameById: Record<string, string> = {
    statsmaster: 'StatsMaster',
    formanalyzer: 'FormAnalyzer',
    h2hexpert: 'H2H Expert',
    deeppredictor: 'DeepPredictor',
    ensemblemaster: 'EnsembleMaster',
    goalsoverunder: 'GoalLine',
    bttsspecialist: 'BTTS Scout',
    correctscore: 'ScoreOracle',
  };

  if (agentId === 'metamodel') {
    try {
      const raw = localStorage.getItem('training_samples_v1');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { version: number; items: Record<string, any> };
      if (!parsed || parsed.version !== 1 || !parsed.items) return 0;
      return Object.keys(parsed.items).length;
    } catch {
      return 0;
    }
  }

  const agentName = agentNameById[agentId];
  if (!agentName) return 0;

  const today = new Date().toISOString().slice(0, 10);

  try {
    const raw = localStorage.getItem('training_samples_v1');
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { version: number; items: Record<string, any> };
    if (!parsed || parsed.version !== 1 || !parsed.items) return 0;
    const items = Object.values(parsed.items);

    let count = 0;
    for (const s of items) {
      if (!s || typeof s !== 'object') continue;
      if (typeof s.day !== 'string') continue;
      if (s.day >= today) continue;
      const preds = Array.isArray(s.agentPredictions) ? s.agentPredictions : [];
      if (preds.some((p: any) => p && p.agentName === agentName)) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

// Configuração padrão de notificações
const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enableToast: true,
  enableEmail: false,
  enableSlack: false,
  emailAddress: '',
  slackWebhook: '',
  notifyOnComplete: true,
  notifyOnError: true,
  notifyOnEarlyStop: true,
};

// ==================== GERENCIAMENTO DE SESSÕES ====================

export function loadTrainingSessions(): TrainingSession[] {
  const stored = localStorage.getItem(TRAINING_SESSIONS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveTrainingSessions(sessions: TrainingSession[]): void {
  try {
    persistSessionsWithBackoff(sessions);
  } catch {
    try {
      localStorage.removeItem(TRAINING_SESSIONS_KEY);
    } catch {}
  }
}

export function createTrainingSession(agentId: string): TrainingSession {
  const config = DEFAULT_AGENT_CONFIGS.find(c => c.agentId === agentId);
  if (!config) {
    throw new Error(`Configuração não encontrada para agente ${agentId}`);
  }

  const session: TrainingSession = {
    sessionId: `train_${agentId}_${Date.now()}`,
    agentId,
    startTime: new Date().toISOString(),
    endTime: null,
    status: 'pending',
    totalEpochs: config.maxEpochs,
    completedEpochs: 0,
    bestAccuracy: 0,
    checkpoints: [],
    datasetVersion: 'latest',
    simulated: agentId !== 'metamodel',
    errorMessage: undefined,
    config,
  };

  const sessions = loadTrainingSessions();
  sessions.push(session);
  saveTrainingSessions(sessions);

  return session;
}

export function updateTrainingSession(sessionId: string, updates: Partial<TrainingSession>): void {
  const sessions = loadTrainingSessions();
  const index = sessions.findIndex(s => s.sessionId === sessionId);
  
  if (index !== -1) {
    sessions[index] = { ...sessions[index], ...updates };
    saveTrainingSessions(sessions);
  }
}

// ==================== CHECKPOINTS ====================

export function saveCheckpoint(sessionId: string, checkpoint: TrainingCheckpoint): void {
  const sessions = loadTrainingSessions();
  const sessionIndex = sessions.findIndex(s => s.sessionId === sessionId);
  
  if (sessionIndex !== -1) {
    const cps = Array.isArray(sessions[sessionIndex].checkpoints) ? sessions[sessionIndex].checkpoints : [];
    cps.push(checkpoint);
    sessions[sessionIndex].checkpoints = cps.length > 25 ? cps.slice(-25) : cps;
    saveTrainingSessions(sessions);
    
    // Também salvar em storage separado para backup
    const allCheckpoints = loadAllCheckpoints();
    allCheckpoints.push({ sessionId, ...checkpoint });
    const trimmed = allCheckpoints.length > 2000 ? allCheckpoints.slice(-2000) : allCheckpoints;
    try {
      localStorage.setItem(TRAINING_CHECKPOINTS_KEY, JSON.stringify(trimmed));
    } catch (e) {
      if (isQuotaExceededError(e)) {
        try {
          localStorage.setItem(TRAINING_CHECKPOINTS_KEY, JSON.stringify(trimmed.slice(-500)));
        } catch {}
      }
    }
  }
}

export function loadAllCheckpoints(): Array<{ sessionId: string } & TrainingCheckpoint> {
  const stored = localStorage.getItem(TRAINING_CHECKPOINTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function getLatestCheckpoint(sessionId: string): TrainingCheckpoint | null {
  const sessions = loadTrainingSessions();
  const session = sessions.find(s => s.sessionId === sessionId);
  
  if (!session || session.checkpoints.length === 0) {
    return null;
  }
  
  return session.checkpoints[session.checkpoints.length - 1];
}

// ==================== DATASETS INCREMENTAIS ====================

export function loadIncrementalDatasets(): IncrementalDataset[] {
  const stored = localStorage.getItem(INCREMENTAL_DATASETS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveIncrementalDatasets(datasets: IncrementalDataset[]): void {
  localStorage.setItem(INCREMENTAL_DATASETS_KEY, JSON.stringify(datasets));
}

export async function downloadIncrementalDataset(datasetId: string): Promise<IncrementalDataset> {
  const config = loadApiConfig();
  if (!config?.kaggleUsername || !config?.kaggleApiKey) {
    throw new Error('Credenciais do Kaggle não configuradas');
  }

  const datasets = loadIncrementalDatasets();
  const existingDataset = datasets.find(d => d.datasetId === datasetId);
  
  // Simular download incremental
  // Em produção, isso faria uma chamada à API do Kaggle
  // e compararia com a versão local para baixar apenas novos dados
  
  const newDataset: IncrementalDataset = {
    datasetId,
    name: 'European Soccer Database',
    lastDownloaded: new Date().toISOString(),
    totalMatches: existingDataset ? existingDataset.totalMatches + 500 : 25000,
    newMatches: existingDataset ? 500 : 25000,
    version: `v${Date.now()}`,
    incrementalUpdates: true,
  };

  // Atualizar ou adicionar dataset
  if (existingDataset) {
    const index = datasets.findIndex(d => d.datasetId === datasetId);
    datasets[index] = newDataset;
  } else {
    datasets.push(newDataset);
  }
  
  saveIncrementalDatasets(datasets);
  
  return newDataset;
}

// ==================== NOTIFICAÇÕES ====================

export function loadNotificationConfig(): NotificationConfig {
  const stored = localStorage.getItem(NOTIFICATION_CONFIG_KEY);
  return stored ? JSON.parse(stored) : DEFAULT_NOTIFICATION_CONFIG;
}

export function saveNotificationConfig(config: NotificationConfig): void {
  localStorage.setItem(NOTIFICATION_CONFIG_KEY, JSON.stringify(config));
}

export function sendNotification(type: 'complete' | 'error' | 'earlyStop', message: string, session?: TrainingSession): void {
  const config = loadNotificationConfig();
  
  // Toast notifications (sempre no navegador)
  if (config.enableToast) {
    switch (type) {
      case 'complete':
        toast.success(message, {
          duration: 5000,
          description: session ? `Agente: ${session.agentId}` : undefined,
        });
        break;
      case 'error':
        toast.error(message, {
          duration: 10000,
          description: session ? `Sessão: ${session.sessionId}` : undefined,
        });
        break;
      case 'earlyStop':
        toast.warning(message, {
          duration: 7000,
          description: session ? `Melhor accuracy: ${session.bestAccuracy.toFixed(2)}%` : undefined,
        });
        break;
    }
  }
  
  // Email notifications (simulado - em produção usaria API de email)
  if (config.enableEmail && config.emailAddress) {
    console.log(`📧 Email enviado para ${config.emailAddress}: ${message}`);
    // Aqui integraria com serviço de email como SendGrid, AWS SES, etc.
  }
  
  // Slack notifications (simulado - em produção usaria webhook)
  if (config.enableSlack && config.slackWebhook) {
    console.log(`💬 Slack webhook chamado: ${message}`);
    // fetch(config.slackWebhook, { method: 'POST', body: JSON.stringify({ text: message }) })
  }
}

// ==================== WORKER EM BACKGROUND ====================

interface WorkerStatus {
  isRunning: boolean;
  currentSessionId: string | null;
  lastUpdate: string;
  performance: {
    epochsPerMinute: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

export function loadWorkerStatus(): WorkerStatus {
  const stored = localStorage.getItem(WORKER_STATUS_KEY);
  return stored ? JSON.parse(stored) : {
    isRunning: false,
    currentSessionId: null,
    lastUpdate: new Date().toISOString(),
    performance: { epochsPerMinute: 0, memoryUsage: 0, cpuUsage: 0 },
  };
}

export function saveWorkerStatus(status: WorkerStatus): void {
  localStorage.setItem(WORKER_STATUS_KEY, JSON.stringify(status));
}

export class TrainingWorker {
  private isRunning = false;
  private currentSessionId: string | null = null;
  private abortController: AbortController | null = null;

  async startTraining(agentId: string): Promise<string> {
    if (this.isRunning) {
      throw new Error('Já existe um treinamento em andamento');
    }

    // Criar nova sessão
    const session = createTrainingSession(agentId);
    this.currentSessionId = session.sessionId;
    this.isRunning = true;
    
    // Atualizar status do worker
    saveWorkerStatus({
      isRunning: true,
      currentSessionId: session.sessionId,
      lastUpdate: new Date().toISOString(),
      performance: { epochsPerMinute: 0, memoryUsage: 0, cpuUsage: 0 },
    });

    // Iniciar treinamento em background (não bloqueia UI)
    this.runTrainingInBackground(session.sessionId).catch(error => {
      console.error('Erro no treinamento:', error);
      const msg = error instanceof Error ? error.message : String(error);
      updateTrainingSession(session.sessionId, { 
        status: 'failed',
        endTime: new Date().toISOString(),
        errorMessage: msg
      });
      sendNotification('error', `Treinamento falhou: ${msg}`, session);
    });

    return session.sessionId;
  }

  async pauseTraining(): Promise<void> {
    if (!this.isRunning || !this.currentSessionId) {
      throw new Error('Nenhum treinamento em andamento para pausar');
    }

    this.isRunning = false;
    if (this.abortController) {
      this.abortController.abort();
    }

    updateTrainingSession(this.currentSessionId, { status: 'paused' });
    saveWorkerStatus({
      isRunning: false,
      currentSessionId: this.currentSessionId,
      lastUpdate: new Date().toISOString(),
      performance: { epochsPerMinute: 0, memoryUsage: 0, cpuUsage: 0 },
    });

    sendNotification('earlyStop', 'Treinamento pausado pelo usuário');
  }

  async resumeTraining(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error('Nenhuma sessão para retomar');
    }

    const sessions = loadTrainingSessions();
    const session = sessions.find(s => s.sessionId === this.currentSessionId);
    
    if (!session) {
      throw new Error('Sessão não encontrada');
    }

    if (session.status !== 'paused') {
      throw new Error('Sessão não está pausada');
    }

    this.isRunning = true;
    this.runTrainingInBackground(session.sessionId).catch(error => {
      console.error('Erro ao retomar treinamento:', error);
      const msg = error instanceof Error ? error.message : String(error);
      updateTrainingSession(session.sessionId, { 
        status: 'failed',
        endTime: new Date().toISOString(),
        errorMessage: msg
      });
      sendNotification('error', `Falha ao retomar treinamento: ${msg}`, session);
    });
  }

  async stopTraining(): Promise<void> {
    this.isRunning = false;
    
    if (this.abortController) {
      this.abortController.abort();
    }

    if (this.currentSessionId) {
      updateTrainingSession(this.currentSessionId, { 
        status: 'stopped',
        endTime: new Date().toISOString()
      });
    }

    saveWorkerStatus({
      isRunning: false,
      currentSessionId: null,
      lastUpdate: new Date().toISOString(),
      performance: { epochsPerMinute: 0, memoryUsage: 0, cpuUsage: 0 },
    });

    sendNotification('earlyStop', 'Treinamento interrompido pelo usuário');
  }

  private async runTrainingInBackground(sessionId: string): Promise<void> {
    const sessions = loadTrainingSessions();
    const session = sessions.find(s => s.sessionId === sessionId);
    
    if (!session) {
      throw new Error('Sessão não encontrada');
    }

    // Atualizar status para running
    updateTrainingSession(sessionId, { status: 'running', errorMessage: undefined });

    // Configurar abort controller para permitir pausa/interrupção
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Variáveis para early stopping
    let bestAccuracy = session.bestAccuracy;
    let epochsWithoutImprovement = 0;
    const config = session.config;

    try {
      if (session.agentId === 'metamodel') {
        const serverCount = await getTrainingSamplesCountFromServer();
        const sampleCount = serverCount ?? readLocalTrainingSampleCountForAgent('metamodel');
        if (sampleCount < 30) {
          throw new Error(`Dados insuficientes para treino real. Amostras com resultado: ${sampleCount}`);
        }

        let best = bestAccuracy;
        await trainMetaModelFromLocalSamples({
          epochs: config.maxEpochs,
          learningRate: config.learningRate,
          signal,
          onEpoch: ({ epoch, epochs, winnerAcc, bttsAcc, overUnderAcc }) => {
            const acc = (winnerAcc + bttsAcc + overUnderAcc) / 3;
            if (acc > best) {
              best = acc;
              epochsWithoutImprovement = 0;
            } else {
              epochsWithoutImprovement += 1;
            }

            updateTrainingSession(sessionId, {
              completedEpochs: epoch,
              bestAccuracy: best,
              simulated: false,
            });

            if (epoch % config.checkpointInterval === 0 || epoch === epochs) {
              const checkpoint: TrainingCheckpoint = {
                epoch,
                accuracy: acc,
                loss: 1 - acc / 100,
                timestamp: new Date().toISOString(),
                modelState: { winnerAcc, bttsAcc, overUnderAcc },
                optimizerState: { learningRate: config.learningRate },
              };
              saveCheckpoint(sessionId, checkpoint);
            }

            if (epochsWithoutImprovement >= config.earlyStoppingPatience) {
              updateTrainingSession(sessionId, {
                status: 'completed',
                endTime: new Date().toISOString(),
              });
            }
          },
        });

        updateTrainingSession(sessionId, {
          status: 'completed',
          endTime: new Date().toISOString(),
          bestAccuracy: best,
          simulated: false,
        });

        await pushLocalMetaModelToServer().catch(() => {});

        const finalSession = loadTrainingSessions().find((s) => s.sessionId === sessionId);
        if (finalSession && finalSession.status === 'completed') {
          sendNotification(
            'complete',
            `Treinamento real (MetaModel) concluído! Accuracy validação: ${finalSession.bestAccuracy.toFixed(2)}%`,
            finalSession,
          );
        }

        return;
      }

      let dataset: IncrementalDataset | null = null;
      try {
        dataset = await downloadIncrementalDataset('european-soccer-database');
        console.log(`📊 Dataset: ${dataset.totalMatches} partidas (${dataset.newMatches} novas)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Dataset incremental indisponível: ${msg}`);
      }

      // Loop de treinamento
      for (let epoch = session.completedEpochs + 1; epoch <= config.maxEpochs; epoch++) {
        // Verificar se foi abortado
        if (signal.aborted) {
          console.log('Treinamento abortado');
          return;
        }

        // Simular treinamento de uma época
        await this.trainEpoch(epoch, sessionId, config);

        // Calcular accuracy (simulada)
        const accuracy = this.calculateSimulatedAccuracy(epoch, config);
        
        // Atualizar melhor accuracy
        if (accuracy > bestAccuracy) {
          bestAccuracy = accuracy;
          epochsWithoutImprovement = 0;
        } else {
          epochsWithoutImprovement++;
        }

        // Atualizar sessão
        updateTrainingSession(sessionId, {
          completedEpochs: epoch,
          bestAccuracy,
        });

        // Salvar checkpoint a cada N épocas
        if (epoch % config.checkpointInterval === 0 || epoch === config.maxEpochs) {
          const checkpoint: TrainingCheckpoint = {
            epoch,
            accuracy,
            loss: 1 - accuracy / 100, // Simulação de loss
            timestamp: new Date().toISOString(),
            modelState: { epoch, accuracy }, // Em produção seria o estado real do modelo
            optimizerState: { learningRate: config.learningRate },
          };
          
          saveCheckpoint(sessionId, checkpoint);
          console.log(`💾 Checkpoint salvo (época ${epoch}, accuracy: ${accuracy.toFixed(2)}%)`);
        }

        // Verificar early stopping
        if (epochsWithoutImprovement >= config.earlyStoppingPatience) {
          console.log(`🛑 Early stopping ativado (sem melhoria por ${epochsWithoutImprovement} épocas)`);
          updateTrainingSession(sessionId, {
            status: 'completed',
            endTime: new Date().toISOString(),
          });
          
          sendNotification('earlyStop', 
            `Early stopping ativado para ${session.agentId}. Melhor accuracy: ${bestAccuracy.toFixed(2)}%`,
            session
          );
          break;
        }

        // Atualizar status do worker periodicamente
        if (epoch % 5 === 0) {
          saveWorkerStatus({
            isRunning: true,
            currentSessionId: sessionId,
            lastUpdate: new Date().toISOString(),
            performance: {
              epochsPerMinute: 12, // Simulado
              memoryUsage: Math.random() * 500 + 100, // MB
              cpuUsage: Math.random() * 30 + 10, // %
            },
          });
        }

        // Pequena pausa para não bloquear a UI
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Se completou todas as épocas sem early stopping
      if (session.status !== 'completed') {
        updateTrainingSession(sessionId, {
          status: 'completed',
          endTime: new Date().toISOString(),
        });
      }

      // Notificação de conclusão
      const finalSession = loadTrainingSessions().find(s => s.sessionId === sessionId);
      if (finalSession && finalSession.status === 'completed') {
        sendNotification('complete',
          `Treinamento de ${session.agentId} concluído! Accuracy final: ${finalSession.bestAccuracy.toFixed(2)}%`,
          finalSession
        );
      }

      console.log(`✅ Treinamento concluído: ${session.agentId}`);

    } catch (error) {
      console.error('Erro durante treinamento:', error);
      const msg = error instanceof Error ? error.message : String(error);
      updateTrainingSession(sessionId, {
        status: 'failed',
        endTime: new Date().toISOString(),
        errorMessage: msg
      });
      
      sendNotification('error',
        `Erro no treinamento de ${session.agentId}: ${msg}`,
        session
      );
      throw error;
    } finally {
      this.isRunning = false;
      this.currentSessionId = null;
      saveWorkerStatus({
        isRunning: false,
        currentSessionId: null,
        lastUpdate: new Date().toISOString(),
        performance: { epochsPerMinute: 0, memoryUsage: 0, cpuUsage: 0 },
      });
    }
  }

  private async trainEpoch(epoch: number, sessionId: string, config: AgentTrainingConfig): Promise<void> {
    // Simulação de treinamento de uma época
    // Em produção, isso seria o treinamento real do modelo
    
    // Progresso simulado (não bloqueante)
    const progressSteps = 100;
    for (let i = 0; i < progressSteps; i++) {
      // Verificar se foi abortado
      if (this.abortController?.signal.aborted) {
        return;
      }
      
      // Pequena pausa para simular processamento
      if (i % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }
    
    console.log(`📈 Época ${epoch} concluída (batch: ${config.batchSize}, lr: ${config.learningRate})`);
  }

  private calculateSimulatedAccuracy(epoch: number, config: AgentTrainingConfig): number {
    // Simulação de melhoria de accuracy durante treinamento
    // Em produção, isso seria calculado com dados reais de validação
    
    const baseAccuracy = 65; // Accuracy inicial
    const sampleCount = readLocalTrainingSampleCountForAgent(config.agentId);
    const dataBoost = Math.min(10, Math.log1p(sampleCount) * 1.6);
    const maxAccuracy = 85 + dataBoost;  // Accuracy máxima possível
    const learningRate = config.learningRate;
    
    // Curva de aprendizado simulada
    const progress = epoch / config.maxEpochs;
    const improvement = (maxAccuracy - baseAccuracy) * (1 - Math.exp(-progress * 10 * learningRate));
    
    // Adicionar algum ruído aleatório
    const noise = (Math.random() - 0.5) * 2;
    
    return Math.min(maxAccuracy, baseAccuracy + improvement + noise);
  }

  getStatus(): { isRunning: boolean; currentSessionId: string | null } {
    return {
      isRunning: this.isRunning,
      currentSessionId: this.currentSessionId,
    };
  }

  getCurrentSession(): TrainingSession | null {
    if (!this.currentSessionId) return null;
    
    const sessions = loadTrainingSessions();
    return sessions.find(s => s.sessionId === this.currentSessionId) || null;
  }
}

// ==================== FUNÇÕES UTILITÁRIAS ====================

export function canResumeTraining(sessionId: string): boolean {
  const sessions = loadTrainingSessions();
  const session = sessions.find(s => s.sessionId === sessionId);
  
  return session ? 
    (session.status === 'paused' && session.completedEpochs < session.totalEpochs) : 
    false;
}

export function getTrainingSummary(): {
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  totalTrainingTime: number; // em horas
  averageAccuracyImprovement: number;
} {
  const sessions = loadTrainingSessions();
  const completedSessions = sessions.filter(s => s.status === 'completed');
  
  let totalTime = 0;
  let totalImprovement = 0;
  
  completedSessions.forEach(session => {
    if (session.startTime && session.endTime) {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);
      totalTime += (end.getTime() - start.getTime()) / (1000 * 60 * 60); // horas
    }
    
    // Calcular melhoria (simplificado)
    if (session.checkpoints.length > 0) {
      const firstAccuracy = session.checkpoints[0]?.accuracy || 0;
      const lastAccuracy = session.checkpoints[session.checkpoints.length - 1]?.accuracy || 0;
      totalImprovement += lastAccuracy - firstAccuracy;
    }
  });
  
  return {
    totalSessions: sessions.length,
    completedSessions: completedSessions.length,
    failedSessions: sessions.filter(s => s.status === 'failed').length,
    totalTrainingTime: parseFloat(totalTime.toFixed(2)),
    averageAccuracyImprovement: completedSessions.length > 0 ? 
      parseFloat((totalImprovement / completedSessions.length).toFixed(2)) : 0,
  };
}

export function cleanupOldSessions(daysToKeep: number = 30): void {
  const sessions = loadTrainingSessions();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const filteredSessions = sessions.filter(session => {
    const sessionDate = new Date(session.startTime);
    return sessionDate >= cutoffDate;
  });
  
  saveTrainingSessions(filteredSessions);
  console.log(`🧹 Limpeza: ${sessions.length - filteredSessions.length} sessões antigas removidas`);
}

// ==================== INSTÂNCIA GLOBAL DO WORKER ====================

export const trainingWorker = new TrainingWorker();
