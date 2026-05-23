import * as kv from "../make-server-1119702f/kv_store.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-token",
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
let cachedBanUntilMs = 0;

const KV_SESSION_KEY = "betfair/session_v1";
const KV_BAN_KEY = "betfair/ban_until_v1";
const KV_LOCK_KEY = "betfair/session_lock_v1";

const kvGetSafe = async <T>(key: string): Promise<T | null> => {
  try {
    return (await kv.get(key)) as T | null;
  } catch {
    return null;
  }
};

const kvSetSafe = async (key: string, value: any) => {
  try {
    await kv.set(key, value);
  } catch {}
};

const kvDelSafe = async (key: string) => {
  try {
    await kv.del(key);
  } catch {}
};

const delay = async (ms: number) => {
  const t = Math.max(0, Math.min(30_000, Math.floor(ms)));
  if (!t) return;
  await new Promise((r) => setTimeout(r, t));
};

const getEnvNum = (key: string, fallback: number, min: number, max: number) => {
  const raw = String(Deno.env.get(key) ?? "").trim();
  const n = raw ? Number(raw) : NaN;
  const v = Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, v));
};

const createRateLimiter = (rps: number, burst: number) => {
  const rate = Math.max(0.01, rps);
  const cap = Math.max(1, Math.floor(burst));
  let tokens = cap;
  let lastMs = Date.now();
  let chain = Promise.resolve();
  const acquire = async () => {
    chain = chain.then(async () => {
      const now = Date.now();
      const elapsed = Math.max(0, now - lastMs);
      tokens = Math.min(cap, tokens + (elapsed * rate) / 1000);
      lastMs = now;
      if (tokens < 1) {
        const waitMs = ((1 - tokens) / rate) * 1000;
        await delay(waitMs);
        const now2 = Date.now();
        const elapsed2 = Math.max(0, now2 - lastMs);
        tokens = Math.min(cap, tokens + (elapsed2 * rate) / 1000);
        lastMs = now2;
      }
      tokens = Math.max(0, tokens - 1);
    });
    await chain;
  };
  return { acquire };
};

const betfairRpcLimiter = createRateLimiter(getEnvNum("BETFAIR_RPC_RPS", 5, 0.2, 20), getEnvNum("BETFAIR_RPC_BURST", 2, 1, 20));
const betfairLoginLimiter = createRateLimiter(getEnvNum("BETFAIR_LOGIN_RPS", 0.05, 0.01, 1), 1);
const betfairIpsLimiter = createRateLimiter(getEnvNum("BETFAIR_IPS_RPS", 3, 0.2, 20), getEnvNum("BETFAIR_IPS_BURST", 2, 1, 20));

const getBanUntilMs = async () => {
  if (Number.isFinite(cachedBanUntilMs) && cachedBanUntilMs > Date.now()) return cachedBanUntilMs;
  const res = await kvGetSafe<{ untilMs: number }>(KV_BAN_KEY);
  const untilMs = Number(res?.untilMs);
  if (Number.isFinite(untilMs) && untilMs > Date.now()) {
    cachedBanUntilMs = untilMs;
    return untilMs;
  }
  return 0;
};

const setBanUntilMs = async (untilMs: number) => {
  const safeUntilMs = Number.isFinite(untilMs) ? Math.max(0, Math.floor(untilMs)) : 0;
  cachedBanUntilMs = safeUntilMs;
  await kvSetSafe(KV_BAN_KEY, { untilMs: safeUntilMs });
};

const acquireLoginLock = async (ttlMs: number) => {
  const expireIn = Math.max(1000, Math.min(20_000, Math.floor(ttlMs)));
  const now = Date.now();
  const existing = await kvGetSafe<{ acquiredAtMs?: number; expiresAtMs?: number }>(KV_LOCK_KEY);
  const existingExpiresAtMs = Number(existing?.expiresAtMs);
  const isLocked = Number.isFinite(existingExpiresAtMs) && existingExpiresAtMs > now;
  const acquired = !isLocked;
  if (acquired) {
    await kvSetSafe(KV_LOCK_KEY, { acquiredAtMs: now, expiresAtMs: now + expireIn });
  }

  return {
    ok: acquired,
    release: async () => {
      if (!acquired) return;
      await kvDelSafe(KV_LOCK_KEY);
    },
  };
};

const betfairCertLogin = async () => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey || !cfg.username || !cfg.password) throw new Error("Betfair: credenciais ausentes (APP_KEY/USERNAME/PASSWORD)");
  if (!cfg.certPem || !cfg.keyPem) throw new Error("Betfair: certificado ausente (CERT_PEM/KEY_PEM)");

  const banUntilMs = await getBanUntilMs();
  if (banUntilMs && Date.now() < banUntilMs) {
    const waitSec = Math.max(1, Math.ceil((banUntilMs - Date.now()) / 1000));
    throw new Error(`Betfair login bloqueado temporariamente. Aguarde ${waitSec}s`);
  }

  await betfairLoginLimiter.acquire();

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
  if (status !== "SUCCESS" || !sessionToken) {
    if (/TEMPORARY_BAN_TOO_MANY_REQUESTS/i.test(status)) {
      await setBanUntilMs(Date.now() + 10 * 60 * 1000);
    }
    throw new Error(`Betfair login falhou: ${status || "UNKNOWN"}`);
  }

  cachedSession = { token: sessionToken, fetchedAtMs: Date.now() };
  return sessionToken;
};

const getBetfairSessionToken = async (opts?: { force?: boolean }) => {
  if (!opts?.force && cachedSession?.token) {
    if (Date.now() - cachedSession.fetchedAtMs < 50 * 60 * 1000) return cachedSession.token;
  }

  const banUntilMs = await getBanUntilMs();
  if (banUntilMs && Date.now() < banUntilMs) {
    const waitSec = Math.max(1, Math.ceil((banUntilMs - Date.now()) / 1000));
    throw new Error(`Betfair login bloqueado temporariamente. Aguarde ${waitSec}s`);
  }

  if (!opts?.force) {
    const v = await kvGetSafe<{ token: string; fetchedAtMs: number }>(KV_SESSION_KEY);
    if (v?.token && typeof v.fetchedAtMs === "number") {
      if (Date.now() - v.fetchedAtMs < 50 * 60 * 1000) {
        cachedSession = { token: v.token, fetchedAtMs: v.fetchedAtMs };
        return v.token;
      }
    }
  }

  const lock = await acquireLoginLock(12_000);
  try {
    if (!lock.ok && !opts?.force) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 12_000) {
        await new Promise((r) => setTimeout(r, 250));
        const v = await kvGetSafe<{ token: string; fetchedAtMs: number }>(KV_SESSION_KEY);
        if (v?.token && typeof v.fetchedAtMs === "number") {
          if (Date.now() - v.fetchedAtMs < 50 * 60 * 1000) {
            cachedSession = { token: v.token, fetchedAtMs: v.fetchedAtMs };
            return v.token;
          }
        }
      }
    }

    const token = await betfairCertLogin();
    await kvSetSafe(KV_SESSION_KEY, { token, fetchedAtMs: Date.now() });
    return token;
  } finally {
    await lock.release();
  }
};

const betfairJsonRpcRaw = async (params: { method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const method = String(params.method ?? "").trim();

  await betfairRpcLimiter.acquire();

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
    const isRetryable = /ANGX-0001/i.test(code);
    const err = new Error(`Betfair API error: ${msg}`.slice(0, 600)) as any;
    err.__betfairSessionInvalid = isSessionInvalid;
    err.__betfairRetryable = isRetryable;
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

const sleep = async (ms: number) => {
  const t = Math.max(0, Math.min(5000, Math.floor(ms)));
  if (!t) return;
  await new Promise((r) => setTimeout(r, t));
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

const listBetfairSoccerMatchOddsRange = async (params: {
  fromIso: string;
  toIso: string;
  maxResults: number;
  inPlayOnly?: boolean;
}) => {
  const fromIso = String(params.fromIso ?? "").trim();
  const toIso = String(params.toIso ?? "").trim();
  const maxResults = Math.max(1, Math.min(400, Number(params.maxResults ?? 200) || 200));
  const inPlayOnly = Boolean(params.inPlayOnly ?? false);
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
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
      } catch (e) {
        lastErr = e;
        const invalid = Boolean((e as any)?.__betfairSessionInvalid);
        const retryable = Boolean((e as any)?.__betfairRetryable);
        if (!(invalid || retryable) || attempt >= 2) throw e;
        if (retryable) {
          await sleep(450 * (attempt + 1));
          continue;
        }
        sessionToken = await getBetfairSessionToken({ force: true });
      }
    }
    throw lastErr;
  };

  const startMs = new Date(fromIso).getTime();
  const endMs = new Date(toIso).getTime();
  if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs)) return [];

  const stepMs = 6 * 60 * 60 * 1000;
  const maxCatalogueResults = String(Math.max(1, Math.min(50, Math.floor(maxResults))));
  const marketsById = new Map<string, any>();
  for (let t = startMs; t < endMs; t += stepMs) {
    const chunkFromIso = new Date(t).toISOString();
    const chunkToIso = new Date(Math.min(endMs, t + stepMs)).toISOString();
    const cats = await withTimeout(
      () =>
        call("SportsAPING/v1.0/listMarketCatalogue", {
          filter: {
            eventTypeIds: ["1"],
            marketTypeCodes: ["MATCH_ODDS"],
            marketStartTime: { from: chunkFromIso, to: chunkToIso },
            ...(inPlayOnly ? { inPlayOnly: true } : {}),
          },
          maxResults: maxCatalogueResults,
          sort: "FIRST_TO_START",
          marketProjection: ["EVENT", "COMPETITION", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
        }),
      12_000,
    );
    for (const mk of Array.isArray(cats) ? cats : []) {
      const marketId = String(mk?.marketId ?? "").trim();
      if (!marketId) continue;
      if (!marketsById.has(marketId)) marketsById.set(marketId, mk);
    }
    if (marketsById.size >= Math.max(50, Math.min(600, maxResults * 3))) break;
  }

  const markets = Array.from(marketsById.values()).slice(0, maxResults);
  const eventIds = Array.from(
    new Set(
      markets
        .map((m: any) => String(m?.event?.id ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, maxResults);

  if (markets.length === 0 || eventIds.length === 0) return [];

  const byEventId = new Map<string, any>();
  for (let i = 0; i < eventIds.length; i += 50) {
    try {
      const chunk = eventIds.slice(i, i + 50);
      const idsParam = encodeURIComponent(chunk.join(","));
      const fetchIps = async (url: string) => {
        await betfairIpsLimiter.acquire();
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

  const marketIds = markets
    .map((m: any) => String(m?.marketId ?? "").trim())
    .filter(Boolean)
    .slice(0, maxResults);

  if (marketIds.length === 0) return [];

  const booksByMarketId = new Map<string, any>();
  const chunkSize = 10;
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
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
      } catch (e) {
        lastErr = e;
        const invalid = Boolean((e as any)?.__betfairSessionInvalid);
        const retryable = Boolean((e as any)?.__betfairRetryable);
        if (!(invalid || retryable) || attempt >= 2) throw e;
        if (retryable) {
          await sleep(450 * (attempt + 1));
          continue;
        }
        sessionToken = await getBetfairSessionToken({ force: true });
      }
    }
    throw lastErr;
  };
  const catalogues = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventTypeIds: ["1"], marketTypeCodes: ["MATCH_ODDS"], marketStartTime: { from, to } },
        maxResults: "200",
        maxResults: "200",
        sort: "FIRST_TO_START",
        marketProjection: ["EVENT", "COMPETITION", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    12_000,
  );

  const markets = Array.isArray(catalogues) ? catalogues : [];
  let bestMarket: { mk: any; score: number } | null = null;
  for (const mk0 of markets) {
    const ev = mk0?.event ?? null;
    const evName = String(ev?.name ?? "").trim();
    const baseScore = scoreEventName(evName, homeTeam, awayTeam);
    if (baseScore <= 0) continue;

    const startIso = String(mk0?.marketStartTime ?? "").trim();
    const startMs = startIso ? new Date(startIso).getTime() : NaN;
    let timeBonus = 0;
    if (Number.isFinite(kickoffMs) && Number.isFinite(startMs)) {
      const diffMin = Math.abs(kickoffMs - startMs) / 60000;
      timeBonus = Math.max(0, 6 - diffMin / 30);
    }
    const s = baseScore + timeBonus;
    if (!bestMarket || s > bestMarket.score) bestMarket = { mk: mk0, score: s };
  }

  const mk = bestMarket?.mk ?? null;
  const eventId = String(mk?.event?.id ?? "").trim();
  const marketId = String(mk?.marketId ?? "").trim();
  if (!eventId || !marketId) throw new Error("Betfair: eventId não encontrado");

  const fetchIps = async (url: string) => {
    await betfairIpsLimiter.acquire();
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

  const timeline = await (async () => {
    try {
      const idsParam = encodeURIComponent(eventId);
      const url1 = `https://ips.betfair.com/inplayservice/v1.1/eventTimelines?eventIds=${idsParam}&alt=json&regionCode=UK&locale=en_GB`;
      const url2 = `https://ips.betfair.com/inplayservice/v1.1/eventTimelines?eventIds=${idsParam}&alt=json`;
      const timelines = await withTimeout(async () => {
        const t1 = await fetchIps(url1).catch(() => null);
        if (Array.isArray(t1) && t1.length > 0) return t1;
        const t2 = await fetchIps(url2).catch(() => null);
        return t2;
      }, 6500);
      const arr = Array.isArray(timelines) ? timelines : [];
      const found = arr.find((t: any) => String(t?.eventId ?? "").trim() === eventId) ?? null;
      return found;
    } catch {
      return null;
    }
  })();

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

  const timelineScore = (() => {
    if (!timeline) return { home: null as number | null, away: null as number | null };
    const pair =
      parseScorePairFromString((timeline as any)?.currentScore) ??
      parseScorePairFromString((timeline as any)?.scoreString) ??
      parseScorePairFromString((timeline as any)?.score) ??
      parseScorePairFromString((timeline as any)?.score?.current) ??
      null;
    if (pair) return { home: pair.home, away: pair.away };
    return { home: null, away: null };
  })();

  const timelineElapsed = (() => {
    const n = Number((timeline as any)?.timeElapsed);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  })();

  const timelineStatusRaw = String((timeline as any)?.status ?? "").trim().toUpperCase() || null;
  const timelineStatusShort = timelineStatusRaw === "ENDED" ? "FINISHED" : timelineStatusRaw;

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
    eventName: String(mk?.event?.name ?? "").trim() || null,
    marketId,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    timeline: timeline
      ? {
          elapsed: timelineElapsed,
          statusShort: timelineStatusShort,
          scoreHome: timelineScore.home,
          scoreAway: timelineScore.away,
          fetchedAt: new Date().toISOString(),
        }
      : null,
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
  try {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    if (method === "POST" && (path.endsWith("/health") || path === "/health")) return json({ status: "ok" });

    if (method === "POST" && (path.endsWith("/betfair/matches/list") || path === "/betfair/matches/list")) {
      try {
        const body = await readJson(req);
        const dateFrom = String((body as any)?.dateFrom ?? "").trim();
        const dateTo = String((body as any)?.dateTo ?? "").trim();
        const maxResultsRaw = Number((body as any)?.maxResults ?? (body as any)?.maxEvents ?? 120);
        const maxResults = Number.isFinite(maxResultsRaw) ? Math.max(1, Math.min(150, Math.floor(maxResultsRaw))) : 120;
        const inPlayOnly = Boolean((body as any)?.inPlayOnly ?? false);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
          return json({ ok: false, error: "dateFrom/dateTo devem estar no formato YYYY-MM-DD" }, 400);
        }

        const addDaysYmd = (ymd: string, delta: number) => {
          const base = String(ymd ?? "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
          const d = new Date(`${base}T12:00:00.000Z`);
          if (!Number.isFinite(d.getTime())) return base;
          d.setUTCDate(d.getUTCDate() + Math.trunc(delta || 0));
          const y = d.getUTCFullYear();
          const m = String(d.getUTCMonth() + 1).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        };
        const ymdToUtcNoon = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`).getTime();

        const fromDayMs = ymdToUtcNoon(dateFrom);
        const toDayMs = ymdToUtcNoon(dateTo);
        if (!(Number.isFinite(fromDayMs) && Number.isFinite(toDayMs))) {
          return json({ ok: false, error: "dateFrom/dateTo inválidos" }, 400);
        }

        const diffDays = Math.round((toDayMs - fromDayMs) / 86400000);
        const days = Math.max(0, Math.min(7, diffDays));
        const perDayLimitBase = maxResults;
        const perDayLimit = Math.max(10, Math.min(80, Math.ceil(perDayLimitBase / Math.max(1, days + 1))));

        const out: any[] = [];
        for (let i = 0; i <= days; i += 1) {
          const ymd = addDaysYmd(dateFrom, i);
          const fromIso = new Date(`${ymd}T00:00:00-03:00`).toISOString();
          const toIso = new Date(`${ymd}T23:59:59-03:00`).toISOString();
          const chunk = await listBetfairSoccerMatchOddsRange({
            fromIso,
            toIso,
            maxResults: perDayLimit,
            inPlayOnly,
          });
          out.push(...(Array.isArray(chunk) ? chunk : []));
        }
        const matches = out.slice(0, perDayLimitBase);
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
    try {
      const method = String((req as any)?.method ?? "").toUpperCase();
      const isPreflight =
        method === "OPTIONS" || (req.headers.has("origin") && req.headers.has("access-control-request-method"));
      if (isPreflight) return new Response(null, { status: 204, headers: CORS_HEADERS });
    } catch {}
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message || "Erro interno" }, 500);
  }
});
