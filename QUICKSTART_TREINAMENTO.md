# ⚡ Quickstart: Treine seu Primeiro Agente HOJE

## 🎯 Objetivo
Treinar o **StatsMaster** (agente estatístico) em **30 minutos** usando dados gratuitos do Kaggle.

---

## 📦 Passo 1: Setup (5 minutos)

```bash
# Criar pasta para o projeto ML
mkdir football-ai-training
cd football-ai-training

# Criar ambiente virtual Python
python3 -m venv venv
source venv/bin/activate  # No Windows: venv\Scripts\activate

# Instalar dependências
pip install pandas numpy scikit-learn joblib kaggle
```

---

## 📊 Passo 2: Baixar Dados (5 minutos)

### Opção A: Kaggle (Recomendado)

1. Crie conta em [kaggle.com](https://www.kaggle.com)
2. Vá em **Account** → **Create New API Token**
3. Baixe o arquivo `kaggle.json`
4. Coloque em `~/.kaggle/kaggle.json` (Linux/Mac) ou `C:\Users\<YourUser>\.kaggle\kaggle.json` (Windows)

```bash
# Baixar dataset
kaggle datasets download -d hugomathien/soccer
unzip soccer.zip

# Ou download manual:
# https://www.kaggle.com/datasets/hugomathien/soccer
```

### Opção B: CSV Exemplo

Crie um arquivo `matches.csv`:

```csv
date,home_team,away_team,home_goals,away_goals,home_shots,away_shots,home_possession,away_possession
2024-01-15,Man City,Arsenal,2,1,18,12,65,35
2024-01-15,Liverpool,Chelsea,3,0,22,8,68,32
2024-01-16,Barcelona,Real Madrid,1,1,15,14,55,45
...
```

---

## 🤖 Passo 3: Treinar Agente (10 minutos)

Crie arquivo `train_stats_master.py`:

```python
import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, classification_report
import joblib

# 1. CARREGAR DADOS
print("📊 Carregando dados...")

# Se usando Kaggle dataset
try:
    # O dataset Kaggle tem tabelas SQL, vamos usar a tabela 'Match'
    import sqlite3
    conn = sqlite3.connect('database.sqlite')
    matches = pd.read_sql_query("""
        SELECT 
            date,
            home_team_goal as home_goals,
            away_team_goal as away_goals,
            possession as home_possession,
            (100 - possession) as away_possession,
            shoton as home_shots_on_target,
            shotoff as home_shots_off_target,
            foulcommit as home_fouls
        FROM Match
        WHERE league_id = 1729  -- Premier League
        AND season = '2015/2016'
    """, conn)
except:
    # Se não tiver o dataset, usar CSV
    matches = pd.read_csv('matches.csv')

print(f"✅ {len(matches)} partidas carregadas")

# 2. PREPARAR FEATURES
print("🔧 Preparando features...")

# Calcular features básicas
matches['total_shots_home'] = matches.get('home_shots_on_target', 0) + matches.get('home_shots_off_target', 0)
matches['total_shots_away'] = matches.get('away_shots_on_target', 0) + matches.get('away_shots_off_target', 0)
matches['shots_difference'] = matches['total_shots_home'] - matches['total_shots_away']
matches['possession_difference'] = matches.get('home_possession', 50) - matches.get('away_possession', 50)

# Target: resultado da partida
def get_result(row):
    if row['home_goals'] > row['away_goals']:
        return 'home'
    elif row['home_goals'] < row['away_goals']:
        return 'away'
    else:
        return 'draw'

matches['result'] = matches.apply(get_result, axis=1)

# Remover linhas com valores nulos
matches = matches.dropna(subset=[
    'total_shots_home', 'total_shots_away', 
    'home_possession', 'away_possession'
])

# 3. SELECIONAR FEATURES
feature_columns = [
    'total_shots_home',
    'total_shots_away', 
    'shots_difference',
    'home_possession',
    'away_possession',
    'possession_difference'
]

X = matches[feature_columns]
y = matches['result']

print(f"📈 Features: {feature_columns}")
print(f"📊 Distribuição de resultados:")
print(y.value_counts())

# 4. SPLIT TREINO/TESTE
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

print(f"\n🔀 Split: {len(X_train)} treino / {len(X_test)} teste")

# 5. NORMALIZAR
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

# 6. TREINAR MODELO
print("\n🤖 Treinando StatsMaster...")

model = GradientBoostingClassifier(
    n_estimators=100,
    learning_rate=0.1,
    max_depth=5,
    random_state=42,
    verbose=1
)

model.fit(X_train_scaled, y_train)

# 7. AVALIAR
print("\n📊 Avaliando modelo...")

y_pred_train = model.predict(X_train_scaled)
y_pred_test = model.predict(X_test_scaled)

train_accuracy = accuracy_score(y_train, y_pred_train)
test_accuracy = accuracy_score(y_test, y_pred_test)

print(f"\n✅ Accuracy Treino: {train_accuracy:.2%}")
print(f"✅ Accuracy Teste: {test_accuracy:.2%}")

print("\n📋 Relatório Detalhado:")
print(classification_report(y_test, y_pred_test))

# Importância das features
feature_importance = pd.DataFrame({
    'feature': feature_columns,
    'importance': model.feature_importances_
}).sort_values('importance', ascending=False)

print("\n🎯 Importância das Features:")
print(feature_importance)

# 8. SALVAR MODELO
print("\n💾 Salvando modelo...")

import os
os.makedirs('models', exist_ok=True)

joblib.dump(model, 'models/stats_master.pkl')
joblib.dump(scaler, 'models/stats_master_scaler.pkl')

print("✅ Modelo salvo em models/stats_master.pkl")

# 9. TESTAR PREVISÃO
print("\n🧪 Testando previsão em partida exemplo...")

exemplo = np.array([[
    18,  # total_shots_home
    12,  # total_shots_away
    6,   # shots_difference
    65,  # home_possession
    35,  # away_possession
    30   # possession_difference
]])

exemplo_scaled = scaler.transform(exemplo)
predicao = model.predict(exemplo_scaled)[0]
probabilidades = model.predict_proba(exemplo_scaled)[0]

print(f"\n🎯 Previsão: {predicao}")
print(f"📊 Probabilidades:")
print(f"  - Casa: {probabilidades[0] if model.classes_[0] == 'away' else probabilidades[2]:.1%}")
print(f"  - Empate: {probabilidades[1]:.1%}")
print(f"  - Fora: {probabilidades[2] if model.classes_[2] == 'home' else probabilidades[0]:.1%}")

print("\n🎉 TREINAMENTO COMPLETO!")
print(f"Seu agente StatsMaster tem {test_accuracy:.1%} de accuracy!")
```

Execute:

```bash
python train_stats_master.py
```

---

## 🧪 Passo 4: Testar o Modelo (5 minutos)

Crie `test_prediction.py`:

```python
import joblib
import numpy as np

# Carregar modelo treinado
model = joblib.load('models/stats_master.pkl')
scaler = joblib.load('models/stats_master_scaler.pkl')

def predict_match(home_shots, away_shots, home_poss, away_poss):
    """
    Prevê resultado de uma partida
    """
    # Calcular features
    shots_diff = home_shots - away_shots
    poss_diff = home_poss - away_poss
    
    # Criar array de features
    features = np.array([[
        home_shots,
        away_shots,
        shots_diff,
        home_poss,
        away_poss,
        poss_diff
    ]])
    
    # Normalizar
    features_scaled = scaler.transform(features)
    
    # Prever
    prediction = model.predict(features_scaled)[0]
    probabilities = model.predict_proba(features_scaled)[0]
    
    # Mapear classes (pode variar)
    class_map = {cls: prob for cls, prob in zip(model.classes_, probabilities)}
    
    return {
        'winner': prediction,
        'confidence': max(probabilities) * 100,
        'probabilities': {
            'home': class_map.get('home', 0) * 100,
            'draw': class_map.get('draw', 0) * 100,
            'away': class_map.get('away', 0) * 100
        }
    }

# Testar com partida exemplo
print("⚽ Manchester City vs Arsenal")
print("   Man City: 18 chutes, 65% posse")
print("   Arsenal: 12 chutes, 35% posse")
print()

result = predict_match(
    home_shots=18,
    away_shots=12,
    home_poss=65,
    away_poss=35
)

print(f"🎯 Previsão: {result['winner'].upper()}")
print(f"🔥 Confiança: {result['confidence']:.1f}%")
print(f"\n📊 Probabilidades:")
print(f"   Casa: {result['probabilities']['home']:.1f}%")
print(f"   Empate: {result['probabilities']['draw']:.1f}%")
print(f"   Fora: {result['probabilities']['away']:.1f}%")
```

---

## 🔌 Passo 5: Integrar ao Sistema (5 minutos)

### Opção A: API Python Simples

Crie `api.py`:

```python
from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import numpy as np

app = FastAPI()

# Carregar modelo
model = joblib.load('models/stats_master.pkl')
scaler = joblib.load('models/stats_master_scaler.pkl')

class MatchStats(BaseModel):
    home_shots: float
    away_shots: float
    home_possession: float
    away_possession: float

@app.post("/predict/stats-master")
async def predict_stats_master(stats: MatchStats):
    # Preparar features
    features = np.array([[
        stats.home_shots,
        stats.away_shots,
        stats.home_shots - stats.away_shots,
        stats.home_possession,
        stats.away_possession,
        stats.home_possession - stats.away_possession
    ]])
    
    # Escalar e prever
    features_scaled = scaler.transform(features)
    prediction = model.predict(features_scaled)[0]
    probabilities = model.predict_proba(features_scaled)[0]
    
    # Mapear classes
    class_map = {cls: prob for cls, prob in zip(model.classes_, probabilities)}
    
    return {
        "agent": "StatsMaster",
        "winner": prediction,
        "confidence": float(max(probabilities) * 100),
        "probabilities": {
            "home": float(class_map.get('home', 0) * 100),
            "draw": float(class_map.get('draw', 0) * 100),
            "away": float(class_map.get('away', 0) * 100)
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Instale e rode:

```bash
pip install fastapi uvicorn
python api.py
```

Teste em outro terminal:

```bash
curl -X POST "http://localhost:8000/predict/stats-master" \
  -H "Content-Type: application/json" \
  -d '{
    "home_shots": 18,
    "away_shots": 12,
    "home_possession": 65,
    "away_possession": 35
  }'
```

### Opção B: Integrar Diretamente no TypeScript

Atualize `/src/app/services/aiAgents.ts`:

```typescript
export class StatsMasterRealAgent extends AIAgent {
  private apiUrl = 'http://localhost:8000';

  async predict(match: FootballMatch): Promise<AgentPrediction> {
    // TODO: Extrair estatísticas reais da partida
    // Por enquanto, usar médias históricas ou dados da API
    
    const response = await fetch(`${this.apiUrl}/predict/stats-master`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        home_shots: 15, // Extrair de stats reais
        away_shots: 12,
        home_possession: 55,
        away_possession: 45
      })
    });

    const data = await response.json();
    
    return {
      agentName: 'StatsMaster',
      agentType: 'statistical',
      confidence: data.confidence,
      winner: data.winner,
      winnerConfidence: data.probabilities[data.winner],
      // ... resto das previsões
      reasoning: `Análise estatística baseada em ${data.confidence.toFixed(1)}% de confiança`,
      // ... fatores
    };
  }
}
```

---

## 🎯 Resultado Esperado

Após esse quickstart, você terá:

- ✅ **Modelo treinado** com dados reais
- ✅ **Accuracy realista** (provavelmente 45-55%)
- ✅ **API funcionando** para servir previsões
- ✅ **Experiência prática** com ML para futebol

## 🚀 Próximos Passos

1. **Melhorar features**: adicionar xG, corners, cartões
2. **Mais dados**: treinar com 5+ temporadas
3. **Validação cruzada**: testar em diferentes ligas
4. **Hyperparameter tuning**: otimizar parâmetros do modelo
5. **Treinar outros agentes**: FormAnalyzer, H2H Expert, etc

---

## 📚 Recursos Extras

- [Kaggle: Soccer Database](https://www.kaggle.com/datasets/hugomathien/soccer)
- [Scikit-learn Tutorial](https://scikit-learn.org/stable/tutorial/index.html)
- [FastAPI Tutorial](https://fastapi.tiangolo.com/tutorial/)
- [Football Analytics com Python](https://github.com/CleKraus/soccer_analytics)

---

**Comece agora e tenha seu primeiro agente de IA treinado em 30 minutos!** 🚀⚽
