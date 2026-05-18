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

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const normalizeLeagueCountryKey = (country: unknown) => {
  const c = String(country ?? "").trim();
  if (!c) return "all";
  return c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
};

const leaguesCacheKey = (country: unknown) => `api-football:leagues:${normalizeLeagueCountryKey(country)}`;

const validateLeaguesCachePayload = (payload: any) => {
  const fetchedAt = String(payload?.fetchedAt ?? "");
  if (!fetchedAt) return { ok: false, error: "fetchedAt é obrigatório" } as const;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return { ok: false, error: "fetchedAt inválido" } as const;

  if (!Array.isArray(payload?.items)) return { ok: false, error: "items deve ser um array" } as const;
  if (payload.items.length > 10000) return { ok: false, error: "items muito grande" } as const;

  const approxSize = JSON.stringify(payload).length;
  if (approxSize > 2_000_000) return { ok: false, error: "payload muito grande" } as const;

  return { ok: true } as const;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path.endsWith("/health"))) return json({ status: "ok" });

  if (req.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);

  if (path.endsWith("/cache/api-football/leagues/get") || path === "/cache/api-football/leagues/get") {
    try {
      const body = await readJson(req);
      const key = leaguesCacheKey((body as any)?.country);
      const value = await kv.get(key);
      return json({ ok: true, value: value ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao ler cache" }, 500);
    }
  }

  if (path.endsWith("/cache/api-football/leagues/set") || path === "/cache/api-football/leagues/set") {
    try {
      const body = await readJson(req);
      const key = leaguesCacheKey((body as any)?.country);
      const payload = (body as any)?.payload;
      const validation = validateLeaguesCachePayload(payload);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
      await kv.set(key, payload);
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao salvar cache" }, 500);
    }
  }

  return json({ ok: false, error: "Not Found" }, 404);
});
