# 🚀 Guia de Implementação do Backend com Supabase

## Por que usar Backend?

Atualmente o sistema armazena API keys no **localStorage** (apenas no navegador do usuário). Para um sistema profissional de produção, você precisa de:

1. **Segurança**: API keys armazenadas de forma segura
2. **Histórico**: Salvar todas as previsões para treinar os agentes
3. **Accuracy Real**: Comparar previsões com resultados reais
4. **Multi-dispositivo**: Sincronizar dados entre dispositivos
5. **Cache**: Reduzir chamadas às APIs externas
6. **Analytics**: Métricas de uso e performance dos agentes

---

## 📊 Arquitetura Backend

```
Frontend (React)
    ↓
Supabase Edge Functions (Hono)
    ↓
┌─────────────────────┬──────────────────┬─────────────────┐
│  PostgreSQL         │  Supabase Auth   │  Storage        │
│  (Histórico)        │  (Usuários)      │  (Cache)        │
└─────────────────────┴──────────────────┴─────────────────┘
    ↓                    ↓
External APIs      External APIs
(football-data)    (openligadb)
```

---

## 🗄️ Estrutura do Banco de Dados

### Tabelas Necessárias

#### 1. `users`
```sql
- id (uuid, PK)
- email (text)
- created_at (timestamp)
- subscription_tier (text) -- free, pro, premium
```

#### 2. `api_keys`
```sql
- id (uuid, PK)
- user_id (uuid, FK → users.id)
- service_name (text) -- 'football-data', 'openligadb'
- api_key (text, encrypted)
- is_active (boolean)
- created_at (timestamp)
```

#### 3. `matches`
```sql
- id (uuid, PK)
- external_id (text) -- ID da API externa
- home_team (text)
- away_team (text)
- home_team_crest (text)
- away_team_crest (text)
- league (text)
- country (text)
- country_flag (text)
- match_date (timestamp)
- status (text) -- scheduled, live, finished
- final_score_home (int, nullable)
- final_score_away (int, nullable)
- created_at (timestamp)
```

#### 4. `predictions`
```sql
- id (uuid, PK)
- match_id (uuid, FK → matches.id)
- agent_id (text) -- 'stats-master', 'form-analyzer', etc
- predicted_winner (text) -- home, away, draw
- confidence (float)
- over_under_prediction (text)
- over_under_confidence (float)
- btts_prediction (boolean)
- btts_confidence (float)
- correct_score (text)
- correct_score_confidence (float)
- created_at (timestamp)
```

#### 5. `prediction_results`
```sql
- id (uuid, PK)
- prediction_id (uuid, FK → predictions.id)
- was_correct (boolean)
- actual_result (text)
- points_earned (float)
- evaluated_at (timestamp)
```

#### 6. `agent_stats`
```sql
- id (uuid, PK)
- agent_id (text)
- total_predictions (int)
- correct_predictions (int)
- accuracy (float)
- last_updated (timestamp)
```

#### 7. `user_favorites`
```sql
- id (uuid, PK)
- user_id (uuid, FK → users.id)
- match_id (uuid, FK → matches.id)
- created_at (timestamp)
```

#### 8. `api_cache`
```sql
- id (uuid, PK)
- cache_key (text, unique)
- data (jsonb)
- expires_at (timestamp)
- created_at (timestamp)
```

---

## 🔧 Implementação do Backend

### 1. Criar Edge Function no Supabase

Arquivo: `/supabase/functions/server/index.tsx`

```typescript
import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const app = new Hono();

// Middlewares
app.use('*', cors());
app.use('*', logger(console.log));

// Supabase Client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Rotas
app.get('/make-server-1119702f/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Salvar API key do usuário
app.post('/make-server-1119702f/api-keys', async (c) => {
  const { service_name, api_key } = await c.req.json();
  const token = c.req.header('Authorization')?.split(' ')[1];
  
  // Validar usuário
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  // Criptografar e salvar
  const { data, error } = await supabase
    .from('api_keys')
    .upsert({
      user_id: user.id,
      service_name,
      api_key, // Usar encryption do Supabase
      is_active: true
    });

  if (error) return c.json({ error: error.message }, 400);
  return c.json({ success: true });
});

// Buscar partidas (com cache)
app.get('/make-server-1119702f/matches', async (c) => {
  const date = c.req.query('date') || 'today';
  const cacheKey = `matches_${date}`;

  // Verificar cache
  const { data: cached } = await supabase
    .from('api_cache')
    .select('data')
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) return c.json(cached.data);

  // Buscar da API externa
  const token = c.req.header('Authorization')?.split(' ')[1];
  const { data: { user } } = await supabase.auth.getUser(token);
  
  // Pegar API key do usuário
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('api_key')
    .eq('user_id', user.id)
    .eq('service_name', 'football-data')
    .eq('is_active', true)
    .single();

  if (!apiKeyData) {
    return c.json({ error: 'API key not configured' }, 400);
  }

  // Chamar API externa
  const response = await fetch('https://api.football-data.org/v4/matches', {
    headers: { 'X-Auth-Token': apiKeyData.api_key }
  });

  const matches = await response.json();

  // Salvar no cache (1 hora)
  await supabase.from('api_cache').upsert({
    cache_key: cacheKey,
    data: matches,
    expires_at: new Date(Date.now() + 3600000).toISOString()
  });

  // Salvar partidas no banco
  for (const match of matches.matches) {
    await supabase.from('matches').upsert({
      external_id: match.id.toString(),
      home_team: match.homeTeam.name,
      away_team: match.awayTeam.name,
      home_team_crest: match.homeTeam.crest,
      away_team_crest: match.awayTeam.crest,
      league: match.competition.name,
      country: match.competition.area.name,
      country_flag: match.competition.area.flag,
      match_date: match.utcDate,
      status: match.status
    });
  }

  return c.json(matches);
});

// Salvar previsão
app.post('/make-server-1119702f/predictions', async (c) => {
  const prediction = await c.req.json();
  
  const { data, error } = await supabase
    .from('predictions')
    .insert(prediction);

  if (error) return c.json({ error: error.message }, 400);
  return c.json({ success: true, data });
});

// Atualizar resultado da partida e avaliar previsões
app.post('/make-server-1119702f/matches/:id/result', async (c) => {
  const matchId = c.req.param('id');
  const { final_score_home, final_score_away } = await c.req.json();

  // Atualizar partida
  await supabase
    .from('matches')
    .update({ 
      final_score_home, 
      final_score_away, 
      status: 'finished' 
    })
    .eq('id', matchId);

  // Buscar todas as previsões dessa partida
  const { data: predictions } = await supabase
    .from('predictions')
    .select('*')
    .eq('match_id', matchId);

  // Avaliar cada previsão
  for (const pred of predictions || []) {
    const wasCorrect = evaluatePrediction(pred, final_score_home, final_score_away);
    
    await supabase.from('prediction_results').insert({
      prediction_id: pred.id,
      was_correct: wasCorrect,
      actual_result: `${final_score_home}-${final_score_away}`,
      points_earned: wasCorrect ? pred.confidence : 0
    });

    // Atualizar stats do agente
    await updateAgentStats(pred.agent_id, wasCorrect);
  }

  return c.json({ success: true });
});

// Função auxiliar para avaliar previsão
function evaluatePrediction(pred: any, homeScore: number, awayScore: number): boolean {
  if (homeScore > awayScore && pred.predicted_winner === 'home') return true;
  if (homeScore < awayScore && pred.predicted_winner === 'away') return true;
  if (homeScore === awayScore && pred.predicted_winner === 'draw') return true;
  return false;
}

// Atualizar estatísticas do agente
async function updateAgentStats(agentId: string, wasCorrect: boolean) {
  const { data: stats } = await supabase
    .from('agent_stats')
    .select('*')
    .eq('agent_id', agentId)
    .single();

  if (stats) {
    await supabase.from('agent_stats').update({
      total_predictions: stats.total_predictions + 1,
      correct_predictions: stats.correct_predictions + (wasCorrect ? 1 : 0),
      accuracy: ((stats.correct_predictions + (wasCorrect ? 1 : 0)) / (stats.total_predictions + 1)) * 100
    }).eq('agent_id', agentId);
  } else {
    await supabase.from('agent_stats').insert({
      agent_id: agentId,
      total_predictions: 1,
      correct_predictions: wasCorrect ? 1 : 0,
      accuracy: wasCorrect ? 100 : 0
    });
  }
}

Deno.serve(app.fetch);
```

---

## 🔐 Autenticação de Usuários

### Frontend: Login/Signup

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Signup
async function signup(email: string, password: string, name: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });
  
  return { data, error };
}

// Login
async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  return { data, error };
}

// Get Session
async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// Logout
async function logout() {
  await supabase.auth.signOut();
}
```

---

## 📈 Treinamento Contínuo dos Agentes

### Sistema Automático

1. **Coletar Resultados**: Quando partida termina, webhook atualiza resultado
2. **Avaliar Previsões**: Comparar o que cada agente previu vs resultado real
3. **Calcular Accuracy**: Atualizar estatísticas de cada agente
4. **Ajustar Pesos**: No ensemble, dar mais peso aos agentes mais precisos
5. **Retreinar Modelos**: Periodicamente, usar novos dados para melhorar

### Exemplo de Ajuste de Pesos

```typescript
function calculateEnsembleWeights(agents: AgentStats[]) {
  const totalAccuracy = agents.reduce((sum, a) => sum + a.accuracy, 0);
  
  return agents.map(agent => ({
    agentId: agent.agent_id,
    weight: agent.accuracy / totalAccuracy
  }));
}
```

---

## 🎯 Próximos Passos

1. **Configurar Supabase**
   - Criar projeto em supabase.com
   - Copiar URL e Anon Key

2. **Criar Tabelas**
   - Executar SQL das tabelas acima
   - Configurar Row Level Security (RLS)

3. **Deploy Edge Function**
   - Copiar código do servidor
   - Fazer deploy via Supabase CLI

4. **Atualizar Frontend**
   - Trocar localStorage por chamadas ao backend
   - Adicionar autenticação
   - Conectar aos endpoints

5. **Testar**
   - Cadastrar usuário
   - Configurar API key
   - Salvar previsões
   - Ver histórico

---

## 💰 Custos

### Supabase Free Tier
- ✅ 500 MB database
- ✅ 1 GB file storage
- ✅ 2 GB bandwidth
- ✅ 50.000 usuários ativos/mês
- ✅ Edge Functions ilimitadas

**Suficiente para começar!**

### Quando escalar
- Pro: $25/mês (8 GB database, 100 GB bandwidth)
- Team: $599/mês (recursos empresariais)

---

## 🔒 Segurança

### Row Level Security (RLS)

```sql
-- Usuários só veem suas próprias API keys
CREATE POLICY "Users can view own API keys"
ON api_keys FOR SELECT
USING (auth.uid() = user_id);

-- Usuários só podem criar suas próprias API keys
CREATE POLICY "Users can insert own API keys"
ON api_keys FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Todos podem ver partidas
CREATE POLICY "Everyone can view matches"
ON matches FOR SELECT
USING (true);

-- Apenas admin pode atualizar resultados
CREATE POLICY "Only admin can update match results"
ON matches FOR UPDATE
USING (auth.jwt() ->> 'role' = 'admin');
```

---

## 🎓 Recursos Úteis

- [Supabase Docs](https://supabase.com/docs)
- [Hono Framework](https://hono.dev/)
- [Football-data.org API](https://www.football-data.org/documentation)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)

---

**Com backend implementado, seu sistema de IA terá memória, aprenderá continuamente e será verdadeiramente inteligente!** 🚀
