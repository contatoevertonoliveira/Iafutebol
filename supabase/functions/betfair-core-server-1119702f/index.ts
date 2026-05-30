import * as kv from "../make-server-1119702f/kv_store.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const requireAutomationAdmin = (req: Request, body?: any) => {
  const enabled = String(Deno.env.get("BETFAIR_TRADING_ENABLED") ?? "").trim().toLowerCase() === "true";
  if (!enabled) return json({ ok: false, error: "Trading desabilitado" }, 403);
  const expected = String(Deno.env.get("AUTOMATION_ADMIN_TOKEN") ?? "").trim();
  if (!expected) return json({ ok: false, error: "Trading desabilitado" }, 403);
  const provided =
    String(req.headers.get("x-automation-token") ?? "").trim() ||
    String(body?.adminToken ?? body?.automationAdminToken ?? "").trim();
  if (!provided || provided !== expected) return json({ ok: false, error: "Forbidden" }, 403);
  return null;
};

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const decodeEnvPem = (value: string) => String(value ?? "").replace(/\\n/g, "\n").trim();

const extractPemBlock = (pem: string, label: string) => {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = pem.indexOf(begin);
  if (start < 0) return null;
  const stop = pem.indexOf(end, start);
  if (stop < 0) return null;
  const inner = pem.slice(start + begin.length, stop).replace(/[\r\n\s]/g, "");
  return inner || null;
};

const pemSha256Hex = async (pem: string, label: string) => {
  const b64 = extractPemBlock(pem, label);
  if (!b64) return null;
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

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
  const certSource = certRawV2 ? "BETFAIR_CERT_PEM_V2" : certRawV1 ? "BETFAIR_CERT_PEM" : null;

  const keyRawV2 = String(Deno.env.get("BETFAIR_KEY_PEM_V2") ?? "");
  const keyRawV1 = String(Deno.env.get("BETFAIR_KEY_PEM") ?? "");
  const keyRawAlias = String(Deno.env.get("BETFAIR_CERT_KEY") ?? "");
  const keyPem = decodeEnvPem(keyRawV2 || keyRawV1 || keyRawAlias);
  const keySource = keyRawV2 ? "BETFAIR_KEY_PEM_V2" : keyRawV1 ? "BETFAIR_KEY_PEM" : keyRawAlias ? "BETFAIR_CERT_KEY" : null;

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
  const bettingRpcUrl = `https://${apiHost}/exchange/betting/json-rpc/v1`;
  const accountRpcUrl = `https://${apiHost}/exchange/account/json-rpc/v1`;

  assertHeaderSafe("BETFAIR_APP_KEY", appKey);
  assertHeaderSafe("BETFAIR_USERNAME", username);
  assertHeaderSafe("BETFAIR_PASSWORD", password);

  return { appKey, username, password, certPem, keyPem, ssoHost, apiHost, bettingRpcUrl, accountRpcUrl, certSource, keySource } as const;
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

  const client = Deno.createHttpClient({ cert: cfg.certPem, key: cfg.keyPem } as any);
  const url = `https://${cfg.ssoHost}/api/certlogin`;
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Application": cfg.appKey, "Content-Type": "application/x-www-form-urlencoded" },
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

const betfairJsonRpcRawWithUrl = async (params: { url: string; method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("Betfair: url ausente");
  const method = String(params.method ?? "").trim();

  await betfairRpcLimiter.acquire();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Application": cfg.appKey,
      "X-Authentication": params.sessionToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method, params: params.params ?? {} }]),
  });

  const text = await res.text().catch(() => "");
  const data = (() => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  })();
  if (!res.ok) {
    const isSessionInvalid = res.status === 401 || res.status === 403 || /INVALID_SESSION|NO_SESSION|SESSION.*INVALID/i.test(text);
    const err = new Error(`Betfair API falhou (HTTP ${res.status})${text ? `: ${text.slice(0, 260)}` : ""}`) as any;
    err.__betfairSessionInvalid = isSessionInvalid;
    throw err;
  }
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

const betfairJsonRpcRaw = async (params: { method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  return await betfairJsonRpcRawWithUrl({ url: cfg.bettingRpcUrl, ...params });
};

const betfairJsonRpc = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set([
    "SportsAPING/v1.0/listEventTypes",
    "SportsAPING/v1.0/listCompetitions",
    "SportsAPING/v1.0/listEvents",
    "SportsAPING/v1.0/listMarketCatalogue",
    "SportsAPING/v1.0/listMarketBook",
    "SportsAPING/v1.0/listTimeRanges",
    "SportsAPING/v1.0/listCountries",
    "SportsAPING/v1.0/listVenues",
  ]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

const betfairJsonRpcAccount = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set(["AccountAPING/v1.0/getAccountFunds"]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  const cfg = getBetfairConfig();
  return await betfairJsonRpcRawWithUrl({ url: cfg.accountRpcUrl, ...params, method });
};

const betfairJsonRpcTrading = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set([
    "SportsAPING/v1.0/placeOrders",
    "SportsAPING/v1.0/listCurrentOrders",
    "SportsAPING/v1.0/cancelOrders",
    "SportsAPING/v1.0/listMarketProfitAndLoss",
  ]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

const validatePlaceOrdersPayload = (payload: any) => {
  const marketId = String(payload?.marketId ?? "").trim();
  if (!marketId) return { ok: false, error: "marketId obrigatório" } as const;
  if (!Array.isArray(payload?.instructions) || payload.instructions.length === 0) {
    return { ok: false, error: "instructions deve ser um array não vazio" } as const;
  }
  if (payload.instructions.length > 50) return { ok: false, error: "instructions grande demais" } as const;
  const customerRef = payload?.customerRef == null ? null : String(payload.customerRef);
  if (customerRef && customerRef.length > 32) return { ok: false, error: "customerRef grande demais" } as const;
  return { ok: true } as const;
};

Deno.serve(async (req) => {
  const method = String((req as any)?.method ?? "").toUpperCase();
  const isPreflight =
    method === "OPTIONS" || (req.headers.has("origin") && req.headers.has("access-control-request-method"));
  if (isPreflight) return new Response(null, { status: 204, headers: CORS_HEADERS });

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path.endsWith("/health"))) return json({ status: "ok" });

  if (req.method === "POST" && (path.endsWith("/betfair/session") || path === "/betfair/session")) {
    try {
      const token = await getBetfairSessionToken();
      const tokenPreview = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null;
      const debug = new URL(req.url).searchParams.get("debug") === "1";
      if (!debug) return json({ ok: true, hasSession: Boolean(token), tokenPreview, fetchedAt: new Date().toISOString() });

      const cfg = getBetfairConfig();
      const certSha256 = await pemSha256Hex(cfg.certPem, "CERTIFICATE");
      const keyType = cfg.keyPem.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN PRIVATE KEY") ? "PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN ENCRYPTED PRIVATE KEY") ? "ENCRYPTED PRIVATE KEY"
        : "UNKNOWN";
      return json({
        ok: true,
        hasSession: Boolean(token),
        tokenPreview,
        fetchedAt: new Date().toISOString(),
        debug: { ssoHost: cfg.ssoHost, apiHost: cfg.apiHost, certSha256, keyType, certSource: cfg.certSource, keySource: cfg.keySource },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao criar sessão Betfair" }, 500);
    }
  }

  if (req.method === "POST" && (path.endsWith("/betfair/rpc") || path === "/betfair/rpc")) {
    try {
      const body = await readJson(req);
      const method = String((body as any)?.method ?? "").trim();
      const params = (body as any)?.params ?? {};
      const sessionToken = await getBetfairSessionToken();
      let result: any = null;
      try {
        result = await betfairJsonRpc({ method, params, sessionToken });
      } catch (e) {
        const invalid = Boolean((e as any)?.__betfairSessionInvalid);
        if (!invalid) throw e;
        const refreshed = await getBetfairSessionToken({ force: true });
        result = await betfairJsonRpc({ method, params, sessionToken: refreshed });
      }
      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao chamar Betfair" }, 500);
    }
  }

  if (req.method === "POST" && (path.endsWith("/automation/betfair/account/funds") || path === "/automation/betfair/account/funds" ||
    path.endsWith("/betfair/account/funds") || path === "/betfair/account/funds")) {
    try {
      const body = await readJson(req);
      const adminError = requireAutomationAdmin(req, body);
      if (adminError) return adminError;
      const wallet = String((body as any)?.wallet ?? "").trim() || null;
      const sessionToken = await getBetfairSessionToken();
      let result: any = null;
      try {
        result = await betfairJsonRpcAccount({
          method: "AccountAPING/v1.0/getAccountFunds",
          params: wallet ? { wallet } : {},
          sessionToken,
        });
      } catch (e) {
        const invalid = Boolean((e as any)?.__betfairSessionInvalid);
        if (!invalid) throw e;
        const refreshed = await getBetfairSessionToken({ force: true });
        result = await betfairJsonRpcAccount({
          method: "AccountAPING/v1.0/getAccountFunds",
          params: wallet ? { wallet } : {},
          sessionToken: refreshed,
        });
      }

      const availableToBetBalance = Number(result?.availableToBetBalance);
      const exposure = Number(result?.exposure);
      const currencyCode = String(result?.currencyCode ?? "").trim() || null;

      return json({
        ok: true,
        funds: result ?? null,
        summary: {
          availableToBetBalance: Number.isFinite(availableToBetBalance) ? availableToBetBalance : null,
          exposure: Number.isFinite(exposure) ? exposure : null,
          currencyCode,
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao buscar banca (Betfair)" }, 500);
    }
  }

  if (req.method === "POST" && (path.endsWith("/betfair/placeOrders") || path === "/betfair/placeOrders")) {
    try {
      const body = await readJson(req);
      const adminError = requireAutomationAdmin(req, body);
      if (adminError) return adminError;
      const validation = validatePlaceOrdersPayload(body);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
      const sessionToken = await getBetfairSessionToken();
      const result = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/placeOrders",
        params: {
          marketId: String((body as any).marketId),
          instructions: (body as any).instructions,
          customerRef: (body as any).customerRef ?? undefined,
          marketVersion: (body as any).marketVersion ?? undefined,
          customerStrategyRef: (body as any).customerStrategyRef ?? undefined,
          async: Boolean((body as any).async ?? false),
        },
        sessionToken,
      });
      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao enviar placeOrders" }, 500);
    }
  }

  if (req.method === "POST" && (path.endsWith("/betfair/listCurrentOrders") || path === "/betfair/listCurrentOrders")) {
    try {
      const body = await readJson(req);
      const adminError = requireAutomationAdmin(req, body);
      if (adminError) return adminError;
      const betIds = Array.isArray((body as any)?.betIds) ? (body as any).betIds.map(String).filter(Boolean).slice(0, 50) : null;
      const marketIds = Array.isArray((body as any)?.marketIds) ? (body as any).marketIds.map(String).filter(Boolean).slice(0, 50) : null;
      const orderProjection = String((body as any)?.orderProjection ?? "").trim() || "ALL";
      const sessionToken = await getBetfairSessionToken();
      let result: any = null;
      try {
        result = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listCurrentOrders",
        params: {
          ...(betIds && betIds.length > 0 ? { betIds } : {}),
          ...(marketIds && marketIds.length > 0 ? { marketIds } : {}),
          orderProjection,
        },
        sessionToken,
      });
      } catch (e) {
        const invalid = Boolean((e as any)?.__betfairSessionInvalid);
        if (!invalid) throw e;
        const refreshed = await getBetfairSessionToken({ force: true });
        result = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/listCurrentOrders",
          params: {
            ...(betIds && betIds.length > 0 ? { betIds } : {}),
            ...(marketIds && marketIds.length > 0 ? { marketIds } : {}),
            orderProjection,
          },
          sessionToken: refreshed,
        });
      }
      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao listar ordens" }, 500);
    }
  }

  if (req.method === "POST" && (path.endsWith("/betfair/cancelOrders") || path === "/betfair/cancelOrders")) {
    try {
      const body = await readJson(req);
      const adminError = requireAutomationAdmin(req, body);
      if (adminError) return adminError;
      const marketId = String((body as any)?.marketId ?? "").trim() || null;
      const rawInstructions = Array.isArray((body as any)?.instructions) ? (body as any).instructions : [];
      const instructions = rawInstructions.slice(0, 50).map((i: any) => {
        const betId = String(i?.betId ?? "").trim() || null;
        const sizeReduction = i?.sizeReduction == null ? undefined : Number(i.sizeReduction);
        return {
          ...(betId ? { betId } : {}),
          ...(Number.isFinite(sizeReduction) ? { sizeReduction } : {}),
        };
      }).filter((x: any) => x.betId);
      if (instructions.length === 0) return json({ ok: false, error: "instructions (betId) obrigatório" }, 400);
      const sessionToken = await getBetfairSessionToken();
      const result = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: {
          ...(marketId ? { marketId } : {}),
          instructions,
        },
        sessionToken,
      });
      return json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao cancelar ordens" }, 500);
    }
  }

  return json({ ok: false, error: "Not Found" }, 404);
});
