import * as kv from "../make-server-1119702f/kv_store.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

const BETFAIR_QUEUE_PREFIX = "betfair/automation_queue_v1/item/";
const TIME_ZONE = "America/Sao_Paulo";

const dayKeySp = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const parseUtcDate = (value: unknown): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
};

const parseJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const getSupabaseUrl = () => String(Deno.env.get("SUPABASE_URL") ?? "").trim();

const resolveBetfairMatchOdds = async (params: { homeTeam: string; awayTeam: string; utcDate: string | null }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");

  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-server-1119702f/betfair/match/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      homeTeam: params.homeTeam,
      awayTeam: params.awayTeam,
      utcDate: params.utcDate,
    }),
  });

  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) {
    const msg = String(data?.error ?? `HTTP ${res.status} ${res.statusText}`).trim();
    throw new Error(msg || "Falha ao resolver Betfair (match/resolve)");
  }

  return data?.betfair ?? null;
};

const matchPath = (pathname: string, target: string) => pathname === target || pathname.endsWith(target);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && matchPath(path, "/health")) return json({ status: "ok" });

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/list")) {
    try {
      const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
      const arr = Array.isArray(items) ? items : [];
      const today = dayKeySp(new Date());

      let cleaned = 0;
      const filtered: any[] = [];
      for (const it of arr) {
        const matchId = String((it as any)?.matchId ?? "").trim();
        const utcDate = parseUtcDate((it as any)?.utcDate);
        const key = utcDate ? dayKeySp(utcDate) : null;
        const isStale = Boolean(key && key < today);
        if (isStale && matchId) {
          try {
            await kv.del(`${BETFAIR_QUEUE_PREFIX}${matchId}`);
            cleaned += 1;
          } catch {}
          continue;
        }
        filtered.push(it);
      }

      return json({ ok: true, items: filtered, cleaned });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao listar fila" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/add")) {
    try {
      const body = await parseJson(req);
      const matchId = String((body as any)?.matchId ?? "").trim();
      if (!matchId) return json({ ok: false, error: "matchId obrigatório" }, 400);
      const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
      const existing = (await kv.get(key)) ?? null;
      const now = new Date().toISOString();
      const payload: any = {
        matchId,
        source: String((body as any)?.source ?? "").trim() || existing?.source || null,
        utcDate: String((body as any)?.utcDate ?? "").trim() || existing?.utcDate || null,
        homeTeam: String((body as any)?.homeTeam ?? "").trim() || existing?.homeTeam || null,
        awayTeam: String((body as any)?.awayTeam ?? "").trim() || existing?.awayTeam || null,
        homeCrest: String((body as any)?.homeCrest ?? "").trim() || existing?.homeCrest || null,
        awayCrest: String((body as any)?.awayCrest ?? "").trim() || existing?.awayCrest || null,
        scoreHome: typeof (body as any)?.scoreHome === "number" ? (body as any).scoreHome : existing?.scoreHome ?? null,
        scoreAway: typeof (body as any)?.scoreAway === "number" ? (body as any).scoreAway : existing?.scoreAway ?? null,
        prediction: (body as any)?.prediction ?? existing?.prediction ?? null,
        markets: Array.isArray(existing?.markets) ? existing.markets : [],
        createdAt: String(existing?.createdAt ?? now),
        updatedAt: now,
        status: String(existing?.status ?? "queued"),
        betfair: existing?.betfair ?? null,
        mappingStatus: existing?.mappingStatus ?? "pending",
        mappingError: existing?.mappingError ?? null,
      };

      const hasMarket = Boolean(String(payload?.betfair?.marketId ?? "").trim());
      if (!hasMarket && payload.homeTeam && payload.awayTeam) {
        try {
          const betfair = await resolveBetfairMatchOdds({
            homeTeam: String(payload.homeTeam),
            awayTeam: String(payload.awayTeam),
            utcDate: payload.utcDate ? String(payload.utcDate) : null,
          });
          if (betfair) {
            payload.betfair = betfair;
            payload.utcDate = String(betfair?.marketStartTime ?? "").trim() || payload.utcDate || null;
            payload.mappingStatus = "mapped";
            payload.mappingError = null;
            payload.mappedAt = now;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          payload.mappingStatus = "unmapped";
          payload.mappingError = msg || "Falha ao mapear jogo na Betfair";
        }
      }

      await kv.set(key, payload);
      return json({ ok: true, item: payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao enfileirar jogo" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/remove")) {
    try {
      const body = await parseJson(req);
      const matchId = String((body as any)?.matchId ?? "").trim();
      if (!matchId) return json({ ok: false, error: "matchId obrigatório" }, 400);
      await kv.del(`${BETFAIR_QUEUE_PREFIX}${matchId}`);
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao remover item" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/update")) {
    try {
      const body = await parseJson(req);
      const matchId = String((body as any)?.matchId ?? "").trim();
      if (!matchId) return json({ ok: false, error: "matchId obrigatório" }, 400);
      const patch = (body as any)?.patch && typeof (body as any).patch === "object" ? (body as any).patch : {};
      const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
      const current = (await kv.get(key)) ?? {};
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      await kv.set(key, next);
      return json({ ok: true, item: next });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao atualizar item" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/batchUpdate")) {
    try {
      const body = await parseJson(req);
      const raw = Array.isArray((body as any)?.updates) ? (body as any).updates : [];
      if (raw.length === 0) return json({ ok: true, updated: 0 });
      const limited = raw.slice(0, 50);

      const updates: Array<{ key: string; value: any }> = [];
      for (const u of limited) {
        const matchId = String(u?.matchId ?? "").trim();
        if (!matchId) continue;
        const patch = u?.patch && typeof u.patch === "object" ? u.patch : {};
        const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
        const current = (await kv.get(key)) ?? {};
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        updates.push({ key, value: next });
      }

      if (updates.length === 0) return json({ ok: true, updated: 0 });
      await kv.mset(
        updates.map((u) => u.key),
        updates.map((u) => u.value),
      );
      return json({ ok: true, updated: updates.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao atualizar itens" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/queue/refreshOdds")) {
    try {
      const body = await parseJson(req);
      const maxRaw = Number((body as any)?.max ?? 10);
      const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(30, Math.floor(maxRaw))) : 10;
      const minFreshSecondsRaw = Number((body as any)?.minFreshSeconds ?? 10);
      const minFreshSeconds = Number.isFinite(minFreshSecondsRaw) ? Math.max(1, Math.min(120, Math.floor(minFreshSecondsRaw))) : 10;

      const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return json({ ok: true, updated: 0, skipped: 0, remapped: 0 });

      const nowMs = Date.now();
      const candidates = list
        .filter((x: any) => String(x?.matchId ?? "").trim())
        .filter((x: any) => String(x?.homeTeam ?? "").trim() && String(x?.awayTeam ?? "").trim())
        .filter((x: any) => String(x?.status ?? "queued") !== "stopped")
        .slice(0, max);

      let updated = 0;
      let skipped = 0;
      let remapped = 0;

      for (const x of candidates) {
        const matchId = String((x as any)?.matchId ?? "").trim();
        if (!matchId) {
          skipped += 1;
          continue;
        }

        const fetchedAtRaw = String((x as any)?.betfair?.oddsFetchedAt ?? (x as any)?.betfair?.fetchedAt ?? "").trim();
        const fetchedAtMs = fetchedAtRaw ? new Date(fetchedAtRaw).getTime() : 0;
        const isFresh = fetchedAtMs && Number.isFinite(fetchedAtMs) && nowMs - fetchedAtMs < minFreshSeconds * 1000;
        const hasMarket = Boolean(String((x as any)?.betfair?.marketId ?? "").trim());
        if (hasMarket && isFresh) {
          skipped += 1;
          continue;
        }

        const homeTeam = String((x as any).homeTeam);
        const awayTeam = String((x as any).awayTeam);
        const utcDate = (x as any)?.utcDate == null ? null : String((x as any).utcDate);

        try {
          const betfair = await resolveBetfairMatchOdds({ homeTeam, awayTeam, utcDate });
          const next: any = {
            ...x,
            betfair,
            utcDate: String(betfair?.marketStartTime ?? "").trim() || utcDate || null,
            mappingStatus: "mapped",
            mappingError: null,
            mappedAt: String((x as any)?.mappedAt ?? new Date().toISOString()),
            updatedAt: new Date().toISOString(),
          };
          await kv.set(`${BETFAIR_QUEUE_PREFIX}${matchId}`, next);
          updated += 1;
          if (!hasMarket) remapped += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const next: any = {
            ...x,
            mappingStatus: "unmapped",
            mappingError: msg || "Falha ao atualizar odds/mapeamento",
            updatedAt: new Date().toISOString(),
          };
          await kv.set(`${BETFAIR_QUEUE_PREFIX}${matchId}`, next);
          skipped += 1;
        }
      }

      return json({ ok: true, updated, skipped, remapped });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao atualizar odds" }, 500);
    }
  }

  if (req.method === "POST" && matchPath(path, "/automation/betfair/account/funds")) {
    return json({ ok: true, skipped: true, reason: "maintenance" });
  }

  if (req.method === "POST" && path.includes("/automation/betfair/strategy/")) {
    if (matchPath(path, "/automation/betfair/strategy/correctScore/tradePreview")) {
      return json({
        ok: true,
        skipped: true,
        reason: "maintenance",
        risk: null,
        cashOut: null,
        profit: null,
        fetchedAt: new Date().toISOString(),
      });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/openOrdersSummary")) {
      return json({
        ok: true,
        skipped: true,
        reason: "maintenance",
        openOrdersCount: 0,
        matchedBetsCount: 0,
      });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cancelOpenOrders")) {
      return json({ ok: true, skipped: true, reason: "maintenance" });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cashout")) {
      return json({ ok: true, skipped: true, reason: "maintenance" });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/execute")) {
      return json({ ok: true, skipped: true, reason: "maintenance", adoptedExisting: false });
    }
    return json({ ok: true, skipped: true, reason: "maintenance" });
  }

  return json({ ok: false, error: "Not Found" }, 404);
});
