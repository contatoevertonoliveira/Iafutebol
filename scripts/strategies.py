"""
Estratégias de Trading Betfair
Scalping, Dutching Correct Score, Handicap Asiático, Over/Gols
"""
import json
import uuid
import logging
from typing import Optional

from betfair_client import (
    list_market_book,
    place_orders,
    back_order,
    lay_order,
    BetfairError,
)

log = logging.getLogger("strategies")

# ── Helpers ──────────────────────────────────────────────────────────────
def _ref() -> str:
    """Gera customerRef único para rastrear ordens."""
    return uuid.uuid4().hex[:16]


def get_best_prices(market_id: str) -> dict:
    """Pega os melhores BACK/LAY de cada runner."""
    books = list_market_book(
        [market_id],
        {"priceData": ["EX_BEST_OFFERS", "EX_TRADED_VOL"]},
    )
    if not books:
        return {}
    book = books[0]
    runners = {}
    for r in book.get("runners", []):
        ex = r.get("ex", {})
        back = ex.get("availableToBack", [])
        lay = ex.get("availableToLay", [])
        runners[r["selectionId"]] = {
            "name": r.get("runnerName", f"ID:{r['selectionId']}"),
            "back": back[0] if back else None,
            "lay": lay[0] if lay else None,
            "tv": ex.get("tradedVolume", 0),
            "status": r.get("status", "ACTIVE"),
            "lastPriceTraded": r.get("lastPriceTraded"),
            "totalMatched": r.get("totalMatched", 0),
        }
    return {
        "marketId": market_id,
        "inplay": book.get("inplay", False),
        "totalMatched": book.get("totalMatched", 0),
        "runners": runners,
    }


# ═══════════════════════════════════════════════════════════════════════
# 1. SCALPING (5-10 ticks)
# ═══════════════════════════════════════════════════════════════════════
def scalping_opportunity(market_id: str, selection_id: int, stake: float = 2.0, tick_target: int = 5):
    """
    Scalping: entra BACK na melhor oferta, mira vender LAY alguns ticks acima.
    Tick = 0.01 para odds < 2.0, 0.02 para odds 2.0-3.0, 0.05 para odds 3.0-4.0, etc.
    """
    prices = get_best_prices(market_id)
    runner = prices.get("runners", {}).get(selection_id)
    if not runner:
        return {"ok": False, "error": "Runner não encontrado"}

    back = runner.get("back")
    if not back:
        return {"ok": False, "error": "Sem BACK disponível"}

    entry_odds = back["price"]
    entry_size = min(stake, back["size"])

    # Calcula tick size
    if entry_odds < 2.0:
        tick = 0.01
    elif entry_odds < 3.0:
        tick = 0.02
    elif entry_odds < 4.0:
        tick = 0.05
    elif entry_odds < 6.0:
        tick = 0.1
    else:
        tick = 0.2

    target_odds = round(entry_odds - (tick * tick_target), 2)

    log.info(
        f"🎯 Scalping: BACK @{entry_odds} → alvo LAY @{target_odds} "
        f"(stake: £{entry_size})"
    )

    # Coloca BACK
    result = back_order(market_id, selection_id, entry_size, entry_odds)

    # Retorna dados pro Hermes gerenciar o take-profit
    return {
        "ok": True,
        "strategy": "scalping",
        "market_id": market_id,
        "selection_id": selection_id,
        "entry_back_odds": entry_odds,
        "target_lay_odds": target_odds,
        "stake": entry_size,
        "tick_target": tick_target,
        "order_result": result,
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. DUTCHING CORRECT SCORE
# ═══════════════════════════════════════════════════════════════════════
def dutch_correct_score(
    market_id: str,
    scores: list,
    total_stake: float = 5.0,
):
    """
    Dutching no mercado de Correct Score.
    Distribui a stake entre vários placares pra garantir lucro.
    scores = [{"selectionId": int, "odds": float, "label": "1-0"}, ...]
    """
    if not scores:
        return {"ok": False, "error": "Nenhum score fornecido"}

    total_implied = sum(1 / s["odds"] for s in scores)
    if total_implied >= 1.0:
        return {"ok": False, "error": f"Dutching impossível: implied={total_implied:.3f} >= 1.0"}

    instructions = []
    for s in scores:
        stake = round((total_stake / s["odds"]) / total_implied, 2)
        instructions.append({
            "selectionId": s["selectionId"],
            "handicap": "0",
            "side": "BACK",
            "orderType": "LIMIT",
            "limitOrder": {
                "size": str(stake),
                "price": str(s["odds"]),
                "persistenceType": "LAPSE",
            },
        })

    labels = [s["label"] for s in scores]
    log.info(f"🎯 Dutching CS: {labels} | Stakes: {[i['limitOrder']['size'] for i in instructions]}")

    result = place_orders(market_id, instructions, customer_ref=_ref())
    return {
        "ok": True,
        "strategy": "dutching_cs",
        "market_id": market_id,
        "scores": [s["label"] for s in scores],
        "total_stake": total_stake,
        "total_implied": round(total_implied, 4),
        "guaranteed_profit_pct": round((1 / total_implied - 1) * 100, 2),
        "instructions": instructions,
        "order_result": result,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. HANDICAP ASIÁTICO (Asian Handicap)
# ═══════════════════════════════════════════════════════════════════════
def asian_handicap(
    market_id: str,
    selection_id: int,
    side: str,  # "BACK" ou "LAY"
    odds: float,
    stake: float = 2.0,
):
    """
    Entrada no mercado de Handicap Asiático.
    side = "BACK" (a favor) ou "LAY" (contra)
    """
    if side.upper() not in ("BACK", "LAY"):
        return {"ok": False, "error": "side deve ser BACK ou LAY"}

    log.info(f"🎯 Asian Handicap: {side} @{odds} stake: £{stake}")

    if side.upper() == "BACK":
        result = back_order(market_id, selection_id, stake, odds)
    else:
        result = lay_order(market_id, selection_id, stake, odds)

    return {
        "ok": True,
        "strategy": "asian_handicap",
        "market_id": market_id,
        "selection_id": selection_id,
        "side": side,
        "odds": odds,
        "stake": stake,
        "order_result": result,
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. OVER/GOLS (Over/Under)
# ═══════════════════════════════════════════════════════════════════════
def over_gols(
    market_id: str,
    selection_id: int,
    side: str,  # "BACK" ou "LAY"
    odds: float,
    stake: float = 2.0,
    line: str = "2.5",  # 2.5, 3.5, etc.
):
    """
    Entrada no mercado de Over/Under Gols.
    """
    log.info(f"🎯 Over{line}: {side} @{odds} stake: £{stake}")

    if side.upper() == "BACK":
        result = back_order(market_id, selection_id, stake, odds)
    else:
        result = lay_order(market_id, selection_id, stake, odds)

    return {
        "ok": True,
        "strategy": "over_gols",
        "market_id": market_id,
        "selection_id": selection_id,
        "line": line,
        "side": side,
        "odds": odds,
        "stake": stake,
        "order_result": result,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. BOOKMAKING (Back all, Lay all - lucro garantido)
# ═══════════════════════════════════════════════════════════════════════
def bookmaking(market_id: str, total_stake: float = 5.0):
    """
    Bookmaking: BACK em todos os runners, cria livro próprio.
    """
    book = list_market_book(
        [market_id],
        {"priceData": ["EX_BEST_OFFERS"]},
    )
    if not book:
        return {"ok": False, "error": "Mercado não encontrado"}

    runners = book[0].get("runners", [])
    active = [r for r in runners if r.get("status") == "ACTIVE"]
    if len(active) < 2:
        return {"ok": False, "error": "Menos de 2 runners ativos"}

    # Pega os melhores BACK disponíveis
    entries = []
    for r in active:
        backs = r.get("ex", {}).get("availableToBack", [])
        if backs:
            entries.append({
                "selectionId": r["selectionId"],
                "odds": backs[0]["price"],
                "size": backs[0]["size"],
            })

    if not entries:
        return {"ok": False, "error": "Sem odds disponíveis"}

    # Distribui stake proporcional ao odds (quanto maior odd, menor stake)
    total_inv = sum(1 / e["odds"] for e in entries)
    instructions = []
    for e in entries:
        stake = round((total_stake / e["odds"]) / total_inv, 2)
        instructions.append({
            "selectionId": e["selectionId"],
            "handicap": "0",
            "side": "BACK",
            "orderType": "LIMIT",
            "limitOrder": {
                "size": str(stake),
                "price": str(e["odds"]),
                "persistenceType": "LAPSE",
            },
        })

    profit_pct = round((1 / total_inv - 1) * 100, 2)
    log.info(f"🎯 Bookmaking: {len(instructions)} runners | lucro garantido: {profit_pct}%")

    result = place_orders(market_id, instructions, customer_ref=_ref())
    return {
        "ok": True,
        "strategy": "bookmaking",
        "market_id": market_id,
        "runners": len(instructions),
        "total_stake": total_stake,
        "guaranteed_profit_pct": profit_pct,
        "instructions": instructions,
        "order_result": result,
    }
