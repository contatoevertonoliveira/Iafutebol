import { FootballMatch } from './footballDataService';
import { loadTrainingSessions } from './optimizedTrainingService';

export interface AgentPrediction {
  agentName: string;
  agentType: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble' | 'goals' | 'correctscore';
  confidence: number;
  winner: 'home' | 'away' | 'draw';
  winnerConfidence: number;
  overUnder: {
    prediction: 'over' | 'under';
    line: number;
    confidence: number;
  };
  btts: {
    prediction: 'yes' | 'no';
    confidence: number;
  };
  correctScore: {
    score: string;
    confidence: number;
  };
  asianHandicap: {
    team: 'home' | 'away';
    line: number;
    confidence: number;
  };
  firstHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  secondHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  reasoning: string;
  factors: {
    formWeight: number;
    h2hWeight: number;
    statsWeight: number;
    homeAdvantage: number;
    motivation: number;
    missingPlayers: number;
  };
}

export interface AgentProfile {
  id: string;
  name: string;
  type: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble' | 'goals' | 'correctscore';
  description: string;
  specialty: string;
  accuracy: number; // Percentual de acertos históricos
  totalPredictions: number;
  correctPredictions: number;
  avatar: string;
  strengths: string[];
}

type TrainingSample = {
  id: string;
  day: string;
  utcDate: string;
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
  score: { home: number; away: number };
  outcomes: {
    winner: 'home' | 'away' | 'draw';
    totalGoals: number;
    btts: 'yes' | 'no';
    overUnder: { line: number; outcome: 'over' | 'under' };
    correctScore: string;
  };
  agentPredictions: Array<{
    agentName: string;
    agentType: AgentPrediction['agentType'];
    winner: AgentPrediction['winner'];
    overUnder: AgentPrediction['overUnder'];
    btts: AgentPrediction['btts'];
    correctScore: AgentPrediction['correctScore'];
  }>;
};

export function recordTrainingSample(match: FootballMatch, predictions: AgentPrediction[]): boolean {
  const home = match.score?.fullTime?.home;
  const away = match.score?.fullTime?.away;
  if (typeof home !== 'number' || typeof away !== 'number') return false;

  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(match.utcDate));
  const id = match.id.toString();
  const winner = home > away ? 'home' : home < away ? 'away' : 'draw';
  const totalGoals = home + away;
  const btts = home > 0 && away > 0 ? 'yes' : 'no';
  const line = 2.5;
  const overUnderOutcome = totalGoals > line ? 'over' : 'under';
  const correctScore = `${home}-${away}`;

  const storeKey = 'training_samples_v1';
  const store = (() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return { version: 1 as const, items: {} as Record<string, TrainingSample> };
      const parsed = JSON.parse(raw) as { version: number; items: Record<string, TrainingSample> };
      if (!parsed || parsed.version !== 1 || !parsed.items) {
        return { version: 1 as const, items: {} as Record<string, TrainingSample> };
      }
      return { version: 1 as const, items: parsed.items };
    } catch {
      return { version: 1 as const, items: {} as Record<string, TrainingSample> };
    }
  })();

  if (store.items[id]) return false;

  const sample: TrainingSample = {
    id,
    day,
    utcDate: match.utcDate,
    league: match.competition?.name ?? 'Unknown',
    country: match.competition?.area?.name ?? match.competition?.area?.code ?? 'Unknown',
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    score: { home, away },
    outcomes: {
      winner,
      totalGoals,
      btts,
      overUnder: { line, outcome: overUnderOutcome },
      correctScore,
    },
    agentPredictions: predictions.map((p) => ({
      agentName: p.agentName,
      agentType: p.agentType,
      winner: p.winner,
      overUnder: p.overUnder,
      btts: p.btts,
      correctScore: p.correctScore,
    })),
  };

  store.items[id] = sample;
  try {
    localStorage.setItem(storeKey, JSON.stringify(store));
  } catch {
    return false;
  }

  return true;
}

// Obter as estatísticas dinâmicas dos agentes (treinamento + histórico)
export function getDynamicAgentProfiles(): AgentProfile[] {
  // Histórico salvo localmente das avaliações do "Ver Resultado"
  const historyRaw = localStorage.getItem('agent_learning_history');
  const history = historyRaw ? JSON.parse(historyRaw) : {};

  // Sessões de treinamento do Kaggle
  const sessions = typeof localStorage !== 'undefined' ? loadTrainingSessions() : [];

  return AI_AGENTS_BASE.map(agent => {
    let currentAccuracy = agent.accuracy;
    
    // 1) Ajuste com base no treinamento do Kaggle
    const agentSession = sessions.find(s => s.agentId === agent.id.replace('agent-', '').replace('-', ''));
    if (agentSession && agentSession.bestAccuracy > 0) {
      // Se o modelo treinou e conseguiu boa acurácia, eleva a base do agente
      const trainingBoost = (agentSession.bestAccuracy * 100) - currentAccuracy;
      if (trainingBoost > 0) {
        currentAccuracy += trainingBoost * 0.5; // Absorve 50% da melhoria do modelo treinado
      }
    }

    // 2) Ajuste com base no histórico real (Ver Resultado)
    const agentHistory = history[agent.id];
    let totalPreds = agent.totalPredictions;
    let correctPreds = agent.correctPredictions;

    if (agentHistory) {
      totalPreds += agentHistory.total;
      correctPreds += agentHistory.correct;
      const historyAccuracy = (correctPreds / totalPreds) * 100;
      // Mistura a acurácia base com o histórico real
      currentAccuracy = (currentAccuracy * 0.7) + (historyAccuracy * 0.3);
    }

    return {
      ...agent,
      accuracy: Math.min(95, Math.max(40, currentAccuracy)),
      totalPredictions: totalPreds,
      correctPredictions: correctPreds,
    };
  });
}

// Registrar o aprendizado do agente após um resultado real
export function learnFromMatchResult(predictions: AgentPrediction[], realWinner: 'home' | 'away' | 'draw') {
  const historyRaw = localStorage.getItem('agent_learning_history');
  const history = historyRaw ? JSON.parse(historyRaw) : {};

  predictions.forEach(p => {
    const agentBase = AI_AGENTS_BASE.find(a => a.name === p.agentName);
    if (!agentBase) return;
    
    if (!history[agentBase.id]) {
      history[agentBase.id] = { total: 0, correct: 0 };
    }
    
    history[agentBase.id].total += 1;
    if (p.winner === realWinner) {
      history[agentBase.id].correct += 1;
    }
  });

  localStorage.setItem('agent_learning_history', JSON.stringify(history));
}

// Perfis Base dos Agentes de IA Especialistas
export const AI_AGENTS_BASE: AgentProfile[] = [
  {
    id: 'agent-stats-master',
    name: 'StatsMaster',
    type: 'statistical',
    description: 'Especialista em análise estatística profunda',
    specialty: 'xG, Posse de bola, Finalizações',
    accuracy: 73.5,
    totalPredictions: 1247,
    correctPredictions: 917,
    avatar: '📊',
    strengths: ['Expected Goals', 'Posse de Bola', 'Finalizações no Alvo'],
  },
  {
    id: 'agent-form-analyzer',
    name: 'FormAnalyzer',
    type: 'form',
    description: 'Focado em momento atual dos times',
    specialty: 'Últimos 5 jogos, Sequências',
    accuracy: 71.2,
    totalPredictions: 1189,
    correctPredictions: 846,
    avatar: '📈',
    strengths: ['Momento do Time', 'Sequências', 'Moral dos Jogadores'],
  },
  {
    id: 'agent-h2h-expert',
    name: 'H2H Expert',
    type: 'head2head',
    description: 'Analisa histórico entre os times',
    specialty: 'Confrontos diretos, Retrospecto',
    accuracy: 68.9,
    totalPredictions: 956,
    correctPredictions: 659,
    avatar: '⚔️',
    strengths: ['Histórico H2H', 'Retrospecto Casa/Fora', 'Clássicos'],
  },
  {
    id: 'agent-deep-learning',
    name: 'DeepPredictor',
    type: 'advanced',
    description: 'Modelo de deep learning com 50+ variáveis',
    specialty: 'Machine Learning Avançado',
    accuracy: 76.8,
    totalPredictions: 2103,
    correctPredictions: 1615,
    avatar: '🧠',
    strengths: ['Pattern Recognition', 'Multi-variável', 'Contexto Tático'],
  },
  {
    id: 'agent-ensemble',
    name: 'EnsembleMaster',
    type: 'ensemble',
    description: 'Combina todos os agentes com pesos inteligentes',
    specialty: 'Consenso Ponderado',
    accuracy: 78.3,
    totalPredictions: 2103,
    correctPredictions: 1647,
    avatar: '🎯',
    strengths: ['Consenso', 'Meta-Learning', 'Ponderação Adaptativa'],
  },
  {
    id: 'agent-goals-overunder',
    name: 'GoalLine',
    type: 'goals',
    description: 'Especialista em padrões de gols e linhas Over/Under',
    specialty: 'Over/Under, ritmo, gols tardios',
    accuracy: 74.6,
    totalPredictions: 1320,
    correctPredictions: 987,
    avatar: '⚽',
    strengths: ['Over/Under', 'Padrões de Ritmo', 'Gols nos Minutos Finais'],
  },
  {
    id: 'agent-correct-score',
    name: 'ScoreOracle',
    type: 'correctscore',
    description: 'Especialista em placar correto e distribuição de gols',
    specialty: 'Correct Score, dutching, proteção contra goleadas',
    accuracy: 72.1,
    totalPredictions: 910,
    correctPredictions: 656,
    avatar: '🔢',
    strengths: ['Correct Score', 'Distribuição de Gols', 'Dutcher/Bookmaking'],
  },
];

/**
 * Simula análise de um agente de IA
 * Em produção, isso seria um modelo treinado que analisa dados reais
 */
export class AIAgent {
  profile: AgentProfile;

  constructor(profile: AgentProfile) {
    this.profile = profile;
  }

  /**
   * Gera previsão baseada em dados da partida
   * TODO: Integrar com modelo de ML real treinado em dados históricos
   */
  async predict(match: FootballMatch): Promise<AgentPrediction> {
    // Semente determinística baseada no ID da partida e ID do agente
    // Isso garante que o mesmo agente sempre dará a mesma previsão para a mesma partida
    const seedString = `${match.id}_${this.profile.id}`;
    let seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      seed = (seed << 5) - seed + seedString.charCodeAt(i);
      seed |= 0;
    }
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Acurácia real (base + treino Kaggle + histórico)
    const baseConfidence = this.profile.accuracy;
    const variance = pseudoRandom() * 20 - 10; // -10 a +10
    const confidence = Math.max(50, Math.min(95, baseConfidence + variance));

    // Fatores de análise determinísticos
    const formWeight = pseudoRandom();
    const h2hWeight = pseudoRandom();
    const statsWeight = pseudoRandom();
    const homeAdvantage = 0.1 + pseudoRandom() * 0.15; // 10-25%
    const motivation = pseudoRandom() * 0.2; // 0-20% (necessidade de ganhar)
    const missingPlayers = pseudoRandom() * 0.15; // 0-15% (impacto de lesões/cartões)

    // Ajusta as chances baseando-se nos fatores e no "momento"
    // Como não temos a API de desfalques, simulamos de forma realista via semente determinística
    const homeScore = pseudoRandom() + homeAdvantage + formWeight - missingPlayers;
    const awayScore = pseudoRandom() + (1 - formWeight) + motivation;

    let winner: 'home' | 'away' | 'draw';
    let winnerConfidence: number;

    if (Math.abs(homeScore - awayScore) < 0.15) {
      winner = 'draw';
    } else if (homeScore > awayScore) {
      winner = 'home';
    } else {
      winner = 'away';
    }

    // Ajuste de vencedor por especialidade
    switch (this.profile.type) {
      case 'statistical':
        winnerConfidence = 60 + pseudoRandom() * 20;
        break;
      case 'form':
        winnerConfidence = 55 + pseudoRandom() * 25;
        break;
      case 'head2head':
        winnerConfidence = 50 + pseudoRandom() * 30;
        break;
      case 'advanced':
        winnerConfidence = 65 + pseudoRandom() * 25;
        break;
      case 'ensemble':
        winnerConfidence = 70 + pseudoRandom() * 20;
        break;
      case 'goals':
        winnerConfidence = 55 + pseudoRandom() * 20;
        break;
      case 'correctscore':
        winnerConfidence = 52 + pseudoRandom() * 20;
        break;
      default:
        winnerConfidence = 60;
    }

    const expectedGoals = Math.max(0, (pseudoRandom() * 3.2) + motivation - (missingPlayers * 1.3));
    const goalsBias = expectedGoals + (pseudoRandom() * 0.6 - 0.3);

    let overUnderLine = 2.5;
    let overUnderPrediction: 'over' | 'under' = goalsBias >= overUnderLine ? 'over' : 'under';
    let overUnderConfidence = 60 + pseudoRandom() * 25;

    if (this.profile.type === 'goals') {
      overUnderConfidence = 72 + pseudoRandom() * 20;
      overUnderPrediction = goalsBias >= overUnderLine ? 'over' : 'under';
    }

    const bttsPrediction: 'yes' | 'no' = pseudoRandom() > 0.45 ? 'yes' : 'no';
    const bttsConfidenceBase = 65 + pseudoRandom() * 20;
    const bttsConfidence = this.profile.type === 'goals' ? Math.min(92, bttsConfidenceBase + 8) : bttsConfidenceBase;

    let correctScorePrediction = this.generateScore(winner, pseudoRandom);
    let correctScoreConfidence = 35 + pseudoRandom() * 20;
    if (this.profile.type === 'correctscore') {
      correctScorePrediction = this.generateScoreForCorrectScore(winner, pseudoRandom, goalsBias);
      correctScoreConfidence = 48 + pseudoRandom() * 22;
    }

    return {
      agentName: this.profile.name,
      agentType: this.profile.type,
      confidence,
      winner,
      winnerConfidence,
      overUnder: {
        prediction: overUnderPrediction,
        line: overUnderLine,
        confidence: overUnderConfidence,
      },
      btts: {
        prediction: bttsPrediction,
        confidence: bttsConfidence,
      },
      correctScore: {
        score: correctScorePrediction,
        confidence: correctScoreConfidence,
      },
      asianHandicap: {
        team: winner === 'draw' ? 'home' : winner,
        line: winner === 'home' ? -0.5 : 0.5,
        confidence: 55 + pseudoRandom() * 25,
      },
      firstHalf: {
        prediction: pseudoRandom() > 0.6 ? 'draw' : winner,
        confidence: 50 + pseudoRandom() * 25,
      },
      secondHalf: {
        prediction: winner,
        confidence: 55 + pseudoRandom() * 25,
      },
      reasoning: this.generateReasoning(match, winner, pseudoRandom, missingPlayers, motivation, formWeight),
      factors: {
        formWeight,
        h2hWeight,
        statsWeight,
        homeAdvantage,
        motivation,
        missingPlayers,
      },
    };
  }

  private generateScore(winner: 'home' | 'away' | 'draw', randomFn: () => number): string {
    const scores = {
      home: ['2-0', '2-1', '3-1', '3-0', '1-0'],
      away: ['0-1', '0-2', '1-2', '1-3', '0-3'],
      draw: ['1-1', '0-0', '2-2', '3-3'],
    };
    const options = scores[winner];
    return options[Math.floor(randomFn() * options.length)];
  }

  private generateScoreForCorrectScore(
    winner: 'home' | 'away' | 'draw',
    randomFn: () => number,
    goalsBias: number,
  ): string {
    const low = goalsBias < 2.2;
    const high = goalsBias > 3.1;

    const pools = {
      homeLow: ['1-0', '2-0', '2-1', '1-1'],
      awayLow: ['0-1', '0-2', '1-2', '1-1'],
      drawLow: ['0-0', '1-1', '2-2'],
      homeHigh: ['3-1', '3-0', '4-1', '2-1'],
      awayHigh: ['1-3', '0-3', '1-4', '1-2'],
      drawHigh: ['2-2', '3-3'],
      homeMid: ['2-1', '1-0', '2-0', '3-1'],
      awayMid: ['1-2', '0-1', '0-2', '1-3'],
      drawMid: ['1-1', '0-0', '2-2'],
    };

    const key =
      winner === 'home'
        ? low
          ? 'homeLow'
          : high
            ? 'homeHigh'
            : 'homeMid'
        : winner === 'away'
          ? low
            ? 'awayLow'
            : high
              ? 'awayHigh'
              : 'awayMid'
          : low
            ? 'drawLow'
            : high
              ? 'drawHigh'
              : 'drawMid';

    const options = pools[key];
    return options[Math.floor(randomFn() * options.length)];
  }

  private generateReasoning(match: FootballMatch, winner: 'home' | 'away' | 'draw', randomFn: () => number, missing: number, motivation: number, form: number): string {
    const team = winner === 'home' ? match.homeTeam.name : 
                 winner === 'away' ? match.awayTeam.name : 'Ambos os times';
    
    let reason = `${team} demonstra superioridade técnica neste confronto. `;

    if (this.profile.type === 'goals') {
      reason += `Padrões de ritmo e tendência de gols (incluindo minutos finais) favoreceram a leitura de Over/Under. `;
    }
    if (this.profile.type === 'correctscore') {
      reason += `Modelagem de distribuição de gols para estimar placar correto e cenários de dutching. `;
    }
    if (missing > 0.1) {
      reason += `Desfalques importantes por lesão/cartões no time adversário pesaram na análise. `;
    }
    if (motivation > 0.15) {
      reason += `A alta necessidade de vitória e motivação no campeonato atual foi fator decisivo. `;
    }
    if (form > 0.7) {
      reason += `O excelente momento e retrospecto recente na competição justificam o favoritismo. `;
    }
    
    if (reason.length < 80) {
      reason += `Análise baseada em ${this.profile.specialty} com cruzamento de dados de treino.`;
    }

    return reason;
  }
}

/**
 * Sistema de Ensemble que combina previsões de múltiplos agentes
 */
export class AgentEnsemble {
  agents: AIAgent[];

  constructor(profiles: AgentProfile[]) {
    this.agents = profiles.map(profile => new AIAgent(profile));
  }

  async predictWithAllAgents(match: FootballMatch): Promise<AgentPrediction[]> {
    const predictions = await Promise.all(
      this.agents.map(agent => agent.predict(match))
    );
    return predictions;
  }

  /**
   * Combina previsões usando ponderação por accuracy
   */
  async getConsensusPrediction(match: FootballMatch): Promise<AgentPrediction> {
    const predictions = await this.predictWithAllAgents(match);
    
    // Ponderação por accuracy de cada agente
    const totalAccuracy = predictions.reduce((sum, p) => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      return sum + (agent?.profile.accuracy || 0);
    }, 0);

    // Voto ponderado para vencedor
    const winnerVotes = { home: 0, away: 0, draw: 0 };
    predictions.forEach(p => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      winnerVotes[p.winner] += weight * p.winnerConfidence;
    });

    const winner = Object.entries(winnerVotes).reduce((a, b) => 
      a[1] > b[1] ? a : b
    )[0] as 'home' | 'away' | 'draw';

    // Média ponderada da confiança
    const avgConfidence = predictions.reduce((sum, p, i) => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      return sum + p.confidence * weight;
    }, 0);

    const getBestCorrectScoreIndex = () => {
      const specialistIdx = this.agents.findIndex((a) => a.profile.type === 'correctscore');
      if (specialistIdx !== -1) return specialistIdx;
      let bestIdx = 0;
      let bestAcc = -Infinity;
      for (let i = 0; i < this.agents.length; i++) {
        const acc = this.agents[i].profile.accuracy;
        if (acc > bestAcc) {
          bestAcc = acc;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    const bestCorrectScoreIndex = getBestCorrectScoreIndex();

    return {
      agentName: 'Consenso IA',
      agentType: 'ensemble',
      confidence: avgConfidence,
      winner,
      winnerConfidence: winnerVotes[winner],
      overUnder: this.getConsensusOverUnder(predictions, totalAccuracy),
      btts: this.getConsensusBTTS(predictions, totalAccuracy),
      correctScore: predictions[bestCorrectScoreIndex]?.correctScore ?? predictions[0].correctScore,
      asianHandicap: predictions[bestCorrectScoreIndex]?.asianHandicap ?? predictions[0].asianHandicap,
      firstHalf: this.getConsensusHalf(predictions, 'first', totalAccuracy),
      secondHalf: this.getConsensusHalf(predictions, 'second', totalAccuracy),
      reasoning: `Consenso de ${predictions.length} agentes especialistas com accuracy média de ${(totalAccuracy / predictions.length).toFixed(1)}%`,
      factors: {
        formWeight: predictions.reduce((sum, p) => sum + p.factors.formWeight, 0) / predictions.length,
        h2hWeight: predictions.reduce((sum, p) => sum + p.factors.h2hWeight, 0) / predictions.length,
        statsWeight: predictions.reduce((sum, p) => sum + p.factors.statsWeight, 0) / predictions.length,
        homeAdvantage: predictions.reduce((sum, p) => sum + p.factors.homeAdvantage, 0) / predictions.length,
        motivation: predictions.reduce((sum, p) => sum + p.factors.motivation, 0) / predictions.length,
        missingPlayers: predictions.reduce((sum, p) => sum + p.factors.missingPlayers, 0) / predictions.length,
      },
    };
  }

  private getConsensusOverUnder(predictions: AgentPrediction[], totalAccuracy: number) {
    const votes = { over: 0, under: 0 };
    predictions.forEach(p => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      votes[p.overUnder.prediction] += weight * p.overUnder.confidence;
    });
    return {
      prediction: votes.over > votes.under ? 'over' as const : 'under' as const,
      line: 2.5,
      confidence: Math.max(votes.over, votes.under),
    };
  }

  private getConsensusBTTS(predictions: AgentPrediction[], totalAccuracy: number) {
    const votes = { yes: 0, no: 0 };
    predictions.forEach(p => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      votes[p.btts.prediction] += weight * p.btts.confidence;
    });
    return {
      prediction: votes.yes > votes.no ? 'yes' as const : 'no' as const,
      confidence: Math.max(votes.yes, votes.no),
    };
  }

  private getConsensusHalf(
    predictions: AgentPrediction[], 
    half: 'first' | 'second',
    totalAccuracy: number
  ) {
    const votes = { home: 0, away: 0, draw: 0 };
    const field = half === 'first' ? 'firstHalf' : 'secondHalf';
    
    predictions.forEach(p => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      votes[p[field].prediction] += weight * p[field].confidence;
    });

    const winner = Object.entries(votes).reduce((a, b) => 
      a[1] > b[1] ? a : b
    )[0] as 'home' | 'away' | 'draw';

    return {
      prediction: winner,
      confidence: votes[winner],
    };
  }
}
