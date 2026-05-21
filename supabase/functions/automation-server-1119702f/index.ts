import * as kv from "../make-server-1119702f/kv_store.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-token",
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
const getSupabaseAnonKey = () => String(Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();

const resolveBetfairMatchOdds = async (params: { homeTeam: string; awayTeam: string; utcDate: string | null; includeCorrectScore?: boolean }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const anonKey = getSupabaseAnonKey();

  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-server-1119702f/betfair/match/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
    body: JSON.stringify({
      homeTeam: params.homeTeam,
      awayTeam: params.awayTeam,
      utcDate: params.utcDate,
      includeCorrectScore: Boolean(params.includeCorrectScore ?? false),
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

const requireAdminToken = (body: any) => {
  const adminToken = String(body?.adminToken ?? "").trim();
  if (!adminToken) return { ok: false, error: "adminToken obrigatório" };
  return { ok: true, adminToken };
};

const getQueueItem = async (matchId: string) => {
  const id = String(matchId ?? "").trim();
  if (!id) return null;
  return (await kv.get(`${BETFAIR_QUEUE_PREFIX}${id}`)) ?? null;
};

const setQueueItem = async (matchId: string, next: any) => {
  const id = String(matchId ?? "").trim();
  if (!id) return;
  await kv.set(`${BETFAIR_QUEUE_PREFIX}${id}`, next);
};

const parsePredictedScore = (prediction: unknown) => {
  const p = prediction && typeof prediction === "object" ? (prediction as any) : null;
  const raw = String(p?.correctScore?.score ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)\s*[-x×]\s*(\d+)$/i) || raw.match(/^(\d+)\s*-\s*(\d+)$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: Math.max(0, Math.floor(h)), away: Math.max(0, Math.floor(a)) };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const tickStep = (price: number) => {
  const p = Number(price);
  if (!(p > 1)) return 0.01;
  if (p < 2) return 0.01;
  if (p < 3) return 0.02;
  if (p < 4) return 0.05;
  if (p < 6) return 0.1;
  if (p < 10) return 0.2;
  if (p < 20) return 0.5;
  if (p < 30) return 1;
  if (p < 50) return 2;
  if (p < 100) return 5;
  return 10;
};

const movePriceByTicks = (startPrice: number, ticks: number) => {
  let p = Number(startPrice);
  if (!Number.isFinite(p) || p <= 1) return startPrice;
  const dir = ticks >= 0 ? 1 : -1;
  const total = Math.abs(Math.floor(ticks));
  for (let i = 0; i < total; i++) {
    const step = tickStep(p);
    p = round2(p + dir * step);
    if (p < 1.01) p = 1.01;
    if (p > 1000) p = 1000;
  }
  return p;
};

const placeOrders = async (params: { adminToken: string; marketId: string; instructions: any[]; customerRef?: string }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const anonKey = getSupabaseAnonKey();
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/placeOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
    body: JSON.stringify({
      adminToken: params.adminToken,
      marketId: params.marketId,
      instructions: params.instructions,
      ...(params.customerRef ? { customerRef: params.customerRef } : {}),
    }),
  });
  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
  return data?.result ?? null;
};

Deno.serve(async (req) => {
  try {
    const method = String((req as any)?.method ?? "").toUpperCase();
    const isPreflight =
      method === "OPTIONS" || (req.headers.has("origin") && req.headers.has("access-control-request-method"));
    if (isPreflight) return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = (() => {
      try {
        return new URL(String((req as any)?.url ?? ""), "http://localhost");
      } catch {
        return new URL("http://localhost/");
      }
    })();
    const path = url.pathname;

    if (method === "GET" && matchPath(path, "/health")) return json({ status: "ok" });

    if (method === "POST" && matchPath(path, "/automation/betfair/queue/list")) {
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
    }
    if (method === "POST" && matchPath(path, "/automation/betfair/queue/add")) {
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
            const includeCorrectScore = Boolean((body as any)?.includeCorrectScore ?? false);
            const betfair = await resolveBetfairMatchOdds({
              homeTeam: String(payload.homeTeam),
              awayTeam: String(payload.awayTeam),
              utcDate: payload.utcDate ? String(payload.utcDate) : null,
              includeCorrectScore,
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

    if (method === "POST" && matchPath(path, "/automation/betfair/queue/remove")) {
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

    if (method === "POST" && matchPath(path, "/automation/betfair/queue/update")) {
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

    if (method === "POST" && matchPath(path, "/automation/betfair/queue/batchUpdate")) {
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

    if (method === "POST" && matchPath(path, "/automation/betfair/queue/refreshOdds")) {
      try {
        const body = await parseJson(req);
        const maxRaw = Number((body as any)?.max ?? 10);
        const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(30, Math.floor(maxRaw))) : 10;
        const minFreshSecondsRaw = Number((body as any)?.minFreshSeconds ?? 10);
        const minFreshSeconds = Number.isFinite(minFreshSecondsRaw) ? Math.max(1, Math.min(120, Math.floor(minFreshSecondsRaw))) : 10;
        const includeCorrectScore = Boolean((body as any)?.includeCorrectScore ?? false);

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
            const betfair = await resolveBetfairMatchOdds({ homeTeam, awayTeam, utcDate, includeCorrectScore });
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
    if (method === "POST" && path.includes("/automation/betfair/strategy/")) {
    const body = await parseJson(req);
    const matchId = String((body as any)?.matchId ?? "").trim();
    if (!matchId) return json({ ok: false, error: "matchId obrigatório" }, 400);

    if (matchPath(path, "/automation/betfair/strategy/scalpingTicks/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: false,
      });

      const marketId = String(betfair?.marketId ?? "").trim();
      const homeSel = Number(betfair?.runners?.homeSelectionId);
      const awaySel = Number(betfair?.runners?.awaySelectionId);
      const homeBack = Number(betfair?.odds?.home?.back);
      const awayBack = Number(betfair?.odds?.away?.back);
      const homeLay = Number(betfair?.odds?.home?.lay);
      const awayLay = Number(betfair?.odds?.away?.lay);

      if (!marketId || !Number.isFinite(homeSel) || !Number.isFinite(awaySel)) {
        const next = { ...current, betfair, updatedAt: new Date().toISOString() };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "market_not_ready", item: next });
      }

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const stakePct = Number(cfg?.stakePct ?? 5);
      const targetTicks = Number(cfg?.targetTicks ?? 6);
      const entryOffsetTicks = Number(cfg?.entryOffsetTicks ?? 0);

      const stakeAbs =
        Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
          ? Math.max(2, round2((bankroll * stakePct) / 100))
          : 2;

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};

      const existing = (strategy as any)?.scalpingTicks && typeof (strategy as any).scalpingTicks === "object" ? (strategy as any).scalpingTicks : {};
      const phase = String(existing?.phase ?? "").trim();

      const nowIso = new Date().toISOString();
      const favoriteIsHome = Number.isFinite(homeBack) && Number.isFinite(awayBack) ? homeBack <= awayBack : Number.isFinite(homeBack);
      const selectionId = favoriteIsHome ? homeSel : awaySel;
      const bestBack = favoriteIsHome ? homeBack : awayBack;
      const bestLay = favoriteIsHome ? homeLay : awayLay;

      if (!(Number.isFinite(bestBack) && bestBack > 1)) {
        const next = {
          ...current,
          betfair,
          strategy: { ...strategy, scalpingTicks: { ...existing, phase: phase || "monitoring", lastTickAt: nowIso } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_price", item: next });
      }

      if (!phase || phase === "monitoring") {
        const entryPrice = movePriceByTicks(bestBack, Number.isFinite(entryOffsetTicks) ? Math.floor(entryOffsetTicks) : 0);
        const targetPrice = movePriceByTicks(entryPrice, -(Number.isFinite(targetTicks) ? Math.floor(targetTicks) : 6));
        const result = await placeOrders({
          adminToken: admin.adminToken,
          marketId,
          customerRef: `scalpticks-${matchId}-${Date.now()}`,
          instructions: [
            {
              selectionId,
              side: "BACK",
              orderType: "LIMIT",
              limitOrder: { size: stakeAbs, price: entryPrice, persistenceType: "PERSIST" },
            },
          ],
        });

        const next = {
          ...current,
          betfair,
          strategy: {
            ...strategy,
            agent: "scalpingTicks",
            scalpingTicks: {
              phase: "entered",
              selectionId,
              entryPrice,
              targetPrice,
              stakeAbs,
              enteredAt: nowIso,
              lastTickAt: nowIso,
              lastResult: result ?? null,
            },
          },
          status: String((current as any)?.status ?? "running"),
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, item: next, entered: true });
      }

      if (phase === "entered") {
        const targetPrice = Number(existing?.targetPrice);
        if (Number.isFinite(targetPrice) && Number.isFinite(bestLay) && bestLay > 1 && bestLay <= targetPrice) {
          const result = await placeOrders({
            adminToken: admin.adminToken,
            marketId,
            customerRef: `scalpticks-exit-${matchId}-${Date.now()}`,
            instructions: [
              {
                selectionId,
                side: "LAY",
                orderType: "LIMIT",
                limitOrder: { size: Number(existing?.stakeAbs ?? stakeAbs), price: bestLay, persistenceType: "LAPSE" },
              },
            ],
          });
          const next = {
            ...current,
            betfair,
            strategy: {
              ...strategy,
              scalpingTicks: { ...existing, phase: "closed", closedAt: nowIso, lastTickAt: nowIso, lastResult: result ?? null },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true });
        }

        const next = {
          ...current,
          betfair,
          strategy: { ...strategy, scalpingTicks: { ...existing, lastTickAt: nowIso } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_target", item: next });
      }

      const next = {
        ...current,
        betfair,
        strategy: { ...strategy, scalpingTicks: { ...existing, lastTickAt: nowIso } },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, skipped: true, reason: "noop", item: next });
    }

    if (matchPath(path, "/automation/betfair/strategy/scalpingGoals/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: false,
      });
      const inPlay = Boolean(betfair?.inPlay ?? false);
      const nowIso = new Date().toISOString();

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const existing = (strategy as any)?.scalpingGoals && typeof (strategy as any).scalpingGoals === "object" ? (strategy as any).scalpingGoals : {};
      const phase = String(existing?.phase ?? "").trim();

      if (!inPlay) {
        const next = {
          ...current,
          betfair,
          strategy: { ...strategy, agent: "scalpingGoals", scalpingGoals: { ...existing, phase: phase || "monitoring", lastTickAt: nowIso } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_inplay", item: next });
      }

      const proxyBody: any = { ...body, config: { ...(body as any)?.config, entryOffsetTicks: 0 } };
      return await (async () => {
        const anonKey = getSupabaseAnonKey();
        const res = await fetch(new URL("/automation/betfair/strategy/scalpingTicks/tick", req.url), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
          },
          body: JSON.stringify(proxyBody),
        });
        const raw = await res.text().catch(() => "");
        const data = raw ? JSON.parse(raw) : null;
        return json(data ?? { ok: false, error: "Falha ao executar" }, res.status);
      })();
    }

    if (matchPath(path, "/automation/betfair/strategy/correctScore/execute")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const bankrollAbs = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 50;

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });

      const marketId = String(betfair?.correctScore?.marketId ?? "").trim();
      if (!marketId) {
        const next = { ...current, betfair, updatedAt: new Date().toISOString() };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "correct_score_not_ready", adoptedExisting: false, item: next });
      }

      const predicted = parsePredictedScore((current as any)?.prediction) ?? { home: 0, away: 0 };
      const maxGoalsRaw = Number((body as any)?.planConfig?.maxGoals ?? 3);
      const maxGoals = Number.isFinite(maxGoalsRaw) ? Math.max(1, Math.min(8, Math.floor(maxGoalsRaw))) : 3;
      const maxSelRaw = Number((body as any)?.planConfig?.maxSelections ?? 10);
      const maxSelections = Number.isFinite(maxSelRaw) ? Math.max(1, Math.min(20, Math.floor(maxSelRaw))) : 10;

      const candidates: Array<{ key: string; dist: number }> = [];
      for (let h = 0; h <= maxGoals; h++) {
        for (let a = 0; a <= maxGoals; a++) {
          const key = `${h}-${a}`;
          const dist = Math.abs(h - predicted.home) + Math.abs(a - predicted.away);
          candidates.push({ key, dist });
        }
      }
      candidates.sort((x, y) => x.dist - y.dist);
      const picked = candidates.slice(0, maxSelections);

      const runners = betfair?.correctScore?.runners && typeof betfair.correctScore.runners === "object" ? betfair.correctScore.runners : {};
      const picksWithPrice = picked
        .map((p) => {
          const r = (runners as any)[p.key] ?? null;
          const back = Number(r?.back);
          const selectionId = Number(r?.selectionId);
          if (!Number.isFinite(back) || back <= 1) return null;
          if (!Number.isFinite(selectionId)) return null;
          return { key: p.key, selectionId, back };
        })
        .filter(Boolean) as Array<{ key: string; selectionId: number; back: number }>;

      if (picksWithPrice.length === 0) {
        const next = { ...current, betfair, updatedAt: new Date().toISOString() };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_runners_price", adoptedExisting: false, item: next });
      }

      const invSum = picksWithPrice.reduce((acc, p) => acc + 1 / p.back, 0);
      const stakes = picksWithPrice.map((p) => {
        const frac = invSum > 0 ? (1 / p.back) / invSum : 1 / picksWithPrice.length;
        return { ...p, stake: Math.max(2, round2(bankrollAbs * frac)) };
      });

      const instructions = stakes.map((s) => ({
        selectionId: s.selectionId,
        side: "BACK",
        orderType: "LIMIT",
        limitOrder: { size: s.stake, price: s.back, persistenceType: "LAPSE" },
      }));

      const result = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: `cs-${matchId}-${Date.now()}`,
        instructions,
      });

      const nowIso = new Date().toISOString();
      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const next = {
        ...current,
        betfair,
        strategy: {
          ...strategy,
          agent: "correctScore",
          correctScore: {
            ...(strategy as any)?.correctScore,
            lastExecutionAt: nowIso,
            lastExecution: { selections: stakes, bankroll: bankrollAbs, predicted },
          },
        },
        updatedAt: nowIso,
      };

      await setQueueItem(matchId, next);
      return json({ ok: true, adoptedExisting: false, item: next, result });
    }

    if (matchPath(path, "/automation/betfair/strategy/correctScore/rebalance")) {
      return json({ ok: true, skipped: true, reason: "not_implemented" });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/tradePreview")) {
      return json({ ok: true, skipped: true, reason: "not_implemented", risk: null, cashOut: null, profit: null, fetchedAt: new Date().toISOString() });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/openOrdersSummary")) {
      return json({ ok: true, skipped: true, reason: "not_implemented", openOrdersCount: 0, matchedBetsCount: 0 });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cancelOpenOrders")) {
      return json({ ok: true, skipped: true, reason: "not_implemented" });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cashout")) {
      return json({ ok: true, skipped: true, reason: "not_implemented" });
    }

    return json({ ok: true, skipped: true, reason: "not_implemented" });
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
