"""
Betfair API Client - Autenticação com certificado + chamadas diretas
Rodando localmente na VPS para evitar bloqueios de segurança.
Supabase usado APENAS para registro de dados (opcional).
"""
import os
import json
import time
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

import requests
from dotenv import load_dotenv

# ── Setup ────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("betfair")

# Carrega .env da mesma pasta
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

# ── Config ───────────────────────────────────────────────────────────────
USERNAME = os.getenv("BETFAIR_USERNAME", "")
PASSWORD = os.getenv("BETFAIR_PASSWORD", "")
APP_KEY = "gBMF1zhAoNgJIbxw"
JURISDICTION = "bet.br"

CERT_PATH = Path(os.getenv("BETFAIR_CERT_PATH", "../certs/client-2048.crt"))
KEY_PATH = Path(os.getenv("BETFAIR_KEY_PATH", "../certs/client-2048.key"))

# Resolve paths relativos ao diretório deste script
if not CERT_PATH.is_absolute():
    CERT_PATH = (Path(__file__).parent / CERT_PATH).resolve()
if not KEY_PATH.is_absolute():
    KEY_PATH = (Path(__file__).parent / KEY_PATH).resolve()

# URLs por jurisdição
SSO_URLS = {
    "bet.br": "https://identitysso-cert.betfair.bet.br/api/certlogin",
    "com": "https://identitysso-cert.betfair.com/api/certlogin",
    "com.au": "https://identitysso-cert.betfair.com.au/api/certlogin",
    "it": "https://identitysso-cert.betfair.it/api/certlogin",
    "es": "https://identitysso-cert.betfair.es/api/certlogin",
}
API_URLS = {
    "bet.br": "https://api.betfair.bet.br/exchange/betting/json-rpc/v1",
    "com": "https://api.betfair.com/exchange/betting/json-rpc/v1",
}
account_urls = {
    "bet.br": "https://api.betfair.bet.br/exchange/account/json-rpc/v1",
    "com": "https://api.betfair.com/exchange/account/json-rpc/v1",
}

SSO_URL = SSO_URLS.get(JURISDICTION, SSO_URLS["com"])
API_URL = API_URLS.get(JURISDICTION, API_URLS["com"])
ACCOUNT_URL = account_urls.get(JURISDICTION, account_urls["com"])

# ── Session Cache ────────────────────────────────────────────────────────
_session: dict = {"token": None, "expires_at": 0}


class BetfairError(Exception):
    """Erro da API Betfair."""
    pass


# ── Autenticação ─────────────────────────────────────────────────────────
def session_token(force: bool = False) -> str:
    """
    Obtém token de sessão via certificado.
    Cache de ~50 minutos para evitar múltiplos logins.
    """
    now = time.time()
    if not force and _session["token"] and now < _session["expires_at"]:
        return _session["token"]

    if not USERNAME or not PASSWORD:
        raise BetfairError("BETFAIR_USERNAME/PASSWORD não configurados no .env")
    if not CERT_PATH.exists():
        raise BetfairError(f"Certificado não encontrado: {CERT_PATH}")
    if not KEY_PATH.exists():
        raise BetfairError(f"Chave não encontrada: {KEY_PATH}")

    log.info("🔑 Obtendo novo session token via certificado...")

    resp = requests.post(
        SSO_URL,
        data={"username": USERNAME, "password": PASSWORD},
        cert=(str(CERT_PATH), str(KEY_PATH)),
        headers={
            "X-Application": APP_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout=30,
    )

    if resp.status_code != 200:
        raise BetfairError(
            f"Login falhou (HTTP {resp.status_code}): {resp.text[:300]}"
        )

    data = resp.json()
    status = data.get("loginStatus", "UNKNOWN")
    token = data.get("sessionToken", "")

    if status != "SUCCESS" or not token:
        raise BetfairError(f"Login falhou: {status}")

    # Cache por 50 minutos
    _session["token"] = token
    _session["expires_at"] = now + 50 * 60
    log.info(f"✅ Session OK! Token: {token[:8]}...{token[-4:]}")
    return token


# ── Chamada JSON-RPC ────────────────────────────────────────────────────
def _rpc_call(url: str, method: str, params: dict = None) -> dict:
    """Faz chamada JSON-RPC à API Betfair com auto-retry em sessão expirada."""
    token = session_token()
    payload = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params or {},
        }
    ]

    log.debug(f"📡 {method}")

    resp = requests.post(
        url,
        json=payload,
        headers={
            "X-Application": APP_KEY,
            "X-Authentication": token,
            "Content-Type": "application/json",
        },
        timeout=30,
    )

    if resp.status_code == 401 or resp.status_code == 403:
        # Sessão expirada - renova e tenta de novo
        log.warning("🔄 Sessão expirada, renovando...")
        token = session_token(force=True)
        resp = requests.post(
            url,
            json=payload,
            headers={
                "X-Application": APP_KEY,
                "X-Authentication": token,
                "Content-Type": "application/json",
            },
            timeout=30,
        )

    if resp.status_code != 200:
        raise BetfairError(
            f"API falhou (HTTP {resp.status_code}): {resp.text[:300]}"
        )

    data = resp.json()
    if isinstance(data, list):
        result = data[0]
    else:
        result = data

    if "error" in result:
        err = result["error"]
        msg = err.get("message", str(err))
        code = (
            err.get("data", {})
            .get("APINGException", {})
            .get("errorCode", "UNKNOWN")
        )
        raise BetfairError(f"API error [{code}]: {msg}")

    return result.get("result")


# ── Endpoints de Leitura ─────────────────────────────────────────────────
def list_event_types(filter_data: dict = None) -> list:
    return _rpc_call(API_URL, "SportsAPING/v1.0/listEventTypes", {"filter": filter_data or {}})


def list_events(filter_data: dict = None) -> list:
    return _rpc_call(API_URL, "SportsAPING/v1.0/listEvents", {"filter": filter_data or {}})


def list_market_catalogue(
    filter_data: dict = None,
    max_results: int = 50,
    market_projection: list = None,
) -> list:
    params = {
        "filter": filter_data or {},
        "maxResults": max_results,
    }
    if market_projection:
        params["marketProjection"] = market_projection
    return _rpc_call(API_URL, "SportsAPING/v1.0/listMarketCatalogue", params)


def list_market_book(market_ids: list, price_projection: dict = None) -> list:
    params = {
        "marketIds": market_ids,
        "priceProjection": price_projection or {
            "priceData": ["EX_BEST_OFFERS", "EX_TRADED_VOL"],
        },
    }
    return _rpc_call(API_URL, "SportsAPING/v1.0/listMarketBook", params)


# ── Endpoints de Trading ─────────────────────────────────────────────────
def get_account_funds(wallet: str = None) -> dict:
    params = {}
    if wallet:
        params["wallet"] = wallet
    return _rpc_call(ACCOUNT_URL, "AccountAPING/v1.0/getAccountFunds", params)


def place_orders(market_id: str, instructions: list, customer_ref: str = None) -> dict:
    params = {
        "marketId": market_id,
        "instructions": instructions,
    }
    if customer_ref:
        params["customerRef"] = customer_ref
    return _rpc_call(API_URL, "SportsAPING/v1.0/placeOrders", params)


def cancel_orders(market_id: str, instructions: list) -> dict:
    return _rpc_call(
        API_URL,
        "SportsAPING/v1.0/cancelOrders",
        {"marketId": market_id, "instructions": instructions},
    )


def list_current_orders(market_ids: list = None) -> dict:
    params = {"orderProjection": "ALL"}
    if market_ids:
        params["marketIds"] = market_ids
    return _rpc_call(API_URL, "SportsAPING/v1.0/listCurrentOrders", params)


# ── Helpers de Trading ───────────────────────────────────────────────────
def back_order(market_id: str, selection_id: int, stake: float, odds: float) -> dict:
    """Ordem BACK (aposta a favor)"""
    return place_orders(market_id, [
        {
            "selectionId": selection_id,
            "handicap": "0",
            "side": "BACK",
            "orderType": "LIMIT",
            "limitOrder": {
                "size": str(stake),
                "price": str(odds),
                "persistenceType": "LAPSE",
            },
        }
    ])


def lay_order(market_id: str, selection_id: int, stake: float, odds: float) -> dict:
    """Ordem LAY (aposta contra)"""
    return place_orders(market_id, [
        {
            "selectionId": selection_id,
            "handicap": "0",
            "side": "LAY",
            "orderType": "LIMIT",
            "limitOrder": {
                "size": str(stake),
                "price": str(odds),
                "persistenceType": "LAPSE",
            },
        }
    ])


# ── Main (teste) ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "funds"

    if cmd == "funds":
        funds = get_account_funds()
        print(json.dumps(funds, indent=2))

    elif cmd == "events":
        events = list_events({"eventTypeIds": ["1"], "inPlayOnly": True})
        print(json.dumps(events, indent=2)[:2000])

    elif cmd == "catalogue":
        cat = list_market_catalogue(
            {"eventTypeIds": ["1"], "inPlayOnly": True},
            max_results=10,
            market_projection=["COMPETITION", "EVENT", "MARKET_START_TIME", "RUNNER_DESCRIPTION"],
        )
        print(json.dumps(cat, indent=2)[:3000])

    elif cmd == "orders":
        orders = list_current_orders()
        print(json.dumps(orders, indent=2)[:2000])

    else:
        print("Comandos: funds, events, catalogue, orders")
