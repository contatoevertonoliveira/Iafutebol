---
name: betfair-trader-local
description: Operar Betfair Exchange localmente via scripts Python com autenticação por certificado. Usado quando o Hermes roda na mesma máquina que o usuário (mesmo IP) para evitar bloqueios de segurança.
---

# Betfair Trader Local 🐍⚽

Opera a Betfair Exchange usando scripts Python rodando **localmente** (sem edge function cloud).

## Setup (uma vez)
```bash
cd /caminho/para/Iafutebol
bash scripts/setup.sh
# Editar scripts/.env com email e senha Betfair
# Colocar certificados em certs/client-2048.crt e client-2048.key
```

## Comandos Disponíveis

### Saldo
```bash
python3 scripts/trade.py funds
```

### Jogos ao Vivo
```bash
python3 scripts/trade.py catalogue
```

### Analisar Mercado
```bash
python3 scripts/trade.py analyse <marketId>
```

### Scalping (5-10 ticks)
```bash
python3 scripts/trade.py scalping <marketId> <selectionId> <stake> [ticks]
```
Ex: `python3 scripts/trade.py scalping 1.2345678 12345 2.00 5`

### Dutching Correct Score
```bash
python3 scripts/trade.py dutch-cs <marketId> '<scores_json>' <stake>
```
Ex: `python3 scripts/trade.py dutch-cs 1.2345678 '[{"selectionId":1,"odds":5.0,"label":"1-0"},{"selectionId":2,"odds":7.0,"label":"2-0"}]' 5.00`

### Handicap Asiático
```bash
python3 scripts/trade.py handicap <marketId> <selectionId> <BACK|LAY> <odds> <stake>
```

### Over/Gols
```bash
python3 scripts/trade.py over <marketId> <selectionId> <BACK|LAY> <odds> <stake>
```

### Bookmaking (Lucro Garantido)
```bash
python3 scripts/trade.py bookmaking <marketId> <stake>
```

### Cancelar Ordens
```bash
python3 scripts/trade.py cancel-all <marketId>
```

## Estratégias Disponíveis

1. **Scalping** - Entra BACK, mira LAY alguns ticks acima (5-10 ticks)
2. **Dutching Correct Score** - Distribui stake entre vários placares
3. **Handicap Asiático** - Aposta a favor/contra no handicap
4. **Over/Gols** - Aposta no mercado de Over/Under
5. **Bookmaking** - Cria livro próprio, lucro garantido se todas as entradas forem aceitas

## Arquitetura
```
Hermes (agente) → python3 trade.py <cmd> → API Betfair (IP local) ✅
                                         → Supabase DB (só dados)
```
