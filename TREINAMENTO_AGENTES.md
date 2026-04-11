# 🎓 Guia de Treinamento dos Agentes de IA

## ⚠️ SITUAÇÃO ATUAL

**Os agentes NÃO estão treinados ainda!**

Atualmente eles são **simulações** que geram previsões usando:
- Lógica programada simples
- `Math.random()` para variação
- Regras baseadas no tipo do agente
- **NÃO usam dados históricos reais**
- **NÃO aprendem com resultados**

### Por que simulados?
- Para demonstrar a **arquitetura** do sistema
- Permitir testar a **interface** sem dependências
- Mostrar **como seria** com agentes reais
- Funcionar sem necessidade de backend/GPU

---

## 🚀 COMO TREINAR OS AGENTES DE VERDADE

### Etapa 1: Coletar Dados Históricos 📊

Você precisa de um **dataset** com milhares de partidas passadas contendo:

#### Dados Mínimos Necessários
```json
{
  "match_id": "12345",
  "date": "2025-01-15",
  "home_team": "Manchester City",
  "away_team": "Arsenal",
  "league": "Premier League",
  "home_score": 2,
  "away_score": 1,
  
  // Features estatísticas (para StatsMaster)
  "home_xg": 2.3,
  "away_xg": 1.1,
  "home_possession": 65,
  "away_possession": 35,
  "home_shots": 18,
  "away_shots": 8,
  "home_shots_on_target": 7,
  "away_shots_on_target": 3,
  
  // Features de forma (para FormAnalyzer)
  "home_last_5_results": [3, 3, 1, 3, 3], // W=3, D=1, L=0
  "away_last_5_results": [3, 3, 3, 1, 3],
  "home_goals_last_5": 12,
  "away_goals_last_5": 10,
  
  // Features H2H (para H2H Expert)
  "h2h_home_wins": 15,
  "h2h_away_wins": 8,
  "h2h_draws": 5,
  "h2h_last_5": ["H", "A", "D", "H", "H"],
  
  // Outros
  "home_advantage": true,
  "home_market_value": 1200000000, // euros
  "away_market_value": 950000000
}
```

#### Fontes de Dados
1. **football-data.org** (API já integrada!)
   - Partidas históricas
   - Estatísticas por jogo
   - Limitação: apenas últimas temporadas no plano gratuito

2. **API-Football (RapidAPI)**
   - Dados muito completos
   - Estatísticas avançadas (xG, posse, etc)
   - ~$30/mês para acesso básico

3. **Understat.com** (web scraping)
   - Excelente para xG
   - Dados de shot maps
   - Scraping permitido respeitando robots.txt

4. **FBref.com** (web scraping)
   - Estatísticas avançadas tipo StatsBomb
   - Métricas táticas

5. **Kaggle Datasets**
   - European Soccer Database (25k+ partidas)
   - Football Events (com coordinates)
   - Gratuito!

---

### Etapa 2: Preparar os Dados 🧹

Criar script Python para processar os dados:

```python
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def prepare_training_data(raw_matches):
    """
    Transforma dados brutos em features para ML
    """
    df = pd.DataFrame(raw_matches)
    
    # Feature Engineering
    
    # 1. Target (o que queremos prever)
    df['result'] = df.apply(lambda x: 
        'home' if x['home_score'] > x['away_score'] else
        'away' if x['home_score'] < x['away_score'] else
        'draw', axis=1)
    
    df['total_goals'] = df['home_score'] + df['away_score']
    df['btts'] = (df['home_score'] > 0) & (df['away_score'] > 0)
    
    # 2. Features de Forma
    df['home_form_points'] = df['home_last_5_results'].apply(sum)
    df['away_form_points'] = df['away_last_5_results'].apply(sum)
    df['form_difference'] = df['home_form_points'] - df['away_form_points']
    
    # 3. Features Estatísticas
    df['xg_difference'] = df['home_xg'] - df['away_xg']
    df['possession_difference'] = df['home_possession'] - df['away_possession']
    df['shots_difference'] = df['home_shots'] - df['away_shots']
    
    # 4. Features H2H
    df['h2h_home_win_rate'] = df['h2h_home_wins'] / (df['h2h_home_wins'] + df['h2h_away_wins'] + df['h2h_draws'])
    
    # 5. Features de Valor
    df['value_difference'] = df['home_market_value'] - df['away_market_value']
    
    # 6. Features Temporais
    df['month'] = pd.to_datetime(df['date']).dt.month
    df['day_of_week'] = pd.to_datetime(df['date']).dt.dayofweek
    
    return df

# Exemplo de uso
matches = load_matches_from_api()
training_data = prepare_training_data(matches)
training_data.to_csv('football_training_data.csv', index=False)
```

---

### Etapa 3: Treinar Cada Agente 🤖

#### **Agente 1: StatsMaster (Estatístico)**

Modelo baseado em **Regressão Logística** ou **XGBoost**

```python
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

def train_stats_master(df):
    """
    Treina agente focado em estatísticas
    """
    # Features relevantes para análise estatística
    features = [
        'home_xg', 'away_xg', 'xg_difference',
        'home_possession', 'away_possession',
        'home_shots', 'away_shots',
        'home_shots_on_target', 'away_shots_on_target',
        'shots_difference'
    ]
    
    X = df[features]
    y = df['result']  # 'home', 'away', 'draw'
    
    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    
    # Normalizar
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Treinar modelo
    model = GradientBoostingClassifier(
        n_estimators=100,
        learning_rate=0.1,
        max_depth=5,
        random_state=42
    )
    
    model.fit(X_train_scaled, y_train)
    
    # Avaliar
    accuracy = model.score(X_test_scaled, y_test)
    print(f"StatsMaster Accuracy: {accuracy:.2%}")
    
    return model, scaler

# Treinar
stats_master_model, stats_master_scaler = train_stats_master(training_data)

# Salvar
import joblib
joblib.dump(stats_master_model, 'models/stats_master.pkl')
joblib.dump(stats_master_scaler, 'models/stats_master_scaler.pkl')
```

#### **Agente 2: FormAnalyzer (Momento)**

Modelo baseado em **Random Forest** ou **LSTM** (para sequências)

```python
from sklearn.ensemble import RandomForestClassifier

def train_form_analyzer(df):
    """
    Treina agente focado em forma/momento
    """
    features = [
        'home_form_points', 'away_form_points', 'form_difference',
        'home_goals_last_5', 'away_goals_last_5',
        'home_last_5_results',  # pode precisar flatten
        'away_last_5_results'
    ]
    
    # Flatten arrays de últimos 5 jogos
    df_expanded = df.copy()
    for i in range(5):
        df_expanded[f'home_match_minus_{i}'] = df['home_last_5_results'].apply(lambda x: x[i] if len(x) > i else 0)
        df_expanded[f'away_match_minus_{i}'] = df['away_last_5_results'].apply(lambda x: x[i] if len(x) > i else 0)
    
    feature_cols = [
        'home_form_points', 'away_form_points', 'form_difference',
        'home_goals_last_5', 'away_goals_last_5'
    ] + [f'home_match_minus_{i}' for i in range(5)] + [f'away_match_minus_{i}' for i in range(5)]
    
    X = df_expanded[feature_cols]
    y = df['result']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        min_samples_split=10,
        random_state=42
    )
    
    model.fit(X_train, y_train)
    accuracy = model.score(X_test, y_test)
    print(f"FormAnalyzer Accuracy: {accuracy:.2%}")
    
    return model

form_analyzer_model = train_form_analyzer(training_data)
joblib.dump(form_analyzer_model, 'models/form_analyzer.pkl')
```

#### **Agente 3: H2H Expert (Histórico)**

Modelo baseado em **K-Nearest Neighbors** ou **Naive Bayes**

```python
from sklearn.neighbors import KNeighborsClassifier

def train_h2h_expert(df):
    """
    Treina agente focado em histórico H2H
    """
    features = [
        'h2h_home_wins', 'h2h_away_wins', 'h2h_draws',
        'h2h_home_win_rate'
    ]
    
    # Encoding do histórico recente
    h2h_encoding = {'H': 1, 'A': -1, 'D': 0}
    for i in range(5):
        df[f'h2h_minus_{i}'] = df['h2h_last_5'].apply(
            lambda x: h2h_encoding.get(x[i], 0) if len(x) > i else 0
        )
    
    feature_cols = features + [f'h2h_minus_{i}' for i in range(5)]
    
    X = df[feature_cols]
    y = df['result']
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    model = KNeighborsClassifier(n_neighbors=15, weights='distance')
    model.fit(X_train, y_train)
    
    accuracy = model.score(X_test, y_test)
    print(f"H2H Expert Accuracy: {accuracy:.2%}")
    
    return model

h2h_expert_model = train_h2h_expert(training_data)
joblib.dump(h2h_expert_model, 'models/h2h_expert.pkl')
```

#### **Agente 4: DeepPredictor (Deep Learning)**

Modelo baseado em **Neural Network** (TensorFlow/PyTorch)

```python
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

def train_deep_predictor(df):
    """
    Treina agente com deep learning (50+ features)
    """
    # Todas as features possíveis
    all_features = [
        'home_xg', 'away_xg', 'xg_difference',
        'home_possession', 'away_possession', 'possession_difference',
        'home_shots', 'away_shots', 'shots_difference',
        'home_form_points', 'away_form_points', 'form_difference',
        'h2h_home_win_rate', 'value_difference',
        'month', 'day_of_week'
    ] + [f'home_match_minus_{i}' for i in range(5)] + \
        [f'away_match_minus_{i}' for i in range(5)]
    
    X = df[all_features]
    y = pd.get_dummies(df['result'])  # One-hot encoding
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Normalizar
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Construir rede neural
    model = keras.Sequential([
        layers.Dense(128, activation='relu', input_shape=(X_train_scaled.shape[1],)),
        layers.Dropout(0.3),
        layers.Dense(64, activation='relu'),
        layers.Dropout(0.2),
        layers.Dense(32, activation='relu'),
        layers.Dense(3, activation='softmax')  # home, away, draw
    ])
    
    model.compile(
        optimizer='adam',
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    
    # Treinar
    history = model.fit(
        X_train_scaled, y_train,
        epochs=50,
        batch_size=32,
        validation_split=0.2,
        verbose=1
    )
    
    # Avaliar
    loss, accuracy = model.evaluate(X_test_scaled, y_test)
    print(f"DeepPredictor Accuracy: {accuracy:.2%}")
    
    # Salvar
    model.save('models/deep_predictor.h5')
    joblib.dump(scaler, 'models/deep_predictor_scaler.pkl')
    
    return model, scaler

deep_model, deep_scaler = train_deep_predictor(training_data)
```

#### **Agente 5: EnsembleMaster (Consenso)**

Este não precisa ser treinado separadamente - ele combina os outros!

```python
def ensemble_predict(match_features, models):
    """
    Combina previsões de todos os agentes
    """
    predictions = {}
    confidences = {}
    
    # StatsMaster
    stats_pred = models['stats_master'].predict_proba(match_features['stats'])[0]
    predictions['stats'] = stats_pred
    confidences['stats'] = max(stats_pred)
    
    # FormAnalyzer
    form_pred = models['form_analyzer'].predict_proba(match_features['form'])[0]
    predictions['form'] = form_pred
    confidences['form'] = max(form_pred)
    
    # H2H Expert
    h2h_pred = models['h2h'].predict_proba(match_features['h2h'])[0]
    predictions['h2h'] = h2h_pred
    confidences['h2h'] = max(h2h_pred)
    
    # DeepPredictor
    deep_pred = models['deep'].predict(match_features['deep'])[0]
    predictions['deep'] = deep_pred
    confidences['deep'] = max(deep_pred)
    
    # Pesos baseados na accuracy de cada agente
    weights = {
        'stats': 0.735,  # 73.5% accuracy
        'form': 0.712,   # 71.2% accuracy
        'h2h': 0.689,    # 68.9% accuracy
        'deep': 0.768    # 76.8% accuracy
    }
    
    # Normalizar pesos
    total_weight = sum(weights.values())
    weights = {k: v/total_weight for k, v in weights.items()}
    
    # Média ponderada
    ensemble_pred = np.zeros(3)  # [home, draw, away]
    for agent, pred in predictions.items():
        ensemble_pred += pred * weights[agent]
    
    # Resultado final
    classes = ['away', 'draw', 'home']  # ordem alfabética
    winner_idx = np.argmax(ensemble_pred)
    winner = classes[winner_idx]
    confidence = ensemble_pred[winner_idx] * 100
    
    return {
        'winner': winner,
        'confidence': confidence,
        'individual_predictions': predictions
    }
```

---

### Etapa 4: Integrar ao Sistema TypeScript 🔧

Criar uma **API Python** (Flask/FastAPI) para servir os modelos:

```python
from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import numpy as np

app = FastAPI()

# Carregar modelos
models = {
    'stats_master': joblib.load('models/stats_master.pkl'),
    'form_analyzer': joblib.load('models/form_analyzer.pkl'),
    'h2h_expert': joblib.load('models/h2h_expert.pkl'),
}

class MatchFeatures(BaseModel):
    home_xg: float
    away_xg: float
    home_possession: float
    away_possession: float
    home_form_points: int
    away_form_points: int
    # ... todas as features

@app.post("/predict")
async def predict(features: MatchFeatures):
    """
    Gera previsões de todos os agentes para uma partida
    """
    # Preparar features
    X_stats = np.array([[
        features.home_xg, features.away_xg,
        features.home_possession, features.away_possession,
        # ...
    ]])
    
    # Prever com cada agente
    predictions = {}
    
    stats_pred = models['stats_master'].predict_proba(X_stats)[0]
    predictions['stats_master'] = {
        'winner': ['away', 'draw', 'home'][np.argmax(stats_pred)],
        'confidence': float(max(stats_pred) * 100),
        'probabilities': {
            'home': float(stats_pred[2]),
            'draw': float(stats_pred[1]),
            'away': float(stats_pred[0])
        }
    }
    
    # ... repetir para outros agentes
    
    return predictions

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

No TypeScript, chamar essa API:

```typescript
export class RealAIAgent extends AIAgent {
  private apiUrl = 'http://localhost:8000';

  async predict(match: FootballMatch): Promise<AgentPrediction> {
    // Extrair features da partida
    const features = this.extractFeatures(match);
    
    // Chamar API Python
    const response = await fetch(`${this.apiUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(features)
    });
    
    const predictions = await response.json();
    
    // Converter para formato AgentPrediction
    return this.formatPrediction(predictions[this.profile.id]);
  }
}
```

---

### Etapa 5: Treinamento Contínuo 🔄

Sistema que aprende com resultados reais:

```python
def retrain_on_new_results(model_name: str):
    """
    Re-treina modelo quando novos resultados ficam disponíveis
    """
    # 1. Buscar partidas finalizadas recentes
    recent_matches = fetch_finished_matches(days=7)
    
    # 2. Buscar previsões que foram feitas
    predictions = db.query("SELECT * FROM predictions WHERE match_id IN (...)")
    
    # 3. Comparar previsão vs resultado real
    for pred in predictions:
        actual_result = get_match_result(pred.match_id)
        was_correct = pred.predicted_winner == actual_result
        
        # Salvar no histórico
        db.insert("prediction_results", {
            "prediction_id": pred.id,
            "was_correct": was_correct,
            "actual_result": actual_result
        })
    
    # 4. Re-treinar com dados novos
    all_training_data = load_all_historical_data()
    new_model = train_model(all_training_data, model_name)
    
    # 5. Avaliar se novo modelo é melhor
    new_accuracy = evaluate_model(new_model)
    old_accuracy = get_current_accuracy(model_name)
    
    if new_accuracy > old_accuracy:
        print(f"Novo modelo melhor! {new_accuracy:.2%} vs {old_accuracy:.2%}")
        save_model(new_model, model_name)
        update_agent_stats(model_name, new_accuracy)
    else:
        print(f"Modelo atual ainda melhor. Mantendo.")

# Agendar para rodar toda semana
from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler()
scheduler.add_job(retrain_on_new_results, 'cron', day_of_week='mon', hour=3)
scheduler.start()
```

---

## 📊 Accuracy Realista Esperada

Com treinamento adequado:

| Agente | Accuracy Realista | Motivo |
|--------|------------------|---------|
| EnsembleMaster | 55-60% | Consenso de múltiplos modelos |
| DeepPredictor | 53-58% | Deep learning com muitas features |
| StatsMaster | 50-55% | Estatísticas são confiáveis |
| FormAnalyzer | 48-53% | Forma é volátil |
| H2H Expert | 45-50% | Histórico nem sempre se repete |

**Nota importante**: Futebol tem muito ruído! Accuracy de 55-60% já é **excelente** e lucrativo.

---

## 💰 Custos de Treinamento

- **Dados**: $0-30/mês (Kaggle grátis, APIs pagas)
- **Computação**: 
  - Modelos simples: CPU local (grátis)
  - Deep learning: Google Colab (grátis até certo ponto)
  - GPU na nuvem: ~$0.50/hora
- **Storage**: ~$5/mês (Supabase)
- **API Python**: ~$5-10/mês (Render/Railway)

**Total**: $10-50/mês para sistema completo

---

## 🎯 Próximos Passos PRÁTICOS

1. **[ ] Coletar 5.000+ partidas históricas** (Kaggle é mais fácil para começar)
2. **[ ] Rodar script de preparação** de dados
3. **[ ] Treinar StatsMaster** primeiro (mais simples)
4. **[ ] Testar accuracy** no conjunto de teste
5. **[ ] Iterar** melhorando features
6. **[ ] Treinar outros agentes** um por um
7. **[ ] Criar API Python** para servir modelos
8. **[ ] Integrar ao frontend** TypeScript

---

## 🔗 Recursos Úteis

- [Kaggle: European Soccer Database](https://www.kaggle.com/datasets/hugomathien/soccer)
- [Scikit-learn Documentation](https://scikit-learn.org/)
- [TensorFlow Guide](https://www.tensorflow.org/guide)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Football xG Explained](https://theanalyst.com/eu/2021/07/what-are-expected-goals-xg/)

---

**Resumindo**: Agentes atuais são DEMO. Para treinar de verdade, você precisa de dados históricos, Python/ML, e algumas semanas de trabalho. Mas o sistema já está arquiteturado para receber os modelos reais! 🚀
