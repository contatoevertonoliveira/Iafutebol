import { FootballMatch } from './footballDataService';

export interface AgentPrediction {
  agentName: string;
  agentType: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble';
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
  };
}

export interface AgentProfile {
  id: string;
  name: string;
  type: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble';
  description: string;
  specialty: string;
  accuracy: number; // Percentual de acertos históricos
  totalPredictions: number;
  correctPredictions: number;
  avatar: string;
  strengths: string[];
}

// Perfis dos Agentes de IA Especialistas
export const AI_AGENTS: AgentProfile[] = [
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
    // Simulação de análise (em produção seria um modelo real)
    const baseConfidence = this.profile.accuracy;
    const variance = Math.random() * 20 - 10; // -10 a +10
    const confidence = Math.max(50, Math.min(95, baseConfidence + variance));

    // Simulação de fatores de análise
    const formWeight = Math.random();
    const h2hWeight = Math.random();
    const statsWeight = Math.random();
    const homeAdvantage = 0.1 + Math.random() * 0.15; // 10-25%

    // Decisão baseada em tipo de agente
    let winner: 'home' | 'away' | 'draw';
    let winnerConfidence: number;

    switch (this.profile.type) {
      case 'statistical':
        // Favorece análise estatística
        winner = Math.random() > 0.4 ? 'home' : (Math.random() > 0.5 ? 'away' : 'draw');
        winnerConfidence = 60 + Math.random() * 20;
        break;
      case 'form':
        // Favorece time em melhor momento
        winner = Math.random() > 0.45 ? 'home' : 'away';
        winnerConfidence = 55 + Math.random() * 25;
        break;
      case 'head2head':
        // Analisa retrospecto
        winner = Math.random() > 0.5 ? 'home' : 'away';
        winnerConfidence = 50 + Math.random() * 30;
        break;
      case 'advanced':
        // Modelo complexo
        winner = Math.random() > 0.35 ? 'home' : (Math.random() > 0.6 ? 'away' : 'draw');
        winnerConfidence = 65 + Math.random() * 25;
        break;
      case 'ensemble':
        // Consenso
        winner = Math.random() > 0.38 ? 'home' : (Math.random() > 0.55 ? 'away' : 'draw');
        winnerConfidence = 70 + Math.random() * 20;
        break;
      default:
        winner = 'home';
        winnerConfidence = 60;
    }

    return {
      agentName: this.profile.name,
      agentType: this.profile.type,
      confidence,
      winner,
      winnerConfidence,
      overUnder: {
        prediction: Math.random() > 0.5 ? 'over' : 'under',
        line: 2.5,
        confidence: 60 + Math.random() * 25,
      },
      btts: {
        prediction: Math.random() > 0.45 ? 'yes' : 'no',
        confidence: 65 + Math.random() * 20,
      },
      correctScore: {
        score: this.generateScore(winner),
        confidence: 35 + Math.random() * 20,
      },
      asianHandicap: {
        team: winner === 'draw' ? 'home' : winner,
        line: winner === 'home' ? -0.5 : 0.5,
        confidence: 55 + Math.random() * 25,
      },
      firstHalf: {
        prediction: Math.random() > 0.6 ? 'draw' : winner,
        confidence: 50 + Math.random() * 25,
      },
      secondHalf: {
        prediction: winner,
        confidence: 55 + Math.random() * 25,
      },
      reasoning: this.generateReasoning(match, winner),
      factors: {
        formWeight,
        h2hWeight,
        statsWeight,
        homeAdvantage,
      },
    };
  }

  private generateScore(winner: 'home' | 'away' | 'draw'): string {
    const scores = {
      home: ['2-0', '2-1', '3-1', '3-0', '1-0'],
      away: ['0-1', '0-2', '1-2', '1-3', '0-3'],
      draw: ['1-1', '0-0', '2-2', '3-3'],
    };
    const options = scores[winner];
    return options[Math.floor(Math.random() * options.length)];
  }

  private generateReasoning(match: FootballMatch, winner: 'home' | 'away' | 'draw'): string {
    const team = winner === 'home' ? match.homeTeam.name : 
                 winner === 'away' ? match.awayTeam.name : 'Ambos os times';
    
    const reasons = [
      `${team} demonstra superioridade técnica e tática neste confronto.`,
      `Análise de ${this.profile.specialty} indica vantagem para ${team}.`,
      `${team} apresenta melhores indicadores nos últimos jogos.`,
      `Fatores estatísticos favorecem ${team} nesta partida.`,
      `${team} tem histórico positivo em situações similares.`,
    ];

    return reasons[Math.floor(Math.random() * reasons.length)];
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

    return {
      agentName: 'Consenso IA',
      agentType: 'ensemble',
      confidence: avgConfidence,
      winner,
      winnerConfidence: winnerVotes[winner],
      overUnder: this.getConsensusOverUnder(predictions, totalAccuracy),
      btts: this.getConsensusBTTS(predictions, totalAccuracy),
      correctScore: predictions[0].correctScore, // Usa previsão do agente mais preciso
      asianHandicap: predictions[0].asianHandicap,
      firstHalf: this.getConsensusHalf(predictions, 'first', totalAccuracy),
      secondHalf: this.getConsensusHalf(predictions, 'second', totalAccuracy),
      reasoning: `Consenso de ${predictions.length} agentes especialistas com accuracy média de ${(totalAccuracy / predictions.length).toFixed(1)}%`,
      factors: {
        formWeight: predictions.reduce((sum, p) => sum + p.factors.formWeight, 0) / predictions.length,
        h2hWeight: predictions.reduce((sum, p) => sum + p.factors.h2hWeight, 0) / predictions.length,
        statsWeight: predictions.reduce((sum, p) => sum + p.factors.statsWeight, 0) / predictions.length,
        homeAdvantage: predictions.reduce((sum, p) => sum + p.factors.homeAdvantage, 0) / predictions.length,
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
