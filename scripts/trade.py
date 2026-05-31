"""
🎯 TRADER ESPORTIVO - Ponto de entrada principal
Uso: python3 trade.py <comando> [args]

Comandos:
  funds                    - Ver saldo
  catalogue                - Listar mercados ao vivo
  analyse <marketId>       - Analisar odds de um mercado
  scalping <marketId> <selId> <stake> [ticks]  - Scalping
  dutch-cs <marketId> <scores.json> <stake>    - Dutching Correct Score
  handicap <marketId> <selId> <BACK|LAY> <odds> <stake>  - Handicap Asiático
  over <marketId> <selId> <BACK|LAY> <odds> <stake>      - Over/Gols
  bookmaking <marketId> <stake>                - Bookmaking
  cancel-all <marketId>    - Cancela todas as ordens
"""
import sys
import json
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

from betfair_client import (
    get_account_funds,
    list_market_catalogue,
    list_current_orders,
    cancel_orders,
    BetfairError,
)
from strategies import (
    get_best_prices,
    scalping_opportunity,
    dutch_correct_score,
    asian_handicap,
    over_gols,
    bookmaking,
)


def cmd_funds():
    """Mostra saldo e exposição."""
    funds = get_account_funds()
    summary = {
        "available": round(funds.get("availableToBetBalance", 0), 2),
        "exposure": round(funds.get("exposure", 0), 2),
        "currency": funds.get("currencyCode", "GBP"),
    }
    print(json.dumps(summary, indent=2))
    return summary


def cmd_catalogue():
    """Lista mercados ao vivo."""
    cat = list_market_catalogue(
        {"eventTypeIds": ["1"], "inPlayOnly": True},
        max_results=20,
        market_projection=["COMPETITION", "EVENT", "MARKET_START_TIME", "RUNNER_DESCRIPTION"],
    )
    if not cat:
        print("Nenhum mercado ao vivo encontrado")
        return

    for m in cat:
        event = m.get("event", {})
        comp = m.get("competition", {})
        runners = ", ".join(
            r.get("runnerName", "?")
            for r in m.get("runners", [])
        )
        print(
            f"⚽ {event.get('name', '?')} | "
            f"{comp.get('name', 'N/A')} | "
            f"📊 {m.get('marketName', '?')} | "
            f"🆔 {m.get('marketId', '?')[:12]}... | "
            f"🏃 {runners}"
        )


def cmd_analyse(market_id: str):
    """Analisa odds completas de um mercado."""
    prices = get_best_prices(market_id)
    if not prices:
        print(f"Mercado {market_id} não encontrado")
        return

    print(f"\n📊 Análise: {prices['marketId'][:12]}...")
    print(f"🔄 In-Play: {'✅' if prices['inplay'] else '❌'}")
    print(f"💰 Total Matched: £{prices['totalMatched']:,.2f}")
    print()

    for sid, info in prices["runners"].items():
        back = f"{info['back']['price']} @ {info['back']['size']}" if info["back"] else "N/A"
        lay = f"{info['lay']['price']} @ {info['lay']['size']}" if info["lay"] else "N/A"
        print(f"  🏃 {info['name']} (ID: {sid})")
        print(f"     BACK: {back}")
        print(f"     LAY:  {lay}")
        print(f"     Vol:  £{info['totalMatched']:,.2f} | Status: {info['status']}")
        print()


def cmd_scalping(market_id: str, selection_id: int, stake: float, ticks: int = 5):
    """Executa scalping."""
    return scalping_opportunity(market_id, selection_id, stake, ticks)


def cmd_dutch_cs(market_id: str, scores_json: str, stake: float):
    """Dutching Correct Score. scores_json = '[{"selectionId":1,"odds":5.0,"label":"1-0"},...]'"""
    scores = json.loads(scores_json)
    return dutch_correct_score(market_id, scores, stake)


def cmd_handicap(market_id: str, selection_id: int, side: str, odds: float, stake: float):
    return asian_handicap(market_id, selection_id, side, odds, stake)


def cmd_over(market_id: str, selection_id: int, side: str, odds: float, stake: float):
    return over_gols(market_id, selection_id, side, odds, stake)


def cmd_bookmaking(market_id: str, stake: float):
    return bookmaking(market_id, stake)


def cmd_cancel_all(market_id: str = None):
    """Cancela todas as ordens (de um mercado específico ou todas)."""
    orders = list_current_orders([market_id] if market_id else None)
    current = orders.get("currentOrders", [])
    if not current:
        print("Nenhuma ordem ativa")
        return

    # Agrupa por mercado
    by_market = {}
    for o in current:
        mid = o.get("marketId")
        if mid not in by_market:
            by_market[mid] = []
        by_market[mid].append({"betId": o.get("betId")})

    for mid, insts in by_market.items():
        result = cancel_orders(mid, insts)
        print(f"Cancelado {len(insts)} ordens em {mid[:12]}...: {result.get('status', 'OK')}")


# ── Main ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    try:
        if cmd == "funds":
            cmd_funds()
        elif cmd == "catalogue":
            cmd_catalogue()
        elif cmd == "analyse" and len(sys.argv) >= 3:
            cmd_analyse(sys.argv[2])
        elif cmd == "scalping" and len(sys.argv) >= 5:
            result = cmd_scalping(sys.argv[2], int(sys.argv[3]), float(sys.argv[4]),
                                  int(sys.argv[5]) if len(sys.argv) > 5 else 5)
            print(json.dumps(result, indent=2, default=str))
        elif cmd == "dutch-cs" and len(sys.argv) >= 5:
            result = cmd_dutch_cs(sys.argv[2], sys.argv[3], float(sys.argv[4]))
            print(json.dumps(result, indent=2, default=str))
        elif cmd == "handicap" and len(sys.argv) >= 7:
            result = cmd_handicap(sys.argv[2], int(sys.argv[3]), sys.argv[4],
                                  float(sys.argv[5]), float(sys.argv[6]))
            print(json.dumps(result, indent=2, default=str))
        elif cmd == "over" and len(sys.argv) >= 7:
            result = cmd_over(sys.argv[2], int(sys.argv[3]), sys.argv[4],
                              float(sys.argv[5]), float(sys.argv[6]))
            print(json.dumps(result, indent=2, default=str))
        elif cmd == "bookmaking" and len(sys.argv) >= 4:
            result = cmd_bookmaking(sys.argv[2], float(sys.argv[3]))
            print(json.dumps(result, indent=2, default=str))
        elif cmd == "cancel-all":
            cmd_cancel_all(sys.argv[2] if len(sys.argv) > 2 else None)
        else:
            print(f"Comando inválido: {cmd}")
            print(__doc__)
    except BetfairError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Erro inesperado: {e}"}))
        sys.exit(1)
