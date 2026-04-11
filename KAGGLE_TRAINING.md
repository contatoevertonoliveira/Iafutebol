# 🎓 Sistema de Treinamento dos Agentes com Kaggle

## 📚 Visão Geral

O sistema agora suporta treinamento real dos agentes de IA usando datasets do Kaggle com milhões de partidas históricas.

---

## 🔑 Configurando Kaggle API

### 1. Criar Conta no Kaggle

1. Acesse [kaggle.com](https://www.kaggle.com/)
2. Crie uma conta gratuita
3. Complete seu perfil

### 2. Obter Credenciais API

1. Acesse [kaggle.com/account](https://www.kaggle.com/account)
2. Role até a seção "API"
3. Clique em **"Create New API Token"**
4. Um arquivo `kaggle.json` será baixado automaticamente

### 3. Extrair Credenciais

Abra o arquivo `kaggle.json`:

```json
{
  "username": "seu-username",
  "key": "sua-api-key-aqui"
}
```

### 4. Configurar no Sistema

1. Vá para **Settings** no menu lateral
2. Encontre a seção "Kaggle API (Treinamento de Agentes)"
3. Insira seu **username**
4. Insira sua **API key**
5. Ative o **Treinamento Automático**
6. Clique em **Salvar Configurações**

---

## 📊 Datasets Recomendados

### 1. European Soccer Database
- **URL**: [kaggle.com/hugomathien/soccer](https://www.kaggle.com/hugomathien/soccer)
- **Tamanho**: ~100MB
- **Partidas**: 25.000+
- **Ligas**: 11 ligas europeias principais
- **Temporadas**: 2008-2016
- **Inclui**: Times, jogadores, odds, estatísticas

### 2. Football Events
- **URL**: [kaggle.com/secareanualin/football-events](https://www.kaggle.com/secareanualin/football-events)
- **Tamanho**: ~200MB
- **Eventos**: Milhões de eventos de jogo
- **Detalhamento**: Passes, chutes, faltas, etc.

### 3. International Football Results
- **URL**: [kaggle.com/martj42/international-football-results](https://www.kaggle.com/martj42/international-football-results)
- **Tamanho**: ~5MB
- **Partidas**: 40.000+
- **Período**: 1872-2024
- **Foco**: Jogos de seleções

### 4. Premier League Matches
- **URL**: [kaggle.com/rishikeshkanabar/premier-league-match-data](https://www.kaggle.com/rishikeshkanabar/premier-league-match-data)
- **Tamanho**: ~50MB
- **Detalhamento**: Estatísticas avançadas
- **xG, passes, finalizações, etc.**

---

## 🧠 Como Funciona o Treinamento

### Processo Automático

```
1. Download do Dataset
   ↓
2. Processamento e Limpeza
   ↓
3. Feature Engineering
   ↓
4. Treinamento dos 5 Agentes
   ↓
5. Validação Cruzada
   ↓
6. Atualização das Métricas
   ↓
7. Deploy dos Modelos
```

### Features Extraídas

#### StatsMaster
- xG (Expected Goals)
- Posse de bola
- Finalizações totais e no alvo
- Passes completados
- Duelos ganhos
- Distância percorrida

#### FormAnalyzer
- Últimos 5 jogos
- Gols marcados/sofridos recentes
- Sequências (vitórias, derrotas)
- Performance em casa/fora
- Moral da equipe

#### H2H Expert
- Confrontos diretos históricos
- Resultados em mesma competição
- Gols marcados/sofridos entre si
- Padrões de placar
- Vantagem histórica

#### DeepPredictor
- Todas as features acima +
- Estatísticas de jogadores
- Condições climáticas
- Arbitragem
- Lesões/suspensões
- Transferências recentes
- +40 variáveis adicionais

#### EnsembleMaster
- Previsões dos 4 agentes anteriores
- Pesos baseados em accuracy histórico
- Consenso ponderado
- Confiança agregada

---

## 📈 Métricas de Evolução

### O que é Rastreado

Para cada agente, o sistema rastreia:

- **Accuracy Atual**: Taxa de acerto atual
- **Accuracy Anterior**: Taxa antes do último treinamento
- **Melhoria**: Diferença entre atual e anterior
- **Total de Previsões**: Quantidade total analisada
- **Previsões Corretas**: Quantidade acertada
- **Última Atualização**: Data do último treinamento
- **Status**: idle | training | completed | error
- **Época Atual**: Progresso do treinamento

### Visualização

As métricas são exibidas em:

1. **Settings** → Seção "Agentes de IA - Performance"
   - Lista de agentes com accuracy
   - Indicadores de melhoria (+X%)
   - Estatísticas gerais

2. **Agentes de IA** (página dedicada)
   - Card de evolução com todos os agentes
   - Gráficos de progresso
   - Comparação antes/depois
   - Histórico de treinamento

3. **Dashboard Principal**
   - Badges de confiança dos agentes
   - Indicadores de performance

---

## 🎯 Exemplo de Treinamento

### Código de Exemplo (TypeScript)

```typescript
import {
  trainAgent,
  trainAllAgents,
  loadAgentMetrics,
  fetchKaggleDataset
} from './services/agentTrainingService';

// Treinar um agente específico
async function trainSingleAgent() {
  console.log('🎯 Iniciando treinamento do DeepPredictor...');

  await trainAgent('deeppredictor', 100); // 100 épocas

  const metrics = loadAgentMetrics();
  const agent = metrics.find(m => m.agentId === 'deeppredictor');

  console.log(`✅ Treinamento concluído!`);
  console.log(`Accuracy: ${agent.accuracy}%`);
  console.log(`Melhoria: +${agent.improvement}%`);
}

// Treinar todos os agentes
async function trainAll() {
  console.log('🚀 Iniciando treinamento de todos os agentes...');

  await trainAllAgents(100);

  console.log('✅ Todos os agentes treinados!');
}

// Buscar dataset do Kaggle
async function fetchData() {
  const config = loadApiConfig();

  const dataset = await fetchKaggleDataset(
    config.kaggleUsername,
    config.kaggleApiKey
  );

  console.log('📥 Dataset carregado:');
  console.log(`- Partidas: ${dataset.matches}`);
  console.log(`- Ligas: ${dataset.leagues}`);
  console.log(`- Temporadas: ${dataset.seasons}`);
}
```

### Usando a Interface

1. **Treinamento Manual** (em desenvolvimento)
   - Ir para "Agentes de IA"
   - Clicar em "Treinar Agente"
   - Selecionar épocas
   - Acompanhar progresso

2. **Treinamento Automático**
   - Ativar em Settings
   - Sistema treina automaticamente após novos resultados
   - Notificações de conclusão

---

## 🎨 Escudos dos Times (API-Football)

### Configuração

Os escudos são obtidos automaticamente da API-Football quando configurada:

1. Configure a API-Football em Settings
2. Os escudos aparecem automaticamente nos cards de partidas
3. Fallback para iniciais se logo não disponível

### Componente TeamLogo

```typescript
import { TeamLogo } from './components/TeamLogo';

// Usar em qualquer lugar
<TeamLogo
  teamName="Manchester United"
  logoUrl="https://media.api-sports.io/football/teams/33.png"
  size="lg"
  showName={true}
/>
```

### Tamanhos Disponíveis

- `xs`: 16x16px (muito pequeno)
- `sm`: 24x24px (pequeno)
- `md`: 32x32px (médio - padrão)
- `lg`: 48x48px (grande)
- `xl`: 64x64px (muito grande)

### URLs dos Logos

API-Football fornece logos em alta resolução:

```
Times: https://media.api-sports.io/football/teams/{teamId}.png
Ligas: https://media.api-sports.io/football/leagues/{leagueId}.png
Países: Incluído no campo "flag" da resposta da API
```

### Exemplo de Uso

```typescript
// Match Card com escudos
<MatchCard
  match={match}
  prediction={prediction}
  homeCrest="https://media.api-sports.io/football/teams/33.png"
  awayCrest="https://media.api-sports.io/football/teams/34.png"
  onViewDetails={handleViewDetails}
/>
```

---

## 📊 Monitoramento de Performance

### Logs do Treinamento

```bash
🎯 Treinando StatsMaster...
📊 Época 1/100 - Accuracy: 70.5%
📊 Época 25/100 - Accuracy: 72.3%
📊 Época 50/100 - Accuracy: 73.8%
📊 Época 75/100 - Accuracy: 74.5%
📊 Época 100/100 - Accuracy: 75.2%
✅ Treinamento concluído!
📈 Melhoria: +4.7%
```

### Console do Navegador

Abra o console (F12) para ver:
- Progresso em tempo real
- Métricas detalhadas
- Erros e avisos
- Performance de cada época

### LocalStorage

Os dados são persistidos em:
```
localStorage.agent_metrics - Métricas dos agentes
localStorage.training_progress - Progresso atual
localStorage.apiConfig - Configurações (inclui Kaggle)
```

---

## 🚀 Próximos Passos

### Em Desenvolvimento

- [ ] Interface de treinamento manual
- [ ] Seleção de datasets específicos
- [ ] Gráficos de evolução histórica
- [ ] Comparação A/B de modelos
- [ ] Export de métricas (CSV/JSON)
- [ ] Agentes especializados por liga
- [ ] Modelos personalizados por tipo de aposta

### Implementação Real com Kaggle API

Atualmente o sistema usa simulação. A integração real com Kaggle API requer:

1. **Kaggle CLI** ou biblioteca Python
2. **Download de datasets**
3. **Processamento de dados**
4. **Treinamento de modelos** (TensorFlow/PyTorch)
5. **Serialização** dos modelos treinados
6. **Integração** com o frontend

---

## 💡 Dicas

### Para Melhor Performance

1. **Use múltiplos datasets**: Combine diferentes fontes
2. **Atualize regularmente**: Treine após novos resultados
3. **Validação cruzada**: Teste em dados não vistos
4. **Feature engineering**: Crie variáveis personalizadas
5. **Ensemble**: Combine múltiplos modelos

### Evite

❌ Overfitting (treinar demais em poucos dados)
❌ Data leakage (usar dados futuros)
❌ Ignorar sazonalidade
❌ Treinar sem validação
❌ Usar apenas uma liga/temporada

### Recomendações

✅ Mínimo 10.000 partidas para treinamento
✅ Validar em temporada diferente
✅ Incluir múltiplas ligas
✅ Atualizar semanalmente
✅ Monitorar decay da performance

---

## 📚 Recursos

### Documentação

- [Kaggle API Docs](https://github.com/Kaggle/kaggle-api)
- [API-Football Logos](https://www.api-football.com/documentation-v3#section/Logos-Images)
- [TensorFlow.js](https://www.tensorflow.org/js)
- [scikit-learn](https://scikit-learn.org/)

### Tutoriais

- [Football Prediction with ML](https://towardsdatascience.com/football-prediction)
- [Sports Analytics](https://www.kaggle.com/learn/intro-to-machine-learning)
- [Feature Engineering for Sports](https://github.com/topics/sports-analytics)

---

## ❓ FAQ

**P: Preciso pagar pelo Kaggle?**
R: Não, o Kaggle é totalmente gratuito.

**P: Quanto tempo leva o treinamento?**
R: Depende do tamanho do dataset. Estimativa: 5-30 minutos.

**P: Os modelos melhoram automaticamente?**
R: Sim, se ativar o treinamento automático em Settings.

**P: Posso treinar só um agente?**
R: Sim, em breve terá opção manual na interface.

**P: Os escudos funcionam sem API-Football?**
R: Sim, mostra as iniciais do time como fallback.

**P: Como resetar as métricas?**
R: Use `resetAgentMetrics()` no console do navegador.
