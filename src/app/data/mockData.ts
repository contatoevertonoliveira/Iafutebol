export interface Match {
  id: string;
  country: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  date: Date;
  time: string;
  status: 'scheduled' | 'live' | 'finished';
}

export interface Prediction {
  matchId: string;
  aiConfidence: number;
  winner: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
    odds: number;
  };
  firstHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  secondHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  overUnder: {
    prediction: 'over' | 'under';
    line: number;
    confidence: number;
  };
  asianHandicap: {
    team: 'home' | 'away';
    line: number;
    confidence: number;
  };
  correctScore: {
    score: string;
    confidence: number;
  };
  btts: {
    prediction: 'yes' | 'no';
    confidence: number;
  };
}

// Mock data de partidas
export const mockMatches: Match[] = [
  // Premier League - Inglaterra
  {
    id: '1',
    country: 'Inglaterra',
    league: 'Premier League',
    homeTeam: 'Manchester City',
    awayTeam: 'Arsenal',
    date: new Date('2026-04-10'),
    time: '17:30',
    status: 'scheduled',
  },
  {
    id: '2',
    country: 'Inglaterra',
    league: 'Premier League',
    homeTeam: 'Liverpool',
    awayTeam: 'Chelsea',
    date: new Date('2026-04-10'),
    time: '20:00',
    status: 'scheduled',
  },
  {
    id: '3',
    country: 'Inglaterra',
    league: 'Premier League',
    homeTeam: 'Manchester United',
    awayTeam: 'Tottenham',
    date: new Date('2026-04-11'),
    time: '15:00',
    status: 'scheduled',
  },
  
  // La Liga - Espanha
  {
    id: '4',
    country: 'Espanha',
    league: 'La Liga',
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona',
    date: new Date('2026-04-10'),
    time: '21:00',
    status: 'scheduled',
  },
  {
    id: '5',
    country: 'Espanha',
    league: 'La Liga',
    homeTeam: 'Atlético Madrid',
    awayTeam: 'Sevilla',
    date: new Date('2026-04-11'),
    time: '19:00',
    status: 'scheduled',
  },
  {
    id: '6',
    country: 'Espanha',
    league: 'La Liga',
    homeTeam: 'Valencia',
    awayTeam: 'Villarreal',
    date: new Date('2026-04-12'),
    time: '16:00',
    status: 'scheduled',
  },
  
  // Serie A - Itália
  {
    id: '7',
    country: 'Itália',
    league: 'Serie A',
    homeTeam: 'Juventus',
    awayTeam: 'Inter Milan',
    date: new Date('2026-04-10'),
    time: '20:45',
    status: 'scheduled',
  },
  {
    id: '8',
    country: 'Itália',
    league: 'Serie A',
    homeTeam: 'AC Milan',
    awayTeam: 'Napoli',
    date: new Date('2026-04-11'),
    time: '18:00',
    status: 'scheduled',
  },
  {
    id: '9',
    country: 'Itália',
    league: 'Serie A',
    homeTeam: 'Roma',
    awayTeam: 'Lazio',
    date: new Date('2026-04-13'),
    time: '20:00',
    status: 'scheduled',
  },
  
  // Bundesliga - Alemanha
  {
    id: '10',
    country: 'Alemanha',
    league: 'Bundesliga',
    homeTeam: 'Bayern Munich',
    awayTeam: 'Borussia Dortmund',
    date: new Date('2026-04-10'),
    time: '18:30',
    status: 'scheduled',
  },
  {
    id: '11',
    country: 'Alemanha',
    league: 'Bundesliga',
    homeTeam: 'RB Leipzig',
    awayTeam: 'Bayer Leverkusen',
    date: new Date('2026-04-12'),
    time: '15:30',
    status: 'scheduled',
  },
  
  // Ligue 1 - França
  {
    id: '12',
    country: 'França',
    league: 'Ligue 1',
    homeTeam: 'Paris Saint-Germain',
    awayTeam: 'Olympique Marseille',
    date: new Date('2026-04-10'),
    time: '21:00',
    status: 'scheduled',
  },
  {
    id: '13',
    country: 'França',
    league: 'Ligue 1',
    homeTeam: 'Monaco',
    awayTeam: 'Lyon',
    date: new Date('2026-04-11'),
    time: '17:00',
    status: 'scheduled',
  },
  
  // Brasileirão - Brasil
  {
    id: '14',
    country: 'Brasil',
    league: 'Brasileirão Série A',
    homeTeam: 'Flamengo',
    awayTeam: 'Palmeiras',
    date: new Date('2026-04-10'),
    time: '21:30',
    status: 'scheduled',
  },
  {
    id: '15',
    country: 'Brasil',
    league: 'Brasileirão Série A',
    homeTeam: 'São Paulo',
    awayTeam: 'Corinthians',
    date: new Date('2026-04-10'),
    time: '19:00',
    status: 'scheduled',
  },
  {
    id: '16',
    country: 'Brasil',
    league: 'Brasileirão Série A',
    homeTeam: 'Atlético Mineiro',
    awayTeam: 'Fluminense',
    date: new Date('2026-04-11'),
    time: '20:00',
    status: 'scheduled',
  },
  {
    id: '17',
    country: 'Brasil',
    league: 'Brasileirão Série A',
    homeTeam: 'Internacional',
    awayTeam: 'Grêmio',
    date: new Date('2026-04-12'),
    time: '18:30',
    status: 'scheduled',
  },
  
  // Champions League
  {
    id: '18',
    country: 'Internacional',
    league: 'UEFA Champions League',
    homeTeam: 'Real Madrid',
    awayTeam: 'Manchester City',
    date: new Date('2026-04-15'),
    time: '21:00',
    status: 'scheduled',
  },
  {
    id: '19',
    country: 'Internacional',
    league: 'UEFA Champions League',
    homeTeam: 'Bayern Munich',
    awayTeam: 'PSG',
    date: new Date('2026-04-16'),
    time: '21:00',
    status: 'scheduled',
  },
];

// Mock data de previsões
export const mockPredictions: Prediction[] = [
  {
    matchId: '1',
    aiConfidence: 87,
    winner: {
      prediction: 'home',
      confidence: 65,
      odds: 1.85,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 58,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 72,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 78,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 68,
    },
    correctScore: {
      score: '2-1',
      confidence: 42,
    },
    btts: {
      prediction: 'yes',
      confidence: 81,
    },
  },
  {
    matchId: '2',
    aiConfidence: 82,
    winner: {
      prediction: 'home',
      confidence: 61,
      odds: 1.95,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 55,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 64,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 75,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 63,
    },
    correctScore: {
      score: '2-1',
      confidence: 38,
    },
    btts: {
      prediction: 'yes',
      confidence: 79,
    },
  },
  {
    matchId: '3',
    aiConfidence: 75,
    winner: {
      prediction: 'draw',
      confidence: 48,
      odds: 3.20,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 62,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 56,
    },
    overUnder: {
      prediction: 'under',
      line: 2.5,
      confidence: 69,
    },
    asianHandicap: {
      team: 'away',
      line: 0.5,
      confidence: 52,
    },
    correctScore: {
      score: '1-1',
      confidence: 45,
    },
    btts: {
      prediction: 'yes',
      confidence: 71,
    },
  },
  {
    matchId: '4',
    aiConfidence: 91,
    winner: {
      prediction: 'home',
      confidence: 58,
      odds: 2.10,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 65,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 69,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 85,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 61,
    },
    correctScore: {
      score: '3-2',
      confidence: 36,
    },
    btts: {
      prediction: 'yes',
      confidence: 88,
    },
  },
  {
    matchId: '5',
    aiConfidence: 79,
    winner: {
      prediction: 'home',
      confidence: 71,
      odds: 1.65,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 64,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 68,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 72,
    },
    asianHandicap: {
      team: 'home',
      line: -1.0,
      confidence: 65,
    },
    correctScore: {
      score: '2-0',
      confidence: 44,
    },
    btts: {
      prediction: 'no',
      confidence: 63,
    },
  },
  {
    matchId: '6',
    aiConfidence: 73,
    winner: {
      prediction: 'away',
      confidence: 54,
      odds: 2.25,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 59,
    },
    secondHalf: {
      prediction: 'away',
      confidence: 66,
    },
    overUnder: {
      prediction: 'under',
      line: 2.5,
      confidence: 67,
    },
    asianHandicap: {
      team: 'away',
      line: 0.0,
      confidence: 57,
    },
    correctScore: {
      score: '0-1',
      confidence: 41,
    },
    btts: {
      prediction: 'no',
      confidence: 68,
    },
  },
  {
    matchId: '7',
    aiConfidence: 89,
    winner: {
      prediction: 'away',
      confidence: 63,
      odds: 2.00,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 61,
    },
    secondHalf: {
      prediction: 'away',
      confidence: 71,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 76,
    },
    asianHandicap: {
      team: 'away',
      line: 0.0,
      confidence: 66,
    },
    correctScore: {
      score: '1-2',
      confidence: 39,
    },
    btts: {
      prediction: 'yes',
      confidence: 82,
    },
  },
  {
    matchId: '8',
    aiConfidence: 84,
    winner: {
      prediction: 'home',
      confidence: 68,
      odds: 1.75,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 62,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 58,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 73,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 69,
    },
    correctScore: {
      score: '2-1',
      confidence: 43,
    },
    btts: {
      prediction: 'yes',
      confidence: 77,
    },
  },
  {
    matchId: '9',
    aiConfidence: 77,
    winner: {
      prediction: 'home',
      confidence: 59,
      odds: 1.90,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 67,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 63,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 71,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 61,
    },
    correctScore: {
      score: '2-1',
      confidence: 40,
    },
    btts: {
      prediction: 'yes',
      confidence: 75,
    },
  },
  {
    matchId: '10',
    aiConfidence: 86,
    winner: {
      prediction: 'home',
      confidence: 64,
      odds: 1.80,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 58,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 67,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 79,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 66,
    },
    correctScore: {
      score: '3-1',
      confidence: 37,
    },
    btts: {
      prediction: 'yes',
      confidence: 80,
    },
  },
  {
    matchId: '11',
    aiConfidence: 81,
    winner: {
      prediction: 'draw',
      confidence: 52,
      odds: 3.10,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 64,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 59,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 74,
    },
    asianHandicap: {
      team: 'home',
      line: 0.0,
      confidence: 54,
    },
    correctScore: {
      score: '2-2',
      confidence: 41,
    },
    btts: {
      prediction: 'yes',
      confidence: 84,
    },
  },
  {
    matchId: '12',
    aiConfidence: 88,
    winner: {
      prediction: 'home',
      confidence: 74,
      odds: 1.55,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 68,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 71,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 81,
    },
    asianHandicap: {
      team: 'home',
      line: -1.0,
      confidence: 72,
    },
    correctScore: {
      score: '3-0',
      confidence: 46,
    },
    btts: {
      prediction: 'no',
      confidence: 66,
    },
  },
  {
    matchId: '13',
    aiConfidence: 76,
    winner: {
      prediction: 'home',
      confidence: 62,
      odds: 1.88,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 61,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 65,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 70,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 64,
    },
    correctScore: {
      score: '2-1',
      confidence: 42,
    },
    btts: {
      prediction: 'yes',
      confidence: 73,
    },
  },
  {
    matchId: '14',
    aiConfidence: 90,
    winner: {
      prediction: 'home',
      confidence: 66,
      odds: 1.70,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 63,
    },
    secondHalf: {
      prediction: 'home',
      confidence: 73,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 83,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 69,
    },
    correctScore: {
      score: '2-1',
      confidence: 44,
    },
    btts: {
      prediction: 'yes',
      confidence: 86,
    },
  },
  {
    matchId: '15',
    aiConfidence: 85,
    winner: {
      prediction: 'away',
      confidence: 57,
      odds: 2.15,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 66,
    },
    secondHalf: {
      prediction: 'away',
      confidence: 68,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 77,
    },
    asianHandicap: {
      team: 'away',
      line: 0.0,
      confidence: 60,
    },
    correctScore: {
      score: '1-2',
      confidence: 40,
    },
    btts: {
      prediction: 'yes',
      confidence: 80,
    },
  },
  {
    matchId: '16',
    aiConfidence: 78,
    winner: {
      prediction: 'home',
      confidence: 61,
      odds: 1.92,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 59,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 62,
    },
    overUnder: {
      prediction: 'under',
      line: 2.5,
      confidence: 68,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 63,
    },
    correctScore: {
      score: '1-0',
      confidence: 43,
    },
    btts: {
      prediction: 'no',
      confidence: 71,
    },
  },
  {
    matchId: '17',
    aiConfidence: 83,
    winner: {
      prediction: 'draw',
      confidence: 55,
      odds: 3.00,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 68,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 61,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 75,
    },
    asianHandicap: {
      team: 'home',
      line: 0.0,
      confidence: 57,
    },
    correctScore: {
      score: '2-2',
      confidence: 42,
    },
    btts: {
      prediction: 'yes',
      confidence: 82,
    },
  },
  {
    matchId: '18',
    aiConfidence: 92,
    winner: {
      prediction: 'away',
      confidence: 59,
      odds: 2.05,
    },
    firstHalf: {
      prediction: 'draw',
      confidence: 67,
    },
    secondHalf: {
      prediction: 'away',
      confidence: 70,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 87,
    },
    asianHandicap: {
      team: 'away',
      line: 0.0,
      confidence: 62,
    },
    correctScore: {
      score: '1-2',
      confidence: 38,
    },
    btts: {
      prediction: 'yes',
      confidence: 91,
    },
  },
  {
    matchId: '19',
    aiConfidence: 89,
    winner: {
      prediction: 'home',
      confidence: 67,
      odds: 1.78,
    },
    firstHalf: {
      prediction: 'home',
      confidence: 63,
    },
    secondHalf: {
      prediction: 'draw',
      confidence: 65,
    },
    overUnder: {
      prediction: 'over',
      line: 2.5,
      confidence: 84,
    },
    asianHandicap: {
      team: 'home',
      line: -0.5,
      confidence: 69,
    },
    correctScore: {
      score: '2-1',
      confidence: 41,
    },
    btts: {
      prediction: 'yes',
      confidence: 85,
    },
  },
];

export const countries = [...new Set(mockMatches.map(m => m.country))].sort();
export const leagues = [...new Set(mockMatches.map(m => m.league))].sort();
