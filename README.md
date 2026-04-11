# ⚽ Sistema de Previsões de Futebol com IA

Sistema profissional de previsões de futebol utilizando 5 agentes de IA especialistas para análise completa de partidas.

## 🎯 Características

- **5 Agentes de IA Especialistas**
  - 📊 **StatsMaster**: Análise estatística profunda
  - 📈 **FormAnalyzer**: Análise de momento dos times
  - ⚔️ **H2H Expert**: Especialista em confrontos diretos
  - 🧠 **DeepPredictor**: Machine Learning avançado
  - 🎯 **EnsembleMaster**: Consenso inteligente entre agentes

- **Interface Profissional**
  - Carrossel premium de jogos em destaque
  - Cards organizados por país, liga e times
  - Modal detalhado com análises completas
  - Design responsivo com Tailwind CSS
  - Filtros avançados por data, país e campeonatos

- **Análises Completas**
  - Vencedor da partida
  - Resultado do primeiro tempo
  - Resultado do segundo tempo
  - Over/Under gols
  - Handicap asiático
  - Placar exato
  - Ambos marcam (BTTS)

## 🔌 APIs Suportadas

### 1. API-Football.com (Recomendada) 🌟

**Por que usar?**
- ✅ Escudos dos times em alta resolução
- ✅ Bandeiras de países e competições
- ✅ Mais de 1000 ligas cobertas mundialmente
- ✅ Estatísticas avançadas e previsões próprias
- ✅ Dados em tempo real
- ✅ Histórico completo (H2H)

**Como obter:**
1. Acesse [api-football.com/register](https://www.api-football.com/register)
2. Escolha um plano (gratuito: 100 req/dia)
3. Copie sua API key
4. Configure em Settings → API-Football.com

**Documentação:** [api-football.com/documentation-v3](https://www.api-football.com/documentation-v3)

### 2. Football-Data.org

**Características:**
- ✅ API gratuita com registro simples
- ✅ Dados de competições europeias
- ✅ 10 requisições por minuto
- ✅ Ótima para desenvolvimento

**Como obter:**
1. Acesse [football-data.org/client/register](https://www.football-data.org/client/register)
2. Crie conta gratuita
3. Copie sua API key
4. Configure em Settings → Football-data.org

### 3. OpenLigaDB

**Características:**
- ✅ Completamente gratuito
- ✅ Sem necessidade de registro
- ✅ Focado em ligas alemãs (Bundesliga)
- ✅ Sem limite de requisições

**Como usar:**
- Apenas ative em Settings → OpenLigaDB
- Não requer API key

## 🚀 Instalação

```bash
# Instalar dependências
pnpm install

# Iniciar servidor de desenvolvimento
pnpm dev
```

## ⚙️ Configuração

1. Acesse a página **Settings** no menu lateral
2. Configure suas API keys:
   - API-Football.com (recomendada para produção)
   - Football-Data.org (alternativa gratuita)
   - OpenLigaDB (sempre ativo, sem API key)
3. Clique em **Validar** para testar cada API key
4. Salve as configurações

### ⚠️ Problema de CORS?

Se a validação da Football-Data.org falhar no navegador mas funcionar via `curl`:

- ✅ **Solução implementada**: Validação via backend Supabase
- 📖 Consulte `CORS_SOLUTION.md` para detalhes completos
- 🔧 A validação agora usa servidor para contornar CORS

## 📊 Estrutura do Projeto

```
src/
├── app/
│   ├── components/          # Componentes React
│   │   ├── AgentAnalysis.tsx
│   │   ├── FilterBar.tsx
│   │   ├── Layout.tsx
│   │   ├── MatchCard.tsx
│   │   ├── PredictionDetails.tsx
│   │   ├── PremiumCarousel.tsx
│   │   ├── Sidebar.tsx
│   │   └── ui/              # Componentes shadcn/ui
│   ├── pages/               # Páginas da aplicação
│   │   ├── Home.tsx
│   │   ├── HomeEnhanced.tsx
│   │   ├── AIAgentsPage.tsx
│   │   └── Settings.tsx
│   ├── services/            # Serviços e APIs
│   │   ├── aiAgents.ts      # Lógica dos agentes de IA
│   │   ├── apiConfig.ts     # Configuração das APIs
│   │   ├── apiFootballService.ts
│   │   └── footballDataService.ts
│   └── data/
│       └── mockData.ts      # Dados de exemplo
└── styles/                  # Estilos CSS
```

## 🧠 Agentes de IA

Os agentes atualmente utilizam lógica programada inteligente. Para treinar com dados reais:

1. Consulte `TREINAMENTO_AGENTES.md` para guia completo
2. Consulte `QUICKSTART_TREINAMENTO.md` para início rápido
3. Use os dados das APIs para alimentar os modelos

**Acurácia atual (simulada):**
- EnsembleMaster: 78.3%
- DeepPredictor: 76.8%
- StatsMaster: 73.5%
- FormAnalyzer: 71.2%
- H2H Expert: 68.9%

## 🎨 Tecnologias

- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS v4
- **UI Components:** shadcn/ui
- **Roteamento:** React Router
- **Ícones:** Lucide React
- **Notificações:** Sonner
- **Carrossel:** Embla Carousel

## 📖 Documentação Adicional

- `PROJETO.md` - Visão geral do projeto
- `RESUMO_IMPLEMENTACAO.md` - Resumo técnico da implementação
- `BACKEND_GUIDE.md` - Guia de integração backend
- `TREINAMENTO_AGENTES.md` - Guia completo de treinamento dos agentes
- `QUICKSTART_TREINAMENTO.md` - Início rápido para treinamento

## 🔄 Próximas Features

- [ ] Integração completa com API-Football
- [ ] Sistema de autenticação de usuários
- [ ] Histórico de previsões
- [ ] Treinamento contínuo dos agentes
- [ ] Dashboard de performance dos agentes
- [ ] Sistema de notificações
- [ ] Modo escuro
- [ ] Exportação de análises (PDF/CSV)

## 📝 Licença

MIT

## 👨‍💻 Autor

Desenvolvido com ❤️ usando Claude Code
