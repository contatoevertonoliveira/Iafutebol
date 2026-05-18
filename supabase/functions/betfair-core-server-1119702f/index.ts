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

const betfairCertLogin = async () => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey || !cfg.username || !cfg.password) throw new Error("Betfair: credenciais ausentes (APP_KEY/USERNAME/PASSWORD)");
  if (!cfg.certPem || !cfg.keyPem) throw new Error("Betfair: certificado ausente (CERT_PEM/KEY_PEM)");

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

const betfairJsonRpcRawWithUrl = async (params: { url: string; method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("Betfair: url ausente");
  const method = String(params.method ?? "").trim();

  const res = await fetch(url, {
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
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
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

  return json({ ok: false, error: "Not Found" }, 404);
});
