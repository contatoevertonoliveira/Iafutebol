import { loadApiConfig, saveApiConfig } from './apiConfig';
import { toast } from 'sonner';

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
];

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
  localStorage.setItem(TRAINING_SESSIONS_KEY, JSON.stringify(sessions));
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
    sessions[sessionIndex].checkpoints.push(checkpoint);
    saveTrainingSessions(sessions);
    
    // Também salvar em storage separado para backup
    const allCheckpoints = loadAllCheckpoints();
    allCheckpoints.push({ sessionId, ...checkpoint });
    localStorage.setItem(TRAINING_CHECKPOINTS_KEY, JSON.stringify(allCheckpoints));
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
      updateTrainingSession(session.sessionId, { 
        status: 'failed',
        endTime: new Date().toISOString()
      });
      sendNotification('error', `Treinamento falhou: ${error.message}`, session);
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
      updateTrainingSession(session.sessionId, { 
        status: 'failed',
        endTime: new Date().toISOString()
      });
      sendNotification('error', `Falha ao retomar treinamento: ${error.message}`, session);
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
    updateTrainingSession(sessionId, { status: 'running' });

    // Configurar abort controller para permitir pausa/interrupção
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Variáveis para early stopping
    let bestAccuracy = session.bestAccuracy;
    let epochsWithoutImprovement = 0;
    const config = session.config;

    try {
      // Baixar dataset incremental (se necessário)
      const dataset = await downloadIncrementalDataset('european-soccer-database');
      console.log(`📊 Dataset: ${dataset.totalMatches} partidas (${dataset.newMatches} novas)`);

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
      updateTrainingSession(sessionId, {
        status: 'failed',
        endTime: new Date().toISOString(),
      });
      
      sendNotification('error',
        `Erro no treinamento de ${session.agentId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
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
    const maxAccuracy = 85;  // Accuracy máxima possível
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