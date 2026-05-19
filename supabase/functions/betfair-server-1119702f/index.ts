const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

const json = (body: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...(extraHeaders ?? {}),
    },
  });

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const decodeEnvPem = (value: string) => String(value ?? "").replace(/\\n/g, "\n").trim();

const assertHeaderSafe = (name: string, value: string) => {
  if (!value) return;
  if (/[\r\n]/.test(value)) throw new Error(`Betfair: ${name} contém quebra de linha (valor inválido para header)`);
};

const getBetfairConfig = () => {
  const appKey = String(Deno.env.get("BETFAIR_APP_KEY") ?? "").trim();
  const username = String(Deno.env.get("BETFAIR_USERNAME") ?? "").trim();
  const password = String(Deno.env.get("BETFAIR_PASSWORD") ?? "").trim();

  const certRawV2 = String(Deno.env.get("BETFAIR_CERT_PEM_V2") ?? "");
  const certRawV1 = String(Deno.env.get("BETFAIR_CERT_PEM") ?? "");
  const certPem = decodeEnvPem(certRawV2 || certRawV1);

  const keyRawV2 = String(Deno.env.get("BETFAIR_KEY_PEM_V2") ?? "");
  const keyRawV1 = String(Deno.env.get("BETFAIR_KEY_PEM") ?? "");
  const keyRawAlias = String(Deno.env.get("BETFAIR_CERT_KEY") ?? "");
  const keyPem = decodeEnvPem(keyRawV2 || keyRawV1 || keyRawAlias);

  const jurisdiction = String(Deno.env.get("BETFAIR_JURISDICTION") ?? "com").trim().toLowerCase();
  const overrideSsoHost = String(Deno.env.get("BETFAIR_SSO_HOST") ?? "").trim();
  const overrideApiHost = String(Deno.env.get("BETFAIR_API_HOST") ?? "").trim();

  const normalizedJurisdiction =
    jurisdiction === "br" || jurisdiction === "bet.br" || jurisdiction === "betfair.bet.br" ? "bet.br" : jurisdiction;

  const ssoHost = overrideSsoHost ||
    (normalizedJurisdiction === "bet.br" ? "identitysso-cert.betfair.bet.br"
      : normalizedJurisdiction === "au" || normalizedJurisdiction === "com.au" ? "identitysso-cert.betfair.com.au"
      : normalizedJurisdiction === "it" ? "identitysso-cert.betfair.it"
      : normalizedJurisdiction === "es" ? "identitysso-cert.betfair.es"
      : normalizedJurisdiction === "ro" ? "identitysso-cert.betfair.ro"
      : "identitysso-cert.betfair.com");

  const apiHost = overrideApiHost || (normalizedJurisdiction === "bet.br" ? "api.betfair.bet.br" : "api.betfair.com");
  const rpcUrl = `https://${apiHost}/exchange/betting/json-rpc/v1`;

  assertHeaderSafe("BETFAIR_APP_KEY", appKey);
  assertHeaderSafe("BETFAIR_USERNAME", username);
  assertHeaderSafe("BETFAIR_PASSWORD", password);

  return { appKey, username, password, certPem, keyPem, ssoHost, apiHost, rpcUrl } as const;
};

let cachedSession: { token: string; fetchedAtMs: number } | null = null;

const betfairCertLogin = async () => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey || !cfg.username || !cfg.password) throw new Error("Betfair: credenciais ausentes (APP_KEY/USERNAME/PASSWORD)");
  if (!cfg.certPem || !cfg.keyPem) throw new Error("Betfair: certificado ausente (CERT_PEM/KEY_PEM)");

  const client = Deno.createHttpClient({
    cert: cfg.certPem,
    key: cfg.keyPem,
  } as any);

  const url = `https://${cfg.ssoHost}/api/certlogin`;
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Application": cfg.appKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    client,
  });

  const text = await res.text().catch(() => "");
  const data = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();

  if (!res.ok) throw new Error(`Betfair login falhou (HTTP ${res.status}): ${text.slice(0, 260)}`);
  const status = String(data?.loginStatus ?? "").trim();
  const sessionToken = String(data?.sessionToken ?? "").trim();
  if (status !== "SUCCESS" || !sessionToken) throw new Error(`Betfair login falhou: ${status || "UNKNOWN"}`);

  cachedSession = { token: sessionToken, fetchedAtMs: Date.now() };
  return sessionToken;
};

const getBetfairSessionToken = async (opts?: { force?: boolean }) => {
  if (!opts?.force && cachedSession?.token) {
    if (Date.now() - cachedSession.fetchedAtMs < 50 * 60 * 1000) return cachedSession.token;
  }
  return await betfairCertLogin();
};

const betfairJsonRpcRaw = async (params: { method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const method = String(params.method ?? "").trim();

  const res = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: {
      "X-Application": cfg.appKey,
      "X-Authentication": params.sessionToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method, params: params.params ?? {} }]),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Betfair API falhou (HTTP ${res.status})`);
  const first = Array.isArray(data) ? data[0] : data;
  if (first?.error) {
    const msg = first?.error?.message ? String(first.error.message) : JSON.stringify(first.error);
    const codeRaw =
      String(first?.error?.data?.APINGException?.errorCode ?? first?.error?.data?.exceptionname ?? "").trim() ||
      String(first?.error?.data?.errorCode ?? "").trim();
    const code = codeRaw || msg;
    const isSessionInvalid = /INVALID_SESSION|NO_SESSION|SESSION.*INVALID/i.test(code);
    const err = new Error(`Betfair API error: ${msg}`.slice(0, 600)) as any;
    err.__betfairSessionInvalid = isSessionInvalid;
    throw err;
  }
  return first?.result ?? null;
};

const betfairJsonRpc = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set([
    "SportsAPING/v1.0/listEvents",
    "SportsAPING/v1.0/listMarketCatalogue",
    "SportsAPING/v1.0/listMarketBook",
  ]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>, ms: number) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
};

const normalizeName = (input: unknown) => {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const scoreEventName = (eventName: string, home: string, away: string) => {
  const e = normalizeName(eventName);
  const h = normalizeName(home);
  const a = normalizeName(away);
  if (!e || !h || !a) return 0;
  let score = 0;
  if (e.includes(h)) score += 6;
  if (e.includes(a)) score += 6;
  if (e.includes(" v ") || e.includes(" vs ") || e.includes(" x ")) score += 2;
  const hTokens = new Set(h.split(" ").filter(Boolean));
  const aTokens = new Set(a.split(" ").filter(Boolean));
  for (const t of hTokens) if (t.length >= 3 && e.includes(t)) score += 1;
  for (const t of aTokens) if (t.length >= 3 && e.includes(t)) score += 1;
  return score;
};

const pickBestEvent = (events: any[], homeTeam: string, awayTeam: string, kickoffIso: string | null) => {
  const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : NaN;
  let best: { event: any; score: number } | null = null;
  for (const row of Array.isArray(events) ? events : []) {
    const ev = row?.event ?? row;
    const name = String(ev?.name ?? "").trim();
    const base = scoreEventName(name, homeTeam, awayTeam);
    if (base <= 0) continue;
    const openDate = String(ev?.openDate ?? "").trim();
    const openMs = openDate ? new Date(openDate).getTime() : NaN;
    let timeBonus = 0;
    if (Number.isFinite(kickoffMs) && Number.isFinite(openMs)) {
      const diffMin = Math.abs(kickoffMs - openMs) / 60000;
      timeBonus = Math.max(0, 6 - diffMin / 30);
    }
    const s = base + timeBonus;
    if (!best || s > best.score) best = { event: ev, score: s };
  }
  return best?.event ?? null;
};

const guessRunnerRole = (runnerName: string, homeTeam: string, awayTeam: string) => {
  const r = normalizeName(runnerName);
  if (!r) return null;
  if (r.includes("draw") || r.includes("empate")) return "draw";
  const h = normalizeName(homeTeam);
  const a = normalizeName(awayTeam);
  const hScore = h ? scoreEventName(`${runnerName} v ${awayTeam}`, homeTeam, awayTeam) : 0;
  const aScore = a ? scoreEventName(`${homeTeam} v ${runnerName}`, homeTeam, awayTeam) : 0;
  const rHasHome = h && (r.includes(h) || h.split(" ").some((t) => t.length >= 3 && r.includes(t)));
  const rHasAway = a && (r.includes(a) || a.split(" ").some((t) => t.length >= 3 && r.includes(t)));
  if (rHasHome && !rHasAway) return "home";
  if (rHasAway && !rHasHome) return "away";
  if (hScore > aScore) return "home";
  if (aScore > hScore) return "away";
  return null;
};

const splitEventTeams = (eventName: string) => {
  const raw = String(eventName ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ");
  const m = normalized.match(/^(.*?)\s+(?:v|vs|x)\s+(.*?)$/i);
  if (!m) return null;
  const home = String(m[1] ?? "").trim();
  const away = String(m[2] ?? "").trim();
  if (!home || !away) return null;
  return { home, away };
};

const listBetfairSoccerMatchOddsRange = async (params: { fromIso: string; toIso: string; maxResults: number }) => {
  const fromIso = String(params.fromIso ?? "").trim();
  const toIso = String(params.toIso ?? "").trim();
  const maxResults = Math.max(1, Math.min(400, Number(params.maxResults ?? 200) || 200));
  if (!fromIso || !toIso) throw new Error("Betfair: período inválido");

  const asInt = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    const s = String(value ?? "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    return null;
  };

  const parseScorePairFromString = (value: unknown): { home: number; away: number } | null => {
    const s = String(value ?? "").trim();
    if (!s) return null;
    const m = s.match(/(\d+)\D+(\d+)/);
    if (!m) return null;
    const h = Number(m[1]);
    const a = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
    return { home: h, away: a };
  };

  const pickAny = (...values: unknown[]): unknown => {
    for (const v of values) {
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && !String(v).trim()) continue;
      return v;
    }
    return null;
  };

  const parseTimelineScore = (timeline: any): { home: number | null; away: number | null } => {
    const s = timeline?.score ?? null;
    if (!s) return { home: null, away: null };

    const fromPair =
      parseScorePairFromString(pickAny(s, (s as any)?.score, (s as any)?.current, timeline?.currentScore, timeline?.scoreString)) ??
      null;
    if (fromPair) return { home: fromPair.home, away: fromPair.away };

    const homeAny = pickAny(
      (s as any)?.home?.score,
      (s as any)?.homeScore,
      (s as any)?.home,
      (s as any)?.home?.value,
      (s as any)?.home?.goals,
      (s as any)?.homeGoals,
      (s as any)?.home?.home,
    );
    const awayAny = pickAny(
      (s as any)?.away?.score,
      (s as any)?.awayScore,
      (s as any)?.away,
      (s as any)?.away?.value,
      (s as any)?.away?.goals,
      (s as any)?.awayGoals,
      (s as any)?.away?.away,
    );

    const home = asInt(homeAny) ?? asInt((homeAny as any)?.score) ?? asInt((homeAny as any)?.value);
    const away = asInt(awayAny) ?? asInt((awayAny as any)?.score) ?? asInt((awayAny as any)?.value);
    return { home, away };
  };

  let sessionToken = await getBetfairSessionToken();
  const call = async (method: string, rpcParams: any) => {
    try {
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      sessionToken = await getBetfairSessionToken({ force: true });
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    }
  };

  const events = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listEvents", {
        filter: { eventTypeIds: ["1"], marketStartTime: { from: fromIso, to: toIso } },
        sort: "FIRST_TO_START",
        maxResults,
      }),
    9000,
  );

  const eventIds = Array.from(
    new Set(
      (Array.isArray(events) ? events : [])
        .map((row: any) => String((row?.event ?? row)?.id ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, maxResults);

  if (eventIds.length === 0) return [];

  const byEventId = new Map<string, any>();
  for (let i = 0; i < eventIds.length; i += 50) {
    try {
      const chunk = eventIds.slice(i, i + 50);
      const idsParam = encodeURIComponent(chunk.join(","));
      const fetchIps = async (url: string) => {
        const res = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: {
            accept: "application/json",
            "cache-control": "no-cache",
            "user-agent": "Mozilla/5.0",
          },
        });
        if (!res.ok) throw new Error(`IPS HTTP ${res.status}`);
        const text = await res.text();
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          throw new Error("IPS JSON parse error");
        }
      };

      const url1 = `https://ips.betfair.com/inplayservice/v1.1/eventTimelines?eventIds=${idsParam}&alt=json&regionCode=UK&locale=en_GB`;
      const url2 = `https://ips.betfair.com/inplayservice/v1.1/eventTimelines?eventIds=${idsParam}&alt=json`;
      const timelines = await withTimeout(async () => {
        const t1 = await fetchIps(url1).catch(() => null);
        if (Array.isArray(t1) && t1.length > 0) return t1;
        const t2 = await fetchIps(url2).catch(() => null);
        return t2;
      }, 7000);
      if (Array.isArray(timelines)) {
        for (const t of timelines) {
          const eventId = String(t?.eventId ?? "").trim();
          if (eventId) byEventId.set(eventId, t);
        }
      }
    } catch {}
  }

  const catalogues = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds, marketTypeCodes: ["MATCH_ODDS"] },
        maxResults: String(Math.min(eventIds.length, maxResults)),
        sort: "FIRST_TO_START",
        marketProjection: ["EVENT", "COMPETITION", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    12_000,
  );

  const markets = Array.isArray(catalogues) ? catalogues : [];
  const marketIds = markets
    .map((m: any) => String(m?.marketId ?? "").trim())
    .filter(Boolean)
    .slice(0, maxResults);

  if (marketIds.length === 0) return [];

  const booksByMarketId = new Map<string, any>();
  const chunkSize = 40;
  for (let i = 0; i < marketIds.length; i += chunkSize) {
    const chunk = marketIds.slice(i, i + chunkSize);
    const books = await withTimeout(
      () =>
        call("SportsAPING/v1.0/listMarketBook", {
          marketIds: chunk,
          priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
        }),
      12_000,
    );
    for (const b of Array.isArray(books) ? books : []) {
      const id = String(b?.marketId ?? "").trim();
      if (id) booksByMarketId.set(id, b);
    }
  }

  const nowMs = Date.now();
  const out: any[] = [];

  for (const mk of markets) {
    const marketId = String(mk?.marketId ?? "").trim();
    if (!marketId) continue;
    const event = mk?.event ?? null;
    const competition = mk?.competition ?? null;
    const eventId = String(event?.id ?? "").trim();
    const eventName = String(event?.name ?? "").trim();
    const teams = splitEventTeams(eventName);
    if (!teams) continue;

    const marketStartTime = String(mk?.marketStartTime ?? event?.openDate ?? "").trim();
    const kickoffMs = marketStartTime ? new Date(marketStartTime).getTime() : NaN;

    const runners = Array.isArray(mk?.runners) ? mk.runners : [];
    const selectionByRole: Record<string, number> = {};
    for (const r of runners) {
      const selectionId = Number(r?.selectionId);
      if (!Number.isFinite(selectionId)) continue;
      const role = guessRunnerRole(String(r?.runnerName ?? ""), teams.home, teams.away);
      if (!role) continue;
      if (selectionByRole[role] != null) continue;
      selectionByRole[role] = selectionId;
    }

    const book = booksByMarketId.get(marketId) ?? null;
    const totalMatched = Number(book?.totalMatched);
    const marketStatus = String(book?.status ?? "").toUpperCase();
    const isClosed = marketStatus === "CLOSED";
    const isInPlay = isClosed ? false : Boolean(book?.inplay);

    const timeline = eventId ? (byEventId.get(eventId) ?? null) : null;
    const elapsed = Number(timeline?.timeElapsed);
    const statusRaw = String(timeline?.status ?? "").trim().toUpperCase();
    const statusShort = statusRaw === "ENDED" ? "FINISHED" : statusRaw || null;
    const parsedScore = parseTimelineScore(timeline);
    let scoreHome: number | null = parsedScore.home;
    let scoreAway: number | null = parsedScore.away;
    const nowIso = new Date().toISOString();

    const fallbackElapsed = (() => {
      const iso = String(marketStartTime ?? "").trim();
      if (!iso) return null;
      const ms = new Date(iso).getTime();
      if (!Number.isFinite(ms)) return null;
      const diffMin = Math.floor((Date.now() - ms) / 60000);
      if (!Number.isFinite(diffMin) || diffMin < 0 || diffMin > 200) return null;
      return diffMin;
    })();

    const isLiveByTime = !isClosed && Number.isFinite(kickoffMs) && nowMs >= kickoffMs;
    const fallbackStatusShort = isClosed ? "FINISHED" : (isInPlay || isLiveByTime) ? "LIVE" : null;

    const status =
      statusShort === "FINISHED" || isClosed
        ? "FINISHED"
        : isInPlay || statusShort === "LIVE" || statusShort === "IN_PLAY" || statusShort === "1H" || statusShort === "2H" || statusShort === "HT"
          ? "IN_PLAY"
          : isLiveByTime
            ? "IN_PLAY"
            : "SCHEDULED";

    if ((status === "IN_PLAY" || isInPlay) && scoreHome == null && scoreAway == null) {
      scoreHome = 0;
      scoreAway = 0;
    }

    const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
    const pull = (selectionId: number) => {
      const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
      const ex = rb?.ex ?? {};
      const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
      const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
      const ltp = Number(rb?.lastPriceTraded);
      return {
        back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
        backSize: back0 ? Number(back0.size) : null,
        lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
        laySize: lay0 ? Number(lay0.size) : null,
      };
    };

    const odds: any = {};
    if (Number.isFinite(selectionByRole.home)) odds.home = pull(selectionByRole.home);
    if (Number.isFinite(selectionByRole.draw)) odds.draw = pull(selectionByRole.draw);
    if (Number.isFinite(selectionByRole.away)) odds.away = pull(selectionByRole.away);

    const idNumber = Number(eventId);
    const id = Number.isFinite(idNumber) ? idNumber : Math.floor(9_000_000_000 + out.length);

    out.push({
      id,
      utcDate: marketStartTime || new Date().toISOString(),
      status,
      matchday: 0,
      homeTeam: { id: 0, name: teams.home, shortName: teams.home, tla: teams.home.substring(0, 3).toUpperCase(), crest: "" },
      awayTeam: { id: 0, name: teams.away, shortName: teams.away, tla: teams.away.substring(0, 3).toUpperCase(), crest: "" },
      score: { fullTime: { home: Number.isFinite(scoreHome as number) ? scoreHome : null, away: Number.isFinite(scoreAway as number) ? scoreAway : null } },
      live: timeline || isInPlay || status === "IN_PLAY"
        ? {
            provider: "betfair",
            elapsed: Number.isFinite(elapsed) ? elapsed : status === "IN_PLAY" ? fallbackElapsed : null,
            extra: null,
            statusShort: statusShort || fallbackStatusShort,
            fetchedAt: nowIso,
          }
        : null,
      competition: {
        id: 0,
        name: String(competition?.name ?? "").trim() || "Soccer",
        code: "",
        emblem: "",
        area: { name: String(event?.countryCode ?? "").trim() || "Unknown", code: String(event?.countryCode ?? "").trim() || "", flag: "" },
      },
      betfair: {
        eventId: eventId || null,
        eventName: eventName || null,
        marketId,
        marketStartTime: marketStartTime || null,
        inPlay: isInPlay,
        runners: {
          homeSelectionId: Number.isFinite(selectionByRole.home) ? selectionByRole.home : null,
          drawSelectionId: Number.isFinite(selectionByRole.draw) ? selectionByRole.draw : null,
          awaySelectionId: Number.isFinite(selectionByRole.away) ? selectionByRole.away : null,
        },
        matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
        odds,
        oddsFetchedAt: new Date().toISOString(),
      },
    });
  }

  return out;

  return out;
};

const resolveBetfairMatchOdds = async (params: { homeTeam: string; awayTeam: string; utcDate: string | null }) => {
  const homeTeam = String(params.homeTeam ?? "").trim();
  const awayTeam = String(params.awayTeam ?? "").trim();
  const utcDate = params.utcDate ? String(params.utcDate) : null;
  if (!homeTeam || !awayTeam) throw new Error("Betfair: home/away ausentes");

  const kickoff = utcDate ? new Date(utcDate) : null;
  const kickoffMs = kickoff && Number.isFinite(kickoff.getTime()) ? kickoff.getTime() : NaN;
  const from = Number.isFinite(kickoffMs) ? new Date(kickoffMs - 3 * 60 * 60 * 1000).toISOString() : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const to = Number.isFinite(kickoffMs) ? new Date(kickoffMs + 6 * 60 * 60 * 1000).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  let sessionToken = await getBetfairSessionToken();
  const call = async (method: string, rpcParams: any) => {
    try {
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      sessionToken = await getBetfairSessionToken({ force: true });
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    }
  };

  const stripTeamNoise = (value: string) => {
    const n = normalizeName(value);
    if (!n) return "";
    const stop = new Set(["fc", "cf", "sc", "ac", "cd", "de", "da", "do", "the", "club", "clube"]);
    return n
      .split(" ")
      .filter((t) => t && t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
      .join(" ")
      .trim();
  };

  const qHome = stripTeamNoise(homeTeam);
  const qAway = stripTeamNoise(awayTeam);
  const eventQueries = Array.from(
    new Set(
      [
        homeTeam,
        awayTeam,
        `${homeTeam} ${awayTeam}`,
        qHome,
        qAway,
        `${qHome} ${qAway}`.trim(),
        `${(qHome.split(" ")[0] ?? "").trim()} ${(qAway.split(" ")[0] ?? "").trim()}`.trim(),
      ].map((x) => String(x ?? "").trim()).filter(Boolean),
    ),
  );
  let events: any[] = [];
  for (const q of eventQueries) {
    const r = await withTimeout(
      () => call("SportsAPING/v1.0/listEvents", { filter: { eventTypeIds: ["1"], textQuery: q, marketStartTime: { from, to } } }),
      8000,
    );
    if (Array.isArray(r) && r.length > 0) {
      events = r;
      const bestEv = pickBestEvent(events, homeTeam, awayTeam, utcDate);
      if (bestEv) {
        events = [{ event: bestEv }];
        break;
      }
    }
  }

  const best = pickBestEvent(events, homeTeam, awayTeam, utcDate);
  const eventId = String(best?.id ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId não encontrado");

  const catalogue = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds: [eventId], marketTypeCodes: ["MATCH_ODDS"] },
        maxResults: 1,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    8000,
  );

  const mk = Array.isArray(catalogue) ? catalogue[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (MATCH_ODDS) não encontrado");

  const runners = Array.isArray(mk?.runners) ? mk.runners : [];
  const selectionByRole: Record<string, number> = {};
  for (const r of runners) {
    const selectionId = Number(r?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const role = guessRunnerRole(String(r?.runnerName ?? ""), homeTeam, awayTeam);
    if (!role) continue;
    if (selectionByRole[role] != null) continue;
    selectionByRole[role] = selectionId;
  }

  const marketBook = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketBook", {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
  const odds: any = {};
  const pull = (selectionId: number) => {
    const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const ltp = Number(rb?.lastPriceTraded);
    return {
      back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
      laySize: lay0 ? Number(lay0.size) : null,
    };
  };

  if (Number.isFinite(selectionByRole.home)) odds.home = pull(selectionByRole.home);
  if (Number.isFinite(selectionByRole.draw)) odds.draw = pull(selectionByRole.draw);
  if (Number.isFinite(selectionByRole.away)) odds.away = pull(selectionByRole.away);

  return {
    eventId,
    eventName: String(best?.name ?? "").trim() || null,
    marketId,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    runners: {
      homeSelectionId: Number.isFinite(selectionByRole.home) ? selectionByRole.home : null,
      drawSelectionId: Number.isFinite(selectionByRole.draw) ? selectionByRole.draw : null,
      awaySelectionId: Number.isFinite(selectionByRole.away) ? selectionByRole.away : null,
    },
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    odds,
    oddsFetchedAt: new Date().toISOString(),
  };
};

const parseCorrectScoreKey = (runnerName: string) => {
  const m = String(runnerName ?? "").trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return `${Math.max(0, Math.floor(h))}-${Math.max(0, Math.floor(a))}`;
};

const resolveBetfairCorrectScoreMarket = async (params: { eventId: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId ausente (Correct Score)");

  const catalogue = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds: [eventId], marketTypeCodes: ["CORRECT_SCORE"] },
        maxResults: 1,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    8000,
  );

  const mk = Array.isArray(catalogue) ? catalogue[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (CORRECT_SCORE) não encontrado");

  const marketBook = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketBook", {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];

  const runners: Record<string, any> = {};
  for (const rb of runnersBook) {
    const selectionId = Number(rb?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const runnerName = String(rb?.runnerName ?? "").trim();
    const key = parseCorrectScoreKey(runnerName);
    if (!key) continue;
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const ltp = Number(rb?.lastPriceTraded);
    runners[key] = {
      selectionId,
      runnerName,
      back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
      laySize: lay0 ? Number(lay0.size) : null,
    };
  }

  return {
    marketId,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    runners,
    oddsFetchedAt: new Date().toISOString(),
  };
};

Deno.serve(async (req) => {
  const method = String((req as any)?.method ?? "").toUpperCase();
  try {
    if (method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });

    const url = (() => {
      try {
        return new URL(String((req as any)?.url ?? ""), "http://localhost");
      } catch {
        return new URL("http://localhost/");
      }
    })();
    const path = url.pathname;

    if (method === "POST" && (path.endsWith("/health") || path === "/health")) return json({ status: "ok" });

    if (method === "POST" && (path.endsWith("/betfair/matches/list") || path === "/betfair/matches/list")) {
      try {
        const body = await readJson(req);
        const dateFrom = String((body as any)?.dateFrom ?? "").trim();
        const dateTo = String((body as any)?.dateTo ?? "").trim();
        const maxResults = Number((body as any)?.maxResults ?? (body as any)?.maxEvents ?? 200);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
          return json({ ok: false, error: "dateFrom/dateTo devem estar no formato YYYY-MM-DD" }, 400);
        }

        const fromIso = new Date(`${dateFrom}T00:00:00-03:00`).toISOString();
        const toIso = new Date(`${dateTo}T23:59:59-03:00`).toISOString();

        const matches = await listBetfairSoccerMatchOddsRange({
          fromIso,
          toIso,
          maxResults: Number.isFinite(maxResults) ? maxResults : 200,
        });
        return json({ ok: true, matches });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: message || "Erro ao listar jogos (Betfair)" }, 500);
      }
    }

    if (method === "POST" && (path.endsWith("/betfair/match/resolve") || path === "/betfair/match/resolve")) {
      try {
        const body = await readJson(req);
        const homeTeam = String((body as any)?.homeTeam ?? "").trim();
        const awayTeam = String((body as any)?.awayTeam ?? "").trim();
        const utcDate = (body as any)?.utcDate == null ? null : String((body as any).utcDate);
        if (!homeTeam || !awayTeam) return json({ ok: false, error: "homeTeam/awayTeam obrigatórios" }, 400);
        const includeCorrectScore = Boolean((body as any)?.includeCorrectScore ?? false);
        const betfair = await resolveBetfairMatchOdds({ homeTeam, awayTeam, utcDate });
        if (includeCorrectScore) {
          try {
            const eventId = String((betfair as any)?.eventId ?? "").trim();
            if (eventId) {
              const cs = await resolveBetfairCorrectScoreMarket({ eventId });
              (betfair as any).correctScore = cs;
            }
          } catch {}
        }
        return json({ ok: true, betfair, cached: false, fetchedAt: betfair?.oddsFetchedAt ?? new Date().toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: message || "Erro ao resolver jogo (Betfair)" }, 500);
      }
    }

    return json({ ok: false, error: "Not Found" }, 404);
  } catch (error) {
    if (method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message || "Erro interno" }, 500);
  }
});
