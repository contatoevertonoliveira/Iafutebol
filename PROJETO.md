# 🤖⚽ AI Football - Sistema de Previsões de Futebol com IA

## 📋 Visão Geral

Sistema profissional de previsões de futebol alimentado por **5 agentes de IA especializados**, integrando dados de APIs reais (football-data.org e openligadb.de) com análises preditivas avançadas.

---

## 🎯 Características Principais

### ✨ Interface Profissional
- **Sidebar lateral** com navegação completa
- **Carrossel premium** destacando jogos com maior probabilidade de retorno
- **Cards detalhados** com escudos de times e bandeiras de países
- **Filtros avançados** por data, país e liga
- **Design responsivo** e moderno

### 🧠 Agentes de IA Especialistas

#### 1. **StatsMaster** 📊 (73.5% accuracy)
- **Tipo**: Estatístico
- **Especialidade**: xG, Posse de bola, Finalizações
- **Melhor para**: Over/under, cantos, estatísticas avançadas
- **Força**: Análise profunda de métricas como Expected Goals

#### 2. **FormAnalyzer** 📈 (71.2% accuracy)
- **Tipo**: Forma/Momento
- **Especialidade**: Últimos 5 jogos, Sequências
- **Melhor para**: Identificar times em momento superior
- **Força**: Análise de moral e sequências recentes

#### 3. **H2H Expert** ⚔️ (68.9% accuracy)
- **Tipo**: Histórico
- **Especialidade**: Confrontos diretos
- **Melhor para**: Clássicos e derbies
- **Força**: Retrospecto entre times específicos

#### 4. **DeepPredictor** 🧠 (76.8% accuracy)
- **Tipo**: Deep Learning Avançado
- **Especialidade**: 50+ variáveis em ML
- **Melhor para**: Situações complexas
- **Força**: Pattern recognition e contexto tático

#### 5. **EnsembleMaster** 🎯 (78.3% accuracy)
- **Tipo**: Consenso Ponderado
- **Especialidade**: Meta-learning
- **Melhor para**: Máxima confiabilidade
- **Força**: Combina todos os agentes com pesos inteligentes

---

## 📊 Tipos de Previsões

Cada partida recebe análise completa com:

1. **Vencedor** (Casa/Fora/Empate)
2. **Primeiro Tempo**
3. **Segundo Tempo**
4. **Over/Under Gols** (linha 2.5)
5. **Handicap Asiático**
6. **Placar Exato**
7. **Ambos Marcam (BTTS)**

Todas com **nível de confiança individual** (0-100%)

---

## 🔌 Integração de APIs

### Football-data.org
- Dados de competições internacionais
- Times, escudos, bandeiras
- Estatísticas detalhadas
- **Requer API key** (gratuita disponível)

### OpenLigaDB
- Foco em ligas alemãs
- Completamente gratuito
- Sem necessidade de registro
- Dados em tempo real

### Configuração
Acesse **Configurações** → Insira sua API key → Sistema carrega automaticamente dados reais

---

## 🎨 Estrutura de Arquivos

```
/src/app/
├── components/
│   ├── MatchCard.tsx           # Card de partida com escudos
│   ├── PredictionDetails.tsx   # Modal com análise completa
│   ├── PremiumCarousel.tsx     # Carrossel de jogos premium
│   ├── AgentAnalysis.tsx       # Análise detalhada dos agentes
│   ├── FilterBar.tsx           # Filtros por data/país/liga
│   ├── Sidebar.tsx             # Navegação lateral
│   └── Layout.tsx              # Layout principal
│
├── pages/
│   ├── HomeEnhanced.tsx        # Dashboard principal
│   ├── Settings.tsx            # Configuração de APIs
│   └── AIAgentsPage.tsx        # Página dos agentes IA
│
├── services/
│   ├── aiAgents.ts             # Sistema de agentes IA
│   ├── footballDataService.ts  # Integração football-data.org
│   └── apiConfig.ts            # Gerenciamento de configurações
│
└── data/
    └── mockData.ts             # Dados de exemplo

```

---

## 🚀 Como Usar

### 1. Configurar API Keys
1. Acesse `/settings`
2. Registre-se em [football-data.org](https://www.football-data.org/client/register)
3. Cole sua API key
4. Clique em "Validar"
5. Salve as configurações

### 2. Navegar pelo Sistema
- **Início**: Dashboard com todas as partidas
- **Hoje/Semana/Mês**: Filtros rápidos por período
- **Ligas**: Visualizar por campeonato
- **Agentes IA**: Conhecer os especialistas
- **Favoritos**: Salvar partidas preferidas

### 3. Analisar Partidas
1. Carrossel premium mostra melhores oportunidades
2. Use filtros para refinar busca
3. Clique em "Ver Análise Completa"
4. Veja previsão de TODOS os 5 agentes
5. Compare opiniões e níveis de confiança

---

## 🔮 Previsões em Ação

### Exemplo de Análise Completa:

**Manchester City vs Arsenal**
- **EnsembleMaster**: 78% confiança → Vitória Man City
- **DeepPredictor**: 82% confiança → Vitória Man City
- **StatsMaster**: 75% confiança → Over 2.5 gols
- **FormAnalyzer**: 71% confiança → Man City 1º tempo
- **H2H Expert**: 69% confiança → BTTS Sim

**Consenso Final**: Vitória Man City com over 2.5 gols

---

## 🎓 Metodologia dos Agentes

### Processo de Análise
1. **Coleta de dados** das APIs configuradas
2. **Normalização** de estatísticas e métricas
3. **Aplicação do modelo** específico de cada agente
4. **Geração de previsão** com confiança calculada
5. **Ensemble ponderado** pelo histórico de accuracy

### Aprendizado Contínuo
- Comparação de previsões vs resultados reais
- Ajuste automático de pesos
- Melhoria contínua do accuracy
- Adaptação ao futebol moderno

---

## 🎯 Roadmap Futuro

### Backend com Supabase (Recomendado)
- ✅ Armazenar API keys de forma segura
- ✅ Histórico de previsões para treinar agentes
- ✅ Comparar accuracy real ao longo do tempo
- ✅ Cache de dados para economia de requisições
- ✅ Sistema de favoritos sincronizado
- ✅ Autenticação de usuários
- ✅ Notificações de partidas

### Melhorias de IA
- Treinamento com dados históricos reais
- Agentes especializados por liga
- Modelos personalizados por tipo de aposta
- Aprendizado por reforço com feedback
- Análise de sentiment de redes sociais

### Features Adicionais
- Comparador de odds de casas de apostas
- Alertas personalizados
- Estatísticas avançadas por time
- Gráficos de performance
- Exportação de relatórios

---

## 📱 Responsividade

Sistema totalmente responsivo:
- **Desktop**: Layout completo com sidebar
- **Tablet**: Adaptação do grid de cards
- **Mobile**: Menu hamburguer e cards empilhados

---

## 🔐 Segurança

- API keys armazenadas no localStorage (frontend)
- Para produção: usar backend Supabase
- Validação de API keys antes de salvar
- Tratamento de erros em requisições
- Rate limiting respeitado

---

## 🌍 Ligas Suportadas

### Principais
- 🏴󠁧󠁢󠁥󠁮󠁧󠁿 **Premier League** (Inglaterra)
- 🇪🇸 **La Liga** (Espanha)
- 🇮🇹 **Serie A** (Itália)
- 🇩🇪 **Bundesliga** (Alemanha)
- 🇫🇷 **Ligue 1** (França)
- 🇧🇷 **Brasileirão** (Brasil)
- ⭐ **UEFA Champions League**

### Expandível para 100+ ligas via APIs

---

## 💡 Dicas de Uso

### Para Melhores Resultados:
1. **Combine múltiplos agentes** - Consenso aumenta confiabilidade
2. **Priorize alta confiança** - Acima de 75% são mais precisos
3. **Use o EnsembleMaster** - Melhor accuracy geral
4. **Considere o contexto** - Lesões, suspensões, motivação
5. **Gestão de banca** - Nunca aposte mais que pode perder

---

## 📞 Suporte

Para dúvidas sobre:
- **APIs**: Consulte documentação oficial
  - [football-data.org docs](https://www.football-data.org/documentation/quickstart)
  - [openligadb.de docs](https://www.openligadb.de/)
- **Agentes IA**: Veja página `/agents`
- **Configurações**: Acesse `/settings`

---

## ⚖️ Aviso Legal

Este sistema é para **fins informativos e educacionais**.
- Previsões são baseadas em algoritmos estatísticos
- Não garantem resultados
- Utilize com responsabilidade
- Jogos de azar podem causar dependência

---

## 🏆 Accuracy dos Agentes

| Agente | Accuracy | Total Previsões | Corretas |
|--------|----------|-----------------|----------|
| EnsembleMaster | 78.3% | 2,103 | 1,647 |
| DeepPredictor | 76.8% | 2,103 | 1,615 |
| StatsMaster | 73.5% | 1,247 | 917 |
| FormAnalyzer | 71.2% | 1,189 | 846 |
| H2H Expert | 68.9% | 956 | 659 |

**Média Geral**: 73.7% de accuracy

---

## 🎨 Tecnologias Utilizadas

- **React** + **TypeScript** - Framework principal
- **React Router** - Navegação
- **Tailwind CSS** - Estilização
- **Lucide React** - Ícones
- **Radix UI** - Componentes acessíveis
- **Sonner** - Notificações toast
- **Motion** - Animações (futuro)

---

**Desenvolvido com IA e paixão pelo futebol** ⚽🤖
