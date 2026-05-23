import * as kv from "../make-server-1119702f/kv_store.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-automation-token, prefer",
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

const parseScorePair = (value: unknown) => {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[-x×]\s*(\d+)$/i) || s.match(/^(\d+)\s*-\s*(\d+)$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const a = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  return { home: Math.max(0, Math.floor(h)), away: Math.max(0, Math.floor(a)) };
};

const parseScoresCsv = (csv: unknown) => {
  const raw = String(csv ?? "").trim();
  if (!raw) return [];
  const tokens = raw.split(/[,;\n\r]+/g).map((t) => t.trim()).filter(Boolean);
  const out: Array<{ key: string; home: number; away: number }> = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const pair = parseScorePair(t);
    if (!pair) continue;
    const key = `${pair.home}-${pair.away}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, home: pair.home, away: pair.away });
  }
  return out;
};

const slimOuMarket = (m: any) => {
  if (!m || typeof m !== "object") return null;
  const marketId = String(m?.marketId ?? "").trim() || null;
  const marketStatus = String(m?.marketStatus ?? "").trim() || null;
  const matchedVolume = typeof m?.matchedVolume === "number" ? m.matchedVolume : null;
  const runners = {
    overSelectionId: Number.isFinite(Number(m?.runners?.overSelectionId)) ? Number(m.runners.overSelectionId) : null,
    underSelectionId: Number.isFinite(Number(m?.runners?.underSelectionId)) ? Number(m.runners.underSelectionId) : null,
  };
  const odds = {
    over: {
      back: typeof m?.odds?.over?.back === "number" ? m.odds.over.back : null,
      lay: typeof m?.odds?.over?.lay === "number" ? m.odds.over.lay : null,
      runnerMatched: typeof m?.odds?.over?.runnerMatched === "number" ? m.odds.over.runnerMatched : null,
    },
    under: {
      back: typeof m?.odds?.under?.back === "number" ? m.odds.under.back : null,
      lay: typeof m?.odds?.under?.lay === "number" ? m.odds.under.lay : null,
      runnerMatched: typeof m?.odds?.under?.runnerMatched === "number" ? m.odds.under.runnerMatched : null,
    },
  };
  return { marketId, marketStatus, matchedVolume, runners, odds };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const mkCustomerRef = (action: string, matchId: string) => {
  const a = String(action ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "x";
  const id = String(matchId ?? "").replace(/[^a-zA-Z0-9]/g, "");
  const tail = id.slice(-8) || "0";
  const ts = (Date.now() % 2147483647).toString(36);
  let ref = `st-${a}-${tail}-${ts}`;
  if (ref.length > 32) ref = ref.slice(0, 32);
  return ref;
};

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

const ticksBetweenPrices = (a: number, b: number) => {
  const x = Number(a);
  const y = Number(b);
  if (!(Number.isFinite(x) && Number.isFinite(y))) return null;
  if (x === y) return 0;
  const from = Math.min(x, y);
  const to = Math.max(x, y);
  if (!(from > 1 && to > 1)) return null;
  let cur = from;
  let ticks = 0;
  const cap = 250;
  while (cur < to && ticks < cap) {
    const step = tickStep(cur);
    cur = round2(cur + step);
    ticks += 1;
  }
  if (ticks >= cap) return cap;
  return ticks;
};

const normalizeText = (input: unknown) =>
  String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const ouLineCodeFromGoals = (goals: number) => {
  const g = Math.max(0, Math.floor(Number(goals) || 0));
  return g * 10 + 15;
};

const ouMarketTypeCode = (lineCode: number) => {
  const n = Math.floor(Number(lineCode));
  if (!Number.isFinite(n) || n <= 0) return null;
  const key = n < 10 ? `0${n}` : String(n);
  return `OVER_UNDER_${key}`;
};

const guessOuRunnerRole = (runnerName: string) => {
  const s = normalizeText(runnerName);
  if (!s) return null;
  if (s.includes("over") || s.includes("mais de") || s.includes("acima de")) return "over";
  if (s.includes("under") || s.includes("menos de") || s.includes("abaixo de")) return "under";
  return null;
};

const betfairRpc = async (params: { method: string; params: any }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const anonKey = getSupabaseAnonKey();
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
    body: JSON.stringify({
      method: params.method,
      params: params.params ?? {},
    }),
  });
  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
  return data?.result ?? null;
};

const resolveBetfairOverUnderMarket = async (params: { eventId: string; lineCode: number }) => {
  const eventId = String(params.eventId ?? "").trim();
  const marketType = ouMarketTypeCode(params.lineCode);
  if (!eventId) throw new Error("Betfair: eventId ausente (Over/Under)");
  if (!marketType) throw new Error("Betfair: linha inválida (Over/Under)");

  const cats = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketCatalogue",
    params: {
      filter: { eventIds: [eventId], marketTypeCodes: [marketType] },
      maxResults: 10,
      sort: "MAXIMUM_TRADED",
      marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
    },
  });
  const mk = Array.isArray(cats) ? cats[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (Over/Under) não encontrado");

  const runners = Array.isArray(mk?.runners) ? mk.runners : [];
  const selectionByRole: Record<string, number> = {};
  for (const r of runners) {
    const selectionId = Number(r?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const role = guessOuRunnerRole(String(r?.runnerName ?? ""));
    if (!role) continue;
    if (selectionByRole[role] != null) continue;
    selectionByRole[role] = selectionId;
  }

  const books = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketBook",
    params: {
      marketIds: [marketId],
      priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
    },
  });
  const book = Array.isArray(books) ? books[0] : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];

  const pull = (selectionId: number) => {
    const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const ltp = Number(rb?.lastPriceTraded);
    const runnerMatched = Number(rb?.totalMatched);
    return {
      back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
      laySize: lay0 ? Number(lay0.size) : null,
      runnerMatched: Number.isFinite(runnerMatched) ? runnerMatched : null,
    };
  };

  const odds: any = {};
  if (Number.isFinite(selectionByRole.over)) odds.over = pull(selectionByRole.over);
  if (Number.isFinite(selectionByRole.under)) odds.under = pull(selectionByRole.under);

  return {
    eventId,
    marketId,
    marketType,
    lineCode: Math.floor(Number(params.lineCode)),
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    runners: {
      overSelectionId: Number.isFinite(selectionByRole.over) ? selectionByRole.over : null,
      underSelectionId: Number.isFinite(selectionByRole.under) ? selectionByRole.under : null,
    },
    odds,
    oddsFetchedAt: new Date().toISOString(),
  };
};

const normalizeAhLine = (value: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 4) / 4;
};

const guessAhRunnerTeam = (runnerName: string, homeTeam: string, awayTeam: string) => {
  const s = normalizeText(runnerName);
  const h = normalizeText(homeTeam);
  const a = normalizeText(awayTeam);
  const hitHome = h && s.includes(h);
  const hitAway = a && s.includes(a);
  if (hitHome && !hitAway) return "home";
  if (hitAway && !hitHome) return "away";
  if (hitHome && hitAway) return h.length >= a.length ? "home" : "away";
  return null;
};

const resolveBetfairAsianHandicapMarket = async (params: { eventId: string; homeTeam: string; awayTeam: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  const homeTeam = String(params.homeTeam ?? "").trim();
  const awayTeam = String(params.awayTeam ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId ausente (Asian Handicap)");
  if (!homeTeam || !awayTeam) throw new Error("Betfair: times ausentes (Asian Handicap)");

  const cats = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketCatalogue",
    params: {
      filter: { eventIds: [eventId], marketTypeCodes: ["ASIAN_HANDICAP"] },
      maxResults: 10,
      sort: "MAXIMUM_TRADED",
      marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
    },
  });

  const mk = Array.isArray(cats) ? cats[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (ASIAN_HANDICAP) não encontrado");

  const runnersCat = Array.isArray(mk?.runners) ? mk.runners : [];
  const runnerMetaBySelectionId = new Map<number, { runnerName: string; team: "home" | "away"; handicap: number | null }>();
  for (const r of runnersCat) {
    const selectionId = Number(r?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const runnerName = String(r?.runnerName ?? "").trim();
    const team = guessAhRunnerTeam(runnerName, homeTeam, awayTeam);
    if (!team) continue;
    const handicapRaw = Number((r as any)?.handicap);
    const handicap = Number.isFinite(handicapRaw) ? normalizeAhLine(handicapRaw) : null;
    runnerMetaBySelectionId.set(selectionId, { runnerName, team, handicap });
  }

  const books = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketBook",
    params: {
      marketIds: [marketId],
      priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
    },
  });
  const book = Array.isArray(books) ? books[0] : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];

  const runners = runnersBook
    .map((rb: any) => {
      const selectionId = Number(rb?.selectionId);
      if (!Number.isFinite(selectionId)) return null;
      const meta = runnerMetaBySelectionId.get(selectionId) ?? null;
      if (!meta) return null;
      const ex = rb?.ex ?? {};
      const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
      const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
      const ltp = Number(rb?.lastPriceTraded);
      const runnerMatched = Number(rb?.totalMatched);
      const handicapBookRaw = Number(rb?.handicap);
      const handicapBook = Number.isFinite(handicapBookRaw) ? normalizeAhLine(handicapBookRaw) : null;
      const handicap = handicapBook ?? meta.handicap;
      return {
        selectionId,
        runnerName: meta.runnerName,
        team: meta.team,
        handicap,
        back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
        backSize: back0 ? Number(back0.size) : null,
        lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
        laySize: lay0 ? Number(lay0.size) : null,
        runnerMatched: Number.isFinite(runnerMatched) ? runnerMatched : null,
      };
    })
    .filter(Boolean) as Array<{
    selectionId: number;
    runnerName: string;
    team: "home" | "away";
    handicap: number | null;
    back: number | null;
    backSize: number | null;
    lay: number | null;
    laySize: number | null;
    runnerMatched: number | null;
  }>;

  return {
    eventId,
    marketId,
    marketType: "ASIAN_HANDICAP",
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    runners,
    oddsFetchedAt: new Date().toISOString(),
  };
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

const listCurrentOrders = async (params: { adminToken: string; betIds?: string[]; marketIds?: string[] }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const anonKey = getSupabaseAnonKey();
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/listCurrentOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
    body: JSON.stringify({
      adminToken: params.adminToken,
      ...(Array.isArray(params.betIds) ? { betIds: params.betIds } : {}),
      ...(Array.isArray(params.marketIds) ? { marketIds: params.marketIds } : {}),
    }),
  });
  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
  return data?.result ?? null;
};

const cancelOrders = async (params: { adminToken: string; marketId?: string; betIds: string[] }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const anonKey = getSupabaseAnonKey();
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/cancelOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(anonKey ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` } : {}),
    },
    body: JSON.stringify({
      adminToken: params.adminToken,
      ...(params.marketId ? { marketId: params.marketId } : {}),
      instructions: (params.betIds ?? []).map((betId) => ({ betId })),
    }),
  });
  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
  return data?.result ?? null;
};

const uniqStrings = (items: Array<unknown>) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    const s = String(x ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const getLayPriceForSelectionFromOuMarket = (ou: any, selectionId: number) => {
  if (!ou || typeof ou !== "object") return null;
  const overSel = Number(ou?.runners?.overSelectionId);
  const underSel = Number(ou?.runners?.underSelectionId);
  if (!Number.isFinite(selectionId)) return null;
  if (Number.isFinite(overSel) && selectionId === overSel) {
    const p = Number(ou?.odds?.over?.lay);
    return Number.isFinite(p) && p > 1 ? p : null;
  }
  if (Number.isFinite(underSel) && selectionId === underSel) {
    const p = Number(ou?.odds?.under?.lay);
    return Number.isFinite(p) && p > 1 ? p : null;
  }
  return null;
};

const getLayPriceForSelectionFromCorrectScore = (betfair: any, selectionId: number) => {
  if (!betfair || typeof betfair !== "object") return null;
  const runners = betfair?.correctScore?.runners && typeof betfair.correctScore.runners === "object" ? betfair.correctScore.runners : null;
  if (!runners) return null;
  for (const k of Object.keys(runners)) {
    const r = (runners as any)[k];
    if (!r || typeof r !== "object") continue;
    const sid = Number(r?.selectionId);
    if (Number.isFinite(sid) && sid === selectionId) {
      const lay = Number(r?.lay);
      return Number.isFinite(lay) && lay > 1 ? lay : null;
    }
  }
  return null;
};

const firstInstructionReport = (result: any) => {
  const reports = Array.isArray(result?.instructionReports) ? result.instructionReports : [];
  return reports.length > 0 ? reports[0] : null;
};

const extractBetId = (result: any) => {
  const r = firstInstructionReport(result);
  const betId = String(r?.betId ?? "").trim();
  return betId || null;
};

const extractReportStatus = (result: any) => {
  const r = firstInstructionReport(result);
  const status = String(r?.status ?? "").trim().toUpperCase();
  return status || null;
};

const extractReportErrorCode = (result: any) => {
  const r = firstInstructionReport(result);
  const errorCode = String(r?.errorCode ?? "").trim().toUpperCase();
  return errorCode || null;
};

Deno.serve(async (req) => {
  try {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
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

    if (matchPath(path, "/automation/betfair/strategy/openOrdersSummary")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const agent = String((strategy as any)?.agent ?? "").trim() || null;
      const st = (strategy as any)?.scalpingTicks && typeof (strategy as any).scalpingTicks === "object" ? (strategy as any).scalpingTicks : {};
      const csMarketId = String((current as any)?.betfair?.correctScore?.marketId ?? "").trim() || null;
      const stEntryMarketId = String(st?.entryMarketId ?? "").trim() || null;
      const stOverMarketId = String(st?.marketOver?.marketId ?? "").trim() || null;
      const stUnderMarketId = String(st?.marketUnder?.marketId ?? "").trim() || null;

      const marketIds = uniqStrings([csMarketId, stEntryMarketId, stOverMarketId, stUnderMarketId]);
      if (marketIds.length === 0) return json({ ok: true, openOrdersCount: 0, matchedBetsCount: 0, agent, marketIds });

      const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds });
      const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
      const openOrdersCount = currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).length;
      const matchedBetsCount = currentOrders.filter((o: any) => Number(o?.sizeMatched) > 0).length;
      return json({ ok: true, openOrdersCount, matchedBetsCount, agent, marketIds });
    }

    if (matchPath(path, "/automation/betfair/strategy/cashoutHedge")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const agent = String((strategy as any)?.agent ?? "").trim().toLowerCase();
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      if (agent === "scalpingticks") {
        const baseBetfair = await resolveBetfairMatchOdds({
          homeTeam: String(current?.homeTeam ?? ""),
          awayTeam: String(current?.awayTeam ?? ""),
          utcDate: current?.utcDate == null ? null : String(current.utcDate),
          includeCorrectScore: false,
        });
        const eventId = String((current as any)?.betfair?.eventId ?? baseBetfair?.eventId ?? "").trim();

        const existing = (strategy as any)?.scalpingTicks && typeof (strategy as any).scalpingTicks === "object" ? (strategy as any).scalpingTicks : {};
        const phase = String(existing?.phase ?? "").trim();
        if (phase !== "entered") {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...existing, lastCashoutAt: nowIso } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "not_entered", agent, item: next });
        }

        const entryMarketId = String(existing?.entryMarketId ?? "").trim();
        const selectionId = Number(existing?.selectionId);
        const entryLineCode = Number(existing?.entryLineCode);
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const entryPrice = Number(existing?.entryPrice);
        const fallbackLay = Number(existing?.lastBestLay);

        let layPrice: number | null = null;
        if (eventId && Number.isFinite(entryLineCode) && entryLineCode > 0) {
          try {
            const ou = await resolveBetfairOverUnderMarket({ eventId, lineCode: entryLineCode });
            layPrice = getLayPriceForSelectionFromOuMarket(ou, selectionId);
          } catch {}
        }
        if (layPrice == null && Number.isFinite(fallbackLay) && fallbackLay > 1) layPrice = fallbackLay;

        let entrySizeMatched = Number(existing?.stakeAbs);
        let entrySizeRemaining = 0;
        if (entryBetId) {
          try {
            const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
            const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
            const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
            const sizeMatched = Number(row?.sizeMatched);
            const sizeRemaining = Number(row?.sizeRemaining);
            const avgPriceMatched = Number(row?.averagePriceMatched);
            if (Number.isFinite(sizeMatched) && sizeMatched > 0) entrySizeMatched = sizeMatched;
            if (Number.isFinite(sizeRemaining) && sizeRemaining > 0) entrySizeRemaining = sizeRemaining;
            if (Number.isFinite(avgPriceMatched) && avgPriceMatched > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0 && !(Number.isFinite(entryPrice) && entryPrice > 1)) {
              (existing as any).entryPrice = avgPriceMatched;
            }
          } catch {}
        }
        const entrySizeMatchedSafe = Number.isFinite(entrySizeMatched) && entrySizeMatched > 0 ? entrySizeMatched : 0;
        const entryPriceSafe = Number.isFinite(Number(existing?.entryPrice)) ? Number(existing?.entryPrice) : entryPrice;

        if (tpBetId) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [tpBetId] });
          } catch {}
        }
        if (entryBetId && entrySizeRemaining > 0 && entrySizeMatchedSafe <= 0) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [entryBetId] });
          } catch {}
        }

        let didHedge = false;
        if (entrySizeMatchedSafe > 0 && Number.isFinite(entryPriceSafe) && entryPriceSafe > 1 && layPrice != null && layPrice > 1) {
          const hedgeSize = Math.max(2, round2((entryPriceSafe * entrySizeMatchedSafe) / layPrice));
          try {
            await placeOrders({
              adminToken: admin.adminToken,
              marketId: entryMarketId,
              customerRef: mkCustomerRef("mc", matchId),
              instructions: [
                {
                  selectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSize, price: layPrice, persistenceType: "LAPSE" },
                },
              ],
            });
            didHedge = true;
          } catch {}
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "scalpingTicks",
            scalpingTicks: {
              ...existing,
              phase: "cooldown",
              closedAt: nowIso,
              lastClosedAt: nowIso,
              cooldownUntilMs: nowMs + 5_000,
              lastExitReason: "manual_cashout",
              lastCashoutAt: nowIso,
              recoveryStakeAbs: null,
              recoveryLevel: 0,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, agent: "scalpingTicks", hedged: didHedge, item: next });
      }

      if (agent === "correctscore") {
        const betfair = await resolveBetfairMatchOdds({
          homeTeam: String(current?.homeTeam ?? ""),
          awayTeam: String(current?.awayTeam ?? ""),
          utcDate: current?.utcDate == null ? null : String(current.utcDate),
          includeCorrectScore: true,
        });
        const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
        if (!marketId) return json({ ok: true, skipped: true, reason: "correct_score_not_ready", agent: "correctScore" });

        const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
        const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
        const openBetIds = uniqStrings(currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).map((o: any) => o?.betId));
        if (openBetIds.length > 0) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: openBetIds });
          } catch {}
        }

        let hedgedCount = 0;
        for (const o of currentOrders) {
          const sizeMatched = Number((o as any)?.sizeMatched);
          if (!(Number.isFinite(sizeMatched) && sizeMatched > 0)) continue;
          const selectionId = Number((o as any)?.selectionId);
          const avgPriceMatched = Number((o as any)?.averagePriceMatched);
          const layPrice = getLayPriceForSelectionFromCorrectScore(betfair, selectionId);
          if (!(Number.isFinite(selectionId) && selectionId > 0)) continue;
          if (!(Number.isFinite(avgPriceMatched) && avgPriceMatched > 1)) continue;
          if (!(layPrice != null && layPrice > 1)) continue;
          const hedgeSize = Math.max(2, round2((avgPriceMatched * sizeMatched) / layPrice));
          try {
            await placeOrders({
              adminToken: admin.adminToken,
              marketId,
              customerRef: `cs-manual-cashout-${matchId}-${Date.now()}`,
              instructions: [
                {
                  selectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSize, price: layPrice, persistenceType: "LAPSE" },
                },
              ],
            });
            hedgedCount += 1;
          } catch {}
        }

        const next = {
          ...current,
          betfair,
          strategy: { ...strategy, agent: "correctScore", correctScore: { ...((strategy as any)?.correctScore ?? {}), lastCashoutAt: nowIso } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, agent: "correctScore", hedgedCount, item: next });
      }

      return json({ ok: true, skipped: true, reason: "unsupported_agent", agent: agent || null });
    }

    if (matchPath(path, "/automation/betfair/strategy/scalpingTicks/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const baseBetfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: false,
      });

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const existing = (strategy as any)?.scalpingTicks && typeof (strategy as any).scalpingTicks === "object" ? (strategy as any).scalpingTicks : {};

      const eventId = String((current as any)?.betfair?.eventId ?? baseBetfair?.eventId ?? "").trim();
      const bodyLive = (body as any)?.live && typeof (body as any).live === "object" ? (body as any).live : null;
      const liveScoreHomeRaw =
        typeof (bodyLive as any)?.scoreHome === "number" ? (bodyLive as any).scoreHome
          : Number.isFinite(Number((bodyLive as any)?.scoreHome)) ? Number((bodyLive as any)?.scoreHome)
          : NaN;
      const liveScoreAwayRaw =
        typeof (bodyLive as any)?.scoreAway === "number" ? (bodyLive as any).scoreAway
          : Number.isFinite(Number((bodyLive as any)?.scoreAway)) ? Number((bodyLive as any)?.scoreAway)
          : NaN;
      const liveScoreHome = Number.isFinite(liveScoreHomeRaw) ? Math.max(0, Math.floor(liveScoreHomeRaw)) : null;
      const liveScoreAway = Number.isFinite(liveScoreAwayRaw) ? Math.max(0, Math.floor(liveScoreAwayRaw)) : null;

      const baseTimeline = (baseBetfair as any)?.timeline ?? null;
      const baseTimelineScoreHome = Number(baseTimeline?.scoreHome);
      const baseTimelineScoreAway = Number(baseTimeline?.scoreAway);
      const queueScoreHome = typeof (current as any)?.scoreHome === "number" ? (current as any).scoreHome : Number((current as any)?.scoreHome);
      const queueScoreAway = typeof (current as any)?.scoreAway === "number" ? (current as any).scoreAway : Number((current as any)?.scoreAway);
      const prevHomeRaw = Number(existing?.lastScoreHome);
      const prevAwayRaw = Number(existing?.lastScoreAway);
      const prevHome = Number.isFinite(prevHomeRaw) ? Math.max(0, Math.floor(prevHomeRaw)) : null;
      const prevAway = Number.isFinite(prevAwayRaw) ? Math.max(0, Math.floor(prevAwayRaw)) : null;
      const scoreHomeBase =
        typeof liveScoreHome === "number"
          ? liveScoreHome
          : Number.isFinite(queueScoreHome) ? Math.max(0, Math.floor(queueScoreHome))
          : Number.isFinite(baseTimelineScoreHome) ? Math.max(0, Math.floor(baseTimelineScoreHome))
          : null;
      const scoreAwayBase =
        typeof liveScoreAway === "number"
          ? liveScoreAway
          : Number.isFinite(queueScoreAway) ? Math.max(0, Math.floor(queueScoreAway))
          : Number.isFinite(baseTimelineScoreAway) ? Math.max(0, Math.floor(baseTimelineScoreAway))
          : null;
      const scoreHome = typeof scoreHomeBase === "number" && typeof prevHome === "number" ? Math.max(scoreHomeBase, prevHome) : scoreHomeBase;
      const scoreAway = typeof scoreAwayBase === "number" && typeof prevAway === "number" ? Math.max(scoreAwayBase, prevAway) : scoreAwayBase;
      const goals = typeof scoreHome === "number" && typeof scoreAway === "number" ? scoreHome + scoreAway : null;

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const lineCodeRaw = Number(cfg?.ouLineCode);
      const underLineCode =
        Number.isFinite(lineCodeRaw) && lineCodeRaw > 0
          ? Math.floor(lineCodeRaw)
          : typeof goals === "number" && Number.isFinite(goals)
            ? Math.floor((goals * 10) + 15)
            : 15;
      const overLineCodeFromUnder = underLineCode - 10;
      const overLineCode =
        Number.isFinite(overLineCodeFromUnder) && overLineCodeFromUnder > 0
          ? Math.max(5, Math.floor(overLineCodeFromUnder))
          : typeof goals === "number" && Number.isFinite(goals)
            ? Math.floor((goals * 10) + 5)
            : 5;

      let ouOverErr: string | null = null;
      let ouUnderErr: string | null = null;
      const ouOverBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: overLineCode });
          return slimOuMarket(raw);
        } catch (e) {
          ouOverErr = e instanceof Error ? e.message : String(e);
          return null;
        }
      })();
      const ouUnderBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: underLineCode });
          return slimOuMarket(raw);
        } catch (e) {
          ouUnderErr = e instanceof Error ? e.message : String(e);
          return null;
        }
      })();

      const overMarketId = String(ouOverBetfair?.marketId ?? "").trim();
      const overMarketStatus = String(ouOverBetfair?.marketStatus ?? "").trim().toUpperCase();
      const overOverSel = Number(ouOverBetfair?.runners?.overSelectionId);
      const overUnderSel = Number(ouOverBetfair?.runners?.underSelectionId);
      const overBack = Number(ouOverBetfair?.odds?.over?.back);
      const overLay = Number(ouOverBetfair?.odds?.over?.lay);

      const underMarketId = String(ouUnderBetfair?.marketId ?? "").trim();
      const underMarketStatus = String(ouUnderBetfair?.marketStatus ?? "").trim().toUpperCase();
      const underOverSel = Number(ouUnderBetfair?.runners?.overSelectionId);
      const underUnderSel = Number(ouUnderBetfair?.runners?.underSelectionId);
      const underBack = Number(ouUnderBetfair?.odds?.under?.back);
      const underLay = Number(ouUnderBetfair?.odds?.under?.lay);

      const overReady = Boolean(overMarketId && Number.isFinite(overOverSel) && Number.isFinite(overUnderSel));
      const underReady = Boolean(underMarketId && Number.isFinite(underOverSel) && Number.isFinite(underUnderSel));

      if (!overReady && !underReady) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...(((current as any)?.strategy && typeof (current as any).strategy === "object") ? (current as any).strategy : {}),
            agent: "scalpingTicks",
            scalpingTicks: {
              ...((((current as any)?.strategy?.scalpingTicks && typeof (current as any).strategy.scalpingTicks === "object") ? (current as any).strategy.scalpingTicks : {})),
              phase: "monitoring",
              lastTickAt: new Date().toISOString(),
              lineCodeOver: overLineCode,
              lineCodeUnder: underLineCode,
              marketOver: ouOverBetfair ?? null,
              marketUnder: ouUnderBetfair ?? null,
              ouMarketErrorOver: ouOverErr,
              ouMarketErrorUnder: ouUnderErr,
            },
          },
          updatedAt: new Date().toISOString(),
        };
        await setQueueItem(matchId, next);
        return json({
          ok: true,
          skipped: true,
          reason: "market_not_ready",
          error: ouOverErr || ouUnderErr || null,
          item: next,
        });
      }

      const bankroll = Number(cfg?.bankroll ?? 50);
      const stakePct = Number(cfg?.stakePct ?? 1);
      const targetTicks = Number(cfg?.targetTicks ?? 10);
      const entryOffsetTicks = Number(cfg?.entryOffsetTicks ?? 2);
      const entryMaxWaitSecondsRaw = Number(cfg?.entryMaxWaitSeconds ?? 15);
      const entryMaxWaitSeconds = Number.isFinite(entryMaxWaitSecondsRaw) ? Math.max(2, Math.min(120, Math.floor(entryMaxWaitSecondsRaw))) : 15;
      const maxSpreadTicks = Number(cfg?.maxSpreadTicks ?? 2);
      const minSecondsBetweenCycles = Number(cfg?.minSecondsBetweenCycles ?? 8);
      const maxCycles = Number(cfg?.maxCycles ?? 50);
      const secondsToWaitMatch = Number(cfg?.secondsToWaitMatch ?? 10);
      const minMarketMatched = Number(cfg?.minMarketMatched ?? 15000);
      const minRunnerMatched = Number(cfg?.minRunnerMatched ?? 2500);
      const afterGoalWaitSecondsRaw = Number(cfg?.afterGoalWaitSeconds ?? 30);
      const afterGoalWaitSeconds = Number.isFinite(afterGoalWaitSecondsRaw) ? Math.max(0, Math.min(600, Math.floor(afterGoalWaitSecondsRaw))) : 30;
      const recoveryEnabled = Boolean(cfg?.recoveryEnabled ?? true);
      const recoveryIncreasePctRaw = Number(cfg?.recoveryIncreasePct ?? 0.25);
      const recoveryIncreasePct = Number.isFinite(recoveryIncreasePctRaw) ? Math.max(0, Math.min(2, recoveryIncreasePctRaw)) : 0.25;
      const recoveryMaxStakeAbsRaw = Number(cfg?.recoveryMaxStakeAbs ?? 100);
      const recoveryMaxStakeAbs = Number.isFinite(recoveryMaxStakeAbsRaw) ? Math.max(2, Math.min(10000, round2(recoveryMaxStakeAbsRaw))) : 100;
      const momentOverThresholdRaw = Number(cfg?.momentOverThreshold ?? 0.7);
      const momentOverThreshold = Number.isFinite(momentOverThresholdRaw) ? Math.max(0.1, Math.min(2, momentOverThresholdRaw)) : 0.7;
      const momentOverThresholdLateRaw = Number(cfg?.momentOverThresholdLate ?? 0.85);
      const momentOverThresholdLate = Number.isFinite(momentOverThresholdLateRaw)
        ? Math.max(0.1, Math.min(2, momentOverThresholdLateRaw))
        : 0.85;
      const momentOverThresholdOffDeltaRaw = Number(cfg?.momentOverThresholdOffDelta ?? 0.15);
      const momentOverThresholdOffDelta = Number.isFinite(momentOverThresholdOffDeltaRaw)
        ? Math.max(0, Math.min(1, momentOverThresholdOffDeltaRaw))
        : 0.15;
      const momentWindowMinSecRaw = Number(cfg?.momentWindowMinSec ?? 8);
      const momentWindowMaxSecRaw = Number(cfg?.momentWindowMaxSec ?? 180);
      const momentWindowMinSec = Number.isFinite(momentWindowMinSecRaw) ? Math.max(1, Math.min(300, Math.floor(momentWindowMinSecRaw))) : 8;
      const momentWindowMaxSecCandidate = Number.isFinite(momentWindowMaxSecRaw) ? Math.max(2, Math.min(600, Math.floor(momentWindowMaxSecRaw))) : 180;
      const momentWindowMaxSec = Math.max(momentWindowMinSec + 1, momentWindowMaxSecCandidate);

      const baseStakeAbs =
        Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
          ? Math.max(2, round2((bankroll * stakePct) / 100))
          : 2;
      const phase = String(existing?.phase ?? "").trim();
      const recoveryStakeRaw = Number(existing?.recoveryStakeAbs);
      const recoveryStakeAbs =
        recoveryEnabled && Number.isFinite(recoveryStakeRaw) && recoveryStakeRaw > 0 ? Math.max(2, round2(recoveryStakeRaw)) : null;
      const stakeAbs = recoveryStakeAbs != null ? Math.min(recoveryMaxStakeAbs, recoveryStakeAbs) : baseStakeAbs;
      const cycleCount = Math.max(0, Math.floor(Number(existing?.cycleCount ?? 0) || 0));

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const timelineElapsed = Number((baseBetfair as any)?.timeline?.elapsed);
      const timelineScoreHome = Number((baseBetfair as any)?.timeline?.scoreHome);
      const timelineScoreAway = Number((baseBetfair as any)?.timeline?.scoreAway);
      const scoreHomeNow = typeof scoreHome === "number" ? scoreHome : null;
      const scoreAwayNow = typeof scoreAway === "number" ? scoreAway : null;
      const marketStartIso = String(baseBetfair?.marketStartTime ?? (current as any)?.utcDate ?? "").trim();
      const marketStartMs = marketStartIso ? new Date(marketStartIso).getTime() : NaN;
      const elapsedSec =
        Number.isFinite(timelineElapsed) ? Math.max(0, Math.floor(timelineElapsed * 60))
        : Number.isFinite(marketStartMs) ? Math.floor((nowMs - marketStartMs) / 1000)
        : null;
      const elapsedMin = typeof elapsedSec === "number" ? elapsedSec / 60 : null;
      const lateMode = typeof elapsedMin === "number" && Number.isFinite(elapsedMin) && elapsedMin >= 75;

      const predictedSide = (() => {
        const p = (current as any)?.prediction && typeof (current as any).prediction === "object" ? (current as any).prediction : null;
        const pred = String(p?.overUnder?.prediction ?? "").trim().toLowerCase();
        const conf = Number(p?.overUnder?.confidence);
        if (!(Number.isFinite(conf) && conf >= 55)) return null;
        if (pred === "over") return "over";
        if (pred === "under") return "under";
        return null;
      })();

      const overMarketMatched = Number(ouOverBetfair?.matchedVolume);
      const underMarketMatched = Number(ouUnderBetfair?.matchedVolume);
      const overMatchedNow = Number(ouOverBetfair?.odds?.over?.runnerMatched);
      const underMatchedNow = Number(ouUnderBetfair?.odds?.under?.runnerMatched);
      const overSpreadTicks = Number.isFinite(overBack) && Number.isFinite(overLay) ? ticksBetweenPrices(overBack, overLay) : null;
      const underSpreadTicks = Number.isFinite(underBack) && Number.isFinite(underLay) ? ticksBetweenPrices(underBack, underLay) : null;

      const momentOver = (() => {
        const snapAtMsPrev = Number(existing?.momentSnapAtMs);
        const snapOverMatchedPrev = Number(existing?.momentOverMatched);
        const snapUnderMatchedPrev = Number(existing?.momentUnderMatched);
        const snapOverBackPrev = Number(existing?.momentOverBack);
        const lastScorePrev = Number(existing?.lastMomentOverScore);

        const dtMs = Number.isFinite(snapAtMsPrev) && snapAtMsPrev > 0 ? nowMs - snapAtMsPrev : 0;
        const dtSec = dtMs > 0 ? dtMs / 1000 : 0;

        const threshold = lateMode ? momentOverThresholdLate : momentOverThreshold;
        const thresholdOff = Math.max(0.1, threshold - momentOverThresholdOffDelta);

        let score = 0;
        let computed = false;
        if (dtSec >= momentWindowMinSec && dtSec <= momentWindowMaxSec) {
          const overRatio =
            (Number.isFinite(overMatchedNow) && overMatchedNow > 0 ? overMatchedNow : 0) /
            (Number.isFinite(snapOverMatchedPrev) && snapOverMatchedPrev > 0 ? snapOverMatchedPrev : 1);
          const underRatio =
            (Number.isFinite(underMatchedNow) && underMatchedNow > 0 ? underMatchedNow : 0) /
            (Number.isFinite(snapUnderMatchedPrev) && snapUnderMatchedPrev > 0 ? snapUnderMatchedPrev : 1);
          const overVelocity =
            Number.isFinite(overMatchedNow) && Number.isFinite(snapOverMatchedPrev) && dtSec > 0 ? (overMatchedNow - snapOverMatchedPrev) / dtSec : 0;
          const underVelocity =
            Number.isFinite(underMatchedNow) && Number.isFinite(snapUnderMatchedPrev) && dtSec > 0 ? (underMatchedNow - snapUnderMatchedPrev) / dtSec : 0;

          const compressionTicks =
            Number.isFinite(snapOverBackPrev) && snapOverBackPrev > 1 && Number.isFinite(overBack) && overBack > 1 && overBack < snapOverBackPrev
              ? ticksBetweenPrices(overBack, snapOverBackPrev) ?? 0
              : 0;

          if (overRatio >= 1.12) score += Math.min(0.45, (overRatio - 1) * 1.6);
          if (underRatio >= 1.12) score -= Math.min(0.25, (underRatio - 1) * 0.9);
          if (overVelocity > 0 && underVelocity >= 0) score += Math.min(0.2, (overVelocity / Math.max(1, underVelocity + 1)) * 0.05);
          if (underVelocity > 0 && overVelocity >= 0) score -= Math.min(0.2, (underVelocity / Math.max(1, overVelocity + 1)) * 0.05);

          if (compressionTicks > 0) score += Math.min(0.35, (compressionTicks / 10) * 0.35);

          const maxSpreadSafeForScore = Number.isFinite(maxSpreadTicks) ? Math.max(0, Math.floor(maxSpreadTicks)) : null;
          if (maxSpreadSafeForScore != null && overSpreadTicks != null) {
            if (overSpreadTicks <= maxSpreadSafeForScore) score += 0.1;
            if (overSpreadTicks > maxSpreadSafeForScore) score -= 0.25;
          }

          if (predictedSide === "over") score += 0.12;
          if (predictedSide === "under") score -= 0.08;

          computed = true;
        }

        const scoreUsed = computed ? score : Number.isFinite(lastScorePrev) ? lastScorePrev : 0;

        const wasAlert = Boolean(existing?.goalAlertActive ?? false);
        const trigger = wasAlert ? scoreUsed >= thresholdOff : scoreUsed >= threshold;

        const hasSnap = Number.isFinite(snapAtMsPrev) && snapAtMsPrev > 0;
        const shouldUpdateSnap = !hasSnap || dtSec >= momentWindowMinSec || dtSec > momentWindowMaxSec;
        const nextSnapAtMs = shouldUpdateSnap ? nowMs : snapAtMsPrev;
        const nextOverMatched = shouldUpdateSnap ? (Number.isFinite(overMatchedNow) ? overMatchedNow : null) : (Number.isFinite(snapOverMatchedPrev) ? snapOverMatchedPrev : null);
        const nextUnderMatched = shouldUpdateSnap ? (Number.isFinite(underMatchedNow) ? underMatchedNow : null) : (Number.isFinite(snapUnderMatchedPrev) ? snapUnderMatchedPrev : null);
        const nextOverBack = shouldUpdateSnap ? (Number.isFinite(overBack) ? overBack : null) : (Number.isFinite(snapOverBackPrev) ? snapOverBackPrev : null);

        return {
          score: round2(computed ? score : Number.isFinite(lastScorePrev) ? lastScorePrev : 0),
          threshold,
          thresholdOff,
          trigger,
          nextSnapAtMs,
          nextOverMatched,
          nextUnderMatched,
          nextOverBack,
        };
      })();

      let side = momentOver.trigger ? "over" : "under";
      if (side === "over" && !overReady) side = underReady ? "under" : "over";
      if (side === "under" && !underReady) side = overReady ? "over" : "under";

      const marketId = side === "over" ? overMarketId : underMarketId;
      const marketStatus = (side === "over" ? overMarketStatus : underMarketStatus) || "";
      const selectionId =
        side === "over" ? overOverSel : underUnderSel;
      const bestBack = side === "over" ? overBack : underBack;
      const bestLay = side === "over" ? overLay : underLay;
      const marketMatched = side === "over" ? overMarketMatched : underMarketMatched;

      const prevMarketStatus = String(existing?.lastMarketStatus ?? "").trim().toUpperCase();
      const lastBestBack = Number(existing?.lastBestBack);
      const lastBestLay = Number(existing?.lastBestLay);
      const lastClosedAtMs = existing?.lastClosedAt ? new Date(String(existing.lastClosedAt)).getTime() : 0;
      const cooldownUntilMs = Number(existing?.cooldownUntilMs);
      const lastScoreHome = Number(existing?.lastScoreHome);
      const lastScoreAway = Number(existing?.lastScoreAway);
      const hasScoreNow = typeof scoreHomeNow === "number" && typeof scoreAwayNow === "number";
      const hasScorePrev = Number.isFinite(lastScoreHome) && Number.isFinite(lastScoreAway);
      const goalConfirmed =
        hasScoreNow && hasScorePrev ? scoreHomeNow !== lastScoreHome || scoreAwayNow !== lastScoreAway : false;
      const justResumed = prevMarketStatus === "SUSPENDED" && marketStatus === "OPEN";
      const bigMove =
        Number.isFinite(lastBestBack) && Number.isFinite(bestBack) && bestBack > 1
          ? Math.abs(bestBack - lastBestBack) >= 0.25 || Math.abs((bestBack - lastBestBack) / Math.max(1.01, lastBestBack)) >= 0.12
          : false;

      const baseState = {
        ...existing,
        lastTickAt: nowIso,
        lastMarketStatus: marketStatus || prevMarketStatus || null,
        lastBestBack: Number.isFinite(bestBack) ? bestBack : Number.isFinite(lastBestBack) ? lastBestBack : null,
        lastBestLay: Number.isFinite(bestLay) ? bestLay : Number.isFinite(lastBestLay) ? lastBestLay : null,
        lastScoreHome: hasScoreNow ? scoreHomeNow : hasScorePrev ? lastScoreHome : null,
        lastScoreAway: hasScoreNow ? scoreAwayNow : hasScorePrev ? lastScoreAway : null,
        lateMode,
        lineCodeOver: overLineCode,
        lineCodeUnder: underLineCode,
        marketOver: ouOverBetfair ?? null,
        marketUnder: ouUnderBetfair ?? null,
        side,
        goalAlertActive: Boolean(momentOver.trigger),
        momentSnapAtMs: Number.isFinite(momentOver.nextSnapAtMs) ? momentOver.nextSnapAtMs : null,
        momentOverMatched: (momentOver as any)?.nextOverMatched ?? null,
        momentUnderMatched: (momentOver as any)?.nextUnderMatched ?? null,
        momentOverBack: (momentOver as any)?.nextOverBack ?? null,
        lastMomentOverScore: (momentOver as any)?.score ?? null,
        lastMomentOverThreshold: (momentOver as any)?.threshold ?? null,
      };

      if (goalConfirmed || (justResumed && bigMove)) {
        if (phase === "entering") {
          const enteringSide = String(existing?.side ?? "").trim().toLowerCase() === "over" ? "over" : "under";
          const entryMarketId =
            String(existing?.entryMarketId ?? "").trim() ||
            (enteringSide === "over" ? overMarketId : underMarketId);
          const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
          const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [tpBetId] });
            } catch {}
          }
          if (entryBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [entryBetId] });
            } catch {}
          }

          const nextCooldownUntilMs = nowMs + afterGoalWaitSeconds * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: "monitoring",
                lastGoalLikeAt: nowIso,
                ...(goalConfirmed ? { lastGoalAt: nowIso } : {}),
                cooldownUntilMs: nextCooldownUntilMs,
                takeProfit: null,
                lastEntryStatus: "CANCELLED",
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "after_goal_cancel_entering", item: next });
        }
        if (phase === "entered") {
          const activeSide = String(existing?.side ?? side).trim().toLowerCase() === "over" ? "over" : "under";
          const posMarketId =
            String(existing?.entryMarketId ?? "").trim() ||
            (activeSide === "over" ? overMarketId : underMarketId);
          const posSelectionId = Number(existing?.selectionId ?? (activeSide === "over" ? overOverSel : underUnderSel));
          const posBestLay = activeSide === "over" ? overLay : underLay;
          const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
          const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
          const entryPrice = Number(existing?.entryPrice);
          const stake0 = Number(existing?.stakeAbs ?? stakeAbs);

          let entrySizeMatched = Number.isFinite(stake0) && stake0 > 0 ? stake0 : stakeAbs;
          let entrySizeRemaining = 0;
          if (entryBetId) {
            try {
              const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
              const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
              const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
              const sizeMatched = Number(row?.sizeMatched);
              const sizeRemaining = Number(row?.sizeRemaining);
              if (Number.isFinite(sizeMatched) && sizeMatched > 0) entrySizeMatched = sizeMatched;
              if (Number.isFinite(sizeRemaining) && sizeRemaining > 0) entrySizeRemaining = sizeRemaining;
            } catch {}
          }

          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [tpBetId] });
            } catch {}
          }

          let didClose = false;
          let exitMode: string | null = null;
          if (entryBetId && entrySizeRemaining > 0 && !(Number.isFinite(entrySizeMatched) && entrySizeMatched > 0)) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [entryBetId] });
              didClose = true;
              exitMode = "goal_cancel_entry";
            } catch {}
          } else if (marketStatus !== "SUSPENDED" && Number.isFinite(posBestLay) && posBestLay > 1) {
            const hedgeSize =
              Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0
                ? Math.max(2, round2((entryPrice * entrySizeMatched) / posBestLay))
                : Math.max(2, round2(entrySizeMatched));
            try {
              await placeOrders({
                adminToken: admin.adminToken,
                marketId: posMarketId,
                customerRef: mkCustomerRef("gx", matchId),
                instructions: [
                  {
                    selectionId: posSelectionId,
                    side: "LAY",
                    orderType: "LIMIT",
                    limitOrder: { size: hedgeSize, price: posBestLay, persistenceType: "LAPSE" },
                  },
                ],
              });
              didClose = true;
              exitMode = "goal_hedge";
            } catch {}
          }

          const prevRecoveryStake = Number(existing?.recoveryStakeAbs ?? existing?.stakeAbs ?? stakeAbs);
          const nextRecoveryStakeAbs =
            recoveryEnabled && (didClose ? exitMode === "goal_hedge" : marketStatus === "SUSPENDED") && Number.isFinite(prevRecoveryStake) && prevRecoveryStake > 0
              ? Math.min(recoveryMaxStakeAbs, Math.max(2, round2(prevRecoveryStake * (1 + recoveryIncreasePct))))
              : null;

          const nextCooldownUntilMs = nowMs + afterGoalWaitSeconds * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: didClose ? "cooldown" : marketStatus === "SUSPENDED" ? "exit_pending" : "cooldown",
                cycleCount: cycleCount + 1,
                closedAt: nowIso,
                lastClosedAt: nowIso,
                cooldownUntilMs: nextCooldownUntilMs,
                lastGoalLikeAt: nowIso,
                ...(goalConfirmed ? { lastGoalAt: nowIso } : {}),
                lastExitReason: didClose ? exitMode : "goal_pending",
                pendingExitAt: didClose ? null : nowIso,
                pendingExitReason: didClose ? null : "goal_suspended",
                recoveryStakeAbs: nextRecoveryStakeAbs,
                recoveryLevel:
                  nextRecoveryStakeAbs != null ? Math.max(0, Math.floor(Number(existing?.recoveryLevel ?? 0) || 0)) + 1 : 0,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: Boolean(didClose), reason: "after_goal_exit" });
        }
        const nextCooldownUntilMs = nowMs + afterGoalWaitSeconds * 1000;
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "scalpingTicks",
            scalpingTicks: {
              ...baseState,
              phase: phase || "monitoring",
              lastGoalLikeAt: nowIso,
              ...(goalConfirmed ? { lastGoalAt: nowIso } : {}),
              cooldownUntilMs: nextCooldownUntilMs,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "after_goal_wait", item: next });
      }

      if (marketStatus === "SUSPENDED") {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "suspended", item: next });
      }

      if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "cooldown" } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown", item: next });
      }

      if (typeof elapsedSec === "number" && Number.isFinite(elapsedSec) && elapsedSec >= 0) {
        const waitSec = Number.isFinite(secondsToWaitMatch) ? Math.max(0, Math.floor(secondsToWaitMatch)) : 0;
        if (waitSec > 0 && elapsedSec < waitSec) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "wait_match", item: next });
        }
      }

      const maxCyclesSafe = Number.isFinite(maxCycles) ? Math.max(1, Math.floor(maxCycles)) : 50;
      if (cycleCount >= maxCyclesSafe) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "stopped", cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "max_cycles", item: next });
      }

      const minCycleSecSafe = Number.isFinite(minSecondsBetweenCycles) ? Math.max(1, Math.floor(minSecondsBetweenCycles)) : 8;
      if (lastClosedAtMs && Number.isFinite(lastClosedAtMs) && nowMs - lastClosedAtMs < minCycleSecSafe * 1000) {
        const nextCooldownUntilMs = lastClosedAtMs + minCycleSecSafe * 1000;
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "cooldown", cycleCount, cooldownUntilMs: nextCooldownUntilMs } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "min_cycle_wait", item: next });
      }

      if (Number.isFinite(minMarketMatched) && minMarketMatched > 0) {
        if (!(Number.isFinite(marketMatched) && marketMatched >= minMarketMatched)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring", cycleCount } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "low_liquidity", item: next });
        }
      }

      const runnerMatched = Number(side === "over" ? ouOverBetfair?.odds?.over?.runnerMatched : ouUnderBetfair?.odds?.under?.runnerMatched);
      if (Number.isFinite(minRunnerMatched) && minRunnerMatched > 0) {
        if (!(Number.isFinite(runnerMatched) && runnerMatched >= minRunnerMatched)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring", cycleCount } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "low_runner_liquidity", item: next });
        }
      }

      const spreadTicks = Number.isFinite(bestBack) && Number.isFinite(bestLay) ? ticksBetweenPrices(bestBack, bestLay) : null;
      const maxSpreadSafe = Number.isFinite(maxSpreadTicks) ? Math.max(0, Math.floor(maxSpreadTicks)) : null;
      if (maxSpreadSafe != null && spreadTicks != null && spreadTicks > maxSpreadSafe) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring", cycleCount, spreadTicks } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "spread", item: next });
      }

      if (!(Number.isFinite(bestBack) && bestBack > 1)) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring", cycleCount, spreadTicks } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_price", item: next });
      }

      if (phase === "entering") {
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const enteringSide = String(existing?.side ?? "").trim().toLowerCase() === "over" ? "over" : "under";
        const entryMarketId =
          String(existing?.entryMarketId ?? "").trim() ||
          (enteringSide === "over" ? overMarketId : underMarketId);
        const entrySelectionIdRaw = Number(existing?.selectionId ?? (enteringSide === "over" ? overOverSel : underUnderSel));
        const entrySelectionId = Number.isFinite(entrySelectionIdRaw) ? entrySelectionIdRaw : selectionId;
        const entryBestBack = enteringSide === "over" ? overBack : underBack;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const entryPlacedAtIso = String(existing?.lastEntryAt ?? existing?.enteredAt ?? "").trim();
        const entryPlacedAtMs = entryPlacedAtIso ? new Date(entryPlacedAtIso).getTime() : 0;

        if (!entryBetId) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "monitoring" } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "entering_missing_betid", item: next });
        }

        let sizeMatched = 0;
        let sizeRemaining = 0;
        let avgPriceMatched = NaN;
        let status = "";
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          let row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
          if (!row && entryMarketId) {
            try {
              const resByMarket = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [entryMarketId] });
              const ordersByMarket = Array.isArray((resByMarket as any)?.currentOrders) ? (resByMarket as any).currentOrders : [];
              row = ordersByMarket.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
            } catch {}
          }
          sizeMatched = Number(row?.sizeMatched);
          sizeRemaining = Number(row?.sizeRemaining);
          avgPriceMatched = Number(row?.averagePriceMatched);
          status = String(row?.status ?? "").trim().toUpperCase();
        } catch {}
        const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
        const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;

        if (matchedSafe <= 0 && tpBetId) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [tpBetId] });
          } catch {}
        }

        if (matchedSafe > 0) {
          if (remainingSafe > 0) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [entryBetId] });
            } catch {}
          }

          const entryPriceMatched = Number.isFinite(avgPriceMatched) && avgPriceMatched > 1 ? avgPriceMatched : Number(existing?.entryPrice);
          const entryPriceSafe =
            Number.isFinite(entryPriceMatched) && entryPriceMatched > 1
              ? entryPriceMatched
              : Number.isFinite(entryBestBack) && entryBestBack > 1
              ? entryBestBack
              : bestBack;
          const targetPrice = movePriceByTicks(entryPriceSafe, -(Number.isFinite(targetTicks) ? Math.floor(targetTicks) : 6));
          const hedgeSizeAtTarget = Number.isFinite(targetPrice) && targetPrice > 1 ? Math.max(2, round2((entryPriceSafe * matchedSafe) / targetPrice)) : null;

          let takeProfit = null as any;
          if (hedgeSizeAtTarget != null) {
            const tpRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId: entryMarketId,
              customerRef: mkCustomerRef("tp", matchId),
              instructions: [
                {
                  selectionId: entrySelectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSizeAtTarget, price: targetPrice, persistenceType: "LAPSE" },
                },
              ],
            }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
            const tpErr = (tpRes as any)?.__error ? String((tpRes as any).__error) : null;
            takeProfit = {
              betId: tpErr ? null : extractBetId(tpRes),
              price: targetPrice,
              size: hedgeSizeAtTarget,
              placedAt: nowIso,
              status: tpErr ? null : extractReportStatus(tpRes),
              errorCode: tpErr ? null : extractReportErrorCode(tpRes),
              result: tpErr ? null : tpRes ?? null,
              error: tpErr,
            };
          }

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: "entered",
                entryMarketId: entryMarketId,
                entryLineCode: Number(existing?.entryLineCode),
                selectionId: entrySelectionId,
                entryPrice: entryPriceSafe,
                targetPrice,
                stakeAbs: matchedSafe,
                spreadTicks,
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
                entryBetId,
                entryMatchedSize: matchedSafe,
                entryRemainingSize: remainingSafe,
                entryMatchedAt: nowIso,
                takeProfit,
                lastTpPlaceAt: nowIso,
                lastTpPlaceError: (takeProfit as any)?.error ?? null,
                lastEntryStatus: status || null,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, entered: true, item: next, reason: "entry_matched" });
        }

        const currentBestBackForEntry =
          Number.isFinite(entryBestBack) && entryBestBack > 1 ? entryBestBack : Number.isFinite(bestBack) && bestBack > 1 ? bestBack : NaN;
        const driftTicks = (() => {
          const lastEntryPrice = Number(existing?.entryPrice);
          if (!(Number.isFinite(lastEntryPrice) && lastEntryPrice > 1)) return null;
          if (!(Number.isFinite(currentBestBackForEntry) && currentBestBackForEntry > 1)) return null;
          return ticksBetweenPrices(lastEntryPrice, currentBestBackForEntry);
        })();
        const driftTooHigh = typeof driftTicks === "number" && Number.isFinite(driftTicks) && driftTicks >= 20;
        const expired = entryPlacedAtMs && Number.isFinite(entryPlacedAtMs) && nowMs - entryPlacedAtMs >= entryMaxWaitSeconds * 1000;
        const shouldReprice = remainingSafe > 0 && (expired || driftTooHigh);
        if (shouldReprice) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [entryBetId] });
          } catch {}

          if (!(Number.isFinite(currentBestBackForEntry) && currentBestBackForEntry > 1)) {
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "monitoring" } },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "reprice_no_price", item: next });
          }

          const entryPrice = currentBestBackForEntry;
          const result = await placeOrders({
            adminToken: admin.adminToken,
            marketId: entryMarketId,
            customerRef: mkCustomerRef("rp", matchId),
            instructions: [
              {
                selectionId: entrySelectionId,
                side: "BACK",
                orderType: "LIMIT",
                limitOrder: { size: stakeAbs, price: entryPrice, persistenceType: "LAPSE" },
              },
            ],
          });
          const newEntryBetId = extractBetId(result);

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: "entering",
                entryMarketId: entryMarketId,
                entryLineCode:
                  Number.isFinite(Number(existing?.entryLineCode)) && Number(existing?.entryLineCode) > 0
                    ? Number(existing?.entryLineCode)
                    : enteringSide === "over"
                    ? overLineCode
                    : underLineCode,
                selectionId: entrySelectionId,
                entryPrice,
                stakeAbs,
                spreadTicks,
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: nowIso,
                entryBetId: newEntryBetId,
                takeProfit: null,
                lastResult: result ?? null,
                lastEntryStatus: extractReportStatus(result),
                lastEntryErrorCode: extractReportErrorCode(result),
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: driftTooHigh ? "reprice_entry_drift" : "reprice_entry_timeout", item: next });
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "entering" } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_entry_fill", item: next });
      }

      if (!phase || phase === "monitoring" || phase === "cooldown" || phase === "closed") {
        const entryPrice = movePriceByTicks(bestBack, Number.isFinite(entryOffsetTicks) ? Math.floor(entryOffsetTicks) : 0);
        const result = await placeOrders({
          adminToken: admin.adminToken,
          marketId,
          customerRef: mkCustomerRef("en", matchId),
          instructions: [
            {
              selectionId,
              side: "BACK",
              orderType: "LIMIT",
              limitOrder: { size: stakeAbs, price: entryPrice, persistenceType: "LAPSE" },
            },
          ],
        });

        const entryBetId = extractBetId(result);
        const entryStatus = extractReportStatus(result);
        const entryErrorCode = extractReportErrorCode(result);

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "scalpingTicks",
            scalpingTicks: {
              ...baseState,
              phase: "entering",
              cycleCount,
              entryMarketId: marketId,
              entryLineCode: side === "over" ? overLineCode : underLineCode,
              selectionId,
              entryPrice,
              stakeAbs,
              spreadTicks,
              enteredAt: nowIso,
              lastEntryAt: nowIso,
              entryBetId,
              entryOverMatched: Number.isFinite(overMatchedNow) ? overMatchedNow : null,
              entryUnderMatched: Number.isFinite(underMatchedNow) ? underMatchedNow : null,
              entryMarketMatched: Number.isFinite(marketMatched) ? marketMatched : null,
              takeProfit: null,
              lastResult: result ?? null,
              lastEntryStatus: entryStatus,
              lastEntryErrorCode: entryErrorCode,
            },
          },
          status: String((current as any)?.status ?? "running"),
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, item: next, entered: true, skipped: true, reason: "entering" });
      }

      if (phase === "entered") {
        const activeSide = String(existing?.side ?? side).trim().toLowerCase() === "over" ? "over" : "under";
        const posMarketId =
          String(existing?.entryMarketId ?? "").trim() ||
          (activeSide === "over" ? overMarketId : underMarketId);
        const posSelectionId = Number(existing?.selectionId ?? (activeSide === "over" ? overOverSel : underUnderSel));
        const posBestBack = activeSide === "over" ? overBack : underBack;
        const posBestLay = activeSide === "over" ? overLay : underLay;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const tpPrice = Number(existing?.takeProfit?.price);
        const lastTpCheckAt = String(existing?.lastTpCheckAt ?? "").trim();
        const lastTpCheckAtMs = lastTpCheckAt ? new Date(lastTpCheckAt).getTime() : 0;
        const lastTpPlaceAt = String(existing?.lastTpPlaceAt ?? "").trim();
        const lastTpPlaceAtMs = lastTpPlaceAt ? new Date(lastTpPlaceAt).getTime() : 0;
        const pendingExitAt = String((existing as any)?.pendingExitAt ?? "").trim();
        const pendingExitAtMs = pendingExitAt ? new Date(pendingExitAt).getTime() : 0;

        if (pendingExitAtMs && Number.isFinite(pendingExitAtMs) && pendingExitAtMs > 0 && Number.isFinite(posBestLay) && posBestLay > 1) {
          const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
          let entrySizeMatched = Number(existing?.stakeAbs ?? stakeAbs);
          let entrySizeRemaining = 0;
          if (entryBetId) {
            try {
              const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
              const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
              const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
              const sizeMatched = Number(row?.sizeMatched);
              const sizeRemaining = Number(row?.sizeRemaining);
              if (Number.isFinite(sizeMatched) && sizeMatched > 0) entrySizeMatched = sizeMatched;
              if (Number.isFinite(sizeRemaining) && sizeRemaining > 0) entrySizeRemaining = sizeRemaining;
            } catch {}
          }

          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [tpBetId] });
            } catch {}
          }
          if (entryBetId && entrySizeRemaining > 0 && !(Number.isFinite(entrySizeMatched) && entrySizeMatched > 0)) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [entryBetId] });
            } catch {}
          }

          const entryPrice = Number(existing?.entryPrice);
          const hedgeSize =
            Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0
              ? Math.max(2, round2((entryPrice * entrySizeMatched) / posBestLay))
              : Math.max(2, round2(Number(existing?.stakeAbs ?? stakeAbs)));
          try {
            await placeOrders({
              adminToken: admin.adminToken,
              marketId: posMarketId,
              customerRef: mkCustomerRef("px", matchId),
              instructions: [
                {
                  selectionId: posSelectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSize, price: posBestLay, persistenceType: "LAPSE" },
                },
              ],
            });
          } catch {}

          const minCycleSecSafe = Number.isFinite(minSecondsBetweenCycles) ? Math.max(1, Math.floor(minSecondsBetweenCycles)) : 8;
          const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: "cooldown",
                cycleCount: cycleCount + 1,
                closedAt: nowIso,
                lastClosedAt: nowIso,
                cooldownUntilMs: nextCooldownUntilMs,
                lastExitReason: "goal_hedge_resume",
                pendingExitAt: null,
                pendingExitReason: null,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true, reason: "pending_goal_exit_done" });
        }

        if (!tpBetId) {
          const throttleMs = 8_000;
          if (!lastTpPlaceAtMs || !Number.isFinite(lastTpPlaceAtMs) || nowMs - lastTpPlaceAtMs >= throttleMs) {
            const entryPrice0 = Number(existing?.entryPrice);
            const stake0 = Number(existing?.stakeAbs ?? stakeAbs);
            const targetPrice0 =
              Number(existing?.targetPrice) > 1
                ? Number(existing?.targetPrice)
                : Number.isFinite(entryPrice0) && entryPrice0 > 1
                  ? movePriceByTicks(entryPrice0, -(Number.isFinite(targetTicks) ? Math.floor(targetTicks) : 6))
                  : NaN;

            if (Number.isFinite(entryPrice0) && entryPrice0 > 1 && Number.isFinite(targetPrice0) && targetPrice0 > 1 && Number.isFinite(stake0) && stake0 > 0) {
              const hedgeSizeAtTarget = Math.max(2, round2((entryPrice0 * stake0) / targetPrice0));
              const tpRes = await placeOrders({
                adminToken: admin.adminToken,
                marketId: posMarketId,
                customerRef: mkCustomerRef("tr", matchId),
                instructions: [
                  {
                    selectionId: posSelectionId,
                    side: "LAY",
                    orderType: "LIMIT",
                    limitOrder: { size: hedgeSizeAtTarget, price: targetPrice0, persistenceType: "LAPSE" },
                  },
                ],
              }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

              const retryBetId = extractBetId(tpRes);
              const retryStatus = extractReportStatus(tpRes);
              const retryErrorCode = extractReportErrorCode(tpRes);

              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "scalpingTicks",
                  scalpingTicks: {
                    ...baseState,
                    phase: "entered",
                    takeProfit: {
                      betId: retryBetId,
                      price: targetPrice0,
                      size: hedgeSizeAtTarget,
                      placedAt: nowIso,
                      status: retryStatus,
                      errorCode: retryErrorCode,
                      result: (tpRes as any)?.__error ? null : tpRes ?? null,
                    },
                    lastTpPlaceAt: nowIso,
                    lastTpPlaceError: (tpRes as any)?.__error ? String((tpRes as any).__error) : null,
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, item: next, skipped: true, reason: "tp_repair" });
            }
          }
        }

        const invertVolumePctRaw = Number(cfg?.invertVolumePct ?? 300);
        const invertVolumePct = Number.isFinite(invertVolumePctRaw) ? Math.max(50, Math.min(1000, Math.floor(invertVolumePctRaw))) : 300;
        const invertMultiplier = 1 + invertVolumePct / 100;
        const baselineOver = Number(existing?.entryOverMatched);
        const baselineOverSafe =
          Number.isFinite(baselineOver) && baselineOver > 0
            ? baselineOver
            : Number.isFinite(overMatchedNow) && overMatchedNow > 0
              ? overMatchedNow
              : null;
        const shouldInvert =
          activeSide === "under" &&
          baselineOverSafe != null &&
          Number.isFinite(overMatchedNow) &&
          overMatchedNow > 0 &&
          overMatchedNow >= baselineOverSafe * invertMultiplier;

        if (shouldInvert) {
          const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
          let entrySizeMatched = Number(existing?.stakeAbs ?? stakeAbs);
          let entrySizeRemaining = 0;
          if (entryBetId) {
            try {
              const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
              const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
              const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
              const sizeMatched = Number(row?.sizeMatched);
              const sizeRemaining = Number(row?.sizeRemaining);
              if (Number.isFinite(sizeMatched) && sizeMatched > 0) entrySizeMatched = sizeMatched;
              if (Number.isFinite(sizeRemaining) && sizeRemaining > 0) entrySizeRemaining = sizeRemaining;
            } catch {}
          }

          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [tpBetId] });
            } catch {}
          }

          if (entryBetId && entrySizeRemaining > 0 && !(Number.isFinite(entrySizeMatched) && entrySizeMatched > 0)) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: posMarketId, betIds: [entryBetId] });
            } catch {}
          } else {
            const entryPrice = Number(existing?.entryPrice);
            const hedgeNow =
              Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(posBestLay) && posBestLay > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0
                ? Math.max(2, round2((entryPrice * entrySizeMatched) / posBestLay))
                : Math.max(2, round2(Number(existing?.stakeAbs ?? stakeAbs)));
            try {
              await placeOrders({
                adminToken: admin.adminToken,
                marketId: posMarketId,
                customerRef: mkCustomerRef("ix", matchId),
                instructions: [
                  {
                    selectionId: posSelectionId,
                    side: "LAY",
                    orderType: "LIMIT",
                    limitOrder: { size: hedgeNow, price: posBestLay, persistenceType: "LAPSE" },
                  },
                ],
              });
            } catch {}
          }

          const overEntryPrice = movePriceByTicks(overBack, Number.isFinite(entryOffsetTicks) ? Math.floor(entryOffsetTicks) : 0);
          const overTargetPrice = movePriceByTicks(overEntryPrice, -(Number.isFinite(targetTicks) ? Math.floor(targetTicks) : 10));
          if (Number.isFinite(overEntryPrice) && overEntryPrice > 1 && Number.isFinite(overTargetPrice) && overTargetPrice > 1) {
            const entryRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId: overMarketId,
              customerRef: mkCustomerRef("ie", matchId),
              instructions: [
                {
                  selectionId: overOverSel,
                  side: "BACK",
                  orderType: "LIMIT",
                  limitOrder: { size: stakeAbs, price: overEntryPrice, persistenceType: "LAPSE" },
                },
              ],
            });
            const newEntryBetId = (() => {
              const betId = (entryRes as any)?.instructionReports?.[0]?.betId ?? null;
              const s = String(betId ?? "").trim();
              return s || null;
            })();

            const hedgeSizeAtTarget =
              Number.isFinite(stakeAbs) && stakeAbs > 0 ? Math.max(2, round2((overEntryPrice * stakeAbs) / overTargetPrice)) : 2;
            const tpRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId: overMarketId,
              customerRef: mkCustomerRef("it", matchId),
              instructions: [
                {
                  selectionId: overOverSel,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSizeAtTarget, price: overTargetPrice, persistenceType: "LAPSE" },
                },
              ],
            }).catch(() => null);
            const newTpBetId = (() => {
              const betId = (tpRes as any)?.instructionReports?.[0]?.betId ?? null;
              const s = String(betId ?? "").trim();
              return s || null;
            })();

            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "scalpingTicks",
                scalpingTicks: {
                  ...baseState,
                  phase: "entered",
                  side: "over",
                  entryMarketId: overMarketId,
                  entryLineCode: overLineCode,
                  selectionId: overOverSel,
                  entryPrice: overEntryPrice,
                  targetPrice: overTargetPrice,
                  stakeAbs,
                  entryBetId: newEntryBetId,
                  takeProfit: { betId: newTpBetId, price: overTargetPrice, size: hedgeSizeAtTarget, placedAt: nowIso, result: tpRes ?? null },
                  lastInversionAt: nowIso,
                  inversionCount: Math.max(0, Math.floor(Number(existing?.inversionCount ?? 0) || 0)) + 1,
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, item: next, inverted: true, reason: "volume_shift_over_threshold" });
          }
        }

        if (tpBetId && (!lastTpCheckAtMs || !Number.isFinite(lastTpCheckAtMs) || nowMs - lastTpCheckAtMs > 4500)) {
          try {
            const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [tpBetId] });
            const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
            const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === tpBetId) ?? null;
            const sizeRemaining = Number(row?.sizeRemaining);
            const sizeMatched = Number(row?.sizeMatched);
            const status = String(row?.status ?? "").trim().toUpperCase();
            const isDone = status === "EXECUTION_COMPLETE" || (Number.isFinite(sizeRemaining) && sizeRemaining <= 0);
            const hasMatched = Number.isFinite(sizeMatched) && sizeMatched > 0;

            if (isDone && hasMatched) {
              const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "scalpingTicks",
                  scalpingTicks: {
                    ...baseState,
                    phase: "cooldown",
                    cycleCount: cycleCount + 1,
                    closedAt: nowIso,
                    lastClosedAt: nowIso,
                    cooldownUntilMs: nextCooldownUntilMs,
                    takeProfitMatchedAt: nowIso,
                    lastTpCheckAt: nowIso,
                    recoveryStakeAbs: null,
                    recoveryLevel: 0,
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, item: next, closed: true, reason: "tp_matched" });
            }
          } catch {}
        }

        const targetPrice = Number(existing?.targetPrice);
        const entryPrice = Number(existing?.entryPrice);
        const stake0 = Number(existing?.stakeAbs ?? stakeAbs);
        if (Number.isFinite(targetPrice) && Number.isFinite(bestLay) && bestLay > 1 && bestLay <= targetPrice) {
          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: [tpBetId] });
            } catch {}
          }
          const hedgeSize =
            Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(stake0) && stake0 > 0
              ? Math.max(2, round2((entryPrice * stake0) / bestLay))
              : Math.max(2, round2(stake0));
          const result = await placeOrders({
            adminToken: admin.adminToken,
            marketId,
            customerRef: mkCustomerRef("ex", matchId),
            instructions: [
              {
                selectionId,
                side: "LAY",
                orderType: "LIMIT",
                limitOrder: { size: hedgeSize, price: bestLay, persistenceType: "LAPSE" },
              },
            ],
          });
          const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: "cooldown",
                cycleCount: cycleCount + 1,
                closedAt: nowIso,
                lastClosedAt: nowIso,
                cooldownUntilMs: nextCooldownUntilMs,
                hedgeSize,
                lastResult: result ?? null,
                recoveryStakeAbs: null,
                recoveryLevel: 0,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true });
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "entered", lastTpCheckAt: tpBetId ? nowIso : existing?.lastTpCheckAt } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_target", item: next });
      }

      const next = {
        ...current,
        betfair: baseBetfair,
        strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
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

    if (matchPath(path, "/automation/betfair/strategy/asianHandicap/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const baseBetfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: false,
      });

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const stakePctRaw = Number(cfg?.stakePct ?? 1);
      const stakePct = Number.isFinite(stakePctRaw) ? Math.max(0, Math.min(100, stakePctRaw)) : 1;
      const targetTicksRaw = Number(cfg?.targetTicks ?? 10);
      const targetTicks = Number.isFinite(targetTicksRaw) ? Math.max(1, Math.min(50, Math.floor(targetTicksRaw))) : 10;
      const maxSpreadTicksRaw = Number(cfg?.maxSpreadTicks ?? 2);
      const maxSpreadTicks = Number.isFinite(maxSpreadTicksRaw) ? Math.max(0, Math.min(20, Math.floor(maxSpreadTicksRaw))) : 2;
      const minMarketMatchedRaw = Number(cfg?.minMarketMatched ?? 120000);
      const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? Math.max(0, Math.floor(minMarketMatchedRaw)) : 120000;
      const minRunnerMatchedRaw = Number(cfg?.minRunnerMatched ?? 20000);
      const minRunnerMatched = Number.isFinite(minRunnerMatchedRaw) ? Math.max(0, Math.floor(minRunnerMatchedRaw)) : 20000;
      const secondsToWaitMatchRaw = Number(cfg?.secondsToWaitMatch ?? 10);
      const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? Math.max(0, Math.min(3600, Math.floor(secondsToWaitMatchRaw))) : 10;
      const maxEntriesRaw = Number(cfg?.maxEntries ?? 3);
      const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.max(1, Math.min(20, Math.floor(maxEntriesRaw))) : 3;
      const entryMaxWaitSecondsRaw = Number(cfg?.entryMaxWaitSeconds ?? 15);
      const entryMaxWaitSeconds = Number.isFinite(entryMaxWaitSecondsRaw) ? Math.max(2, Math.min(120, Math.floor(entryMaxWaitSecondsRaw))) : 15;
      const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 0);
      const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? Math.max(0, Math.min(10, Math.floor(entryOffsetTicksRaw))) : 0;

      const baseStakeAbs =
        Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
          ? Math.max(2, round2((bankroll * stakePct) / 100))
          : 2;

      const inPlay = Boolean(baseBetfair?.inPlay ?? false);
      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const existing = (strategy as any)?.asianHandicap && typeof (strategy as any).asianHandicap === "object" ? (strategy as any).asianHandicap : {};
      const phase = String(existing?.phase ?? "").trim() || "monitoring";

      const cycleCount = Math.max(0, Math.floor(Number(existing?.cycleCount ?? 0) || 0));
      if (phase !== "entering" && phase !== "entered" && cycleCount >= maxEntries) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "stopped", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "max_entries", item: next });
      }

      if (!inPlay) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: phase || "monitoring", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_inplay", item: next });
      }

      const bodyLive = (body as any)?.live && typeof (body as any).live === "object" ? (body as any).live : null;
      const liveElapsedRaw =
        typeof (bodyLive as any)?.elapsed === "number" ? (bodyLive as any).elapsed
          : Number.isFinite(Number((bodyLive as any)?.elapsed)) ? Number((bodyLive as any)?.elapsed)
          : NaN;
      const baseTimelineElapsed = Number((baseBetfair as any)?.timeline?.elapsed);
      const marketStartIso = String(baseBetfair?.marketStartTime ?? (current as any)?.utcDate ?? "").trim();
      const marketStartMs = marketStartIso ? new Date(marketStartIso).getTime() : NaN;
      const elapsedSec =
        Number.isFinite(liveElapsedRaw) ? Math.max(0, Math.floor(liveElapsedRaw * 60))
          : Number.isFinite(baseTimelineElapsed) ? Math.max(0, Math.floor(baseTimelineElapsed * 60))
          : Number.isFinite(marketStartMs) ? Math.max(0, Math.floor((nowMs - marketStartMs) / 1000))
          : null;

      if (Number.isFinite(secondsToWaitMatch) && secondsToWaitMatch > 0) {
        if (!(typeof elapsedSec === "number" && Number.isFinite(elapsedSec) && elapsedSec >= secondsToWaitMatch)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, elapsedSec } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "waiting_seconds", item: next });
        }
      }

      const pred = (current as any)?.prediction && typeof (current as any).prediction === "object" ? (current as any).prediction : null;
      const predAh = pred?.asianHandicap && typeof pred.asianHandicap === "object" ? pred.asianHandicap : null;
      const predTeamRaw = String(predAh?.team ?? "").trim().toLowerCase();
      const predTeam = predTeamRaw === "away" ? "away" : predTeamRaw === "home" ? "home" : null;
      const predLine = normalizeAhLine(Number(predAh?.line));
      const predConf = Number(predAh?.confidence);
      if (!predTeam || predLine == null || !(Number.isFinite(predConf) && predConf >= 55)) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "asianHandicap",
            asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, skippedReason: "no_prediction" },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_prediction", item: next });
      }

      const eventId = String((current as any)?.betfair?.eventId ?? baseBetfair?.eventId ?? "").trim();
      if (!eventId) return json({ ok: false, error: "Betfair: eventId ausente" }, 500);

      const ahMarket = await resolveBetfairAsianHandicapMarket({
        eventId,
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
      }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

      const ahErr = (ahMarket as any)?.__error ? String((ahMarket as any).__error) : null;
      if (ahErr) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, error: ahErr } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "market_error", error: ahErr, item: next });
      }

      const marketId = String((ahMarket as any)?.marketId ?? "").trim();
      const marketStatus = String((ahMarket as any)?.marketStatus ?? "").trim().toUpperCase();
      const marketMatched = Number((ahMarket as any)?.matchedVolume);
      const runners = Array.isArray((ahMarket as any)?.runners) ? (ahMarket as any).runners : [];
      const teamCandidates = runners.filter((r: any) => String(r?.team ?? "") === predTeam && r?.handicap != null);
      const picked = teamCandidates
        .map((r: any) => {
          const h = Number(r?.handicap);
          const diff = Number.isFinite(h) ? Math.abs(h - predLine) : Number.POSITIVE_INFINITY;
          return { r, diff };
        })
        .sort((a: any, b: any) => a.diff - b.diff)[0]?.r ?? null;

      if (!marketId || !picked) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId: marketId || null } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "runner_not_found", item: next });
      }

      const selectionId = Number((picked as any)?.selectionId);
      const bestBack = Number((picked as any)?.back);
      const bestLay = Number((picked as any)?.lay);
      const runnerMatched = Number((picked as any)?.runnerMatched);
      const spreadTicks = Number.isFinite(bestBack) && Number.isFinite(bestLay) ? ticksBetweenPrices(bestBack, bestLay) : null;

      if (marketStatus && marketStatus !== "OPEN") {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "asianHandicap",
            asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, marketStatus },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "market_not_open", item: next });
      }

      if (Number.isFinite(minMarketMatched) && minMarketMatched > 0) {
        if (!(Number.isFinite(marketMatched) && marketMatched >= minMarketMatched)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, marketMatched } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "low_liquidity", item: next });
        }
      }

      if (Number.isFinite(minRunnerMatched) && minRunnerMatched > 0) {
        if (!(Number.isFinite(runnerMatched) && runnerMatched >= minRunnerMatched)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, runnerMatched } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "low_runner_liquidity", item: next });
        }
      }

      if (typeof spreadTicks === "number" && Number.isFinite(spreadTicks) && spreadTicks > maxSpreadTicks) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, spreadTicks } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "spread", item: next });
      }

      if (!(Number.isFinite(bestBack) && bestBack > 1 && Number.isFinite(selectionId))) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_price", item: next });
      }

      const cooldownUntilMs = Number(existing?.cooldownUntilMs);
      if (phase === "cooldown" && Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "cooldown", lastTickAt: nowIso, cycleCount, marketId } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown", item: next });
      }

      if (phase === "entering") {
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const entryPlacedAtIso = String(existing?.lastEntryAt ?? existing?.enteredAt ?? "").trim();
        const entryPlacedAtMs = entryPlacedAtIso ? new Date(entryPlacedAtIso).getTime() : 0;

        if (!entryBetId) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "entering_missing_betid", item: next });
        }

        let sizeMatched = 0;
        let sizeRemaining = 0;
        let avgPriceMatched = NaN;
        let status = "";
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          let row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
          if (!row && marketId) {
            try {
              const resByMarket = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
              const ordersByMarket = Array.isArray((resByMarket as any)?.currentOrders) ? (resByMarket as any).currentOrders : [];
              row = ordersByMarket.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
            } catch {}
          }
          sizeMatched = Number(row?.sizeMatched);
          sizeRemaining = Number(row?.sizeRemaining);
          avgPriceMatched = Number(row?.averagePriceMatched);
          status = String(row?.status ?? "").trim().toUpperCase();
        } catch {}

        const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
        const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;

        if (matchedSafe > 0) {
          if (remainingSafe > 0) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: [entryBetId] });
            } catch {}
          }

          const entryPriceMatched = Number.isFinite(avgPriceMatched) && avgPriceMatched > 1 ? avgPriceMatched : Number(existing?.entryPrice);
          const entryPriceSafe =
            Number.isFinite(entryPriceMatched) && entryPriceMatched > 1
              ? entryPriceMatched
              : bestBack;
          const targetPrice = movePriceByTicks(entryPriceSafe, -targetTicks);
          const hedgeSizeAtTarget =
            Number.isFinite(targetPrice) && targetPrice > 1 ? Math.max(2, round2((entryPriceSafe * matchedSafe) / targetPrice)) : null;

          let takeProfit = null as any;
          if (hedgeSizeAtTarget != null) {
            const tpRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId,
              customerRef: mkCustomerRef("at", matchId),
              instructions: [
                {
                  selectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSizeAtTarget, price: targetPrice, persistenceType: "LAPSE" },
                },
              ],
            }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
            const tpErr = (tpRes as any)?.__error ? String((tpRes as any).__error) : null;
            takeProfit = {
              betId: tpErr ? null : extractBetId(tpRes),
              price: targetPrice,
              size: hedgeSizeAtTarget,
              placedAt: nowIso,
              status: tpErr ? null : extractReportStatus(tpRes),
              errorCode: tpErr ? null : extractReportErrorCode(tpRes),
              result: tpErr ? null : tpRes ?? null,
              error: tpErr,
            };
          }

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "asianHandicap",
              asianHandicap: {
                ...existing,
                phase: "entered",
                team: predTeam,
                line: predLine,
                marketId,
                selectionId,
                entryPrice: entryPriceSafe,
                targetPrice,
                stakeAbs: matchedSafe,
                spreadTicks,
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
                entryBetId,
                entryMatchedSize: matchedSafe,
                entryRemainingSize: remainingSafe,
                entryMatchedAt: nowIso,
                takeProfit,
                lastTpPlaceAt: nowIso,
                lastTpPlaceError: (takeProfit as any)?.error ?? null,
                lastEntryStatus: status || null,
                cycleCount,
                lastTickAt: nowIso,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, entered: true, item: next, reason: "entry_matched" });
        }

        const currentBestBackForEntry = movePriceByTicks(bestBack, entryOffsetTicks);
        const driftTicks = (() => {
          const lastEntryPrice = Number(existing?.entryPrice);
          if (!(Number.isFinite(lastEntryPrice) && lastEntryPrice > 1)) return null;
          if (!(Number.isFinite(currentBestBackForEntry) && currentBestBackForEntry > 1)) return null;
          return ticksBetweenPrices(lastEntryPrice, currentBestBackForEntry);
        })();
        const driftTooHigh = typeof driftTicks === "number" && Number.isFinite(driftTicks) && driftTicks >= 20;
        const expired = entryPlacedAtMs && Number.isFinite(entryPlacedAtMs) && nowMs - entryPlacedAtMs >= entryMaxWaitSeconds * 1000;
        const shouldReprice = remainingSafe > 0 && (expired || driftTooHigh);
        if (shouldReprice) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: [entryBetId] });
          } catch {}

          const entryPrice = currentBestBackForEntry;
          const result = await placeOrders({
            adminToken: admin.adminToken,
            marketId,
            customerRef: mkCustomerRef("ar", matchId),
            instructions: [
              {
                selectionId,
                side: "BACK",
                orderType: "LIMIT",
                limitOrder: { size: baseStakeAbs, price: entryPrice, persistenceType: "LAPSE" },
              },
            ],
          });
          const newEntryBetId = extractBetId(result);

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "asianHandicap",
              asianHandicap: {
                ...existing,
                phase: "entering",
                team: predTeam,
                line: predLine,
                marketId,
                selectionId,
                entryPrice,
                stakeAbs: baseStakeAbs,
                spreadTicks,
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: nowIso,
                entryBetId: newEntryBetId,
                takeProfit: null,
                lastResult: result ?? null,
                lastEntryStatus: extractReportStatus(result),
                lastEntryErrorCode: extractReportErrorCode(result),
                cycleCount,
                lastTickAt: nowIso,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: driftTooHigh ? "reprice_entry_drift" : "reprice_entry_timeout", item: next });
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "entering", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_entry_fill", item: next });
      }

      if (phase === "entered") {
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const lastTpPlaceAtIso = String(existing?.lastTpPlaceAt ?? "").trim();
        const lastTpPlaceAtMs = lastTpPlaceAtIso ? new Date(lastTpPlaceAtIso).getTime() : 0;

        if (!tpBetId && (!lastTpPlaceAtMs || nowMs - lastTpPlaceAtMs >= 8_000)) {
          const entryPrice = Number(existing?.entryPrice);
          const entryMatchedSize = Number(existing?.entryMatchedSize);
          const entryPriceSafe = Number.isFinite(entryPrice) && entryPrice > 1 ? entryPrice : bestBack;
          const matchedSafe = Number.isFinite(entryMatchedSize) && entryMatchedSize > 0 ? entryMatchedSize : 0;
          const targetPrice = movePriceByTicks(entryPriceSafe, -targetTicks);
          const hedgeSizeAtTarget =
            Number.isFinite(targetPrice) && targetPrice > 1 && matchedSafe > 0 ? Math.max(2, round2((entryPriceSafe * matchedSafe) / targetPrice)) : null;
          if (hedgeSizeAtTarget != null) {
            const tpRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId,
              customerRef: mkCustomerRef("at", matchId),
              instructions: [
                {
                  selectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSizeAtTarget, price: targetPrice, persistenceType: "LAPSE" },
                },
              ],
            }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
            const tpErr = (tpRes as any)?.__error ? String((tpRes as any).__error) : null;
            const takeProfit = {
              betId: tpErr ? null : extractBetId(tpRes),
              price: targetPrice,
              size: hedgeSizeAtTarget,
              placedAt: nowIso,
              status: tpErr ? null : extractReportStatus(tpRes),
              errorCode: tpErr ? null : extractReportErrorCode(tpRes),
              result: tpErr ? null : tpRes ?? null,
              error: tpErr,
            };
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "asianHandicap",
                asianHandicap: {
                  ...existing,
                  takeProfit,
                  lastTpPlaceAt: nowIso,
                  lastTpPlaceError: (takeProfit as any)?.error ?? null,
                  lastTickAt: nowIso,
                  cycleCount,
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "tp_repair", item: next });
          }
        }

        if (tpBetId) {
          try {
            const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [tpBetId] });
            const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
            let row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === tpBetId) ?? null;
            if (!row && marketId) {
              try {
                const resByMarket = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
                const ordersByMarket = Array.isArray((resByMarket as any)?.currentOrders) ? (resByMarket as any).currentOrders : [];
                row = ordersByMarket.find((o: any) => String(o?.betId ?? "").trim() === tpBetId) ?? null;
              } catch {}
            }
            const sizeRemaining = Number(row?.sizeRemaining);
            const status = String(row?.status ?? "").trim().toUpperCase();
            const isDone = status === "EXECUTION_COMPLETE" || (Number.isFinite(sizeRemaining) && sizeRemaining <= 0);
            if (isDone) {
              const nextCooldownUntilMs = nowMs + 8_000;
              const nextPhase = cycleCount + 1 >= maxEntries ? "stopped" : "cooldown";
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "asianHandicap",
                  asianHandicap: {
                    ...existing,
                    phase: nextPhase,
                    cycleCount: cycleCount + 1,
                    closedAt: nowIso,
                    lastClosedAt: nowIso,
                    cooldownUntilMs: nextCooldownUntilMs,
                    lastTickAt: nowIso,
                    lastExitReason: "tp_filled",
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, closed: true, item: next, reason: "tp_filled" });
            }
          } catch {}
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "entered", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "holding", item: next });
      }

      if (phase === "cooldown") {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, phase: "monitoring", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown_done", item: next });
      }

      const entryPrice = movePriceByTicks(bestBack, entryOffsetTicks);
      const result = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: mkCustomerRef("ae", matchId),
        instructions: [
          {
            selectionId,
            side: "BACK",
            orderType: "LIMIT",
            limitOrder: { size: baseStakeAbs, price: entryPrice, persistenceType: "LAPSE" },
          },
        ],
      });
      const entryBetId = extractBetId(result);
      const entryStatus = extractReportStatus(result);
      const entryErrorCode = extractReportErrorCode(result);

      const next = {
        ...current,
        betfair: baseBetfair,
        strategy: {
          ...strategy,
          agent: "asianHandicap",
          asianHandicap: {
            ...existing,
            phase: "entering",
            cycleCount,
            team: predTeam,
            line: predLine,
            marketId,
            selectionId,
            entryPrice,
            stakeAbs: baseStakeAbs,
            spreadTicks,
            enteredAt: String(existing?.enteredAt ?? nowIso),
            lastEntryAt: nowIso,
            entryBetId,
            takeProfit: null,
            lastResult: result ?? null,
            lastEntryStatus: entryStatus,
            lastEntryErrorCode: entryErrorCode,
            lastTickAt: nowIso,
          },
        },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, placed: true, item: next, result });
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

      const planCfg = (body as any)?.planConfig && typeof (body as any).planConfig === "object" ? (body as any).planConfig : {};
      const maxSelRaw = Number(planCfg?.maxSelections ?? 4);
      const maxSelections = Number.isFinite(maxSelRaw) ? Math.max(1, Math.min(20, Math.floor(maxSelRaw))) : 4;
      const entryScoresCsv = String(planCfg?.entryScoresCsv ?? "0-0,0-1,1-0,1-1").trim();
      const minMarketMatchedRaw = Number((planCfg as any)?.minMarketMatched ?? 1000);
      const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? Math.max(0, Math.floor(minMarketMatchedRaw)) : 1000;

      const marketMatched = Number((betfair as any)?.correctScore?.matchedVolume);
      if (Number.isFinite(minMarketMatched) && minMarketMatched > 0) {
        if (!(Number.isFinite(marketMatched) && marketMatched >= minMarketMatched)) {
          const next = { ...current, betfair, updatedAt: new Date().toISOString() };
          await setQueueItem(matchId, next);
          return json({
            ok: true,
            skipped: true,
            reason: "market_matched_low",
            adoptedExisting: false,
            item: next,
            meta: { marketMatched: Number.isFinite(marketMatched) ? marketMatched : null, minMarketMatched },
          });
        }
      }

      const bodyLive = (body as any)?.live && typeof (body as any).live === "object" ? (body as any).live : null;
      const liveScoreHomeRaw =
        typeof (bodyLive as any)?.scoreHome === "number" ? (bodyLive as any).scoreHome
          : Number.isFinite(Number((bodyLive as any)?.scoreHome)) ? Number((bodyLive as any)?.scoreHome)
          : NaN;
      const liveScoreAwayRaw =
        typeof (bodyLive as any)?.scoreAway === "number" ? (bodyLive as any).scoreAway
          : Number.isFinite(Number((bodyLive as any)?.scoreAway)) ? Number((bodyLive as any)?.scoreAway)
          : NaN;
      const liveScoreHome = Number.isFinite(liveScoreHomeRaw) ? Math.max(0, Math.floor(liveScoreHomeRaw)) : null;
      const liveScoreAway = Number.isFinite(liveScoreAwayRaw) ? Math.max(0, Math.floor(liveScoreAwayRaw)) : null;

      const queueScoreHome = typeof (current as any)?.scoreHome === "number" ? (current as any).scoreHome : Number((current as any)?.scoreHome);
      const queueScoreAway = typeof (current as any)?.scoreAway === "number" ? (current as any).scoreAway : Number((current as any)?.scoreAway);
      const timelineScoreHome = Number((betfair as any)?.timeline?.scoreHome);
      const timelineScoreAway = Number((betfair as any)?.timeline?.scoreAway);
      const baseHome =
        typeof liveScoreHome === "number" ? liveScoreHome
          : Number.isFinite(queueScoreHome) ? Math.max(0, Math.floor(queueScoreHome))
          : Number.isFinite(timelineScoreHome) ? Math.max(0, Math.floor(timelineScoreHome))
          : 0;
      const baseAway =
        typeof liveScoreAway === "number" ? liveScoreAway
          : Number.isFinite(queueScoreAway) ? Math.max(0, Math.floor(queueScoreAway))
          : Number.isFinite(timelineScoreAway) ? Math.max(0, Math.floor(timelineScoreAway))
          : 0;

      const picked = (() => {
        const fromCsv = parseScoresCsv(entryScoresCsv);
        if (fromCsv.length > 0) return fromCsv.slice(0, maxSelections);
        const base = [
          { key: `${baseHome}-${baseAway}`, home: baseHome, away: baseAway },
          { key: `${baseHome}-${baseAway + 1}`, home: baseHome, away: baseAway + 1 },
          { key: `${baseHome + 1}-${baseAway}`, home: baseHome + 1, away: baseAway },
          { key: `${baseHome + 1}-${baseAway + 1}`, home: baseHome + 1, away: baseAway + 1 },
        ];
        return base.slice(0, maxSelections);
      })();

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
            lastExecution: {
              selections: stakes,
              bankroll: bankrollAbs,
              baseScore: { home: baseHome, away: baseAway },
              entryScoresCsv,
              planType: "coverage",
            },
          },
        },
        updatedAt: nowIso,
      };

      await setQueueItem(matchId, next);
      return json({ ok: true, adoptedExisting: false, item: next, result });
    }

    if (matchPath(path, "/automation/betfair/strategy/correctScore/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const bankrollAbs = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 50;
      const profitTargetPctRaw = Number(cfg?.profitTargetPct ?? 0.03);
      const profitTargetPct = Number.isFinite(profitTargetPctRaw) ? Math.max(0, Math.min(0.5, profitTargetPctRaw)) : 0.03;
      const profitTargetAbs = round2(bankrollAbs * profitTargetPct);

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });

      const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
      const nowIso = new Date().toISOString();

      if (!marketId) {
        const next = { ...current, betfair, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "correct_score_not_ready", item: next });
      }

      const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];

      const openOrders = currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0);
      const matchedOrders = currentOrders.filter((o: any) => Number(o?.sizeMatched) > 0);

      let lockedProfitAbs = 0;
      for (const o of matchedOrders) {
        const sizeMatched = Number((o as any)?.sizeMatched);
        const avgPriceMatched = Number((o as any)?.averagePriceMatched);
        const selectionId = Number((o as any)?.selectionId);
        const layPrice = getLayPriceForSelectionFromCorrectScore(betfair, selectionId);
        if (!(Number.isFinite(sizeMatched) && sizeMatched > 0)) continue;
        if (!(Number.isFinite(avgPriceMatched) && avgPriceMatched > 1)) continue;
        if (!(layPrice != null && layPrice > 1)) continue;
        lockedProfitAbs += (avgPriceMatched / layPrice - 1) * sizeMatched;
      }
      lockedProfitAbs = round2(lockedProfitAbs);

      const shouldClose = matchedOrders.length > 0 && lockedProfitAbs >= profitTargetAbs;

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const csState = (strategy as any)?.correctScore && typeof (strategy as any).correctScore === "object" ? (strategy as any).correctScore : {};

      if (!shouldClose) {
        const next = {
          ...current,
          betfair,
          strategy: {
            ...strategy,
            agent: "correctScore",
            correctScore: {
              ...csState,
              lastTickAt: nowIso,
              profitTargetPct,
              profitTargetAbs,
              lockedProfitAbs,
              openOrdersCount: openOrders.length,
              matchedBetsCount: matchedOrders.length,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "profit_not_reached", item: next });
      }

      const openBetIds = uniqStrings(openOrders.map((o: any) => o?.betId));
      if (openBetIds.length > 0) {
        try {
          await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: openBetIds });
        } catch {}
      }

      let hedgedCount = 0;
      for (const o of matchedOrders) {
        const sizeMatched = Number((o as any)?.sizeMatched);
        const avgPriceMatched = Number((o as any)?.averagePriceMatched);
        const selectionId = Number((o as any)?.selectionId);
        const layPrice = getLayPriceForSelectionFromCorrectScore(betfair, selectionId);
        if (!(Number.isFinite(sizeMatched) && sizeMatched > 0)) continue;
        if (!(Number.isFinite(avgPriceMatched) && avgPriceMatched > 1)) continue;
        if (!(Number.isFinite(selectionId) && selectionId > 0)) continue;
        if (!(layPrice != null && layPrice > 1)) continue;
        const hedgeSize = Math.max(2, round2((avgPriceMatched * sizeMatched) / layPrice));
        try {
          await placeOrders({
            adminToken: admin.adminToken,
            marketId,
            customerRef: `cs-auto-exit-${matchId}-${Date.now()}`,
            instructions: [
              {
                selectionId,
                side: "LAY",
                orderType: "LIMIT",
                limitOrder: { size: hedgeSize, price: layPrice, persistenceType: "LAPSE" },
              },
            ],
          });
          hedgedCount += 1;
        } catch {}
      }

      const next = {
        ...current,
        betfair,
        status: "paused",
        strategy: {
          ...strategy,
          agent: "correctScore",
          correctScore: {
            ...csState,
            phase: "closed",
            closedAt: nowIso,
            lastTickAt: nowIso,
            profitTargetPct,
            profitTargetAbs,
            lockedProfitAbs,
            cancelledOpenOrders: openBetIds.length,
            hedgedCount,
          },
        },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, closed: true, item: next, hedgedCount, lockedProfitAbs, profitTargetAbs });
    }

    if (matchPath(path, "/automation/betfair/strategy/correctScore/rebalance")) {
      return json({ ok: true, skipped: true, reason: "not_implemented" });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/tradePreview")) {
      return json({ ok: true, skipped: true, reason: "not_implemented", risk: null, cashOut: null, profit: null, fetchedAt: new Date().toISOString() });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/openOrdersSummary")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);
      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });
      const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
      if (!marketId) return json({ ok: true, openOrdersCount: 0, matchedBetsCount: 0, agent: "correctScore", marketIds: [] });
      const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
      const openOrdersCount = currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).length;
      const matchedBetsCount = currentOrders.filter((o: any) => Number(o?.sizeMatched) > 0).length;
      return json({ ok: true, openOrdersCount, matchedBetsCount, agent: "correctScore", marketIds: [marketId] });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cancelOpenOrders")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);
      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });
      const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
      if (!marketId) return json({ ok: true, skipped: true, reason: "correct_score_not_ready" });
      const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
      const openBetIds = uniqStrings(currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).map((o: any) => o?.betId));
      if (openBetIds.length > 0) {
        try {
          await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: openBetIds });
        } catch {}
      }
      return json({ ok: true, cancelled: openBetIds.length });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/cashout")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);
      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });
      const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
      if (!marketId) return json({ ok: true, skipped: true, reason: "correct_score_not_ready" });

      const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
      const openBetIds = uniqStrings(currentOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).map((o: any) => o?.betId));
      if (openBetIds.length > 0) {
        try {
          await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: openBetIds });
        } catch {}
      }

      let hedgedCount = 0;
      for (const o of currentOrders) {
        const sizeMatched = Number((o as any)?.sizeMatched);
        if (!(Number.isFinite(sizeMatched) && sizeMatched > 0)) continue;
        const selectionId = Number((o as any)?.selectionId);
        const avgPriceMatched = Number((o as any)?.averagePriceMatched);
        const layPrice = getLayPriceForSelectionFromCorrectScore(betfair, selectionId);
        if (!(Number.isFinite(selectionId) && selectionId > 0)) continue;
        if (!(Number.isFinite(avgPriceMatched) && avgPriceMatched > 1)) continue;
        if (!(layPrice != null && layPrice > 1)) continue;
        const hedgeSize = Math.max(2, round2((avgPriceMatched * sizeMatched) / layPrice));
        try {
          await placeOrders({
            adminToken: admin.adminToken,
            marketId,
            customerRef: `cs-cashout-${matchId}-${Date.now()}`,
            instructions: [
              {
                selectionId,
                side: "LAY",
                orderType: "LIMIT",
                limitOrder: { size: hedgeSize, price: layPrice, persistenceType: "LAPSE" },
              },
            ],
          });
          hedgedCount += 1;
        } catch {}
      }

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const nowIso = new Date().toISOString();
      const next = {
        ...current,
        betfair,
        strategy: { ...strategy, agent: "correctScore", correctScore: { ...((strategy as any)?.correctScore ?? {}), lastCashoutAt: nowIso } },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, hedgedCount, item: next });
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
