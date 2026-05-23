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

const requireBearer = (req: Request) => {
  const auth = String(req.headers.get("authorization") ?? "");
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
  return null;
};

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const TRAINING_META_KEY = "iafutebol/meta_model_v1";
const TRAINING_SAMPLES_PREFIX = "iafutebol/training_samples_v1/item/";

const validateMetaModelPayload = (model: any) => {
  if (!model || typeof model !== "object") return { ok: false, error: "model inválido" } as const;
  if (model.version !== 1) return { ok: false, error: "versão inválida" } as const;
  const approxSize = JSON.stringify(model).length;
  if (approxSize > 300_000) return { ok: false, error: "model muito grande" } as const;
  return { ok: true } as const;
};

const validateTrainingSamplesPayload = (items: any) => {
  if (!Array.isArray(items)) return { ok: false, error: "items deve ser um array" } as const;
  if (items.length === 0) return { ok: false, error: "items vazio" } as const;
  if (items.length > 200) return { ok: false, error: "items grande demais" } as const;
  const approxSize = JSON.stringify(items).length;
  if (approxSize > 900_000) return { ok: false, error: "payload muito grande" } as const;
  for (const s of items) {
    const id = String(s?.id ?? "").trim();
    const utcDate = String(s?.utcDate ?? "").trim();
    const homeTeam = String(s?.homeTeam ?? "").trim();
    const awayTeam = String(s?.awayTeam ?? "").trim();
    if (!id || !utcDate || !homeTeam || !awayTeam) return { ok: false, error: "amostra inválida" } as const;
  }
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

  const authError = requireBearer(req);
  if (authError) return authError;

  if (req.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);

  if (path.endsWith("/training/meta/get") || path === "/training/meta/get") {
    try {
      const model = await kv.get(TRAINING_META_KEY);
      return json({ ok: true, model: model ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao ler meta model" }, 500);
    }
  }

  if (path.endsWith("/training/meta/set") || path === "/training/meta/set") {
    try {
      const body = await readJson(req);
      const model = (body as any)?.model ?? null;
      const validation = validateMetaModelPayload(model);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
      await kv.set(TRAINING_META_KEY, model);
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao salvar meta model" }, 500);
    }
  }

  if (path.endsWith("/training/samples/upsert") || path === "/training/samples/upsert") {
    try {
      const body = await readJson(req);
      const items = (body as any)?.items ?? null;
      const validation = validateTrainingSamplesPayload(items);
      if (!validation.ok) return json({ ok: false, error: validation.error }, 400);
      const keys = (items as any[]).map((s) => `${TRAINING_SAMPLES_PREFIX}${String(s.id)}`);
      const existing = await kv.mget(keys);
      let added = 0;
      for (let i = 0; i < existing.length; i++) if (existing[i] == null) added += 1;
      await kv.mset(keys, items);
      return json({ ok: true, added, upserted: (items as any[]).length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao salvar training samples" }, 500);
    }
  }

  if (path.endsWith("/training/samples/count") || path === "/training/samples/count") {
    try {
      const count = await kv.countByPrefix(TRAINING_SAMPLES_PREFIX);
      return json({ ok: true, count });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao contar training samples" }, 500);
    }
  }

  if (path.endsWith("/training/samples/list") || path === "/training/samples/list") {
    try {
      const body = await readJson(req);
      const limitRaw = Number((body as any)?.limit);
      const offsetRaw = Number((body as any)?.offset);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

      const rows = await kv.listByPrefix(TRAINING_SAMPLES_PREFIX, { offset, limit });
      const items = rows.map((r: any) => r?.value).filter((v: any) => v) as any[];
      const nextOffset = items.length === limit ? offset + limit : null;
      return json({ ok: true, items, nextOffset });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao listar training samples" }, 500);
    }
  }

  return json({ ok: false, error: "Not Found" }, 404);
});
