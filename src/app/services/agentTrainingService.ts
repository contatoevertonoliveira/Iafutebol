import { loadApiConfig, saveApiConfig } from './apiConfig';

export interface AgentMetrics {
  agentId: string;
  name: string;
  accuracy: number;
  previousAccuracy: number;
  improvement: number;
  totalPredictions: number;
  correctPredictions: number;
  lastUpdated: string;
  trainingStatus: 'idle' | 'training' | 'completed' | 'error';
  epoch: number;
  totalEpochs: number;
}

export interface TrainingProgress {
  isTraining: boolean;
  currentEpoch: number;
  totalEpochs: number;
  currentAccuracy: number;
  estimatedTimeRemaining: number;
}

const AGENTS_STORAGE_KEY = 'agent_metrics';
const TRAINING_STORAGE_KEY = 'training_progress';

// Inicializar métricas padrão dos agentes
const DEFAULT_AGENT_METRICS: AgentMetrics[] = [
  {
    agentId: 'statsmaster',
    name: 'StatsMaster',
    accuracy: 73.5,
    previousAccuracy: 70.2,
    improvement: 3.3,
    totalPredictions: 1520,
    correctPredictions: 1117,
    lastUpdated: new Date().toISOString(),
    trainingStatus: 'idle',
    epoch: 0,
    totalEpochs: 100,
  },
  {
    agentId: 'formanalyzer',
    name: 'FormAnalyzer',
    accuracy: 71.2,
    previousAccuracy: 68.5,
    improvement: 2.7,
    totalPredictions: 1520,
    correctPredictions: 1082,
    lastUpdated: new Date().toISOString(),
    trainingStatus: 'idle',
    epoch: 0,
    totalEpochs: 100,
  },
  {
    agentId: 'h2hexpert',
    name: 'H2H Expert',
    accuracy: 68.9,
    previousAccuracy: 67.1,
    improvement: 1.8,
    totalPredictions: 1520,
    correctPredictions: 1047,
    lastUpdated: new Date().toISOString(),
    trainingStatus: 'idle',
    epoch: 0,
    totalEpochs: 100,
  },
  {
    agentId: 'deeppredictor',
    name: 'DeepPredictor',
    accuracy: 76.8,
    previousAccuracy: 73.9,
    improvement: 2.9,
    totalPredictions: 1520,
    correctPredictions: 1167,
    lastUpdated: new Date().toISOString(),
    trainingStatus: 'idle',
    epoch: 0,
    totalEpochs: 100,
  },
  {
    agentId: 'ensemblemaster',
    name: 'EnsembleMaster',
    accuracy: 78.3,
    previousAccuracy: 75.8,
    improvement: 2.5,
    totalPredictions: 1520,
    correctPredictions: 1190,
    lastUpdated: new Date().toISOString(),
    trainingStatus: 'idle',
    epoch: 0,
    totalEpochs: 100,
  },
];

// Carregar métricas dos agentes
export function loadAgentMetrics(): AgentMetrics[] {
  const stored = localStorage.getItem(AGENTS_STORAGE_KEY);
  if (!stored) {
    // Salvar métricas padrão
    saveAgentMetrics(DEFAULT_AGENT_METRICS);
    return DEFAULT_AGENT_METRICS;
  }
  return JSON.parse(stored);
}

// Salvar métricas dos agentes
export function saveAgentMetrics(metrics: AgentMetrics[]): void {
  localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(metrics));
}

// Atualizar métrica de um agente específico
export function updateAgentMetric(agentId: string, updates: Partial<AgentMetrics>): void {
  const metrics = loadAgentMetrics();
  const index = metrics.findIndex(m => m.agentId === agentId);

  if (index !== -1) {
    metrics[index] = {
      ...metrics[index],
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
    saveAgentMetrics(metrics);
  }
}

// Carregar progresso do treinamento
export function loadTrainingProgress(): TrainingProgress | null {
  const stored = localStorage.getItem(TRAINING_STORAGE_KEY);
  if (!stored) return null;
  return JSON.parse(stored);
}

// Salvar progresso do treinamento
export function saveTrainingProgress(progress: TrainingProgress): void {
  localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify(progress));
}

// Limpar progresso do treinamento
export function clearTrainingProgress(): void {
  localStorage.removeItem(TRAINING_STORAGE_KEY);
}

// Simular treinamento de um agente (será substituído por treinamento real com Kaggle)
export async function trainAgent(agentId: string, epochs: number = 100): Promise<void> {
  const metrics = loadAgentMetrics();
  const agent = metrics.find(m => m.agentId === agentId);

  if (!agent) {
    throw new Error(`Agente ${agentId} não encontrado`);
  }

  // Atualizar status para treinando
  updateAgentMetric(agentId, {
    trainingStatus: 'training',
    epoch: 0,
    totalEpochs: epochs,
  });

  // Simular treinamento progressivo
  for (let epoch = 1; epoch <= epochs; epoch++) {
    await new Promise(resolve => setTimeout(resolve, 100)); // Simular tempo de treinamento

    // Calcular nova acurácia (melhoria gradual)
    const improvementRate = Math.random() * 0.5 + 0.1; // 0.1% a 0.6% por época
    const newAccuracy = Math.min(95, agent.accuracy + improvementRate);

    updateAgentMetric(agentId, {
      accuracy: parseFloat(newAccuracy.toFixed(1)),
      epoch,
      trainingStatus: epoch === epochs ? 'completed' : 'training',
    });

    // Atualizar progresso
    saveTrainingProgress({
      isTraining: true,
      currentEpoch: epoch,
      totalEpochs: epochs,
      currentAccuracy: newAccuracy,
      estimatedTimeRemaining: (epochs - epoch) * 100,
    });
  }

  // Finalizar treinamento
  const finalMetrics = loadAgentMetrics();
  const finalAgent = finalMetrics.find(m => m.agentId === agentId);

  if (finalAgent) {
    updateAgentMetric(agentId, {
      previousAccuracy: agent.accuracy,
      improvement: parseFloat((finalAgent.accuracy - agent.accuracy).toFixed(1)),
      trainingStatus: 'completed',
    });
  }

  clearTrainingProgress();
}

// Treinar todos os agentes
export async function trainAllAgents(epochs: number = 100): Promise<void> {
  const metrics = loadAgentMetrics();

  for (const agent of metrics) {
    console.log(`🎯 Treinando ${agent.name}...`);
    await trainAgent(agent.agentId, epochs);
  }

  console.log('✅ Treinamento de todos os agentes concluído!');
}

// Obter dados do Kaggle (placeholder - será implementado com API real)
export async function fetchKaggleDataset(username: string, apiKey: string): Promise<any> {
  // TODO: Implementar integração real com Kaggle API
  console.log('📥 Buscando dataset do Kaggle...');
  console.log('Username:', username);

  // Simular busca de dados
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        matches: 1520,
        leagues: 15,
        seasons: 3,
        lastUpdated: new Date().toISOString(),
      });
    }, 1000);
  });
}

// Resetar métricas para valores padrão
export function resetAgentMetrics(): void {
  saveAgentMetrics(DEFAULT_AGENT_METRICS);
  clearTrainingProgress();
}
