from datetime import datetime
import traceback
import os
import requests
from django.conf import settings

class ApiFootballProvider:
    """
    Provider da API-Football centralizado.
    Expõe: fixtures, estatísticas, eventos, previsões e standings.
    """

    BASE_URL = "https://v3.football.api-sports.io"

    def __init__(self):
        self.session = requests.Session()
        api_key = os.getenv("API_FOOTBALL_KEY", "").strip()  # 👈 remove espaços e quebras
        self.session.headers.update({
            "x-apisports-key": api_key,
            "Accept": "application/json"
        })

    # ---------------------------
    # Helpers
    # ---------------------------
    def _get(self, endpoint: str, params: dict):
        """
        Executa requisição segura à API-Football.
        Retorna SEMPRE um dicionário no formato {'response': [...]}, ou {}.
        Evita que respostas textuais ou HTML quebrem o pipeline.
        """
        url = f"{self.BASE_URL}{endpoint}"
        try:
            r = self.session.get(url, params=params, timeout=15)
            r.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"[ApiFootballProvider] ❌ Erro HTTP em {endpoint}: {e}")
            return {}

        try:
            data = r.json()
        except Exception:
            # Quando não é JSON (HTML, texto de erro, etc.)
            text_sample = r.text[:300].replace("\n", " ")
            print(f"[ApiFootballProvider] ⚠️ Resposta não-JSON em {endpoint}: {text_sample}")
            return {}

        # 🔹 Proteção extra: se a estrutura não contém "response", padroniza
        if not isinstance(data, dict):
            print(f"[ApiFootballProvider] ⚠️ Resposta inesperada ({type(data).__name__}) em {endpoint}: {str(data)[:200]}")
            return {}

        if "response" not in data:
            # Pode ser uma mensagem de erro textual da API
            message = data.get("message") or data.get("error") or str(data)
            print(f"[ApiFootballProvider] ⚠️ Estrutura sem 'response' ({endpoint}) → {message[:200]}")
            return {"response": []}

        return data



    # ---------------------------
    # Fixtures
    # ---------------------------
    def get_fixtures(self, date: str, live: bool = False):
        """
        Busca fixtures do dia ou ao vivo.
        date -> 'YYYY-MM-DD'
        live -> True para somente jogos ao vivo
        """
        params = {"date": date}
        if live:
            params["live"] = "all"
        data = self._get("/fixtures", params)
        return [self._normalize_fixture(f) for f in data.get("response", [])]

    def get_fixture(self, fixture_id: int):
        """Busca fixture específico"""
        data = self._get("/fixtures", {"id": fixture_id})
        resp = data.get("response", [])
        if not resp:
            return None
        return self._normalize_fixture(resp[0])
    


    
    def map_country_flag(self, country) -> str:
        """
        Retorna a URL da bandeira de um país usando API-Football.
        Aceita string, lista ou dicionário.
        Usa league.flag se disponível, senão gera fallback.
        """
        try:
            if not country:
                return ""

            # 🔹 Normaliza tipos — garante que o resultado final seja string
            if isinstance(country, list):
                # Se for lista, pega o primeiro elemento (ex: ["Brazil"])
                country = country[0] if country else ""
            elif isinstance(country, dict):
                # Se for dicionário, tenta extrair nome ou código
                country = country.get("name") or country.get("country") or ""

            if not isinstance(country, str):
                country = str(country)

            country = country.strip()
            if not country:
                return ""

            # 🔹 Gera URL padronizada
            code = country.lower().replace(" ", "-")
            return f"https://media.api-sports.io/flags/{code}.svg"

        except Exception as e:
            print(f"[ApiFootballProvider] ⚠️ Erro map_country_flag({country}): {e}")
            return ""

    
    
    # ---------------------------
    # Estatísticas
    # ---------------------------
    def get_statistics(self, fixture_id: int):
        data = self._get("/fixtures/statistics", {"fixture": fixture_id})
        return data.get("response", [])

    # ---------------------------
    # Eventos (gols, cartões etc.)
    # ---------------------------
    def get_events(self, fixture_id: int):
        data = self._get("/fixtures/events", {"fixture": fixture_id})
        return data.get("response", [])

    # ---------------------------
    # Previsões
    # ---------------------------
    def get_predictions(self, fixture_id: int):
        data = self._get("/predictions", {"fixture": fixture_id})
        return data.get("response", [])

    # ---------------------------
    # Standings (classificação)
    # ---------------------------
    def get_standings(self, league_id: int, season: int):
        data = self._get("/standings", {"league": league_id, "season": season})
        return data.get("response", [])
    
    
    # ---------------------------
    # Odds
    # ---------------------------
    def get_odds(self, fixture_id: int):
        data = self._get("/odds", {"fixture": fixture_id})
        return data.get("response", [])
    
    def get_odds_live(self, fixture_id: int):
        """
        Odds ao vivo (in-play).
        """
        data = self._get("/odds/live", {"fixture": fixture_id})
        return data.get("response", [])


    def get_odds_bookmakers(self):
        data = self._get("/odds/bookmakers", {})
        return data.get("response", [])

    def get_odds_bets(self):
        data = self._get("/odds/bets", {})
        return data.get("response", [])

    # ---------------------------
    # Head-to-head (H2H)
    # ---------------------------
    def get_h2h(self, team1_id: int, team2_id: int, last: int = 5):
        """
        Busca histórico de confrontos (H2H) entre dois times.
        last -> número de partidas a retornar (default 5)
        """
        params = {"h2h": f"{team1_id}-{team2_id}", "last": last}
        data = self._get("/fixtures/headtohead", params)
        return data.get("response", [])


    
    # dentro da classe ApiFootballProvider
    def get_leagues(self, country=None):
        params = {}
        if country:
            params["country"] = country
        return self._get("/leagues", params).get("response", [])

    def get_teams(self, search: str):
        """Busca times pelo nome"""
        return self._get("/teams", {"search": search}).get("response", [])

    def get_fixtures_by_league(self, league_id, date_str):
        season = datetime.strptime(date_str, "%Y-%m-%d").year
        return self._get("/fixtures", {
            "league": league_id,
            "season": season,
            "date": date_str
        }).get("response", [])

    def get_fixtures_by_team(self, team_id, date_str, league_id=None, season=None):
        params = {"team": team_id, "date": date_str}
        if league_id:
            params["league"] = league_id
        if season:
            params["season"] = season
        return self._get("/fixtures", params).get("response", [])
    
    def get_last_fixtures_by_team(self, team_id: int, last: int = 12):
        """
        Retorna os últimos N jogos de um time.
        Docs: https://www.api-football.com/documentation-v3#operation/get-fixtures
        """
        data = self._get("/fixtures", {"team": team_id, "last": last})
        return data.get("response", [])


    
    
    
    # ---------------------------
    # Normalização
    # ---------------------------
    def _normalize_fixture(self, fixture: dict):
        fxt = fixture.get("fixture", {})
        league = fixture.get("league", {})
        teams = fixture.get("teams", {})
        goals = fixture.get("goals", {})

        # mapear continente
        country = league.get("country")
        continent = self._map_continent(country)

        country_flag = league.get("flag") or self.map_country_flag(country)


        return {
            "fixture_id": fxt.get("id"),
            "date": fxt.get("date"),
            "start": fxt.get("date"),  # alias
            "status": fxt.get("status", {}).get("short"),
            "minute": fxt.get("status", {}).get("elapsed"),
            "venue": fxt.get("venue", {}).get("name"),

            "league": league.get("name"),
            "league_id": league.get("id"),
            "season": league.get("season"),
            "country": country,
            "country_flag": country_flag,   # 🔹 corrigido
            "continent": continent,

            "home_id": teams.get("home", {}).get("id"),
            "home": teams.get("home", {}).get("name"),
            "home_logo": teams.get("home", {}).get("logo"),
            "away_id": teams.get("away", {}).get("id"),
            "away": teams.get("away", {}).get("name"),
            "away_logo": teams.get("away", {}).get("logo"),

            "score_home": goals.get("home"),
            "score_away": goals.get("away"),
        }


    def _map_continent(self, country: str):
        if not country:
            return None
        country = country.lower()
        europa = ["england","spain","italy","germany","france","portugal","netherlands","belgium","sweden","norway"]
        america_sul = ["brazil","argentina","uruguay","chile","colombia","paraguay","ecuador","peru"]
        asia = ["china","japan","korea republic","iran","qatar","saudi arabia"]
        africa = ["nigeria","cameroon","ghana","egypt","senegal","morocco"]
        america_central = ["mexico","honduras","costa rica","panama"]
        america_norte = ["usa","canada"]
        oceania = ["australia","new zealand"]

        if country in europa: return "Europe"
        if country in america_sul: return "South America"
        if country in asia: return "Asia"
        if country in africa: return "Africa"
        if country in america_central: return "Central America"
        if country in america_norte: return "North America"
        if country in oceania: return "Oceania"
        return "Other"
  
    


