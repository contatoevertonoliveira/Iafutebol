# MEMORY.md - Anotações do Dudu

## Projeto Iafutebol
- Repo: https://github.com/contatoevertonoliveira/Iafutebol.git
- Branch: main
- Scripts Python locais em scripts/ (betfair_client.py, strategies.py, trade.py)
- Certificados Betfair em certs/ (client-2048.crt, client-2048.key)

## Credenciais Betfair
- Username: oliveroculto@gmail.com
- App Key: gBMF1zhAoNgJIbxw
- Jurisdição: bet.br
- SSO: identitysso-cert.betfair.bet.br
- API: api.betfair.bet.br

## Autenticação
- Login via certificado (Non-Interactive bot login)
- Session token dura ~50 min, usar cache
- Rodar LOCALMENTE para evitar bloqueio de segurança por IP diferente
- Se der ACCOUNT_PENDING_PASSWORD_CHANGE: logar no site, trocar senha, esperar propagar

## Estratégias
1. **Scalping**: BACK na melhor oferta, alvo LAY 5-10 ticks acima
2. **Dutching Correct Score**: Distribuir stake entre múltiplos placares
3. **Handicap Asiático**: BACK ou LAY no mercado de handicap
4. **Over/Gols**: BACK ou LAY no mercado de Over/Under
5. **Bookmaking**: BACK em todos runners, lucro garantido

## Regras
- Máximo 3 jogos simultâneos
- Take-profit: 50% do lucro potencial → green book
- Remover cards não ativos da automação
- Entrada→correspondência→TP→2min→repete (scalping)

## Supabase
Usar APENAS como banco de dados para registrar histórico de trades.
Projeto: ygxcalveixkfwgztrzud
