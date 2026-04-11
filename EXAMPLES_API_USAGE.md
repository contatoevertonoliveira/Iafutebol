# 📝 Exemplos de Uso das APIs

Este documento mostra como usar cada uma das 3 APIs no código.

## 🔧 Setup Inicial

```typescript
import { loadApiConfig } from './services/apiConfig';
import { FootballDataService } from './services/footballDataService';
import { ApiFootballService } from './services/apiFootballService';

// Carregar configurações
const config = loadApiConfig();

// Inicializar serviços (apenas se API key estiver configurada)
const footballDataService = config?.footballDataApiKey 
  ? new FootballDataService(config.footballDataApiKey)
  : null;

const apiFootballService = config?.apiFootballKey
  ? new ApiFootballService(config.apiFootballKey)
  : null;
```

---

## 🥇 API-Football.com

### Obter partidas de hoje

```typescript
const today = new Date().toISOString().split('T')[0];

const matches = await apiFootballService.getFixtures({
  date: today,
  timezone: 'America/Sao_Paulo'
});

console.log(matches);
// [{
//   fixture: {
//     id: 12345,
//     date: "2024-04-11T20:00:00+00:00",
//     status: { long: "Not Started", short: "NS" },
//     venue: { name: "Maracanã", city: "Rio de Janeiro" }
//   },
//   league: {
//     id: 71,
//     name: "Série A",
//     country: "Brazil",
//     logo: "https://...",
//     flag: "https://..."
//   },
//   teams: {
//     home: {
//       id: 123,
//       name: "Flamengo",
//       logo: "https://..."
//     },
//     away: {
//       id: 124,
//       name: "Palmeiras",
//       logo: "https://..."
//     }
//   },
//   goals: { home: null, away: null }
// }]
```

### Obter partidas de uma liga específica

```typescript
// Premier League (ID: 39)
const premierLeagueMatches = await apiFootballService.getFixtures({
  league: 39,
  season: 2024,
  from: '2024-04-01',
  to: '2024-04-30'
});
```

### Obter estatísticas de um time

```typescript
// Estatísticas do Manchester United na Premier League 2024
const stats = await apiFootballService.getTeamStatistics({
  league: 39,
  season: 2024,
  team: 33
});

console.log(stats);
// {
//   form: "WWLDW",
//   fixtures: {
//     played: { home: 15, away: 14, total: 29 },
//     wins: { home: 10, away: 7, total: 17 },
//     draws: { home: 3, away: 4, total: 7 }
//   },
//   goals: {
//     for: { total: 52, average: "1.8" },
//     against: { total: 31, average: "1.1" }
//   }
// }
```

### Obter confrontos diretos (H2H)

```typescript
// Manchester United vs Liverpool
const h2h = await apiFootballService.getH2H({
  h2h: '33-40',
  league: 39,
  season: 2024
});

console.log(h2h);
// Array com histórico de partidas entre os times
```

### Obter previsões da própria API

```typescript
const prediction = await apiFootballService.getPredictions(12345);

console.log(prediction);
// {
//   predictions: {
//     winner: { id: 123, name: "Flamengo", comment: "..." },
//     win_or_draw: true,
//     under_over: "2.5",
//     goals: { home: "1.5", away: "1.0" },
//     advice: "Combo Double Chance : Home/Draw",
//     percent: {
//       home: "45%",
//       draw: "30%",
//       away: "25%"
//     }
//   },
//   league: {...},
//   teams: {...}
// }
```

### Obter todas as ligas disponíveis

```typescript
const leagues = await apiFootballService.getLeagues({
  country: 'Brazil',
  season: 2024
});

console.log(leagues);
// [
//   { id: 71, name: "Série A", ... },
//   { id: 72, name: "Série B", ... },
//   ...
// ]
```

### Obter classificação da liga

```typescript
const standings = await apiFootballService.getStandings({
  league: 71,  // Brasileirão
  season: 2024
});

console.log(standings);
// [{
//   league: {...},
//   standings: [[
//     {
//       rank: 1,
//       team: { id: 123, name: "Flamengo", logo: "..." },
//       points: 45,
//       goalsDiff: 15,
//       all: { played: 20, win: 14, draw: 3, lose: 3 }
//     }
//   ]]
// }]
```

---

## ⚽ Football-Data.org

### Obter partidas

```typescript
const matches = await footballDataService.getMatches(
  undefined,  // todas as competições
  '2024-04-01',
  '2024-04-30'
);

console.log(matches);
// [{
//   id: 12345,
//   utcDate: "2024-04-11T19:45:00Z",
//   status: "SCHEDULED",
//   matchday: 32,
//   homeTeam: {
//     id: 64,
//     name: "Liverpool FC",
//     shortName: "Liverpool",
//     tla: "LIV",
//     crest: "https://..."
//   },
//   awayTeam: {
//     id: 65,
//     name: "Manchester City FC",
//     shortName: "Man City",
//     tla: "MCI",
//     crest: "https://..."
//   },
//   score: {
//     fullTime: { home: null, away: null }
//   },
//   competition: {
//     id: 2021,
//     name: "Premier League",
//     code: "PL",
//     emblem: "https://...",
//     area: {
//       name: "England",
//       code: "ENG",
//       flag: "https://..."
//     }
//   }
// }]
```

### Obter competições

```typescript
const competitions = await footballDataService.getCompetitions();

console.log(competitions);
// [
//   { id: 2021, name: "Premier League", code: "PL", ... },
//   { id: 2014, name: "Primera Division", code: "PD", ... },
//   ...
// ]
```

### Obter partidas de uma competição

```typescript
// Premier League
const premierLeagueMatches = await footballDataService.getMatches(
  2021,
  '2024-04-01',
  '2024-04-30'
);
```

### Obter dados de um time

```typescript
const team = await footballDataService.getTeam(64);  // Liverpool

console.log(team);
// {
//   id: 64,
//   name: "Liverpool FC",
//   shortName: "Liverpool",
//   tla: "LIV",
//   crest: "https://...",
//   address: "Anfield Road Liverpool L4 0TH",
//   website: "http://www.liverpoolfc.com",
//   founded: 1892,
//   clubColors: "Red / White",
//   venue: "Anfield"
// }
```

### Obter classificação

```typescript
const standings = await footballDataService.getStandings(2021);  // Premier League

console.log(standings);
```

---

## 🇩🇪 OpenLigaDB

### Obter partidas da Bundesliga

```typescript
const response = await fetch('https://api.openligadb.de/getmatchdata/bl1');
const matches = await response.json();

console.log(matches);
// [{
//   matchID: 12345,
//   matchDateTime: "2024-04-11T20:30:00",
//   team1: {
//     teamId: 40,
//     teamName: "FC Bayern München",
//     shortName: "Bayern",
//     teamIconUrl: "https://..."
//   },
//   team2: {
//     teamId: 87,
//     teamName: "Borussia Dortmund",
//     shortName: "Dortmund",
//     teamIconUrl: "https://..."
//   },
//   matchResults: [
//     { resultTypeID: 2, pointsTeam1: null, pointsTeam2: null }
//   ],
//   group: { groupName: "34. Spieltag" },
//   leagueName: "1. Fußball-Bundesliga"
// }]
```

### Obter partidas de uma temporada específica

```typescript
const response = await fetch('https://api.openligadb.de/getmatchdata/bl1/2024');
const matches = await response.json();
```

### Obter próximas partidas de um time

```typescript
const response = await fetch(
  'https://api.openligadb.de/getmatchdata/bl1/2024/FC-Bayern-München'
);
const matches = await response.json();
```

### Obter partida atual

```typescript
const response = await fetch('https://api.openligadb.de/getcurrentgroup/bl1');
const currentGroup = await response.json();

const currentMatches = await fetch(
  `https://api.openligadb.de/getmatchdata/bl1/2024/${currentGroup.groupOrderID}`
);
const matches = await currentMatches.json();
```

---

## 🎯 Exemplo Completo: Buscar Partidas do Dia

```typescript
import { loadApiConfig } from './services/apiConfig';
import { FootballDataService } from './services/footballDataService';
import { ApiFootballService } from './services/apiFootballService';

export async function getTodayMatches() {
  const config = loadApiConfig();
  const today = new Date().toISOString().split('T')[0];
  const matches = [];

  // Tentar API-Football primeiro (tem escudos e bandeiras)
  if (config?.apiFootballKey) {
    try {
      const apiFootballService = new ApiFootballService(config.apiFootballKey);
      const apiFootballMatches = await apiFootballService.getFixtures({
        date: today,
        timezone: 'America/Sao_Paulo'
      });

      // Transformar para formato unificado
      matches.push(...apiFootballMatches.map(match => ({
        id: match.fixture.id,
        date: match.fixture.date,
        homeTeam: {
          name: match.teams.home.name,
          logo: match.teams.home.logo
        },
        awayTeam: {
          name: match.teams.away.name,
          logo: match.teams.away.logo
        },
        league: {
          name: match.league.name,
          country: match.league.country,
          flag: match.league.flag
        },
        status: match.fixture.status.short,
        source: 'api-football'
      })));

      return matches;
    } catch (error) {
      console.error('Erro ao buscar da API-Football:', error);
    }
  }

  // Fallback para Football-Data.org
  if (config?.footballDataApiKey) {
    try {
      const footballDataService = new FootballDataService(config.footballDataApiKey);
      const footballDataMatches = await footballDataService.getMatches(
        undefined,
        today,
        today
      );

      matches.push(...footballDataMatches.map(match => ({
        id: match.id,
        date: match.utcDate,
        homeTeam: {
          name: match.homeTeam.name,
          logo: match.homeTeam.crest
        },
        awayTeam: {
          name: match.awayTeam.name,
          logo: match.awayTeam.crest
        },
        league: {
          name: match.competition.name,
          country: match.competition.area.name,
          flag: match.competition.area.flag
        },
        status: match.status,
        source: 'football-data'
      })));

      return matches;
    } catch (error) {
      console.error('Erro ao buscar da Football-Data:', error);
    }
  }

  // Fallback para OpenLigaDB (apenas Bundesliga)
  if (config?.openLigaDbEnabled) {
    try {
      const response = await fetch('https://api.openligadb.de/getmatchdata/bl1');
      const openLigaMatches = await response.json();

      // Filtrar apenas partidas de hoje
      const todayMatches = openLigaMatches.filter(match => {
        const matchDate = new Date(match.matchDateTime).toISOString().split('T')[0];
        return matchDate === today;
      });

      matches.push(...todayMatches.map(match => ({
        id: match.matchID,
        date: match.matchDateTime,
        homeTeam: {
          name: match.team1.teamName,
          logo: match.team1.teamIconUrl
        },
        awayTeam: {
          name: match.team2.teamName,
          logo: match.team2.teamIconUrl
        },
        league: {
          name: match.leagueName,
          country: 'Germany',
          flag: null
        },
        status: 'SCHEDULED',
        source: 'openligadb'
      })));

      return matches;
    } catch (error) {
      console.error('Erro ao buscar da OpenLigaDB:', error);
    }
  }

  return matches;
}
```

---

## 💡 Dicas de Performance

### Cache de Escudos e Bandeiras

```typescript
// Usar API-Football apenas para assets
const CACHE_KEY = 'football_assets_cache';

async function getTeamLogo(teamId: number): Promise<string> {
  const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  
  if (cache[`team_${teamId}`]) {
    return cache[`team_${teamId}`];
  }

  const apiFootballService = new ApiFootballService(config.apiFootballKey);
  const teams = await apiFootballService.getTeams({ search: teamId.toString() });
  
  if (teams.length > 0) {
    cache[`team_${teamId}`] = teams[0].logo;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    return teams[0].logo;
  }

  return '';
}
```

### Combinar APIs

```typescript
// Usar Football-Data para dados + API-Football para imagens
async function getEnhancedMatches() {
  const footballDataService = new FootballDataService(config.footballDataApiKey);
  const apiFootballService = new ApiFootballService(config.apiFootballKey);

  // Buscar partidas (conta como 1 requisição)
  const matches = await footballDataService.getMatches();

  // Enriquecer com logos (usar cache!)
  for (const match of matches) {
    match.homeTeam.logo = await getTeamLogo(match.homeTeam.id);
    match.awayTeam.logo = await getTeamLogo(match.awayTeam.id);
  }

  return matches;
}
```

---

## 🔗 Referências

- [API-Football Docs](https://www.api-football.com/documentation-v3)
- [Football-Data Docs](https://www.football-data.org/documentation/quickstart)
- [OpenLigaDB Samples](https://github.com/OpenLigaDB/OpenLigaDB-Samples)
