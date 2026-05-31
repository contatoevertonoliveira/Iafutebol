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
const LIVE_SNAPSHOT_KEY = "betfair/live_snapshot_v1";
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
const getSupabaseServiceRoleKey = () => String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
const getSupabaseInternalKey = () => getSupabaseServiceRoleKey() || getSupabaseAnonKey();

const resolveBetfairMatchOdds = async (params: { homeTeam: string; awayTeam: string; utcDate: string | null; includeCorrectScore?: boolean }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const key = getSupabaseInternalKey();
  if (!key) throw new Error("SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ausente");

  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-server-1119702f/betfair/match/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  // Se lineCode é 0.5, retorna OVER_UNDER_05 sem arredondar pra 0
  if (Number.isFinite(Number(lineCode)) && Number(lineCode) === 0.5) return "OVER_UNDER_05";
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

const betfairRpc = async (params: { method: string; params: any; adminToken: string }) => {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) throw new Error("SUPABASE_URL ausente");
  const key = getSupabaseInternalKey();
  if (!key) throw new Error("SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ausente");
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      adminToken: params.adminToken,
      method: params.method,
      params: params.params ?? {},
    }),
  });
  const raw = await res.text().catch(() => "");
  const data = raw ? JSON.parse(raw) : null;
  if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
  return data?.result ?? null;
};

const resolveBetfairOverUnderMarket = async (params: { eventId: string; lineCode: number; adminToken: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  const marketType = ouMarketTypeCode(params.lineCode);
  if (!eventId) throw new Error("Betfair: eventId ausente (Over/Under)");
  if (!marketType) throw new Error("Betfair: linha inválida (Over/Under)");

  const cats = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketCatalogue",
    adminToken: params.adminToken,
    params: {
      filter: { eventIds: [eventId], marketTypeCodes: [marketType] },
      maxResults: 10,
      sort: "MAXIMUM_TRADED",
      marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
    },
  });
  if (!Array.isArray(cats) || cats.length === 0) {
    throw new Error(`Betfair: marketId (Over/Under) não encontrado - type=${marketType} eventId=${eventId} cats=${JSON.stringify(cats)}`);
  }
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
    adminToken: params.adminToken,
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

// Resolve o mercado Both Teams to Score (BOTH_TEAMS_TO_SCORE) na Betfair
// Retorna: { marketId, runners: { yesSelectionId, noSelectionId }, odds: { yes: {back,lay,...}, no: {back,lay,...} }, inPlay, marketStatus }
const resolveBetfairBttsMarket = async (params: { eventId: string; adminToken: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId ausente (BTTS)");

  const cats = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketCatalogue",
    adminToken: params.adminToken,
    params: {
      filter: { eventIds: [eventId], marketTypeCodes: ["BOTH_TEAMS_TO_SCORE"] },
      maxResults: 10,
      sort: "MAXIMUM_TRADED",
      marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
    },
  });
  const mk = Array.isArray(cats) ? cats[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (BTTS) não encontrado");

  const runners = Array.isArray(mk?.runners) ? mk.runners : [];
  const selectionByRole: Record<string, number> = {};
  for (const r of runners) {
    const selectionId = Number(r?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const name = String(r?.runnerName ?? "").toLowerCase().trim();
    if (name.includes("yes") || name.includes("sim")) {
      if (selectionByRole.yes == null) selectionByRole.yes = selectionId;
    } else if (name.includes("no") || name.includes("não") || name.includes("nao")) {
      if (selectionByRole.no == null) selectionByRole.no = selectionId;
    } else {
      // Fallback: primeiro runner é YES, segundo é NO
      if (selectionByRole.yes == null) selectionByRole.yes = selectionId;
      else if (selectionByRole.no == null) selectionByRole.no = selectionId;
    }
  }

  const books = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketBook",
    adminToken: params.adminToken,
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

  const pull = (selectionId: number) => {
    const rb = Array.isArray(book?.runners) ? book.runners.find((x: any) => Number(x?.selectionId) === selectionId) : null;
    if (!rb) return null;
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const ltp = Number(rb?.lastPriceTraded);
    return {
      back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
      laySize: lay0 ? Number(lay0.size) : null,
      selectionId,
      runnerMatched: Number(rb?.totalMatched),
    };
  };

  const odds: any = {};
  if (Number.isFinite(selectionByRole.yes)) odds.yes = pull(selectionByRole.yes);
  if (Number.isFinite(selectionByRole.no)) odds.no = pull(selectionByRole.no);

  return {
    eventId,
    marketId,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    inPlay,
    marketStatus,
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    runners: {
      yesSelectionId: Number.isFinite(selectionByRole.yes) ? selectionByRole.yes : null,
      noSelectionId: Number.isFinite(selectionByRole.no) ? selectionByRole.no : null,
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

const resolveBetfairAsianHandicapMarket = async (params: { eventId: string; homeTeam: string; awayTeam: string; adminToken: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  const homeTeam = String(params.homeTeam ?? "").trim();
  const awayTeam = String(params.awayTeam ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId ausente (Asian Handicap)");
  if (!homeTeam || !awayTeam) throw new Error("Betfair: times ausentes (Asian Handicap)");

  const cats = await betfairRpc({
    method: "SportsAPING/v1.0/listMarketCatalogue",
    adminToken: params.adminToken,
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
    adminToken: params.adminToken,
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
  const key = getSupabaseInternalKey();
  if (!key) throw new Error("SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ausente");
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/placeOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  const key = getSupabaseInternalKey();
  if (!key) throw new Error("SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ausente");
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/listCurrentOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
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
  const key = getSupabaseInternalKey();
  if (!key) throw new Error("SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY ausente");
  const res = await fetch(`${supabaseUrl}/functions/v1/betfair-core-server-1119702f/betfair/cancelOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
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
      const rows = await kv.listByPrefix(BETFAIR_QUEUE_PREFIX, { offset: 0, limit: 500 });
      const arr = Array.isArray(rows) ? rows : [];
      const today = dayKeySp(new Date());
      const nowMs = Date.now();

      let cleaned = 0;
      const filtered: any[] = [];
      const keysToDelete: string[] = [];
      for (const row of arr) {
        const keyRow = row && typeof row === "object" ? String((row as any)?.key ?? "").trim() : "";
        const it = row && typeof row === "object" ? (row as any)?.value : null;
        if (!it || typeof it !== "object") continue;

        const matchId = String((it as any)?.matchId ?? "").trim();
        const matchIdOk = Boolean(matchId && /^\d+$/.test(matchId));
        const homeTeam = String((it as any)?.homeTeam ?? "").trim();
        const awayTeam = String((it as any)?.awayTeam ?? "").trim();
        const isEmptyCard = !homeTeam || !awayTeam;

        const utcDate =
          parseUtcDate((it as any)?.utcDate) ||
          parseUtcDate((it as any)?.betfair?.marketStartTime) ||
          parseUtcDate((it as any)?.updatedAt) ||
          parseUtcDate((it as any)?.createdAt) ||
          null;
        const dayKey = utcDate ? dayKeySp(utcDate) : null;
        const isStale = Boolean(dayKey && dayKey < today);

        const ageBase = parseUtcDate((it as any)?.updatedAt) || parseUtcDate((it as any)?.createdAt) || utcDate;
        const ageMs = ageBase ? nowMs - ageBase.getTime() : null;
        const status = String((it as any)?.status ?? "").trim().toLowerCase();
        const mappingStatus = String((it as any)?.mappingStatus ?? "").trim().toLowerCase();
        const isOldUnmapped =
          (mappingStatus === "pending" || mappingStatus === "unmapped") &&
          typeof ageMs === "number" &&
          Number.isFinite(ageMs) &&
          ageMs > 36 * 60 * 60 * 1000;
        const isOldStopped =
          (status === "stopped" || status === "paused") &&
          typeof ageMs === "number" &&
          Number.isFinite(ageMs) &&
          ageMs > 24 * 60 * 60 * 1000;

        const shouldDelete = !matchIdOk || isEmptyCard || isStale || isOldUnmapped || isOldStopped;
        if (shouldDelete) {
          if (keyRow) keysToDelete.push(keyRow);
          continue;
        }

        filtered.push(it);
      }

      if (keysToDelete.length > 0) {
        try {
          await kv.mdel(keysToDelete);
          cleaned += keysToDelete.length;
        } catch {
          for (const k of keysToDelete) {
            try {
              await kv.del(k);
              cleaned += 1;
            } catch {}
          }
        }
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
        const rawFixtureId = (body as any)?.fixtureId ?? (existing as any)?.fixtureId ?? null;
        const fixtureIdNum = Number(rawFixtureId);
        const fixtureId =
          Number.isFinite(fixtureIdNum) && fixtureIdNum > 0 ? Math.floor(fixtureIdNum) : null;
        const payload: any = {
          matchId,
          fixtureId,
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
            const includeCorrectScore = Boolean((body as any)?.includeCorrectScore ?? true);
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

    if (method === "POST" && matchPath(path, "/automation/live/snapshot/upsert")) {
      try {
        const body = await parseJson(req);
        const admin = requireAdminToken(body);
        if (!admin.ok) return json(admin, 401);

        const rawItems = (body as any)?.items && typeof (body as any).items === "object" ? (body as any).items : {};
        const incomingEntries = Object.entries(rawItems)
          .map(([k, v]) => [String(k ?? "").trim(), v] as const)
          .filter(([k, v]) => Boolean(k) && v && typeof v === "object");
        if (incomingEntries.length === 0) {
          return json({ ok: true, updated: 0, skipped: 0 });
        }

        const nowIso = new Date().toISOString();
        const stored = (await kv.get(LIVE_SNAPSHOT_KEY)) ?? null;
        const prevItems = stored && typeof stored === "object" && (stored as any).version === 1 && (stored as any).items && typeof (stored as any).items === "object"
          ? (stored as any).items
          : {};

        const nextItems: Record<string, any> = { ...prevItems };
        let updated = 0;
        let skipped = 0;
        for (const [matchId, v] of incomingEntries) {
          const prev = nextItems[matchId] ?? null;
          const prevAt = String(prev?.updatedAt ?? prev?.fetchedAt ?? "").trim();
          const incomingAt = String((v as any)?.updatedAt ?? (v as any)?.fetchedAt ?? "").trim();
          const prevMs = prevAt ? new Date(prevAt).getTime() : 0;
          const incMs = incomingAt ? new Date(incomingAt).getTime() : 0;
          if (prevMs && incMs && Number.isFinite(prevMs) && Number.isFinite(incMs) && incMs < prevMs) {
            skipped += 1;
            continue;
          }
          nextItems[matchId] = { ...(prev && typeof prev === "object" ? prev : {}), ...(v as any), updatedAt: incomingAt || nowIso };
          updated += 1;
        }

        const pruned = Object.entries(nextItems)
          .map(([k, v]) => [String(k ?? "").trim(), v] as const)
          .filter(([k, v]) => Boolean(k) && v && typeof v === "object")
          .sort((a, b) => String((b[1] as any)?.updatedAt ?? "").localeCompare(String((a[1] as any)?.updatedAt ?? "")))
          .slice(0, 2000);

        const snapshot = { version: 1 as const, updatedAt: nowIso, items: Object.fromEntries(pruned) };
        await kv.set(LIVE_SNAPSHOT_KEY, snapshot);
        return json({ ok: true, updated, skipped, total: pruned.length, updatedAt: nowIso });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: message || "Erro ao salvar snapshot" }, 500);
      }
    }

    if (method === "POST" && matchPath(path, "/automation/live/snapshot/get")) {
      try {
        const body = await parseJson(req);
        const admin = requireAdminToken(body);
        if (!admin.ok) return json(admin, 401);

        const raw = (await kv.get(LIVE_SNAPSHOT_KEY)) ?? null;
        const stored = raw && typeof raw === "object" && (raw as any).version === 1 && (raw as any).items && typeof (raw as any).items === "object"
          ? (raw as any)
          : { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };

        const matchIdsRaw = Array.isArray((body as any)?.matchIds) ? (body as any).matchIds : null;
        const matchIds = matchIdsRaw
          ? matchIdsRaw.map((x: any) => String(x ?? "").trim()).filter(Boolean).slice(0, 120)
          : null;

        if (!matchIds || matchIds.length === 0) {
          return json({ ok: true, snapshot: stored });
        }

        const out: Record<string, any> = {};
        for (const id of matchIds) {
          const v = (stored.items as any)[id];
          if (v && typeof v === "object") out[id] = v;
        }
        return json({ ok: true, snapshot: { version: 1 as const, updatedAt: stored.updatedAt, items: out } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: message || "Erro ao carregar snapshot" }, 500);
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
            const ou = await resolveBetfairOverUnderMarket({ eventId, lineCode: entryLineCode, adminToken: admin.adminToken });
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

    if (matchPath(path, "/automation/betfair/strategy/overGoalsLimit/tick")) {
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
      const existing = (strategy as any)?.overGoalsLimit && typeof (strategy as any).overGoalsLimit === "object" ? (strategy as any).overGoalsLimit : {};

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const stakePctRaw = Number(cfg?.stakePct ?? 1);
      const stakePct = Number.isFinite(stakePctRaw) ? Math.max(0, Math.min(100, stakePctRaw)) : 1;
      const stakeAbsCfgRaw = Number(cfg?.stakeAbs);
      const stakeAbsCfg = Number.isFinite(stakeAbsCfgRaw) ? round2(stakeAbsCfgRaw) : NaN;
      const stakeAbs =
        Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0
          ? Math.max(2, stakeAbsCfg)
          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
            ? Math.max(2, round2((bankroll * stakePct) / 100))
            : 2;
      const minOddsRaw = Number(cfg?.minOdds ?? 1.2);
      const minOdds = Number.isFinite(minOddsRaw) ? Math.max(1.01, Math.min(1000, minOddsRaw)) : 1.2;
      const maxEntriesRaw = Number(cfg?.maxEntries ?? 3);
      const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.max(1, Math.min(50, Math.floor(maxEntriesRaw))) : 3;
      const profitTargetPctRaw = Number(cfg?.profitTargetPct ?? 5);
      const profitTargetPct = Number.isFinite(profitTargetPctRaw) ? Math.max(0.25, Math.min(50, profitTargetPctRaw)) : 5;
      const minDeltaTradedRaw = Number(cfg?.minDeltaTraded);
      const minDeltaTraded = Number.isFinite(minDeltaTradedRaw) ? Math.max(0, Math.floor(minDeltaTradedRaw)) : null;
      const dominanceRatioRaw = Number(cfg?.dominanceRatio);
      const dominanceRatio = Number.isFinite(dominanceRatioRaw) ? Math.max(0, Math.min(1.5, dominanceRatioRaw)) : null;
      const minSecondsBetweenEntriesRaw = Number(cfg?.minSecondsBetweenEntries ?? 30);
      const minSecondsBetweenEntries = Number.isFinite(minSecondsBetweenEntriesRaw)
        ? Math.max(0, Math.min(3600, Math.floor(minSecondsBetweenEntriesRaw)))
        : 30;
      const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 0);
      const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? Math.max(0, Math.min(10, Math.floor(entryOffsetTicksRaw))) : 0;
      const secondsToWaitMatchRaw = Number(cfg?.secondsToWaitMatch ?? 10);
      const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? Math.max(0, Math.min(3600, Math.floor(secondsToWaitMatchRaw))) : 10;

      const momentOverThresholdRaw = Number(cfg?.momentOverThreshold ?? 0.7);
      const momentOverThreshold = Number.isFinite(momentOverThresholdRaw) ? Math.max(0.1, Math.min(2, momentOverThresholdRaw)) : 0.7;
      const momentOverThresholdLateRaw = Number(cfg?.momentOverThresholdLate ?? 0.85);
      const momentOverThresholdLate = Number.isFinite(momentOverThresholdLateRaw) ? Math.max(0.1, Math.min(2, momentOverThresholdLateRaw)) : 0.85;
      const momentOverThresholdOffDeltaRaw = Number(cfg?.momentOverThresholdOffDelta ?? 0.15);
      const momentOverThresholdOffDelta = Number.isFinite(momentOverThresholdOffDeltaRaw) ? Math.max(0, Math.min(1, momentOverThresholdOffDeltaRaw)) : 0.15;
      const momentWindowMinSecRaw = Number(cfg?.momentWindowMinSec ?? 8);
      const momentWindowMaxSecRaw = Number(cfg?.momentWindowMaxSec ?? 180);
      const momentWindowMinSec = Number.isFinite(momentWindowMinSecRaw) ? Math.max(1, Math.min(300, Math.floor(momentWindowMinSecRaw))) : 8;
      const momentWindowMaxSecCandidate = Number.isFinite(momentWindowMaxSecRaw) ? Math.max(2, Math.min(600, Math.floor(momentWindowMaxSecRaw))) : 180;
      const momentWindowMaxSec = Math.max(momentWindowMinSec + 1, momentWindowMaxSecCandidate);

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const entryLockTtlSecondsRaw = Number((cfg as any)?.entryLockTtlSeconds ?? 180);
      const entryLockTtlSeconds = Number.isFinite(entryLockTtlSecondsRaw) ? Math.max(5, Math.min(3600, Math.floor(entryLockTtlSecondsRaw))) : 180;
      const entryLockPendingTtlSecondsRaw = Number((cfg as any)?.entryLockPendingTtlSeconds ?? 25);
      const entryLockPendingTtlSeconds = Number.isFinite(entryLockPendingTtlSecondsRaw)
        ? Math.max(4, Math.min(300, Math.floor(entryLockPendingTtlSecondsRaw)))
        : 25;
      const lockKeyFor = (marketId: string, selectionId: number) => {
        const mid = String(marketId ?? "").trim();
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? Math.floor(selectionId) : 0;
        return `${mid}:${sid}:BACK`;
      };
      const readEntryLocks = () => {
        const merged: Record<string, any> = {};
        const add = (raw: any) => {
          if (!raw || typeof raw !== "object") return;
          for (const [k, v] of Object.entries(raw)) {
            const key = String(k ?? "").trim();
            if (!key) continue;
            if (!v || typeof v !== "object") continue;
            merged[key] = v;
          }
        };
        add((strategy as any)?.entryLocks);
        add((existing as any)?.entryLocks);
        for (const k of Object.keys(strategy)) {
          const sub = (strategy as any)[k];
          if (!sub || typeof sub !== "object") continue;
          if (sub?.entryLocks && typeof sub.entryLocks === "object") add(sub.entryLocks);
        }
        return merged;
      };
      const pruneEntryLocks = (locks: any) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(locks ?? {})) {
          if (!k) continue;
          if (!v || typeof v !== "object") continue;
          const exp = Number((v as any)?.expiresAtMs);
          if (Number.isFinite(exp) && exp > nowMs) out[k] = v;
        }
        return out;
      };
      const entryLocksPruned = pruneEntryLocks(readEntryLocks());
      const isEntryLocked = (locks: any, key: string) => {
        const v = locks && typeof locks === "object" ? (locks as any)[key] : null;
        const exp = Number(v?.expiresAtMs);
        return Boolean(v && Number.isFinite(exp) && exp > nowMs);
      };
      const setEntryLock = (locks: any, key: string, value: any) => {
        const base = locks && typeof locks === "object" ? locks : {};
        return { ...base, [key]: value };
      };
      const clearEntryLock = (locks: any, key: string) => {
        const base = locks && typeof locks === "object" ? locks : {};
        const { [key]: _, ...rest } = base as any;
        return rest;
      };
      const mkStableCustomerRef = (action: string, matchId: string, marketId: string, selectionId: number) => {
        const a = String(action ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "x";
        const id = String(matchId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const tail = id.slice(-8) || "0";
        const mid = String(marketId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const midTail = mid.slice(-6) || "m";
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? String(Math.floor(selectionId)).slice(-4) : "0";
        const bucket = Math.floor(Date.now() / 4000).toString(36);
        let ref = `st-${a}-${tail}-${midTail}${sid}-${bucket}`;
        if (ref.length > 32) ref = ref.slice(0, 32);
        return ref;
      };

      const inPlay = Boolean(baseBetfair?.inPlay ?? false);
      if (!inPlay) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...existing, phase: String(existing?.phase ?? "").trim() || "monitoring", lastTickAt: nowIso } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_inplay", item: next });
      }

      const phase = String(existing?.phase ?? "").trim() || "monitoring";
      const entryCount = Math.max(0, Math.floor(Number(existing?.entryCount ?? 0) || 0));
      const lastEntryAtMs = (() => {
        const s = String(existing?.lastEntryAt ?? "").trim();
        return s ? new Date(s).getTime() : 0;
      })();
      const cooldownUntilMs = Number(existing?.cooldownUntilMs);
      if ((phase !== "entering" && phase !== "entered") && entryCount >= maxEntries) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...existing, phase: "stopped", lastTickAt: nowIso, entryCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "max_entries", item: next });
      }

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
        Number.isFinite(queueScoreHome) ? Math.max(0, Math.floor(queueScoreHome))
          : Number.isFinite(baseTimelineScoreHome) ? Math.max(0, Math.floor(baseTimelineScoreHome))
          : null;
      const scoreAwayBase =
        Number.isFinite(queueScoreAway) ? Math.max(0, Math.floor(queueScoreAway))
          : Number.isFinite(baseTimelineScoreAway) ? Math.max(0, Math.floor(baseTimelineScoreAway))
          : null;
      const scoreHome = typeof scoreHomeBase === "number" && typeof prevHome === "number" ? Math.max(scoreHomeBase, prevHome) : scoreHomeBase;
      const scoreAway = typeof scoreAwayBase === "number" && typeof prevAway === "number" ? Math.max(scoreAwayBase, prevAway) : scoreAwayBase;
      const goals = typeof scoreHome === "number" && typeof scoreAway === "number" ? scoreHome + scoreAway : null;

      const timelineElapsed = Number((baseBetfair as any)?.timeline?.elapsed);
      const marketStartIso = String(baseBetfair?.marketStartTime ?? (current as any)?.utcDate ?? "").trim();
      const marketStartMs = marketStartIso ? new Date(marketStartIso).getTime() : NaN;
      const elapsedSec =
        Number.isFinite(timelineElapsed) ? Math.max(0, Math.floor(timelineElapsed * 60))
          : Number.isFinite(marketStartMs) ? Math.max(0, Math.floor((nowMs - marketStartMs) / 1000))
          : null;
      const elapsedMin = typeof elapsedSec === "number" ? elapsedSec / 60 : null;
      const lateMode = typeof elapsedMin === "number" && Number.isFinite(elapsedMin) && elapsedMin >= 75;
      if (Number.isFinite(secondsToWaitMatch) && secondsToWaitMatch > 0) {
        if (!(typeof elapsedSec === "number" && Number.isFinite(elapsedSec) && elapsedSec >= secondsToWaitMatch)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...existing, phase: "monitoring", lastTickAt: nowIso, elapsedSec } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "waiting_seconds", item: next });
        }
      }

      const eventId = String((current as any)?.betfair?.eventId ?? baseBetfair?.eventId ?? "").trim();
      if (!eventId) return json({ ok: false, error: "Betfair: eventId ausente" }, 500);
      const underLineCode = Number.isFinite(Number(cfg?.ouLineCode)) && Number(cfg?.ouLineCode) > 0
        ? Math.floor(Number(cfg?.ouLineCode))
        : typeof goals === "number" && Number.isFinite(goals) ? Math.floor((goals * 10) + 15) : 15;
      const overLineCode = Math.max(5, underLineCode - 10);

      let ouOverErr: string | null = null;
      let ouUnderErr: string | null = null;
      const ouOverBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: overLineCode, adminToken: admin.adminToken });
          return slimOuMarket(raw);
        } catch (e) {
          ouOverErr = e instanceof Error ? e.message : String(e);
          return null;
        }
      })();
      const ouUnderBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: underLineCode, adminToken: admin.adminToken });
          return slimOuMarket(raw);
        } catch (e) {
          ouUnderErr = e instanceof Error ? e.message : String(e);
          return null;
        }
      })();

      const overMarketId = String(ouOverBetfair?.marketId ?? "").trim();
      const overMarketStatus = String(ouOverBetfair?.marketStatus ?? "").trim().toUpperCase();
      const overOverSel = Number(ouOverBetfair?.runners?.overSelectionId);
      const overBack = Number(ouOverBetfair?.odds?.over?.back);
      const overLay = Number(ouOverBetfair?.odds?.over?.lay);
      const overMatchedNow = Number(ouOverBetfair?.odds?.over?.runnerMatched);

      const underMatchedNow = Number(ouUnderBetfair?.odds?.under?.runnerMatched);
      const underBack = Number(ouUnderBetfair?.odds?.under?.back);
      const underLay = Number(ouUnderBetfair?.odds?.under?.lay);

      const overReady = Boolean(overMarketId && overMarketStatus === "OPEN" && Number.isFinite(overOverSel) && overOverSel > 0 && Number.isFinite(overBack) && overBack > 1);
      const underReady = Boolean(String(ouUnderBetfair?.marketId ?? "").trim() && String(ouUnderBetfair?.marketStatus ?? "").trim().toUpperCase() === "OPEN" && Number.isFinite(underBack) && underBack > 1);

      if (!overReady || !underReady) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "overGoalsLimit",
            overGoalsLimit: {
              ...existing,
              phase,
              lastTickAt: nowIso,
              ouMarketErrorOver: ouOverErr,
              ouMarketErrorUnder: ouUnderErr,
              marketOver: ouOverBetfair ?? null,
              marketUnder: ouUnderBetfair ?? null,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "market_not_ready", error: ouOverErr || ouUnderErr || null, item: next });
      }

      const overSpreadTicks = Number.isFinite(overBack) && Number.isFinite(overLay) ? ticksBetweenPrices(overBack, overLay) : null;
      const predictedSide = (() => {
        const p = (current as any)?.prediction && typeof (current as any).prediction === "object" ? (current as any).prediction : null;
        const pred = String(p?.overUnder?.prediction ?? "").trim().toLowerCase();
        const conf = Number(p?.overUnder?.confidence);
        if (!(Number.isFinite(conf) && conf >= 55)) return null;
        if (pred === "over") return "over";
        if (pred === "under") return "under";
        return null;
      })();

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

          const spreadPenalty = overSpreadTicks != null && overSpreadTicks > 3 ? 0.2 : 0;
          if (spreadPenalty > 0) score -= spreadPenalty;

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
          dtSec,
          snapOverMatchedPrev: Number.isFinite(snapOverMatchedPrev) ? snapOverMatchedPrev : null,
        };
      })();

      const stats = (body as any)?.stats && typeof (body as any).stats === "object" ? (body as any).stats : null;
      const attacksHome = Number(stats?.attacksHome);
      const attacksAway = Number(stats?.attacksAway);
      const dangHome = Number(stats?.dangerousAttacksHome);
      const dangAway = Number(stats?.dangerousAttacksAway);
      const attacksSum = (Number.isFinite(attacksHome) ? attacksHome : 0) + (Number.isFinite(attacksAway) ? attacksAway : 0);
      const dangerousSum = (Number.isFinite(dangHome) ? dangHome : 0) + (Number.isFinite(dangAway) ? dangAway : 0);
      const liveDominanceRatio = attacksSum > 0 ? dangerousSum / attacksSum : null;

      const deltaTradedOver =
        momentOver.snapOverMatchedPrev != null && Number.isFinite(overMatchedNow) && momentOver.dtSec >= momentWindowMinSec
          ? overMatchedNow - momentOver.snapOverMatchedPrev
          : null;

      const canEnterNowByCooldown =
        !Number.isFinite(cooldownUntilMs) || cooldownUntilMs <= 0 ? true : nowMs >= cooldownUntilMs;
      const canEnterNowBySpacing =
        !(lastEntryAtMs && Number.isFinite(lastEntryAtMs) && lastEntryAtMs > 0 && minSecondsBetweenEntries > 0)
          ? true
          : nowMs - lastEntryAtMs >= minSecondsBetweenEntries * 1000;
      const canEnterNow = canEnterNowByCooldown && canEnterNowBySpacing;

      const baseState = {
        ...existing,
        lastTickAt: nowIso,
        entryLocks: entryLocksPruned,
        lastScoreHome: typeof scoreHome === "number" ? scoreHome : typeof prevHome === "number" ? prevHome : null,
        lastScoreAway: typeof scoreAway === "number" ? scoreAway : typeof prevAway === "number" ? prevAway : null,
        elapsedSec,
        lineCodeOver: overLineCode,
        lineCodeUnder: underLineCode,
        marketOver: ouOverBetfair ?? null,
        marketUnder: ouUnderBetfair ?? null,
        goalAlertActive: Boolean(momentOver.trigger),
        momentSnapAtMs: Number.isFinite(momentOver.nextSnapAtMs) ? momentOver.nextSnapAtMs : null,
        momentOverMatched: (momentOver as any)?.nextOverMatched ?? null,
        momentUnderMatched: (momentOver as any)?.nextUnderMatched ?? null,
        momentOverBack: (momentOver as any)?.nextOverBack ?? null,
        lastMomentOverScore: (momentOver as any)?.score ?? null,
        lastMomentOverThreshold: (momentOver as any)?.threshold ?? null,
        lastDeltaTradedOver: deltaTradedOver,
        lastDominanceRatio: liveDominanceRatio,
      };

      const isGoalAlert = Boolean(momentOver.trigger);
      const canEnterAlert =
        isGoalAlert &&
        canEnterNow &&
        Number.isFinite(overBack) &&
        overBack >= minOdds &&
        (dominanceRatio == null || liveDominanceRatio == null || liveDominanceRatio >= dominanceRatio) &&
        (minDeltaTraded == null || deltaTradedOver == null || deltaTradedOver >= minDeltaTraded);

      let ouOrdersCache: any[] | null = null;
      const getOuOrders = async () => {
        if (ouOrdersCache) return ouOrdersCache;
        ouOrdersCache = [];
        const mids = uniqStrings([overMarketId]).filter(Boolean);
        if (mids.length === 0) return ouOrdersCache;
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: mids });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          ouOrdersCache = currentOrders;
        } catch {}
        return ouOrdersCache;
      };
      const findExistingBackEntry = async (marketId: string, selectionId: number) => {
        const orders = await getOuOrders();
        const candidates = orders.filter((o: any) => {
          const mid = String(o?.marketId ?? "").trim();
          const sid = Number(o?.selectionId);
          const sideRaw = String(o?.side ?? "").trim().toUpperCase();
          if (mid !== String(marketId ?? "").trim()) return false;
          if (!(Number.isFinite(sid) && sid > 0 && sid === Number(selectionId))) return false;
          if (sideRaw !== "BACK") return false;
          const sizeMatched = Number(o?.sizeMatched);
          const sizeRemaining = Number(o?.sizeRemaining);
          return (Number.isFinite(sizeMatched) && sizeMatched > 0) || (Number.isFinite(sizeRemaining) && sizeRemaining > 0);
        });
        if (candidates.length === 0) return null;
        candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
        return candidates[0] ?? null;
      };
      const findExistingLayTp = async (marketId: string, selectionId: number) => {
        const orders = await getOuOrders();
        const candidates = orders.filter((o: any) => {
          const mid = String(o?.marketId ?? "").trim();
          const sid = Number(o?.selectionId);
          const sideRaw = String(o?.side ?? "").trim().toUpperCase();
          if (mid !== String(marketId ?? "").trim()) return false;
          if (!(Number.isFinite(sid) && sid > 0 && sid === Number(selectionId))) return false;
          if (sideRaw !== "LAY") return false;
          const sizeRemaining = Number(o?.sizeRemaining);
          return Number.isFinite(sizeRemaining) && sizeRemaining > 0;
        });
        if (candidates.length === 0) return null;
        candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
        return candidates[0] ?? null;
      };

      const goalConfirmed = (() => {
        const lastScoreHome = Number(existing?.lastScoreHome);
        const lastScoreAway = Number(existing?.lastScoreAway);
        const hasScoreNow = typeof scoreHome === "number" && typeof scoreAway === "number";
        const hasScorePrev = Number.isFinite(lastScoreHome) && Number.isFinite(lastScoreAway);
        return hasScoreNow && hasScorePrev ? scoreHome !== lastScoreHome || scoreAway !== lastScoreAway : false;
      })();
      if (goalConfirmed) {
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        if (tpBetId) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: overMarketId, betIds: [tpBetId] });
          } catch {}
        }
        if (entryBetId) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: overMarketId, betIds: [entryBetId] });
          } catch {}
        }

        const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
        const locksCleared = clearEntryLock(locksNow, lockKeyFor(overMarketId, overOverSel));
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "overGoalsLimit",
            overGoalsLimit: {
              ...baseState,
              entryLocks: locksCleared,
              phase: "cooldown",
              closedAt: nowIso,
              lastClosedAt: nowIso,
              cooldownUntilMs: nowMs + Math.max(3, minSecondsBetweenEntries) * 1000,
              lastExitReason: "goal_or_suspend",
              entryBetId: null,
              takeProfit: null,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, item: next, closed: true, reason: "goal_or_suspend" });
      }

      if ((phase === "monitoring" || phase === "cooldown" || phase === "closed" || phase === "stopped") && canEnterAlert) {
        const existingEntry = await findExistingBackEntry(overMarketId, overOverSel);
        if (existingEntry) {
          const sizeMatched = Number(existingEntry?.sizeMatched);
          const sizeRemaining = Number(existingEntry?.sizeRemaining);
          const hasMatched = Number.isFinite(sizeMatched) && sizeMatched > 0;
          const tpExisting = await findExistingLayTp(overMarketId, overOverSel);
          const tpBetId = String(tpExisting?.betId ?? "").trim() || null;
          const tpPrice = Number(tpExisting?.priceSize?.price ?? tpExisting?.price);
          const tpSize = Number(tpExisting?.sizeRemaining);
          const takeProfit =
            tpBetId && Number.isFinite(tpPrice) && tpPrice > 1 && Number.isFinite(tpSize) && tpSize > 0
              ? { betId: tpBetId, price: tpPrice, size: tpSize, placedAt: String(tpExisting?.placedDate ?? nowIso), status: String(tpExisting?.status ?? null), errorCode: null, result: null, error: null }
              : null;
          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const lockTtlMs = entryLockTtlSeconds * 1000;
          const entryLockKey = lockKeyFor(overMarketId, overOverSel);
          const locksUpdated = setEntryLock(locksNow, entryLockKey, {
            matchId,
            agent: "overGoalsLimit",
            marketId: overMarketId,
            selectionId: overOverSel,
            side: "BACK",
            lockedAt: nowIso,
            betId: String(existingEntry?.betId ?? "").trim() || null,
            expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
          });
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "overGoalsLimit",
              overGoalsLimit: {
                ...baseState,
                entryLocks: locksUpdated,
                phase: hasMatched && takeProfit ? "entered" : "entering",
                entryMarketId: overMarketId,
                entryLineCode: overLineCode,
                selectionId: overOverSel,
                entryBetId: String(existingEntry?.betId ?? "").trim() || null,
                entryMatchedSize: Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : null,
                entryRemainingSize: Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : null,
                entryPrice:
                  (Number(existingEntry?.averagePriceMatched) > 1 ? Number(existingEntry?.averagePriceMatched) : null) ??
                  (Number(existingEntry?.priceSize?.price) > 1 ? Number(existingEntry?.priceSize?.price) : null) ??
                  Number(existing?.entryPrice ?? overBack),
                takeProfit,
                lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, skipped: true, reason: "adopt_existing_entry" });
        }

        const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
        const entryLockKey = lockKeyFor(overMarketId, overOverSel);
        if (isEntryLocked(locksNow, entryLockKey)) {
          const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase } }, updatedAt: nowIso };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "entry_locked", item: next });
        }

        const entryPrice = movePriceByTicks(overBack, entryOffsetTicks);
        const result = await placeOrders({
          adminToken: admin.adminToken,
          marketId: overMarketId,
          customerRef: mkStableCustomerRef("og", matchId, overMarketId, overOverSel),
          instructions: [
            {
              selectionId: overOverSel,
              side: "BACK",
              orderType: "LIMIT",
              limitOrder: { size: stakeAbs, price: entryPrice, persistenceType: "LAPSE" },
            },
          ],
        }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
        const err = (result as any)?.__error ? String((result as any).__error) : null;
        const newEntryBetId = err ? null : extractBetId(result);
        const lockTtlMs = (newEntryBetId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
        const locksUpdated = err
          ? locksNow
          : setEntryLock(locksNow, entryLockKey, {
              matchId,
              agent: "overGoalsLimit",
              marketId: overMarketId,
              selectionId: overOverSel,
              side: "BACK",
              lockedAt: nowIso,
              betId: newEntryBetId,
              status: err ? null : extractReportStatus(result),
              expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
            });

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "overGoalsLimit",
            overGoalsLimit: {
              ...baseState,
              entryLocks: locksUpdated,
              phase: err ? "monitoring" : "entering",
              entryMarketId: overMarketId,
              entryLineCode: overLineCode,
              selectionId: overOverSel,
              entryPrice,
              stakeAbs,
              entryBetId: newEntryBetId,
              entryRequestedAt: nowIso,
              lastEntryAt: nowIso,
              entryCount: entryCount + (err ? 0 : 1),
              lastError: err,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, item: next, placed: !err, error: err, reason: err ? "entry_failed" : "entry_placed" });
      }

      if (phase === "cooldown") {
        if (Number.isFinite(cooldownUntilMs) && cooldownUntilMs > 0 && nowMs < cooldownUntilMs) {
          const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase: "cooldown" } }, updatedAt: nowIso };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "cooldown", item: next });
        }
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase: "monitoring", cooldownUntilMs: null } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, item: next, resumed: true, reason: "cooldown_done" });
      }

      if (phase === "entering") {
        const entryMarketId = String(existing?.entryMarketId ?? overMarketId).trim();
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const entrySelectionId = Number(existing?.selectionId ?? overOverSel);
        if (!entryBetId) {
          const adopted = await findExistingBackEntry(entryMarketId, entrySelectionId);
          if (adopted) {
            const hasMatched = Number(adopted?.sizeMatched) > 0;
            const tpExisting = hasMatched ? await findExistingLayTp(entryMarketId, entrySelectionId) : null;
            const tpBetId = String(tpExisting?.betId ?? "").trim() || null;
            const tpPrice = Number(tpExisting?.priceSize?.price ?? tpExisting?.price);
            const tpSize = Number(tpExisting?.sizeRemaining);
            const takeProfit =
              tpBetId && Number.isFinite(tpPrice) && tpPrice > 1 && Number.isFinite(tpSize) && tpSize > 0
                ? { betId: tpBetId, price: tpPrice, size: tpSize, placedAt: String(tpExisting?.placedDate ?? nowIso), status: String(tpExisting?.status ?? null), errorCode: null, result: null, error: null }
                : null;

            const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
            const entryLockKey = lockKeyFor(entryMarketId, entrySelectionId);
            const locksUpdated = setEntryLock(locksNow, entryLockKey, {
              matchId,
              agent: "overGoalsLimit",
              marketId: entryMarketId,
              selectionId: entrySelectionId,
              side: "BACK",
              lockedAt: nowIso,
              betId: String(adopted?.betId ?? "").trim() || null,
              expiresAtMs: nowMs + Math.max(1000, entryLockTtlSeconds * 1000),
            });

            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "overGoalsLimit",
                overGoalsLimit: {
                  ...baseState,
                  entryLocks: locksUpdated,
                  phase: hasMatched && takeProfit ? "entered" : "entering",
                  entryMarketId,
                  entryLineCode: overLineCode,
                  selectionId: entrySelectionId,
                  entryBetId: String(adopted?.betId ?? "").trim() || null,
                  entryMatchedSize: hasMatched ? Number(adopted?.sizeMatched) : null,
                  entryRemainingSize: Number(adopted?.sizeRemaining),
                  entryPrice:
                    (Number(adopted?.averagePriceMatched) > 1 ? Number(adopted?.averagePriceMatched) : null) ??
                    (Number(adopted?.priceSize?.price) > 1 ? Number(adopted?.priceSize?.price) : null) ??
                    Number(existing?.entryPrice ?? overBack),
                  takeProfit,
                  lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "adopt_missing_betid", item: next });
          }

          const reqAt = String(existing?.entryRequestedAt ?? existing?.lastEntryAt ?? existing?.enteredAt ?? "").trim();
          const reqAtMs = reqAt ? new Date(reqAt).getTime() : 0;
          if (reqAtMs && Number.isFinite(reqAtMs) && nowMs - reqAtMs < 6_000) {
            const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase: "entering", lastExitReason: "await_betid" } }, updatedAt: nowIso };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "await_betid", item: next });
          }

          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared = clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId));
          const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, entryLocks: locksCleared, phase: "monitoring", lastExitReason: "missing_entry_betid" } }, updatedAt: nowIso };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "missing_entry_betid", item: next });
        }
        let sizeMatched = 0;
        let sizeRemaining = 0;
        let avgPriceMatched = Number(existing?.entryPrice);
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
          sizeMatched = Number(row?.sizeMatched);
          sizeRemaining = Number(row?.sizeRemaining);
          const apm = Number(row?.averagePriceMatched);
          if (Number.isFinite(apm) && apm > 1) avgPriceMatched = apm;
        } catch {}

        const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? Math.max(2, round2(sizeMatched)) : 0;
        const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? round2(sizeRemaining) : 0;
        const entryPriceSafe = Number.isFinite(avgPriceMatched) && avgPriceMatched > 1 ? avgPriceMatched : overBack;

        if (!isGoalAlert) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [entryBetId] });
          } catch {}
          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared = clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId));
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "overGoalsLimit",
              overGoalsLimit: {
                ...baseState,
                entryLocks: locksCleared,
                phase: "cooldown",
                closedAt: nowIso,
                lastClosedAt: nowIso,
                cooldownUntilMs: nowMs + Math.max(3, minSecondsBetweenEntries) * 1000,
                lastExitReason: "alert_off_before_match",
                entryBetId: null,
                takeProfit: null,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true, reason: "alert_off_before_match" });
        }

        if (matchedSafe > 0) {
          const desiredLay = entryPriceSafe / (1 + profitTargetPct / 100);
          let targetPrice = entryPriceSafe;
          for (let i = 0; i < 120 && targetPrice > desiredLay; i++) {
            const step = tickStep(targetPrice);
            targetPrice = round2(targetPrice - step);
            if (targetPrice < 1.01) targetPrice = 1.01;
          }
          if (!(Number.isFinite(targetPrice) && targetPrice > 1 && targetPrice < entryPriceSafe)) {
            targetPrice = movePriceByTicks(entryPriceSafe, -Math.max(2, Math.floor(Math.max(2, profitTargetPct))));
          }
          const hedgeSize = Math.max(2, round2((entryPriceSafe * matchedSafe) / targetPrice));

          const tpRes = await placeOrders({
            adminToken: admin.adminToken,
            marketId: entryMarketId,
            customerRef: mkCustomerRef("tp", matchId),
            instructions: [
              {
                selectionId: entrySelectionId,
                side: "LAY",
                orderType: "LIMIT",
                limitOrder: { size: hedgeSize, price: targetPrice, persistenceType: "LAPSE" },
              },
            ],
          }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
          const tpErr = (tpRes as any)?.__error ? String((tpRes as any).__error) : null;

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "overGoalsLimit",
              overGoalsLimit: {
                ...baseState,
                phase: tpErr ? "entered" : "entered",
                entryMarketId: entryMarketId,
                entryLineCode: overLineCode,
                selectionId: entrySelectionId,
                entryBetId,
                entryMatchedSize: matchedSafe,
                entryRemainingSize: remainingSafe,
                entryPrice: entryPriceSafe,
                targetPrice,
                takeProfit: {
                  betId: tpErr ? null : extractBetId(tpRes),
                  price: targetPrice,
                  size: hedgeSize,
                  placedAt: nowIso,
                  status: tpErr ? null : extractReportStatus(tpRes),
                  errorCode: tpErr ? null : extractReportErrorCode(tpRes),
                  result: tpErr ? null : tpRes ?? null,
                  error: tpErr,
                },
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, entered: true, reason: "entry_matched" });
        }

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "overGoalsLimit",
            overGoalsLimit: {
              ...baseState,
              phase: "entering",
              entryMarketId: entryMarketId,
              entryLineCode: overLineCode,
              selectionId: entrySelectionId,
              entryBetId,
              entryMatchedSize: matchedSafe > 0 ? matchedSafe : null,
              entryRemainingSize: remainingSafe > 0 ? remainingSafe : null,
              entryPrice: entryPriceSafe,
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_match", item: next });
      }

      if (phase === "entered") {
        const entryMarketId = String(existing?.entryMarketId ?? overMarketId).trim();
        const entrySelectionId = Number(existing?.selectionId ?? overOverSel);
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const entryPrice = Number(existing?.entryPrice);
        const matched0 = Number(existing?.entryMatchedSize ?? existing?.stakeAbs);
        const matchedSafe = Number.isFinite(matched0) && matched0 > 0 ? Math.max(2, round2(matched0)) : 0;

        if (!isGoalAlert && matchedSafe > 0 && Number.isFinite(overLay) && overLay > 1 && Number.isFinite(entryPrice) && entryPrice > 1) {
          if (tpBetId) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: entryMarketId, betIds: [tpBetId] });
            } catch {}
          }
          const hedgeSize = Math.max(2, round2((entryPrice * matchedSafe) / overLay));
          try {
            await placeOrders({
              adminToken: admin.adminToken,
              marketId: entryMarketId,
              customerRef: mkCustomerRef("ex", matchId),
              instructions: [
                {
                  selectionId: entrySelectionId,
                  side: "LAY",
                  orderType: "LIMIT",
                  limitOrder: { size: hedgeSize, price: overLay, persistenceType: "LAPSE" },
                },
              ],
            });
          } catch {}

          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared = clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId));
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "overGoalsLimit",
              overGoalsLimit: {
                ...baseState,
                entryLocks: locksCleared,
                phase: "cooldown",
                closedAt: nowIso,
                lastClosedAt: nowIso,
                cooldownUntilMs: nowMs + Math.max(3, minSecondsBetweenEntries) * 1000,
                lastExitReason: "alert_off_exit",
                takeProfit: null,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true, reason: "alert_off_exit" });
        }

        if (tpBetId) {
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
              const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
              const locksCleared = clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId));
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "overGoalsLimit",
                  overGoalsLimit: {
                    ...baseState,
                    entryLocks: locksCleared,
                    phase: "cooldown",
                    closedAt: nowIso,
                    lastClosedAt: nowIso,
                    cooldownUntilMs: nowMs + Math.max(3, minSecondsBetweenEntries) * 1000,
                    lastExitReason: "tp_matched",
                    takeProfitMatchedAt: nowIso,
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, item: next, closed: true, reason: "tp_matched" });
            }
          } catch {}
        }

        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase: "entered" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "holding", item: next });
      }

      const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsLimit", overGoalsLimit: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
      await setQueueItem(matchId, next);
      return json({ ok: true, skipped: true, reason: "noop", item: next });
    }

    if (matchPath(path, "/automation/betfair/strategy/overGoalsHT/tick")) {
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
      const existing = (strategy as any)?.overGoalsHT && typeof (strategy as any).overGoalsHT === "object" ? (strategy as any).overGoalsHT : {};

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const enabled = Boolean((cfg as any)?.enabled ?? true);
      const bankroll = Number((cfg as any)?.bankroll ?? 50);
      const stakePctRaw = Number((cfg as any)?.stakePct ?? 1);
      const stakePct = Number.isFinite(stakePctRaw) ? Math.max(0, Math.min(100, stakePctRaw)) : 1;
      const stakeAbsCfgRaw = Number((cfg as any)?.stakeAbs);
      const stakeAbsCfg = Number.isFinite(stakeAbsCfgRaw) ? round2(stakeAbsCfgRaw) : NaN;
      const stakeAbs =
        Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0
          ? Math.max(2, stakeAbsCfg)
          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
            ? Math.max(2, round2((bankroll * stakePct) / 100))
            : 2;
      const minOddsRaw = Number((cfg as any)?.minOdds ?? 1.25);
      const minOdds = Number.isFinite(minOddsRaw) ? Math.max(1.01, Math.min(1000, minOddsRaw)) : 1.25;
      const maxEntriesRaw = Number((cfg as any)?.maxEntries ?? 1);
      const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.max(1, Math.min(10, Math.floor(maxEntriesRaw))) : 1;
      const entryOffsetTicksRaw = Number((cfg as any)?.entryOffsetTicks ?? 0);
      const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? Math.max(-10, Math.min(10, Math.trunc(entryOffsetTicksRaw))) : 0;
      const secondsToWaitMatchRaw = Number((cfg as any)?.secondsToWaitMatch ?? 10);
      const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? Math.max(1, Math.min(120, Math.floor(secondsToWaitMatchRaw))) : 10;
      const maxMinuteRaw = Number((cfg as any)?.maxMinute ?? 46);
      const maxMinute = Number.isFinite(maxMinuteRaw) ? Math.max(1, Math.min(60, Math.floor(maxMinuteRaw))) : 46;
      const observeMinMinuteRaw = Number((cfg as any)?.observeMinMinute ?? 10);
      const observeMinMinute = Number.isFinite(observeMinMinuteRaw) ? Math.max(0, Math.min(45, Math.floor(observeMinMinuteRaw))) : 10;
      const observeMaxMinuteRaw = Number((cfg as any)?.observeMaxMinute ?? 15);
      const observeMaxMinute = Number.isFinite(observeMaxMinuteRaw) ? Math.max(0, Math.min(45, Math.floor(observeMaxMinuteRaw))) : 15;
      const preMinConfidenceRaw = Number((cfg as any)?.preMinConfidence ?? 75);
      const preMinConfidence = Number.isFinite(preMinConfidenceRaw) ? Math.max(0, Math.min(95, Math.floor(preMinConfidenceRaw))) : 75;

      const momentOverThresholdRaw = Number((cfg as any)?.momentOverThreshold ?? 0.75);
      const momentOverThreshold = Number.isFinite(momentOverThresholdRaw) ? Math.max(0.1, Math.min(2, momentOverThresholdRaw)) : 0.75;
      const momentOverThresholdOffDeltaRaw = Number((cfg as any)?.momentOverThresholdOffDelta ?? 0.15);
      const momentOverThresholdOffDelta = Number.isFinite(momentOverThresholdOffDeltaRaw) ? Math.max(0, Math.min(1, momentOverThresholdOffDeltaRaw)) : 0.15;
      const momentWindowMinSecRaw = Number((cfg as any)?.momentWindowMinSec ?? 8);
      const momentWindowMaxSecRaw = Number((cfg as any)?.momentWindowMaxSec ?? 180);
      const momentWindowMinSec = Number.isFinite(momentWindowMinSecRaw) ? Math.max(1, Math.min(300, Math.floor(momentWindowMinSecRaw))) : 8;
      const momentWindowMaxSecCandidate = Number.isFinite(momentWindowMaxSecRaw) ? Math.max(2, Math.min(600, Math.floor(momentWindowMaxSecRaw))) : 180;
      const momentWindowMaxSec = Math.max(momentWindowMinSec + 1, momentWindowMaxSecCandidate);

      const nowIso = new Date().toISOString();
      const nowMs = Date.now();
      const entryLockTtlSecondsRaw = Number((cfg as any)?.entryLockTtlSeconds ?? 180);
      const entryLockTtlSeconds = Number.isFinite(entryLockTtlSecondsRaw) ? Math.max(5, Math.min(3600, Math.floor(entryLockTtlSecondsRaw))) : 180;
      const entryLockPendingTtlSecondsRaw = Number((cfg as any)?.entryLockPendingTtlSeconds ?? 25);
      const entryLockPendingTtlSeconds = Number.isFinite(entryLockPendingTtlSecondsRaw)
        ? Math.max(4, Math.min(300, Math.floor(entryLockPendingTtlSecondsRaw)))
        : 25;
      const lockKeyFor = (marketId: string, selectionId: number) => {
        const mid = String(marketId ?? "").trim();
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? Math.floor(selectionId) : 0;
        return `${mid}:${sid}:BACK`;
      };
      const readEntryLocks = () => {
        const merged: Record<string, any> = {};
        const add = (raw: any) => {
          if (!raw || typeof raw !== "object") return;
          for (const [k, v] of Object.entries(raw)) {
            const key = String(k ?? "").trim();
            if (!key) continue;
            if (!v || typeof v !== "object") continue;
            merged[key] = v;
          }
        };
        add((strategy as any)?.entryLocks);
        add((existing as any)?.entryLocks);
        for (const k of Object.keys(strategy)) {
          const sub = (strategy as any)[k];
          if (!sub || typeof sub !== "object") continue;
          if (sub?.entryLocks && typeof sub.entryLocks === "object") add(sub.entryLocks);
        }
        return merged;
      };
      const pruneEntryLocks = (locks: any) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(locks ?? {})) {
          if (!k) continue;
          if (!v || typeof v !== "object") continue;
          const exp = Number((v as any)?.expiresAtMs);
          if (Number.isFinite(exp) && exp > nowMs) out[k] = v;
        }
        return out;
      };
      const entryLocksPruned = pruneEntryLocks(readEntryLocks());
      const isEntryLocked = (locks: any, key: string) => {
        const v = locks && typeof locks === "object" ? (locks as any)[key] : null;
        const exp = Number(v?.expiresAtMs);
        return Boolean(v && Number.isFinite(exp) && exp > nowMs);
      };
      const setEntryLock = (locks: any, key: string, value: any) => {
        const base = locks && typeof locks === "object" ? locks : {};
        return { ...base, [key]: value };
      };
      const clearEntryLock = (locks: any, key: string) => {
        const base = locks && typeof locks === "object" ? locks : {};
        const { [key]: _, ...rest } = base as any;
        return rest;
      };
      const mkStableCustomerRef = (action: string, matchId: string, marketId: string, selectionId: number) => {
        const a = String(action ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "x";
        const id = String(matchId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const tail = id.slice(-8) || "0";
        const mid = String(marketId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const midTail = mid.slice(-6) || "m";
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? String(Math.floor(selectionId)).slice(-4) : "0";
        const bucket = Math.floor(Date.now() / 4000).toString(36);
        let ref = `ht-${a}-${tail}-${midTail}${sid}-${bucket}`;
        if (ref.length > 32) ref = ref.slice(0, 32);
        return ref;
      };

      const eventId = String((current as any)?.betfair?.eventId ?? baseBetfair?.eventId ?? "").trim();
      const bodyLive = (body as any)?.live && typeof (body as any).live === "object" ? (body as any).live : null;
      const liveElapsedRaw = Number((bodyLive as any)?.elapsed);
      const elapsedMin = Number.isFinite(liveElapsedRaw) ? Math.max(0, Math.floor(liveElapsedRaw)) : null;
      const statusShort = String((bodyLive as any)?.statusShort ?? (baseBetfair as any)?.timeline?.statusShort ?? "").trim().toUpperCase() || null;

      const baseTimeline = (baseBetfair as any)?.timeline ?? null;
      const baseTimelineScoreHome = Number(baseTimeline?.scoreHome);
      const baseTimelineScoreAway = Number(baseTimeline?.scoreAway);
      const liveScoreHomeRaw =
        typeof (bodyLive as any)?.scoreHome === "number" ? (bodyLive as any).scoreHome
          : Number.isFinite(Number((bodyLive as any)?.scoreHome)) ? Number((bodyLive as any)?.scoreHome)
          : NaN;
      const liveScoreAwayRaw =
        typeof (bodyLive as any)?.scoreAway === "number" ? (bodyLive as any).scoreAway
          : Number.isFinite(Number((bodyLive as any)?.scoreAway)) ? Number((bodyLive as any)?.scoreAway)
          : NaN;
      const queueScoreHome = typeof (current as any)?.scoreHome === "number" ? (current as any).scoreHome : Number((current as any)?.scoreHome);
      const queueScoreAway = typeof (current as any)?.scoreAway === "number" ? (current as any).scoreAway : Number((current as any)?.scoreAway);
      const scoreHome =
        Number.isFinite(liveScoreHomeRaw) ? Math.max(0, Math.floor(liveScoreHomeRaw))
          : Number.isFinite(baseTimelineScoreHome) ? Math.max(0, Math.floor(baseTimelineScoreHome))
            : Number.isFinite(queueScoreHome) ? Math.max(0, Math.floor(queueScoreHome))
              : null;
      const scoreAway =
        Number.isFinite(liveScoreAwayRaw) ? Math.max(0, Math.floor(liveScoreAwayRaw))
          : Number.isFinite(baseTimelineScoreAway) ? Math.max(0, Math.floor(baseTimelineScoreAway))
            : Number.isFinite(queueScoreAway) ? Math.max(0, Math.floor(queueScoreAway))
              : null;
      const totalGoals =
        typeof scoreHome === "number" && typeof scoreAway === "number" ? Math.max(0, scoreHome + scoreAway) : null;

      const inPlay = Boolean(baseBetfair?.inPlay ?? false);
      const inFirstHalf = statusShort === "1H" || statusShort === "1ST" || statusShort === "FIRST_HALF" || statusShort === "LIVE";

      const phase = String(existing?.phase ?? "").trim() || "monitoring";
      const entriesCount = Math.max(0, Math.floor(Number((existing as any)?.entriesCount ?? 0) || 0));

      const preConfRaw = Number(((current as any)?.prediction as any)?.overHT?.confidence);
      const preConfidence = Number.isFinite(preConfRaw) ? Math.max(0, Math.min(100, Math.floor(preConfRaw))) : null;

      const baseState: any = {
        ...existing,
        phase,
        entriesCount,
        lastTickAt: nowIso,
        entryLocks: entryLocksPruned,
        goalAlertActive: Boolean((existing as any)?.goalAlertActive ?? false),
        momentSnapAtMs: Number.isFinite(Number((existing as any)?.momentSnapAtMs)) ? Number((existing as any)?.momentSnapAtMs) : null,
        momentOverMatched: Number.isFinite(Number((existing as any)?.momentOverMatched)) ? Number((existing as any)?.momentOverMatched) : null,
        momentOverBack: Number.isFinite(Number((existing as any)?.momentOverBack)) ? Number((existing as any)?.momentOverBack) : null,
        momentScore: Number.isFinite(Number((existing as any)?.momentScore)) ? Number((existing as any)?.momentScore) : null,
        momentUpdatedAtMs: Number.isFinite(Number((existing as any)?.momentUpdatedAtMs)) ? Number((existing as any)?.momentUpdatedAtMs) : null,
        preConfidence,
      };

      if (!enabled) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "disabled", item: next });
      }

      if (!eventId || !inPlay || !inFirstHalf || elapsedMin == null || elapsedMin > maxMinute) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "not_applicable", item: next });
      }

      if (!(totalGoals != null && totalGoals === 0)) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "cooldown", closedAt: nowIso, lastClosedAt: nowIso, cooldownUntilMs: nowMs + 30_000, lastExitReason: "goal_or_not_0x0" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "goal_or_not_0x0", item: next });
      }

      let ou: any = null;
      try {
        ou = await resolveBetfairOverUnderMarket({ eventId, lineCode: 5, adminToken: admin.adminToken });
      } catch {
        ou = null;
      }
      const marketId = String(ou?.marketId ?? "").trim();
      const selectionId = Number(ou?.runners?.overSelectionId);
      const overBack = Number(ou?.odds?.over?.back);
      const overLay = Number(ou?.odds?.over?.lay);
      const overMatched = Number(ou?.odds?.over?.runnerMatched);
      const underMatched = Number(ou?.odds?.under?.runnerMatched);
      const marketMatched = Number(ou?.matchedVolume);

      if (!marketId || !(Number.isFinite(selectionId) && selectionId > 0)) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "market_not_ready", item: next });
      }

      const bestBack = Number.isFinite(overBack) ? overBack : NaN;
      const bestLay = Number.isFinite(overLay) ? overLay : NaN;
      const bestPrice = Number.isFinite(bestLay) && bestLay > 1 ? bestLay : bestBack;

      if (!(Number.isFinite(bestPrice) && bestPrice > 1)) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_price", item: next });
      }

      if (bestPrice < minOdds) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...baseState, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "min_odds", item: next });
      }

      const computeMoment = () => {
        const prevActive = Boolean((baseState as any)?.goalAlertActive ?? false);
        const snapAtMs = Number((baseState as any)?.momentSnapAtMs);
        const snapOverMatched = Number((baseState as any)?.momentOverMatched);
        const snapOverBack = Number((baseState as any)?.momentOverBack);
        const nowOverMatched = Number.isFinite(overMatched) ? Math.max(0, overMatched) : NaN;
        const nowUnderMatched = Number.isFinite(underMatched) ? Math.max(0, underMatched) : NaN;
        const nowOverBack = Number.isFinite(bestBack) ? bestBack : NaN;
        const hasSnap = Number.isFinite(snapAtMs) && Number.isFinite(snapOverMatched) && Number.isFinite(snapOverBack);
        if (!hasSnap) {
          return {
            goalAlertActive: prevActive,
            momentScore: null,
            momentSnapAtMs: nowMs,
            momentOverMatched: Number.isFinite(nowOverMatched) ? nowOverMatched : null,
            momentOverBack: Number.isFinite(nowOverBack) ? nowOverBack : null,
            momentUpdatedAtMs: nowMs,
          };
        }
        const dtMs = nowMs - snapAtMs;
        if (!(Number.isFinite(dtMs) && dtMs >= 0)) {
          return {
            goalAlertActive: prevActive,
            momentScore: null,
            momentSnapAtMs: nowMs,
            momentOverMatched: Number.isFinite(nowOverMatched) ? nowOverMatched : null,
            momentOverBack: Number.isFinite(nowOverBack) ? nowOverBack : null,
            momentUpdatedAtMs: nowMs,
          };
        }
        const dtSec = dtMs / 1000;
        if (dtSec < momentWindowMinSec) {
          return {
            goalAlertActive: prevActive,
            momentScore: Number.isFinite(Number((baseState as any)?.momentScore)) ? Number((baseState as any)?.momentScore) : null,
            momentSnapAtMs: snapAtMs,
            momentOverMatched: Number.isFinite(snapOverMatched) ? snapOverMatched : null,
            momentOverBack: Number.isFinite(snapOverBack) ? snapOverBack : null,
            momentUpdatedAtMs: Number.isFinite(Number((baseState as any)?.momentUpdatedAtMs)) ? Number((baseState as any)?.momentUpdatedAtMs) : null,
          };
        }
        if (dtSec > momentWindowMaxSec) {
          return {
            goalAlertActive: prevActive,
            momentScore: null,
            momentSnapAtMs: nowMs,
            momentOverMatched: Number.isFinite(nowOverMatched) ? nowOverMatched : null,
            momentOverBack: Number.isFinite(nowOverBack) ? nowOverBack : null,
            momentUpdatedAtMs: nowMs,
          };
        }
        const deltaOverMatched = Number.isFinite(nowOverMatched) && Number.isFinite(snapOverMatched) ? Math.max(0, nowOverMatched - snapOverMatched) : 0;
        const deltaUnderMatched = Number.isFinite(nowUnderMatched) ? Math.max(0, nowUnderMatched) : 0;
        const deltaOverBack = Number.isFinite(nowOverBack) && Number.isFinite(snapOverBack) ? Math.max(0, snapOverBack - nowOverBack) : 0;
        const s1 = Math.min(1, deltaOverMatched / 500);
        const s2 = Math.min(1, deltaOverBack / 0.1);
        const dominance = deltaOverMatched > 0 ? Math.min(0.5, Math.max(0, (deltaOverMatched / Math.max(1, deltaUnderMatched)) - 1) * 0.25) : 0;
        const score = Math.max(0, Math.min(2, s1 + s2 + dominance));
        const thresholdOff = Math.max(0.05, momentOverThreshold - momentOverThresholdOffDelta);
        const nextActive = prevActive ? score >= thresholdOff : score >= momentOverThreshold;
        return {
          goalAlertActive: Boolean(nextActive),
          momentScore: score,
          momentSnapAtMs: snapAtMs,
          momentOverMatched: snapOverMatched,
          momentOverBack: snapOverBack,
          momentUpdatedAtMs: nowMs,
        };
      };

      const moment = computeMoment();
      const nextBase = {
        ...baseState,
        goalAlertActive: moment.goalAlertActive,
        momentScore: moment.momentScore,
        momentSnapAtMs: moment.momentSnapAtMs,
        momentOverMatched: moment.momentOverMatched,
        momentOverBack: moment.momentOverBack,
        momentUpdatedAtMs: moment.momentUpdatedAtMs,
        marketId,
        selectionId,
        marketMatched: Number.isFinite(marketMatched) ? marketMatched : null,
      };

      const entryBetId = String((existing as any)?.entryBetId ?? "").trim() || null;
      const enteredAtIso = String((existing as any)?.enteredAt ?? "").trim() || null;
      const enteredAtMs = enteredAtIso ? new Date(enteredAtIso).getTime() : 0;
      const lockKey = lockKeyFor(marketId, selectionId);

      if (phase === "entering" && entryBetId) {
        let matchedSize = 0;
        let remainingSize = 0;
        let avgPriceMatched = NaN;
        let status = "";
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [entryBetId] });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === entryBetId) ?? null;
          matchedSize = Number(row?.sizeMatched);
          remainingSize = Number(row?.sizeRemaining);
          avgPriceMatched = Number(row?.averagePriceMatched);
          status = String(row?.status ?? "").trim().toUpperCase();
        } catch {}

        const hasMatched = Number.isFinite(matchedSize) && matchedSize > 0;
        if (hasMatched) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "entered", entryBetId, entryMatchedSize: matchedSize, entryRemainingSize: remainingSize, entryMatchedAt: nowIso, entryPrice: Number.isFinite(avgPriceMatched) && avgPriceMatched > 1 ? avgPriceMatched : bestPrice } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, entered: true, reason: "matched" });
        }

        const waitedSec = enteredAtMs && Number.isFinite(enteredAtMs) ? (nowMs - enteredAtMs) / 1000 : 0;
        if (waitedSec > secondsToWaitMatch) {
          try {
            await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: [entryBetId] });
          } catch {}
          const locksCleared = clearEntryLock(entryLocksPruned, lockKey);
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, entryLocks: locksCleared, phase: "monitoring", entryBetId: null, lastExitReason: "entry_timeout", lastClosedAt: nowIso, closedAt: nowIso } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "entry_timeout", item: next });
        }

        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "entering", entryBetId, enteredAt: enteredAtIso || nowIso, entryStatus: status || null } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_match", item: next });
      }

      if (phase === "entered" && entryBetId) {
        const shouldExit = !moment.goalAlertActive || elapsedMin >= maxMinute;
        if (shouldExit) {
          const layPrice = Number.isFinite(bestLay) && bestLay > 1 ? bestLay : bestPrice;
          const sizeToLay = stakeAbs;
          let didHedge = false;
          try {
            await placeOrders({
              adminToken: admin.adminToken,
              marketId,
              customerRef: mkStableCustomerRef("x", matchId, marketId, selectionId),
              instructions: [
                { selectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: Math.max(2, round2(sizeToLay)), price: layPrice, persistenceType: "LAPSE" } },
              ],
            });
            didHedge = true;
          } catch {}
          const locksCleared = clearEntryLock(entryLocksPruned, lockKey);
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, entryLocks: locksCleared, phase: "cooldown", closedAt: nowIso, lastClosedAt: nowIso, cooldownUntilMs: nowMs + 25_000, lastExitReason: !moment.goalAlertActive ? "alert_off_exit" : "max_minute_exit", lastCashoutAt: didHedge ? nowIso : null } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true, reason: !moment.goalAlertActive ? "alert_off_exit" : "max_minute_exit" });
        }
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "entered" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "holding", item: next });
      }

      const cooldownUntilMs = Number((existing as any)?.cooldownUntilMs);
      if (phase === "cooldown" && Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "cooldown" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown", item: next });
      }

      const allowByPre = preConfidence != null && preConfidence >= preMinConfidence && elapsedMin <= Math.min(5, observeMinMinute);
      const allowByObserve = elapsedMin >= observeMinMinute && elapsedMin <= observeMaxMinute && moment.goalAlertActive;
      const allowEntry = allowByPre || allowByObserve;

      if (!allowEntry) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "waiting_signal", item: next });
      }

      if (entriesCount >= maxEntries) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "max_entries", item: next });
      }

      if (isEntryLocked(entryLocksPruned, lockKey)) {
        const next = { ...current, betfair: baseBetfair, strategy: { ...strategy, agent: "overGoalsHT", overGoalsHT: { ...nextBase, phase: "monitoring" } }, updatedAt: nowIso };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "entry_locked", item: next });
      }

      const entryPrice = movePriceByTicks(bestPrice, entryOffsetTicks);
      const result = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: mkStableCustomerRef("e", matchId, marketId, selectionId),
        instructions: [
          {
            selectionId,
            side: "BACK",
            orderType: "LIMIT",
            limitOrder: { size: stakeAbs, price: entryPrice, persistenceType: "LAPSE" },
          },
        ],
      }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

      const betId = extractBetId(result);
      const lockTtlMs = (betId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
      const locksUpdated = setEntryLock(entryLocksPruned, lockKey, {
        matchId,
        marketId,
        selectionId,
        side: "BACK",
        tradeMode: "over_ht",
        lockedAt: nowIso,
        betId,
        status: extractReportStatus(result),
        expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
      });

      const next = {
        ...current,
        betfair: baseBetfair,
        strategy: {
          ...strategy,
          agent: "overGoalsHT",
          overGoalsHT: {
            ...nextBase,
            entryLocks: locksUpdated,
            phase: "entering",
            entriesCount: entriesCount + 1,
            entryMarketId: marketId,
            selectionId,
            entryPrice,
            stakeAbs,
            enteredAt: nowIso,
            lastEntryAt: nowIso,
            entryBetId: betId,
            lastResult: (result as any)?.__error ? null : result ?? null,
            lastEntryStatus: extractReportStatus(result),
            lastEntryErrorCode: extractReportErrorCode(result),
          },
        },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, item: next, entered: true, reason: "entering" });
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
      const agentRaw = String((strategy as any)?.agent ?? "").trim().toLowerCase();
      const isLegacyScalpingGoals = agentRaw === "scalpinggoals" || agentRaw === "scalping_goals" || agentRaw === "scalping_goals_above";
      const existingTicks = (strategy as any)?.scalpingTicks && typeof (strategy as any).scalpingTicks === "object" ? (strategy as any).scalpingTicks : {};
      const existingGoals = (strategy as any)?.scalpingGoals && typeof (strategy as any).scalpingGoals === "object" ? (strategy as any).scalpingGoals : {};
      const existing = isLegacyScalpingGoals ? { ...existingGoals, ...existingTicks } : existingTicks;

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
      const goalsSafe = typeof goals === "number" && Number.isFinite(goals) ? Math.max(0, Math.floor(goals)) : null;
      const underLineCode = 15;
      const overLineCode = 5;

      let ouOverErr: string | null = null;
      let ouUnderErr: string | null = null;
      const ouOverBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: overLineCode, adminToken: admin.adminToken });
          return slimOuMarket(raw);
        } catch (e) {
          ouOverErr = e instanceof Error ? e.message : String(e);
          return null;
        }
      })();
      const ouUnderBetfair = await (async () => {
        try {
          const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: underLineCode, adminToken: admin.adminToken });
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
      const overUnderBack = Number(ouOverBetfair?.odds?.under?.back);
      const overUnderLay = Number(ouOverBetfair?.odds?.under?.lay);

      const underMarketId = String(ouUnderBetfair?.marketId ?? "").trim();
      const underMarketStatus = String(ouUnderBetfair?.marketStatus ?? "").trim().toUpperCase();
      const underOverSel = Number(ouUnderBetfair?.runners?.overSelectionId);
      const underUnderSel = Number(ouUnderBetfair?.runners?.underSelectionId);
      const underBack = Number(ouUnderBetfair?.odds?.under?.back);
      const underLay = Number(ouUnderBetfair?.odds?.under?.lay);

      const overReady = Boolean(overMarketId && Number.isFinite(overOverSel) && Number.isFinite(overUnderSel));
      const underReady = Boolean(underMarketId && Number.isFinite(underOverSel) && Number.isFinite(underUnderSel));

      if (overMarketId && underMarketId && overMarketId === underMarketId) {
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
              ouMarketError: "Over/Under resolveu para o mesmo marketId (inconsistência).",
            },
          },
          updatedAt: new Date().toISOString(),
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "ou_market_same_id", item: next });
      }

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
      const minMarketMatched = Number(cfg?.minMarketMatched ?? 0);
      const minRunnerMatched = Number(cfg?.minRunnerMatched ?? 0);
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
      const overReevalMinMinutesRaw = Number(cfg?.overReevalMinMinutes ?? 5);
      const overReevalMaxMinutesRaw = Number(cfg?.overReevalMaxMinutes ?? 10);
      const overReevalMinMinutes = Number.isFinite(overReevalMinMinutesRaw) ? Math.max(1, Math.min(60, Math.floor(overReevalMinMinutesRaw))) : 5;
      const overReevalMaxMinutesCandidate = Number.isFinite(overReevalMaxMinutesRaw) ? Math.max(1, Math.min(60, Math.floor(overReevalMaxMinutesRaw))) : 10;
      const overReevalMaxMinutes = Math.max(overReevalMinMinutes, overReevalMaxMinutesCandidate);
      const lateNoGoalEnabled = Boolean(cfg?.lateNoGoalEnabled ?? true);
      const lateNoGoalMinMinuteRaw = Number(cfg?.lateNoGoalMinMinute ?? 80);
      const lateNoGoalMinMinute = Number.isFinite(lateNoGoalMinMinuteRaw) ? Math.max(60, Math.min(120, Math.floor(lateNoGoalMinMinuteRaw))) : 80;
      const lateUnderLimitEnabled = Boolean(cfg?.lateUnderLimitEnabled ?? true);
      const lateUnderLimitMinMinuteRaw = Number(cfg?.lateUnderLimitMinMinute ?? 75);
      const lateUnderLimitMinMinute = Number.isFinite(lateUnderLimitMinMinuteRaw) ? Math.max(0, Math.min(120, Math.floor(lateUnderLimitMinMinuteRaw))) : 75;
      const lateUnderLimitTargetTicksMinRaw = Number(cfg?.lateUnderLimitTargetTicksMin ?? 5);
      const lateUnderLimitTargetTicksMaxRaw = Number(cfg?.lateUnderLimitTargetTicksMax ?? 10);
      const lateUnderLimitTargetTicksMin = Number.isFinite(lateUnderLimitTargetTicksMinRaw)
        ? Math.max(2, Math.min(50, Math.floor(lateUnderLimitTargetTicksMinRaw)))
        : 5;
      const lateUnderLimitTargetTicksMaxCandidate = Number.isFinite(lateUnderLimitTargetTicksMaxRaw)
        ? Math.max(2, Math.min(50, Math.floor(lateUnderLimitTargetTicksMaxRaw)))
        : 10;
      const lateUnderLimitTargetTicksMax = Math.max(lateUnderLimitTargetTicksMin, lateUnderLimitTargetTicksMaxCandidate);
      const lateUnderLimitMinSecondsBetweenCyclesRaw = Number(cfg?.lateUnderLimitMinSecondsBetweenCycles ?? 4);
      const lateUnderLimitMinSecondsBetweenCycles = Number.isFinite(lateUnderLimitMinSecondsBetweenCyclesRaw)
        ? Math.max(1, Math.min(120, Math.floor(lateUnderLimitMinSecondsBetweenCyclesRaw)))
        : 4;
      const hedgeUnderEnabled = Boolean(cfg?.hedgeUnderEnabled ?? true);
      const hedgeUnderAboveGoalsRaw = Number(cfg?.hedgeUnderAboveGoals ?? 2);
      const hedgeUnderAboveGoals = Number.isFinite(hedgeUnderAboveGoalsRaw) ? Math.max(1, Math.min(4, Math.floor(hedgeUnderAboveGoalsRaw))) : 2;
      const hedgeUnderMinMinuteRaw = Number(cfg?.hedgeUnderMinMinute ?? 70);
      const hedgeUnderMinMinute = Number.isFinite(hedgeUnderMinMinuteRaw) ? Math.max(0, Math.min(120, Math.floor(hedgeUnderMinMinuteRaw))) : 70;
      const hedgeUnderStakePctRaw = Number(cfg?.hedgeUnderStakePct ?? 0.25);
      const hedgeUnderStakePct = Number.isFinite(hedgeUnderStakePctRaw) ? Math.max(0.05, Math.min(1, hedgeUnderStakePctRaw)) : 0.25;
      const hedgeUnderTargetTicksRaw = Number(cfg?.hedgeUnderTargetTicks ?? 6);
      const hedgeUnderTargetTicks = Number.isFinite(hedgeUnderTargetTicksRaw) ? Math.max(2, Math.min(50, Math.floor(hedgeUnderTargetTicksRaw))) : 6;

      const stakeAbsCfgRaw = Number(cfg?.stakeAbs);
      const stakeAbsCfg = Number.isFinite(stakeAbsCfgRaw) ? round2(stakeAbsCfgRaw) : NaN;
      const baseStakeAbs =
        Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0
          ? Math.max(2, stakeAbsCfg)
          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
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
      const entryLockTtlSecondsRaw = Number((cfg as any)?.entryLockTtlSeconds ?? 180);
      const entryLockTtlSeconds = Number.isFinite(entryLockTtlSecondsRaw) ? Math.max(5, Math.min(3600, Math.floor(entryLockTtlSecondsRaw))) : 180;
      const entryLockPendingTtlSecondsRaw = Number((cfg as any)?.entryLockPendingTtlSeconds ?? 25);
      const entryLockPendingTtlSeconds = Number.isFinite(entryLockPendingTtlSecondsRaw)
        ? Math.max(4, Math.min(300, Math.floor(entryLockPendingTtlSecondsRaw)))
        : 25;
      const lockKeyFor = (marketId: string, selectionId: number) => {
        const mid = String(marketId ?? "").trim();
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? Math.floor(selectionId) : 0;
        return `${mid}:${sid}:BACK`;
      };
      const readEntryLocks = () => {
        const merged: Record<string, any> = {};
        const add = (raw: any) => {
          if (!raw || typeof raw !== "object") return;
          for (const [k, v] of Object.entries(raw)) {
            const key = String(k ?? "").trim();
            if (!key) continue;
            if (!v || typeof v !== "object") continue;
            merged[key] = v;
          }
        };
        add((strategy as any)?.entryLocks);
        add((existing as any)?.entryLocks);
        for (const k of Object.keys(strategy)) {
          const sub = (strategy as any)[k];
          if (!sub || typeof sub !== "object") continue;
          if (sub?.entryLocks && typeof sub.entryLocks === "object") add(sub.entryLocks);
        }
        return merged;
      };
      const pruneEntryLocks = (locks: any) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(locks ?? {})) {
          if (!k) continue;
          if (!v || typeof v !== "object") continue;
          const exp = Number((v as any)?.expiresAtMs);
          if (Number.isFinite(exp) && exp > nowMs) out[k] = v;
        }
        return out;
      };
      const entryLocksPruned = pruneEntryLocks(readEntryLocks());
      const isEntryLocked = (locks: any, key: string) => {
        const v = locks && typeof locks === "object" ? (locks as any)[key] : null;
        const exp = Number(v?.expiresAtMs);
        return Boolean(v && Number.isFinite(exp) && exp > nowMs);
      };
      const setEntryLock = (locks: any, key: string, value: any) => {
        const base = locks && typeof locks === "object" ? locks : {};
        return { ...base, [key]: value };
      };
      const clearEntryLock = (locks: any, key: string) => {
        const base = locks && typeof locks === "object" ? locks : {};
        const { [key]: _, ...rest } = base as any;
        return rest;
      };
      const pickOverReevalAtMs = () => {
        const span = Math.max(0, overReevalMaxMinutes - overReevalMinMinutes);
        const minutes = span > 0 ? overReevalMinMinutes + Math.floor(Math.random() * (span + 1)) : overReevalMinMinutes;
        return nowMs + Math.max(1, minutes) * 60_000;
      };
      const timelineElapsed = Number((baseBetfair as any)?.timeline?.elapsed);
      const timelineScoreHome = Number((baseBetfair as any)?.timeline?.scoreHome);
      const timelineScoreAway = Number((baseBetfair as any)?.timeline?.scoreAway);
      const scoreHomeNow = typeof scoreHome === "number" ? scoreHome : null;
      const scoreAwayNow = typeof scoreAway === "number" ? scoreAway : null;
      const totalGoalsNow = typeof scoreHomeNow === "number" && typeof scoreAwayNow === "number" ? scoreHomeNow + scoreAwayNow : null;
      const marketStartIso = String(baseBetfair?.marketStartTime ?? (current as any)?.utcDate ?? "").trim();
      const marketStartMs = marketStartIso ? new Date(marketStartIso).getTime() : NaN;
      const elapsedSec =
        Number.isFinite(timelineElapsed) ? Math.max(0, Math.floor(timelineElapsed * 60))
        : Number.isFinite(marketStartMs) ? Math.floor((nowMs - marketStartMs) / 1000)
        : null;
      const elapsedMin = typeof elapsedSec === "number" ? elapsedSec / 60 : null;
      const lateMode = typeof elapsedMin === "number" && Number.isFinite(elapsedMin) && elapsedMin >= 75;
      const veryLateMode = typeof elapsedMin === "number" && Number.isFinite(elapsedMin) && elapsedMin >= lateNoGoalMinMinute;
      const lateUnderLimitMode =
        lateUnderLimitEnabled &&
        typeof elapsedMin === "number" &&
        Number.isFinite(elapsedMin) &&
        elapsedMin >= lateUnderLimitMinMinute;

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

      const sideSignal = momentOver.trigger ? "over" : "under";
      let side = sideSignal;
      if (side === "over" && !overReady) side = "over";
      if (side === "under" && !underReady) side = "under";

      const marketId = side === "over" ? overMarketId : underMarketId;
      const marketStatus = (side === "over" ? overMarketStatus : underMarketStatus) || "";
      const selectionId = side === "over" ? overOverSel : underUnderSel;
      const bestBack = side === "over" ? overBack : underBack;
      const bestLay = side === "over" ? overLay : underLay;
      const marketMatched = side === "over" ? overMarketMatched : underMarketMatched;
      const sideForLate =
        phase === "entered" || phase === "entering"
          ? String(existing?.side ?? side).trim().toLowerCase() === "over"
            ? "over"
            : "under"
          : side;
      const lateUnderLimitApplies =
        lateUnderLimitMode &&
        sideForLate === "under" &&
        !momentOver.trigger;
      const minSecondsBetweenCyclesUsed = lateUnderLimitApplies ? lateUnderLimitMinSecondsBetweenCycles : minSecondsBetweenCycles;
      const pickTargetTicksForNewEntry = () => {
        if (!lateUnderLimitApplies) return Number.isFinite(targetTicks) ? Math.floor(targetTicks) : 10;
        const minT = lateUnderLimitTargetTicksMin;
        const maxT = lateUnderLimitTargetTicksMax;
        if (maxT <= minT) return minT;
        return minT + Math.floor(Math.random() * (maxT - minT + 1));
      };

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

      const prevAlertActive = Boolean(existing?.goalAlertActive ?? false);
      const prevAlertOffAtMsRaw = Number((existing as any)?.alertOffAtMs);
      const prevAlertOffAtMs = Number.isFinite(prevAlertOffAtMsRaw) && prevAlertOffAtMsRaw > 0 ? prevAlertOffAtMsRaw : null;

      const alertActiveNow = Boolean(momentOver.trigger);
      const wentOffNow = prevAlertActive && !alertActiveNow;
      const alertOffAtMs = wentOffNow ? nowMs : prevAlertOffAtMs;

      const minOffSecondsRaw = Number((cfg as any)?.alertEpisodeMinOffSeconds ?? 25);
      const minOffMs =
        (Number.isFinite(minOffSecondsRaw) ? Math.max(0, Math.min(300, Math.floor(minOffSecondsRaw))) : 25) * 1000;
      const offAgeMs =
        !prevAlertActive && alertActiveNow && alertOffAtMs != null && Number.isFinite(alertOffAtMs) && alertOffAtMs > 0
          ? nowMs - alertOffAtMs
          : Number.POSITIVE_INFINITY;
      const isNewAlertEpisode = alertActiveNow && !prevAlertActive && (alertOffAtMs == null || offAgeMs > minOffMs);

      const prevOverEntriesInAlert = Math.max(0, Math.floor(Number((existing as any)?.overEntriesInAlert ?? 0) || 0));
      const prevAlertOverEntriesInAlert = Math.max(0, Math.floor(Number((existing as any)?.alertOverEntriesInAlert ?? 0) || 0));
      const overEntriesInAlert = isNewAlertEpisode ? 0 : prevOverEntriesInAlert;
      const alertOverEntriesInAlert = isNewAlertEpisode ? 0 : prevAlertOverEntriesInAlert;

      const baseState = {
        ...existing,
        entryLocks: entryLocksPruned,
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
        goalAlertActive: alertActiveNow,
        alertOffAtMs: alertOffAtMs == null ? null : alertOffAtMs,
        overEntriesInAlert,
        alertOverEntriesInAlert,
        momentSnapAtMs: Number.isFinite(momentOver.nextSnapAtMs) ? momentOver.nextSnapAtMs : null,
        momentOverMatched: (momentOver as any)?.nextOverMatched ?? null,
        momentUnderMatched: (momentOver as any)?.nextUnderMatched ?? null,
        momentOverBack: (momentOver as any)?.nextOverBack ?? null,
        lastMomentOverScore: (momentOver as any)?.score ?? null,
        lastMomentOverThreshold: (momentOver as any)?.threshold ?? null,
      };

      if (sideSignal === "over" && !overReady && (!phase || phase === "monitoring" || phase === "cooldown" || phase === "closed")) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "over_market_not_ready", item: next });
      }

      if (sideSignal === "under" && !underReady && (!phase || phase === "monitoring" || phase === "cooldown" || phase === "closed")) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "under_market_not_ready", item: next });
      }

      let ouOrdersCache: any[] | null = null;
      const getOuOrders = async () => {
        if (ouOrdersCache) return ouOrdersCache;
        ouOrdersCache = [];
        const mids = uniqStrings([overMarketId, underMarketId]).filter(Boolean);
        if (mids.length === 0) return ouOrdersCache;
        try {
          const res = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: mids });
          const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
          ouOrdersCache = currentOrders;
        } catch {}
        return ouOrdersCache;
      };

      const findExistingBackEntry = async (marketId: string, selectionId: number) => {
        const orders = await getOuOrders();
        const candidates = orders.filter((o: any) => {
          const mid = String(o?.marketId ?? "").trim();
          const sid = Number(o?.selectionId);
          const sideRaw = String(o?.side ?? "").trim().toUpperCase();
          if (mid !== String(marketId ?? "").trim()) return false;
          if (!(Number.isFinite(sid) && sid > 0 && sid === Number(selectionId))) return false;
          if (sideRaw !== "BACK") return false;
          const sizeMatched = Number(o?.sizeMatched);
          const sizeRemaining = Number(o?.sizeRemaining);
          return (Number.isFinite(sizeMatched) && sizeMatched > 0) || (Number.isFinite(sizeRemaining) && sizeRemaining > 0);
        });
        if (candidates.length === 0) return null;
        candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
        const pick = candidates[0] ?? null;
        if (!pick) return null;
        const betId = String(pick?.betId ?? "").trim() || null;
        const placedAt = String(pick?.placedDate ?? "").trim() || null;
        const price = Number(pick?.priceSize?.price ?? pick?.price);
        const sizeMatched = Number(pick?.sizeMatched);
        const sizeRemaining = Number(pick?.sizeRemaining);
        const averagePriceMatched = Number(pick?.averagePriceMatched);
        const status = String(pick?.status ?? "").trim().toUpperCase() || null;
        return {
          betId,
          placedAt,
          price: Number.isFinite(price) && price > 1 ? price : null,
          sizeMatched: Number.isFinite(sizeMatched) ? sizeMatched : null,
          sizeRemaining: Number.isFinite(sizeRemaining) ? sizeRemaining : null,
          averagePriceMatched: Number.isFinite(averagePriceMatched) ? averagePriceMatched : null,
          status,
        };
      };

      const findExistingLayTp = async (marketId: string, selectionId: number) => {
        const orders = await getOuOrders();
        const candidates = orders.filter((o: any) => {
          const mid = String(o?.marketId ?? "").trim();
          const sid = Number(o?.selectionId);
          const sideRaw = String(o?.side ?? "").trim().toUpperCase();
          if (mid !== String(marketId ?? "").trim()) return false;
          if (!(Number.isFinite(sid) && sid > 0 && sid === Number(selectionId))) return false;
          if (sideRaw !== "LAY") return false;
          const sizeRemaining = Number(o?.sizeRemaining);
          return Number.isFinite(sizeRemaining) && sizeRemaining > 0;
        });
        if (candidates.length === 0) return null;
        candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
        const pick = candidates[0] ?? null;
        if (!pick) return null;
        const betId = String(pick?.betId ?? "").trim() || null;
        const placedAt = String(pick?.placedDate ?? "").trim() || null;
        const price = Number(pick?.priceSize?.price ?? pick?.price);
        const sizeRemaining = Number(pick?.sizeRemaining);
        const sizeMatched = Number(pick?.sizeMatched);
        const status = String(pick?.status ?? "").trim().toUpperCase() || null;
        const size =
          Number.isFinite(sizeRemaining) && sizeRemaining > 0
            ? sizeRemaining
            : Number.isFinite(sizeMatched) && sizeMatched > 0
              ? sizeMatched
              : null;
        return {
          betId,
          placedAt,
          price: Number.isFinite(price) && price > 1 ? price : null,
          size,
          status,
        };
      };

      const mkStableCustomerRef = (action: string, matchId: string, marketId: string, selectionId: number) => {
        const a = String(action ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "x";
        const id = String(matchId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const tail = id.slice(-8) || "0";
        const mid = String(marketId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const midTail = mid.slice(-6) || "m";
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? String(Math.floor(selectionId)).slice(-4) : "0";
        const bucket = Math.floor(Date.now() / 4000).toString(36);
        let ref = `st-${a}-${tail}-${midTail}${sid}-${bucket}`;
        if (ref.length > 32) ref = ref.slice(0, 32);
        return ref;
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

          const entrySelectionId = Number(existing?.selectionId ?? (enteringSide === "over" ? overOverSel : underUnderSel));
          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(entrySelectionId) && entrySelectionId > 0 && entryMarketId
              ? clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId))
              : locksNow;
          const nextCooldownUntilMs = nowMs + afterGoalWaitSeconds * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksCleared,
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

          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(posSelectionId) && posSelectionId > 0 && posMarketId
              ? clearEntryLock(locksNow, lockKeyFor(posMarketId, posSelectionId))
              : locksNow;
          const nextCooldownUntilMs = nowMs + afterGoalWaitSeconds * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksCleared,
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

      const minCycleSecSafe = Number.isFinite(minSecondsBetweenCyclesUsed) ? Math.max(1, Math.floor(minSecondsBetweenCyclesUsed)) : 8;
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

      const runnerMatched = Number(
        side === "over"
          ? ouOverBetfair?.odds?.over?.runnerMatched
          : ouUnderBetfair?.odds?.under?.runnerMatched,
      );
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
        const entryOdds = (() => {
          const mid = String(entryMarketId ?? "").trim();
          const sid = Number(entrySelectionId);
          if (mid === overMarketId && sid === overOverSel) return { bestBack: overBack, bestLay: overLay };
          if (mid === overMarketId && sid === overUnderSel) return { bestBack: overUnderBack, bestLay: overUnderLay };
          if (mid === underMarketId && sid === underOverSel) return { bestBack: Number(ouUnderBetfair?.odds?.over?.back), bestLay: Number(ouUnderBetfair?.odds?.over?.lay) };
          if (mid === underMarketId && sid === underUnderSel) return { bestBack: underBack, bestLay: underLay };
          return { bestBack: enteringSide === "over" ? overBack : underBack, bestLay: enteringSide === "over" ? overLay : underLay };
        })();
        const entryBestBack = entryOdds.bestBack;
        const entryBestLay = entryOdds.bestLay;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const entryPlacedAtIso = String(existing?.lastEntryAt ?? existing?.enteredAt ?? "").trim();
        const entryPlacedAtMs = entryPlacedAtIso ? new Date(entryPlacedAtIso).getTime() : 0;

        if (enteringSide === "under" && lateUnderLimitMode && Boolean(momentOver.trigger)) {
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

          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(entrySelectionId) && entrySelectionId > 0 && entryMarketId
              ? clearEntryLock(locksNow, lockKeyFor(entryMarketId, entrySelectionId))
              : locksNow;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksCleared,
                phase: "cooldown",
                cooldownUntilMs: nowMs + 5_000,
                lastExitReason: "late_under_goal_alert_cancel",
                takeProfit: null,
                lastEntryStatus: "CANCELLED",
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "late_under_goal_alert_cancel", item: next });
        }

        if (!entryBetId) {
          const adopted = await findExistingBackEntry(entryMarketId, entrySelectionId);
          if (adopted?.betId) {
            const hasMatched = Number(adopted?.sizeMatched) > 0;
            const tpExisting = hasMatched ? await findExistingLayTp(entryMarketId, entrySelectionId) : null;
            const takeProfit =
              tpExisting && tpExisting.betId && tpExisting.price != null && tpExisting.size != null
                ? { betId: tpExisting.betId, price: tpExisting.price, size: tpExisting.size, placedAt: tpExisting.placedAt ?? nowIso, status: tpExisting.status, errorCode: null, result: null, error: null }
                : null;
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "scalpingTicks",
                scalpingTicks: {
                  ...baseState,
                  phase: hasMatched && takeProfit ? "entered" : "entering",
                  entryMarketId,
                  entryLineCode: Number(existing?.entryLineCode),
                  selectionId: entrySelectionId,
                  entryPrice: adopted.averagePriceMatched ?? adopted.price ?? Number(existing?.entryPrice ?? bestBack),
                  stakeAbs: Number.isFinite(adopted.sizeMatched) && adopted.sizeMatched > 0 ? adopted.sizeMatched : Number(existing?.stakeAbs ?? stakeAbs),
                  enteredAt: String(existing?.enteredAt ?? nowIso),
                  lastEntryAt: String(existing?.lastEntryAt ?? nowIso),
                  entryBetId: adopted.betId,
                  entryMatchedSize: adopted.sizeMatched ?? null,
                  entryRemainingSize: adopted.sizeRemaining ?? null,
                  entryMatchedAt: hasMatched ? nowIso : null,
                  takeProfit,
                  lastEntryStatus: adopted.status,
                  lastEntryErrorCode: null,
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, entered: Boolean(hasMatched), skipped: true, reason: "adopt_missing_betid", item: next });
          }

          if (entryPlacedAtMs && Number.isFinite(entryPlacedAtMs) && nowMs - entryPlacedAtMs < 6_000) {
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "entering", entryMarketId, selectionId: entrySelectionId, lastEntryStatus: "PENDING_BETID" } },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "await_betid", item: next });
          }

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "monitoring", lastEntryStatus: "MISSING_BETID" } },
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
          const cycleTargetTicks0 = Number(existing?.cycleTargetTicks);
          const targetTicksUsed =
            Number.isFinite(cycleTargetTicks0) && cycleTargetTicks0 > 0
              ? Math.floor(cycleTargetTicks0)
              : Number.isFinite(targetTicks)
                ? Math.floor(targetTicks)
                : 6;
          const targetPrice = movePriceByTicks(entryPriceSafe, -Math.max(2, targetTicksUsed));
          const hedgeSizeAtTarget = Number.isFinite(targetPrice) && targetPrice > 1 ? Math.max(2, round2((entryPriceSafe * matchedSafe) / targetPrice)) : null;

          let takeProfit = null as any;
          if (hedgeSizeAtTarget != null) {
            const tpRes = await placeOrders({
              adminToken: admin.adminToken,
              marketId: entryMarketId,
              customerRef: mkStableCustomerRef("tp", matchId, entryMarketId, entrySelectionId),
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

          const entrySide = String(existing?.side ?? "").trim().toLowerCase() === "over" ? "over" : "under";
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
                cycleTargetTicks: Number.isFinite(targetTicksUsed) ? targetTicksUsed : null,
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
                ...(entrySide === "over"
                  ? {
                      overReevalAtMs: pickOverReevalAtMs(),
                      overReevalStartedAt: nowIso,
                      overReevalStartScoreHome: baseState.lastScoreHome ?? null,
                      overReevalStartScoreAway: baseState.lastScoreAway ?? null,
                    }
                  : {
                      overReevalAtMs: null,
                      overReevalStartedAt: null,
                      overReevalStartScoreHome: null,
                      overReevalStartScoreAway: null,
                    }),
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

          const entryPrice =
            !momentOver.trigger && Number.isFinite(entryBestLay) && entryBestLay > 1
              ? entryBestLay
              : currentBestBackForEntry;
          const result = await placeOrders({
            adminToken: admin.adminToken,
            marketId: entryMarketId,
            customerRef: mkStableCustomerRef("rp", matchId, entryMarketId, entrySelectionId),
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
          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const entryLockKey = lockKeyFor(entryMarketId, entrySelectionId);
          const lockTtlMs = (newEntryBetId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
          const locksUpdated = setEntryLock(locksNow, entryLockKey, {
            matchId,
            marketId: entryMarketId,
            selectionId: entrySelectionId,
            side: "BACK",
            tradeMode: enteringSide,
            lockedAt: nowIso,
            betId: newEntryBetId,
            status: extractReportStatus(result),
            expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
          });

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksUpdated,
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
        const existingEntryOver = overReady ? await findExistingBackEntry(overMarketId, overOverSel) : null;
        const existingEntryUnder = underReady ? await findExistingBackEntry(underMarketId, underUnderSel) : null;
        const pickExisting = (a: any, b: any) => {
          if (!a && !b) return null;
          if (a && !b) return a;
          if (!a && b) return b;
          const atA = String(a?.placedAt ?? "").trim();
          const atB = String(b?.placedAt ?? "").trim();
          if (atA && atB) return atA.localeCompare(atB) >= 0 ? a : b;
          return a ?? b;
        };
        const existingEntry = pickExisting(existingEntryOver, existingEntryUnder);
        if (existingEntry) {
          const existingBetId = String(existingEntry?.betId ?? "").trim();
          const adoptedSide =
            existingEntryOver && String((existingEntryOver as any)?.betId ?? "").trim() === existingBetId
              ? "over"
              : "under";
          const adoptedMarketId = adoptedSide === "over" ? overMarketId : underMarketId;
          const adoptedSelectionId = adoptedSide === "over" ? overOverSel : underUnderSel;
          const adoptedBestBack = adoptedSide === "over" ? overBack : underBack;
          const spreadTicksUsed = adoptedSide === "over" ? overSpreadTicks : underSpreadTicks;
          const sizeMatched = Number(existingEntry.sizeMatched);
          const sizeRemaining = Number(existingEntry.sizeRemaining);
          const hasMatched = Number.isFinite(sizeMatched) && sizeMatched > 0;
          const tpExisting = hasMatched
            ? await findExistingLayTp(adoptedMarketId, adoptedSelectionId)
            : null;
          const stakeFromOrders =
            Number.isFinite(sizeMatched) && sizeMatched > 0
              ? Math.max(2, round2(sizeMatched))
              : Number.isFinite(sizeRemaining) && sizeRemaining > 0
                ? Math.max(2, round2(sizeRemaining))
                : stakeAbs;
          const tpPrice = tpExisting?.price ?? null;
          const tpSize = tpExisting?.size ?? null;
          const takeProfit =
            tpExisting && tpExisting.betId && tpPrice != null && tpSize != null
              ? { betId: tpExisting.betId, price: tpPrice, size: tpSize, placedAt: tpExisting.placedAt ?? nowIso, status: tpExisting.status, errorCode: null, result: null, error: null }
              : null;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                phase: hasMatched && takeProfit ? "entered" : "entering",
                cycleCount,
                ...(alertActiveNow && adoptedSide === "over"
                  ? { overEntriesInAlert: Math.max(1, Math.floor(Number((baseState as any)?.overEntriesInAlert ?? 0) || 0)) }
                  : {}),
                entryMarketId: adoptedMarketId,
                entryLineCode: adoptedSide === "over" ? overLineCode : underLineCode,
                selectionId: adoptedSelectionId,
                entryPrice:
                  (existingEntry.averagePriceMatched != null && existingEntry.averagePriceMatched > 1 ? existingEntry.averagePriceMatched : null) ??
                  existingEntry.price ??
                  Number(existing?.entryPrice ?? adoptedBestBack),
                targetPrice: takeProfit ? tpPrice : Number(existing?.targetPrice),
                stakeAbs: stakeFromOrders,
                spreadTicks: spreadTicksUsed,
                enteredAt: String(existing?.enteredAt ?? nowIso),
                lastEntryAt: nowIso,
                entryBetId: existingEntry.betId,
                entryMatchedSize: hasMatched ? Math.max(0, round2(sizeMatched)) : null,
                entryRemainingSize: Number.isFinite(sizeRemaining) ? Math.max(0, round2(sizeRemaining)) : null,
                entryMatchedAt: hasMatched ? nowIso : null,
                takeProfit,
                lastEntryStatus: existingEntry.status,
                lastEntryErrorCode: null,
              },
            },
            status: String((current as any)?.status ?? "running"),
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, skipped: true, reason: "adopt_existing_entry" });
        }

        if (alertActiveNow && side === "over") {
          const count = Number((baseState as any)?.overEntriesInAlert);
          if (Number.isFinite(count) && count >= 3) {
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: "monitoring" } },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, skipped: true, reason: "over_entries_cap", item: next });
          }
        }

        const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
        const entryLockKey = lockKeyFor(marketId, selectionId);
        if (isEntryLocked(locksNow, entryLockKey)) {
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState, phase: phase || "monitoring" } },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "entry_locked", item: next });
        }

        const entryOffsetTicksSafe = Number.isFinite(entryOffsetTicks) ? Math.floor(entryOffsetTicks) : 0;
        const baseForEntry =
          !momentOver.trigger && Number.isFinite(bestLay) && bestLay > 1
            ? bestLay
            : bestBack;
        const entryPrice = movePriceByTicks(baseForEntry, !momentOver.trigger ? 0 : entryOffsetTicksSafe);
        const cycleTargetTicks = pickTargetTicksForNewEntry();
        const result = await placeOrders({
          adminToken: admin.adminToken,
          marketId,
          customerRef: mkStableCustomerRef("en", matchId, marketId, selectionId),
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
        const lockTtlMs = (entryBetId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
        const locksUpdated = setEntryLock(locksNow, entryLockKey, {
          matchId,
          marketId,
          selectionId,
          side: "BACK",
          tradeMode: side,
          lockedAt: nowIso,
          betId: entryBetId,
          status: entryStatus,
          expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
        });

        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "scalpingTicks",
            scalpingTicks: {
              ...baseState,
              entryLocks: locksUpdated,
              phase: "entering",
              cycleCount,
              ...(alertActiveNow && side === "over"
                ? { overEntriesInAlert: Math.max(0, Math.floor(Number((baseState as any)?.overEntriesInAlert ?? 0) || 0)) + 1 }
                : {}),
              entryMarketId: marketId,
              entryLineCode: String(marketId ?? "").trim() === String(overMarketId ?? "").trim() ? overLineCode : underLineCode,
              selectionId,
              entryPrice,
              cycleTargetTicks,
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
        const posOdds = (() => {
          const mid = String(posMarketId ?? "").trim();
          const sid = Number(posSelectionId);
          if (mid === overMarketId && sid === overOverSel) return { bestBack: overBack, bestLay: overLay, runnerMatched: overMatchedNow };
          if (mid === overMarketId && sid === overUnderSel) return { bestBack: overUnderBack, bestLay: overUnderLay, runnerMatched: Number(ouOverBetfair?.odds?.under?.runnerMatched) };
          if (mid === underMarketId && sid === underOverSel) return { bestBack: Number(ouUnderBetfair?.odds?.over?.back), bestLay: Number(ouUnderBetfair?.odds?.over?.lay), runnerMatched: Number(ouUnderBetfair?.odds?.over?.runnerMatched) };
          if (mid === underMarketId && sid === underUnderSel) return { bestBack: underBack, bestLay: underLay, runnerMatched: underMatchedNow };
          return { bestBack: activeSide === "over" ? overBack : underBack, bestLay: activeSide === "over" ? overLay : underLay, runnerMatched: activeSide === "over" ? overMatchedNow : underMatchedNow };
        })();
        const posBestBack = posOdds.bestBack;
        const posBestLay = posOdds.bestLay;
        const tpBetId = String(existing?.takeProfit?.betId ?? "").trim() || null;
        const tpPrice = Number(existing?.takeProfit?.price);
        const lastTpCheckAt = String(existing?.lastTpCheckAt ?? "").trim();
        const lastTpCheckAtMs = lastTpCheckAt ? new Date(lastTpCheckAt).getTime() : 0;
        const lastTpPlaceAt = String(existing?.lastTpPlaceAt ?? "").trim();
        const lastTpPlaceAtMs = lastTpPlaceAt ? new Date(lastTpPlaceAt).getTime() : 0;
        const pendingExitAt = String((existing as any)?.pendingExitAt ?? "").trim();
        const pendingExitAtMs = pendingExitAt ? new Date(pendingExitAt).getTime() : 0;
        const overReevalAtMs = Number((existing as any)?.overReevalAtMs);
        const overStartHome = Number((existing as any)?.overReevalStartScoreHome);
        const overStartAway = Number((existing as any)?.overReevalStartScoreAway);

        const isSameScoreAsOverStart =
          activeSide === "over" &&
          typeof scoreHomeNow === "number" &&
          typeof scoreAwayNow === "number" &&
          Number.isFinite(overStartHome) &&
          Number.isFinite(overStartAway) &&
          scoreHomeNow === overStartHome &&
          scoreAwayNow === overStartAway;

        if (activeSide === "under" && lateUnderLimitMode && Boolean(momentOver.trigger)) {
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
          } else if (marketStatus !== "SUSPENDED" && Number.isFinite(posBestLay) && posBestLay > 1) {
            const entryPrice = Number(existing?.entryPrice);
            const hedgeSize =
              Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0
                ? Math.max(2, round2((entryPrice * entrySizeMatched) / posBestLay))
                : Math.max(2, round2(entrySizeMatched));
            try {
              await placeOrders({
                adminToken: admin.adminToken,
                marketId: posMarketId,
                customerRef: mkCustomerRef("lx", matchId),
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
          }

          const minCycleSecSafe = Number.isFinite(minSecondsBetweenCyclesUsed) ? Math.max(1, Math.floor(minSecondsBetweenCyclesUsed)) : 8;
          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(posSelectionId) && posSelectionId > 0 && posMarketId
              ? clearEntryLock(locksNow, lockKeyFor(posMarketId, posSelectionId))
              : locksNow;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksCleared,
                phase: "cooldown",
                cooldownUntilMs: nowMs + minCycleSecSafe * 1000,
                lastClosedAt: nowIso,
                closedAt: nowIso,
                lastExitReason: "late_under_goal_alert_exit",
                pendingExitAt: marketStatus === "SUSPENDED" ? nowIso : null,
                pendingExitReason: marketStatus === "SUSPENDED" ? "late_under_goal_alert_pending" : null,
                takeProfit: null,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, closed: true, reason: "late_under_goal_alert_exit" });
        }

        
        if (
          activeSide === "over" &&
          Number.isFinite(overReevalAtMs) &&
          overReevalAtMs > 0 &&
          nowMs >= overReevalAtMs &&
          isSameScoreAsOverStart &&
          Number.isFinite(posBestLay) &&
          posBestLay > 1
        ) {
          if (
            lateNoGoalEnabled &&
            veryLateMode &&
            totalGoalsNow === 0 &&
            Number.isFinite(overUnderBack) &&
            overUnderBack > 1 &&
            Number.isFinite(overUnderLay) &&
            overUnderLay > 1
          ) {
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
                Number.isFinite(entryPrice) && entryPrice > 1 && Number.isFinite(entrySizeMatched) && entrySizeMatched > 0
                  ? Math.max(2, round2((entryPrice * entrySizeMatched) / posBestLay))
                  : Math.max(2, round2(Number(existing?.stakeAbs ?? stakeAbs)));
              try {
                await placeOrders({
                  adminToken: admin.adminToken,
                  marketId: posMarketId,
                  customerRef: mkCustomerRef("rx", matchId),
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

            const minCycleSecSafe = Number.isFinite(minSecondsBetweenCyclesUsed) ? Math.max(1, Math.floor(minSecondsBetweenCyclesUsed)) : 8;
            const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
            const locksCleared =
              Number.isFinite(posSelectionId) && posSelectionId > 0 && posMarketId
                ? clearEntryLock(locksNow, lockKeyFor(posMarketId, posSelectionId))
                : locksNow;
            const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "scalpingTicks",
                scalpingTicks: {
                  ...baseState,
                  entryLocks: locksCleared,
                  phase: "cooldown",
                  cycleCount: cycleCount + 1,
                  closedAt: nowIso,
                  lastClosedAt: nowIso,
                  cooldownUntilMs: nextCooldownUntilMs,
                  lastExitReason: "late_no_goal_rebalance",
                  pendingExitAt: null,
                  pendingExitReason: null,
                  
                  overReevalAtMs: null,
                  overReevalStartedAt: null,
                  overReevalStartScoreHome: null,
                  overReevalStartScoreAway: null,
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, item: next, closed: true, reason: "late_no_goal_rebalance" });
          }

          if (!momentOver.trigger) {
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
                customerRef: mkCustomerRef("rx", matchId),
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

            const minCycleSecSafe = Number.isFinite(minSecondsBetweenCyclesUsed) ? Math.max(1, Math.floor(minSecondsBetweenCyclesUsed)) : 8;
            const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
            const locksCleared =
              Number.isFinite(posSelectionId) && posSelectionId > 0 && posMarketId
                ? clearEntryLock(locksNow, lockKeyFor(posMarketId, posSelectionId))
                : locksNow;
            const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
            const next = {
              ...current,
              betfair: baseBetfair,
              strategy: {
                ...strategy,
                agent: "scalpingTicks",
                scalpingTicks: {
                  ...baseState,
                  entryLocks: locksCleared,
                  phase: "cooldown",
                  cycleCount: cycleCount + 1,
                  closedAt: nowIso,
                  lastClosedAt: nowIso,
                  cooldownUntilMs: nextCooldownUntilMs,
                  lastExitReason: "over_reeval_under",
                  pendingExitAt: null,
                  pendingExitReason: null,
                  overReevalAtMs: null,
                  overReevalStartedAt: null,
                  overReevalStartScoreHome: null,
                  overReevalStartScoreAway: null,
                },
              },
              updatedAt: nowIso,
            };
            await setQueueItem(matchId, next);
            return json({ ok: true, item: next, closed: true, reason: "over_reeval_under" });
          }

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: { ...baseState, phase: "entered", overReevalAtMs: pickOverReevalAtMs() },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, item: next, skipped: true, reason: "over_reeval_keep" });
        }

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

          const locksNow = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(posSelectionId) && posSelectionId > 0 && posMarketId
              ? clearEntryLock(locksNow, lockKeyFor(posMarketId, posSelectionId))
              : locksNow;
          const minCycleSecSafe = Number.isFinite(minSecondsBetweenCyclesUsed) ? Math.max(1, Math.floor(minSecondsBetweenCyclesUsed)) : 8;
          const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState,
                entryLocks: locksCleared,
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
            const cycleTargetTicks0 = Number(existing?.cycleTargetTicks);
            const targetTicksUsed =
              Number.isFinite(cycleTargetTicks0) && cycleTargetTicks0 > 0
                ? Math.floor(cycleTargetTicks0)
                : Number.isFinite(targetTicks)
                  ? Math.floor(targetTicks)
                  : 6;
            const targetPrice0 =
              Number(existing?.targetPrice) > 1
                ? Number(existing?.targetPrice)
                : Number.isFinite(entryPrice0) && entryPrice0 > 1
                  ? movePriceByTicks(entryPrice0, -Math.max(2, targetTicksUsed))
                  : NaN;

            if (Number.isFinite(entryPrice0) && entryPrice0 > 1 && Number.isFinite(targetPrice0) && targetPrice0 > 1 && Number.isFinite(stake0) && stake0 > 0) {
              const hedgeSizeAtTarget = Math.max(2, round2((entryPrice0 * stake0) / targetPrice0));
              const tpRes = await placeOrders({
                adminToken: admin.adminToken,
                marketId: posMarketId,
                customerRef: mkStableCustomerRef("tr", matchId, posMarketId, posSelectionId),
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

        if (
          hedgeUnderEnabled &&
          activeSide === "over" &&
          totalGoalsNow === 0 &&
          typeof elapsedMin === "number" &&
          Number.isFinite(elapsedMin) &&
          elapsedMin >= hedgeUnderMinMinute &&
          Boolean(momentOver.trigger)
        ) {
          const hedgeLineCode = Math.max(5, Math.floor(overLineCode + hedgeUnderAboveGoals * 10));
          const hedgeState = ((existing as any)?.hedgeUnder && typeof (existing as any).hedgeUnder === "object") ? (existing as any).hedgeUnder : {};
          const hedgePhase = String(hedgeState?.phase ?? "").trim();
          const hedgeMarketIdStored = String(hedgeState?.marketId ?? "").trim() || null;
          const hedgeSelectionIdStored = Number(hedgeState?.selectionId);
          const hedgeEntryBetIdStored = String(hedgeState?.entryBetId ?? "").trim() || null;
          const hedgeTpBetIdStored = String(hedgeState?.takeProfit?.betId ?? "").trim() || null;
          const hedgeEntryPriceStored = Number(hedgeState?.entryPrice);
          const hedgeTargetPriceStored = Number(hedgeState?.targetPrice);
          const hedgeStakeAbsStored = Number(hedgeState?.stakeAbs);
          const hedgeCooldownUntilMsStored = Number(hedgeState?.cooldownUntilMs);

          const resolveHedge = async () => {
            const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: hedgeLineCode, adminToken: admin.adminToken });
            const slim = slimOuMarket(raw);
            const mid = String(slim?.marketId ?? "").trim();
            const selUnder = Number(slim?.runners?.underSelectionId);
            const bestBackUnder = Number(slim?.odds?.under?.back);
            const bestLayUnder = Number(slim?.odds?.under?.lay);
            return { mid, selUnder, bestBackUnder, bestLayUnder };
          };

          const hedgeCooldownSec = Number.isFinite(minSecondsBetweenCycles) ? Math.max(5, Math.min(120, Math.floor(minSecondsBetweenCycles))) : 8;

          let hedgeMid = hedgeMarketIdStored;
          let hedgeSel = Number.isFinite(hedgeSelectionIdStored) ? hedgeSelectionIdStored : NaN;
          let hedgeBestBack = NaN;
          let hedgeBestLay = NaN;
          try {
            const r = await resolveHedge();
            hedgeMid = r.mid || hedgeMid;
            hedgeSel = Number.isFinite(r.selUnder) ? r.selUnder : hedgeSel;
            hedgeBestBack = r.bestBackUnder;
            hedgeBestLay = r.bestLayUnder;
          } catch {}

          const pickBack = (orders: any[]) => {
            const candidates = orders.filter((o: any) => {
              const mid = String(o?.marketId ?? "").trim();
              const sid = Number(o?.selectionId);
              const sideRaw = String(o?.side ?? "").trim().toUpperCase();
              if (mid !== String(hedgeMid ?? "").trim()) return false;
              if (!(Number.isFinite(sid) && sid > 0 && sid === Number(hedgeSel))) return false;
              if (sideRaw !== "BACK") return false;
              const sizeMatched = Number(o?.sizeMatched);
              const sizeRemaining = Number(o?.sizeRemaining);
              return (Number.isFinite(sizeMatched) && sizeMatched > 0) || (Number.isFinite(sizeRemaining) && sizeRemaining > 0);
            });
            if (candidates.length === 0) return null;
            candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
            return candidates[0] ?? null;
          };

          const pickLayTp = (orders: any[]) => {
            const candidates = orders.filter((o: any) => {
              const mid = String(o?.marketId ?? "").trim();
              const sid = Number(o?.selectionId);
              const sideRaw = String(o?.side ?? "").trim().toUpperCase();
              if (mid !== String(hedgeMid ?? "").trim()) return false;
              if (!(Number.isFinite(sid) && sid > 0 && sid === Number(hedgeSel))) return false;
              if (sideRaw !== "LAY") return false;
              const sizeRemaining = Number(o?.sizeRemaining);
              return Number.isFinite(sizeRemaining) && sizeRemaining > 0;
            });
            if (candidates.length === 0) return null;
            candidates.sort((a: any, b: any) => String(b?.placedDate ?? "").localeCompare(String(a?.placedDate ?? "")));
            return candidates[0] ?? null;
          };

          const canOperateHedge = Boolean(hedgeMid && Number.isFinite(hedgeSel) && hedgeSel > 0);
          if (canOperateHedge) {
            const hedgeOrdersRes = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [String(hedgeMid)] }).catch(() => null);
            const hedgeOrders = Array.isArray((hedgeOrdersRes as any)?.currentOrders) ? (hedgeOrdersRes as any).currentOrders : [];

            const existingBack = pickBack(hedgeOrders);
            const existingTp = pickLayTp(hedgeOrders);

            if (!hedgeEntryBetIdStored && existingBack) {
              const betId = String(existingBack?.betId ?? "").trim() || null;
              const placedAt = String(existingBack?.placedDate ?? "").trim() || nowIso;
              const avgMatched = Number(existingBack?.averagePriceMatched);
              const price = Number(existingBack?.priceSize?.price ?? existingBack?.price);
              const sizeMatched = Number(existingBack?.sizeMatched);
              const sizeRemaining = Number(existingBack?.sizeRemaining);
              const entryPriceH =
                Number.isFinite(avgMatched) && avgMatched > 1
                  ? avgMatched
                  : Number.isFinite(price) && price > 1
                    ? price
                    : Number.isFinite(hedgeEntryPriceStored) && hedgeEntryPriceStored > 1
                      ? hedgeEntryPriceStored
                      : null;
              const stakeHedge =
                Number.isFinite(sizeMatched) && sizeMatched > 0
                  ? Math.max(2, round2(sizeMatched))
                  : Number.isFinite(sizeRemaining) && sizeRemaining > 0
                    ? Math.max(2, round2(sizeRemaining))
                    : Math.max(2, round2(hedgeStakeAbsStored));

              const tpBetId = existingTp ? String(existingTp?.betId ?? "").trim() || null : null;
              const tpPrice = existingTp ? Number(existingTp?.priceSize?.price ?? existingTp?.price) : null;
              const tpSizeRemaining = existingTp ? Number(existingTp?.sizeRemaining) : null;
              const tpSizeMatched = existingTp ? Number(existingTp?.sizeMatched) : null;
              const tpSize =
                Number.isFinite(tpSizeRemaining) && tpSizeRemaining > 0
                  ? tpSizeRemaining
                  : Number.isFinite(tpSizeMatched) && tpSizeMatched > 0
                    ? tpSizeMatched
                    : null;

              const targetPriceH =
                Number.isFinite(hedgeTargetPriceStored) && hedgeTargetPriceStored > 1
                  ? hedgeTargetPriceStored
                  : entryPriceH
                    ? movePriceByTicks(entryPriceH, -hedgeUnderTargetTicks)
                    : null;

              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "scalpingTicks",
                  scalpingTicks: {
                    ...baseState,
                    phase: "entered",
                    hedgeUnder: {
                      phase: tpBetId && tpPrice && tpSize ? "entered" : "entering",
                      lineCode: hedgeLineCode,
                      marketId: hedgeMid,
                      selectionId: hedgeSel,
                      entryPrice: entryPriceH,
                      targetPrice: targetPriceH,
                      stakeAbs: stakeHedge,
                      entryBetId: betId,
                      enteredAt: String(hedgeState?.enteredAt ?? placedAt),
                      takeProfit: tpBetId && tpPrice && tpSize ? { betId: tpBetId, price: tpPrice, size: tpSize, placedAt: String(existingTp?.placedDate ?? nowIso), result: null, error: null } : null,
                      cooldownUntilMs: Number.isFinite(hedgeCooldownUntilMsStored) && hedgeCooldownUntilMsStored > 0 ? hedgeCooldownUntilMsStored : null,
                      lastClosedAt: String(hedgeState?.lastClosedAt ?? ""),
                      lastError: null,
                    },
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, item: next, skipped: true, reason: "hedge_under_adopt" });
            }

            if (hedgeTpBetIdStored) {
              const tpRowRes = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [hedgeTpBetIdStored] }).catch(() => null);
              const tpOrders = Array.isArray((tpRowRes as any)?.currentOrders) ? (tpRowRes as any).currentOrders : [];
              const row = tpOrders.find((o: any) => String(o?.betId ?? "").trim() === hedgeTpBetIdStored) ?? null;
              const remaining = Number(row?.sizeRemaining);
              const isOpen = Number.isFinite(remaining) && remaining > 0;

              if (!isOpen) {
                const next = {
                  ...current,
                  betfair: baseBetfair,
                  strategy: {
                    ...strategy,
                    agent: "scalpingTicks",
                    scalpingTicks: {
                      ...baseState,
                      phase: "entered",
                      hedgeUnder: {
                        phase: "cooldown",
                        lineCode: hedgeLineCode,
                        marketId: hedgeMid,
                        selectionId: hedgeSel,
                        entryPrice: null,
                        targetPrice: null,
                        stakeAbs: null,
                        entryBetId: null,
                        enteredAt: null,
                        takeProfit: null,
                        cooldownUntilMs: nowMs + hedgeCooldownSec * 1000,
                        lastClosedAt: nowIso,
                        lastError: null,
                      },
                    },
                  },
                  updatedAt: nowIso,
                };
                await setQueueItem(matchId, next);
                return json({ ok: true, item: next, skipped: true, reason: "hedge_under_closed" });
              }
            }

            const hedgeCooldownUntilMs =
              Number.isFinite(hedgeCooldownUntilMsStored) && hedgeCooldownUntilMsStored > 0 ? hedgeCooldownUntilMsStored : 0;
            const isCoolingDown = hedgePhase === "cooldown" && hedgeCooldownUntilMs > 0 && nowMs < hedgeCooldownUntilMs;

            if (!hedgeEntryBetIdStored && !isCoolingDown && Number.isFinite(hedgeBestBack) && hedgeBestBack > 1) {
              const locksNowGlobal = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
              const hedgeEntryLockKey = lockKeyFor(String(hedgeMid), Number(hedgeSel));
              if (isEntryLocked(locksNowGlobal, hedgeEntryLockKey)) {
                const next = {
                  ...current,
                  betfair: baseBetfair,
                  strategy: {
                    ...strategy,
                    agent: "scalpingTicks",
                    scalpingTicks: {
                      ...baseState,
                      phase: "entered",
                      hedgeUnder: {
                        ...hedgeState,
                        phase: hedgePhase || "monitoring",
                        lineCode: hedgeLineCode,
                        marketId: hedgeMid,
                        selectionId: hedgeSel,
                      },
                    },
                  },
                  updatedAt: nowIso,
                };
                await setQueueItem(matchId, next);
                return json({ ok: true, item: next, skipped: true, reason: "hedge_under_entry_locked" });
              }

              const stakeHedge = Math.max(2, round2(stakeAbs * hedgeUnderStakePct));
              const entryPriceH = hedgeBestBack;
              const targetPriceH = movePriceByTicks(entryPriceH, -hedgeUnderTargetTicks);
              const placeRes = await placeOrders({
                adminToken: admin.adminToken,
                marketId: String(hedgeMid),
                customerRef: mkStableCustomerRef("hu", matchId, String(hedgeMid), Number(hedgeSel)),
                instructions: [
                  {
                    selectionId: hedgeSel,
                    side: "BACK",
                    orderType: "LIMIT",
                    limitOrder: { size: stakeHedge, price: entryPriceH, persistenceType: "LAPSE" },
                  },
                ],
              }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

              const betId = extractBetId(placeRes);
              const lockTtlMs = (betId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
              const locksUpdated = setEntryLock(locksNowGlobal, hedgeEntryLockKey, {
                matchId,
                marketId: String(hedgeMid),
                selectionId: Number(hedgeSel),
                side: "BACK",
                tradeMode: "hedge_under",
                lockedAt: nowIso,
                betId,
                status: extractReportStatus(placeRes),
                expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
              });
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "scalpingTicks",
                  scalpingTicks: {
                    ...baseState,
                    entryLocks: locksUpdated,
                    phase: "entered",
                    hedgeUnder: {
                      phase: "entering",
                      lineCode: hedgeLineCode,
                      marketId: hedgeMid,
                      selectionId: hedgeSel,
                      entryPrice: entryPriceH,
                      targetPrice: Number.isFinite(targetPriceH) && targetPriceH > 1 ? targetPriceH : null,
                      stakeAbs: stakeHedge,
                      entryBetId: betId,
                      enteredAt: nowIso,
                      takeProfit: null,
                      cooldownUntilMs: null,
                      lastClosedAt: String(hedgeState?.lastClosedAt ?? ""),
                      lastError: (placeRes as any)?.__error ? String((placeRes as any).__error) : null,
                    },
                  },
                },
                updatedAt: nowIso,
              };
              await setQueueItem(matchId, next);
              return json({ ok: true, item: next, skipped: true, reason: "hedge_under_entering" });
            }
          }

          if (hedgeEntryBetIdStored && !hedgeTpBetIdStored) {
            try {
              const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [hedgeEntryBetIdStored] });
              const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
              const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === hedgeEntryBetIdStored) ?? null;
              const sizeMatched = Number(row?.sizeMatched);
              const sizeRemaining = Number(row?.sizeRemaining);
              const avgMatched = Number(row?.averagePriceMatched);
              const isStillOpen = Number.isFinite(sizeRemaining) && sizeRemaining > 0;
              const hasMatched = Number.isFinite(sizeMatched) && sizeMatched > 0;
              if (!isStillOpen && !hasMatched) {
                const locksNowGlobal = (baseState as any)?.entryLocks && typeof (baseState as any).entryLocks === "object" ? (baseState as any).entryLocks : {};
                const locksCleared =
                  hedgeMid && Number.isFinite(hedgeSel) && Number(hedgeSel) > 0
                    ? clearEntryLock(locksNowGlobal, lockKeyFor(String(hedgeMid), Number(hedgeSel)))
                    : locksNowGlobal;
                const next = {
                  ...current,
                  betfair: baseBetfair,
                  strategy: {
                    ...strategy,
                    agent: "scalpingTicks",
                    scalpingTicks: {
                      ...baseState,
                      entryLocks: locksCleared,
                      phase: "entered",
                      hedgeUnder: {
                        phase: "cooldown",
                        lineCode: hedgeLineCode,
                        marketId: hedgeMid,
                        selectionId: hedgeSel,
                        entryPrice: null,
                        targetPrice: null,
                        stakeAbs: null,
                        entryBetId: null,
                        enteredAt: null,
                        takeProfit: null,
                        cooldownUntilMs: nowMs + hedgeCooldownSec * 1000,
                        lastClosedAt: nowIso,
                        lastError: null,
                      },
                    },
                  },
                  updatedAt: nowIso,
                };
                await setQueueItem(matchId, next);
                return json({ ok: true, item: next, skipped: true, reason: "hedge_under_reset" });
              }

              if (hasMatched) {
                const mid = hedgeMid || hedgeMarketIdStored || String(row?.marketId ?? "").trim();
                const sel = Number.isFinite(hedgeSel) ? hedgeSel : Number.isFinite(hedgeSelectionIdStored) ? hedgeSelectionIdStored : Number(row?.selectionId);
                const entryPriceH =
                  Number.isFinite(avgMatched) && avgMatched > 1
                    ? avgMatched
                    : Number.isFinite(hedgeEntryPriceStored) && hedgeEntryPriceStored > 1
                      ? hedgeEntryPriceStored
                      : Number.isFinite(hedgeBestBack) && hedgeBestBack > 1
                        ? hedgeBestBack
                        : null;
                const stakeHedge = Number.isFinite(sizeMatched) ? Math.max(2, round2(sizeMatched)) : Math.max(2, round2(hedgeStakeAbsStored));
                let targetPriceH = Number.isFinite(hedgeTargetPriceStored) && hedgeTargetPriceStored > 1 ? hedgeTargetPriceStored : null;
                if (!targetPriceH && entryPriceH) targetPriceH = movePriceByTicks(entryPriceH, -hedgeUnderTargetTicks);

                if (mid && Number.isFinite(sel) && sel > 0 && entryPriceH && targetPriceH && targetPriceH > 1) {
                  const hedgeSizeAtTarget = Math.max(2, round2((entryPriceH * stakeHedge) / targetPriceH));
                  const tpRes = await placeOrders({
                    adminToken: admin.adminToken,
                    marketId: String(mid),
                    customerRef: mkStableCustomerRef("ht", matchId, String(mid), Number(sel)),
                    instructions: [
                      {
                        selectionId: sel,
                        side: "LAY",
                        orderType: "LIMIT",
                        limitOrder: { size: hedgeSizeAtTarget, price: targetPriceH, persistenceType: "LAPSE" },
                      },
                    ],
                  }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

                  const tpBetId = extractBetId(tpRes);
                  const next = {
                    ...current,
                    betfair: baseBetfair,
                    strategy: {
                      ...strategy,
                      agent: "scalpingTicks",
                      scalpingTicks: {
                        ...baseState,
                        phase: "entered",
                        hedgeUnder: {
                          phase: "entered",
                          lineCode: hedgeLineCode,
                          marketId: mid,
                          selectionId: sel,
                          entryPrice: entryPriceH,
                          targetPrice: targetPriceH,
                          stakeAbs: stakeHedge,
                          entryBetId: hedgeEntryBetIdStored,
                          enteredAt: String(hedgeState?.enteredAt ?? nowIso),
                          takeProfit: { betId: tpBetId, price: targetPriceH, size: hedgeSizeAtTarget, placedAt: nowIso, result: (tpRes as any)?.__error ? null : tpRes ?? null, error: (tpRes as any)?.__error ? String((tpRes as any).__error) : null },
                          cooldownUntilMs: null,
                          lastClosedAt: String(hedgeState?.lastClosedAt ?? ""),
                          lastError: null,
                        },
                      },
                    },
                    updatedAt: nowIso,
                  };
                  await setQueueItem(matchId, next);
                  return json({ ok: true, item: next, skipped: true, reason: "hedge_under_tp" });
                }
              }
            } catch {}
          }
        }

        const alertOver0 = ((existing as any)?.alertOver && typeof (existing as any).alertOver === "object") ? (existing as any).alertOver : {};
        const alertPhase = String((alertOver0 as any)?.phase ?? "").trim() || "monitoring";
        const alertEntryBetId0 = String((alertOver0 as any)?.entryBetId ?? "").trim() || null;
        const alertTpBetId0 = String((alertOver0 as any)?.takeProfit?.betId ?? "").trim() || null;
        const alertLastEntryAtIso0 = String((alertOver0 as any)?.lastEntryAt ?? "").trim();
        const alertLastEntryAtMs0 = alertLastEntryAtIso0 ? new Date(alertLastEntryAtIso0).getTime() : 0;
        const alertCooldownUntilMs0 = Number((alertOver0 as any)?.cooldownUntilMs);
        const alertIsCooling = alertPhase === "cooldown" && Number.isFinite(alertCooldownUntilMs0) && alertCooldownUntilMs0 > nowMs;

        let alertOverNext: any = alertOver0;
        let alertOverEntriesInAlertNext = Math.max(
          0,
          Math.floor(Number((baseState as any)?.alertOverEntriesInAlert ?? 0) || 0),
        );
        let entryLocksAfterAlert: any = (baseState as any).entryLocks;
        const locksNowGlobal = entryLocksAfterAlert && typeof entryLocksAfterAlert === "object" ? entryLocksAfterAlert : {};
        const alertMarketId = String((alertOver0 as any)?.entryMarketId ?? "").trim() || overMarketId;
        const alertSelectionId = Number((alertOver0 as any)?.selectionId ?? overOverSel);
        const alertLockKey =
          alertMarketId && Number.isFinite(alertSelectionId) && alertSelectionId > 0
            ? lockKeyFor(alertMarketId, alertSelectionId)
            : null;

        const alertUnder0 = ((existing as any)?.alertUnder && typeof (existing as any).alertUnder === "object") ? (existing as any).alertUnder : {};
        const alertUnderPhase = String((alertUnder0 as any)?.phase ?? "").trim() || "monitoring";
        const alertUnderEntryBetId0 = String((alertUnder0 as any)?.entryBetId ?? "").trim() || null;
        const alertUnderTpBetId0 = String((alertUnder0 as any)?.takeProfit?.betId ?? "").trim() || null;
        const alertUnderLastEntryAtIso0 = String((alertUnder0 as any)?.lastEntryAt ?? "").trim();
        const alertUnderLastEntryAtMs0 = alertUnderLastEntryAtIso0 ? new Date(alertUnderLastEntryAtIso0).getTime() : 0;
        const alertUnderCooldownUntilMs0 = Number((alertUnder0 as any)?.cooldownUntilMs);
        const alertUnderIsCooling = alertUnderPhase === "cooldown" && Number.isFinite(alertUnderCooldownUntilMs0) && alertUnderCooldownUntilMs0 > nowMs;
        let alertUnderNext: any = alertUnder0;
        const earlyHedgeOk =
          typeof goalsSafe === "number" &&
          Number.isFinite(goalsSafe) &&
          goalsSafe === 0 &&
          typeof elapsedMin === "number" &&
          Number.isFinite(elapsedMin) &&
          elapsedMin >= 0 &&
          elapsedMin <= 46;

        if (!momentOver.trigger && alertEntryBetId0 && alertMarketId && Number.isFinite(alertSelectionId) && alertSelectionId > 0) {
          if (alertTpBetId0) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: alertMarketId, betIds: [alertTpBetId0] });
            } catch {}
          }

          let sizeMatched = 0;
          let sizeRemaining = 0;
          let avgPriceMatched = NaN;
          try {
            const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [alertEntryBetId0] });
            const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
            const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === alertEntryBetId0) ?? null;
            sizeMatched = Number(row?.sizeMatched);
            sizeRemaining = Number(row?.sizeRemaining);
            avgPriceMatched = Number(row?.averagePriceMatched);
          } catch {}

          const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
          const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;
          if (remainingSafe > 0 && matchedSafe <= 0) {
            try {
              await cancelOrders({ adminToken: admin.adminToken, marketId: alertMarketId, betIds: [alertEntryBetId0] });
            } catch {}
            entryLocksAfterAlert = alertLockKey ? clearEntryLock(locksNowGlobal, alertLockKey) : entryLocksAfterAlert;
            alertOverNext = {
              phase: "cooldown",
              entryMarketId: alertMarketId,
              selectionId: alertSelectionId,
              entryPrice: null,
              stakeAbs: null,
              enteredAt: null,
              lastEntryAt: null,
              entryBetId: null,
              takeProfit: null,
              cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
              lastClosedAt: nowIso,
              lastExitReason: "alert_over_cancel_on_alert_off",
            };
          } else if (matchedSafe > 0 && overMarketStatus === "OPEN" && Number.isFinite(overLay) && overLay > 1) {
            const entryPriceUsed =
              Number.isFinite(avgPriceMatched) && avgPriceMatched > 1
                ? avgPriceMatched
                : Number((alertOver0 as any)?.entryPrice);
            const entryPriceSafe = Number.isFinite(entryPriceUsed) && entryPriceUsed > 1 ? entryPriceUsed : overLay;
            const hedgeSize = Math.max(2, round2((entryPriceSafe * matchedSafe) / overLay));
            try {
              await placeOrders({
                adminToken: admin.adminToken,
                marketId: alertMarketId,
                customerRef: mkStableCustomerRef("ax", matchId, alertMarketId, alertSelectionId),
                instructions: [
                  {
                    selectionId: alertSelectionId,
                    side: "LAY",
                    orderType: "LIMIT",
                    limitOrder: { size: hedgeSize, price: overLay, persistenceType: "LAPSE" },
                  },
                ],
              });
            } catch {}
            entryLocksAfterAlert = alertLockKey ? clearEntryLock(locksNowGlobal, alertLockKey) : entryLocksAfterAlert;
            alertOverNext = {
              phase: "cooldown",
              entryMarketId: alertMarketId,
              selectionId: alertSelectionId,
              entryPrice: null,
              stakeAbs: null,
              enteredAt: null,
              lastEntryAt: null,
              entryBetId: null,
              takeProfit: null,
              cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
              lastClosedAt: nowIso,
              lastExitReason: "alert_over_exit_on_alert_off",
            };
          }
        }

        if (!momentOver.trigger && alertUnderEntryBetId0 && !alertUnderIsCooling) {
          const alertUnderLineCode = Math.max(5, underLineCode + 10);
          let uErr: string | null = null;
          const uMk = await (async () => {
            try {
              const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: alertUnderLineCode, adminToken: admin.adminToken });
              return slimOuMarket(raw);
            } catch (e) {
              uErr = e instanceof Error ? e.message : String(e);
              return null;
            }
          })();
          const uMid = String(uMk?.marketId ?? "").trim();
          const uStatus = String(uMk?.marketStatus ?? "").trim().toUpperCase();
          const uSel = Number(uMk?.runners?.underSelectionId);
          const uLay = Number(uMk?.odds?.under?.lay);
          if (uMid && uStatus === "OPEN" && Number.isFinite(uSel) && uSel > 0) {
            if (alertUnderTpBetId0) {
              try {
                await cancelOrders({ adminToken: admin.adminToken, marketId: uMid, betIds: [alertUnderTpBetId0] });
              } catch {}
            }

            let sizeMatched = 0;
            let sizeRemaining = 0;
            let avgPriceMatched = NaN;
            try {
              const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [alertUnderEntryBetId0] });
              const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
              const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === alertUnderEntryBetId0) ?? null;
              sizeMatched = Number(row?.sizeMatched);
              sizeRemaining = Number(row?.sizeRemaining);
              avgPriceMatched = Number(row?.averagePriceMatched);
            } catch {}

            const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
            const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;
            const lockKey = lockKeyFor(uMid, uSel);

            if (remainingSafe > 0 && matchedSafe <= 0) {
              try {
                await cancelOrders({ adminToken: admin.adminToken, marketId: uMid, betIds: [alertUnderEntryBetId0] });
              } catch {}
              entryLocksAfterAlert = clearEntryLock(locksNowGlobal, lockKey);
              alertUnderNext = {
                phase: "cooldown",
                entryMarketId: uMid,
                selectionId: uSel,
                entryPrice: null,
                stakeAbs: null,
                enteredAt: null,
                lastEntryAt: null,
                entryBetId: null,
                takeProfit: null,
                cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
                lastClosedAt: nowIso,
                lastExitReason: "alert_under_cancel_on_alert_off",
                error: uErr,
              };
            } else if (matchedSafe > 0 && Number.isFinite(uLay) && uLay > 1) {
              const entryPriceUsed =
                Number.isFinite(avgPriceMatched) && avgPriceMatched > 1
                  ? avgPriceMatched
                  : Number((alertUnder0 as any)?.entryPrice);
              const entryPriceSafe = Number.isFinite(entryPriceUsed) && entryPriceUsed > 1 ? entryPriceUsed : uLay;
              const hedgeSize = Math.max(2, round2((entryPriceSafe * matchedSafe) / uLay));
              try {
                await placeOrders({
                  adminToken: admin.adminToken,
                  marketId: uMid,
                  customerRef: mkStableCustomerRef("ux", matchId, uMid, uSel),
                  instructions: [
                    {
                      selectionId: uSel,
                      side: "LAY",
                      orderType: "LIMIT",
                      limitOrder: { size: hedgeSize, price: uLay, persistenceType: "LAPSE" },
                    },
                  ],
                });
              } catch {}
              entryLocksAfterAlert = clearEntryLock(locksNowGlobal, lockKey);
              alertUnderNext = {
                phase: "cooldown",
                entryMarketId: uMid,
                selectionId: uSel,
                entryPrice: null,
                stakeAbs: null,
                enteredAt: null,
                lastEntryAt: null,
                entryBetId: null,
                takeProfit: null,
                cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
                lastClosedAt: nowIso,
                lastExitReason: "alert_under_exit_on_alert_off",
                error: uErr,
              };
            }
          } else {
            alertUnderNext = { ...(alertUnder0 as any), error: uErr, phase: alertUnderPhase || "monitoring" };
          }
        }

        const canRunAlertOver =
          activeSide === "under" &&
          Boolean(momentOver.trigger) &&
          overReady &&
          overMarketStatus === "OPEN" &&
          Number.isFinite(overOverSel) &&
          overOverSel > 0 &&
          overMarketId &&
          !alertIsCooling;

        if (canRunAlertOver) {
          const alertLockKey2 = lockKeyFor(overMarketId, overOverSel);
          const spreadOk =
            maxSpreadSafe == null || overSpreadTicks == null ? true : overSpreadTicks <= maxSpreadSafe;

          const targetTicksSafe = Number.isFinite(targetTicks) ? Math.max(2, Math.floor(targetTicks)) : 10;
          const entryPriceNow =
            Number.isFinite(overLay) && overLay > 1 ? overLay
              : Number.isFinite(overBack) && overBack > 1 ? overBack
                : NaN;

          if (spreadOk && Number.isFinite(entryPriceNow) && entryPriceNow > 1) {
            const underExposure0 = Number(existing?.entryMatchedSize ?? existing?.stakeAbs ?? stakeAbs);
            const underExposure = Number.isFinite(underExposure0) && underExposure0 > 0 ? Math.max(2, round2(underExposure0)) : stakeAbs;
            const oddsForProtect0 = Number.isFinite(overBack) && overBack > 1 ? overBack : entryPriceNow;
            const desiredProtectStakeAbs =
              Number.isFinite(oddsForProtect0) && oddsForProtect0 > 1
                ? Math.max(2, round2(underExposure / Math.max(0.05, oddsForProtect0 - 1)))
                : stakeAbs;
            const protectCap = Number.isFinite(recoveryMaxStakeAbs) && recoveryMaxStakeAbs > 0 ? recoveryMaxStakeAbs : 100;
            const alertStakeAbs = Math.max(2, Math.min(protectCap, desiredProtectStakeAbs));

            if (!alertEntryBetId0) {
              if (alertOverEntriesInAlertNext >= 3) {
              } else {
                const adopted = await findExistingBackEntry(overMarketId, overOverSel);
                if (adopted?.betId) {
                  alertOverEntriesInAlertNext += 1;
                const hasMatched = Number(adopted?.sizeMatched) > 0;
                const tpExisting = hasMatched ? await findExistingLayTp(overMarketId, overOverSel) : null;
                const takeProfit =
                  tpExisting && tpExisting.betId && tpExisting.price != null && tpExisting.size != null
                    ? { betId: tpExisting.betId, price: tpExisting.price, size: tpExisting.size, placedAt: tpExisting.placedAt ?? nowIso, status: tpExisting.status, errorCode: null, result: null, error: null }
                    : null;
                alertOverNext = {
                  phase: hasMatched && takeProfit ? "entered" : "entering",
                  entryMarketId: overMarketId,
                  selectionId: overOverSel,
                  entryPrice: adopted.averagePriceMatched ?? adopted.price ?? entryPriceNow,
                  stakeAbs: Number.isFinite(adopted.sizeMatched) && adopted.sizeMatched > 0 ? adopted.sizeMatched : Number((alertOver0 as any)?.stakeAbs ?? alertStakeAbs),
                  enteredAt: String((alertOver0 as any)?.enteredAt ?? nowIso),
                  lastEntryAt: String((alertOver0 as any)?.lastEntryAt ?? nowIso),
                  entryBetId: adopted.betId,
                  entryMatchedSize: adopted.sizeMatched ?? null,
                  entryRemainingSize: adopted.sizeRemaining ?? null,
                  entryMatchedAt: hasMatched ? nowIso : null,
                  takeProfit,
                  lastEntryStatus: adopted.status,
                  lastEntryErrorCode: null,
                  cooldownUntilMs: Number((alertOver0 as any)?.cooldownUntilMs) || null,
                };
                } else if (!isEntryLocked(locksNowGlobal, alertLockKey2)) {
                  alertOverEntriesInAlertNext += 1;
                const result = await placeOrders({
                  adminToken: admin.adminToken,
                  marketId: overMarketId,
                  customerRef: mkStableCustomerRef("ao", matchId, overMarketId, overOverSel),
                  instructions: [
                    {
                      selectionId: overOverSel,
                      side: "BACK",
                      orderType: "LIMIT",
                      limitOrder: { size: alertStakeAbs, price: entryPriceNow, persistenceType: "LAPSE" },
                    },
                  ],
                }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

                const betId = extractBetId(result);
                const lockTtlMs = (betId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
                entryLocksAfterAlert = setEntryLock(locksNowGlobal, alertLockKey2, {
                  matchId,
                  marketId: overMarketId,
                  selectionId: overOverSel,
                  side: "BACK",
                  tradeMode: "alert_over",
                  lockedAt: nowIso,
                  betId,
                  status: extractReportStatus(result),
                  expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
                });

                alertOverNext = {
                  phase: "entering",
                  entryMarketId: overMarketId,
                  selectionId: overOverSel,
                  entryPrice: entryPriceNow,
                  stakeAbs: alertStakeAbs,
                  enteredAt: nowIso,
                  lastEntryAt: nowIso,
                  entryBetId: betId,
                  takeProfit: null,
                  lastResult: (result as any)?.__error ? null : result ?? null,
                  lastEntryStatus: extractReportStatus(result),
                  lastEntryErrorCode: extractReportErrorCode(result),
                };
                }
              }
            } else {
              let sizeMatched = 0;
              let sizeRemaining = 0;
              let avgPriceMatched = NaN;
              let status = "";
              try {
                const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [alertEntryBetId0] });
                const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
                const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === alertEntryBetId0) ?? null;
                sizeMatched = Number(row?.sizeMatched);
                sizeRemaining = Number(row?.sizeRemaining);
                avgPriceMatched = Number(row?.averagePriceMatched);
                status = String(row?.status ?? "").trim().toUpperCase();
              } catch {}

              const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
              const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;
              const expired = alertLastEntryAtMs0 && Number.isFinite(alertLastEntryAtMs0) && nowMs - alertLastEntryAtMs0 >= entryMaxWaitSeconds * 1000;

              if (matchedSafe <= 0 && remainingSafe > 0 && expired) {
                try {
                  await cancelOrders({ adminToken: admin.adminToken, marketId: overMarketId, betIds: [alertEntryBetId0] });
                } catch {}
                entryLocksAfterAlert = clearEntryLock(locksNowGlobal, alertLockKey2);
                alertOverNext = {
                  phase: "cooldown",
                  entryMarketId: overMarketId,
                  selectionId: overOverSel,
                  entryPrice: null,
                  stakeAbs: null,
                  enteredAt: null,
                  lastEntryAt: null,
                  entryBetId: null,
                  takeProfit: null,
                  cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
                  lastClosedAt: nowIso,
                  lastExitReason: "alert_over_entry_timeout",
                };
              } else if (matchedSafe > 0) {
                if (remainingSafe > 0) {
                  try {
                    await cancelOrders({ adminToken: admin.adminToken, marketId: overMarketId, betIds: [alertEntryBetId0] });
                  } catch {}
                }

                const entryPriceMatched =
                  Number.isFinite(avgPriceMatched) && avgPriceMatched > 1
                    ? avgPriceMatched
                    : Number((alertOver0 as any)?.entryPrice ?? entryPriceNow);
                const targetPrice = movePriceByTicks(entryPriceMatched, -targetTicksSafe);

                let takeProfit = (alertOver0 as any)?.takeProfit ?? null;
                if (!alertTpBetId0 && Number.isFinite(targetPrice) && targetPrice > 1) {
                  const hedgeSizeAtTarget = Math.max(2, round2((entryPriceMatched * matchedSafe) / targetPrice));
                  const tpRes = await placeOrders({
                    adminToken: admin.adminToken,
                    marketId: overMarketId,
                    customerRef: mkStableCustomerRef("at", matchId, overMarketId, overOverSel),
                    instructions: [
                      {
                        selectionId: overOverSel,
                        side: "LAY",
                        orderType: "LIMIT",
                        limitOrder: { size: hedgeSizeAtTarget, price: targetPrice, persistenceType: "LAPSE" },
                      },
                    ],
                  }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
                  takeProfit = {
                    betId: extractBetId(tpRes),
                    price: targetPrice,
                    size: hedgeSizeAtTarget,
                    placedAt: nowIso,
                    status: extractReportStatus(tpRes),
                    errorCode: extractReportErrorCode(tpRes),
                    result: (tpRes as any)?.__error ? null : tpRes ?? null,
                    error: (tpRes as any)?.__error ? String((tpRes as any).__error) : null,
                  };
                }

                if (takeProfit?.betId) {
                  try {
                    const tpRes2 = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [String(takeProfit.betId)] });
                    const currentOrders2 = Array.isArray((tpRes2 as any)?.currentOrders) ? (tpRes2 as any).currentOrders : [];
                    const row2 = currentOrders2.find((o: any) => String(o?.betId ?? "").trim() === String(takeProfit.betId)) ?? null;
                    const sizeRemaining2 = Number(row2?.sizeRemaining);
                    const sizeMatched2 = Number(row2?.sizeMatched);
                    const status2 = String(row2?.status ?? "").trim().toUpperCase();
                    const isDone2 = status2 === "EXECUTION_COMPLETE" || (Number.isFinite(sizeRemaining2) && sizeRemaining2 <= 0);
                    const hasMatched2 = Number.isFinite(sizeMatched2) && sizeMatched2 > 0;
                    if (isDone2 && hasMatched2) {
                      entryLocksAfterAlert = clearEntryLock(locksNowGlobal, alertLockKey2);
                      alertOverNext = {
                        phase: "cooldown",
                        entryMarketId: overMarketId,
                        selectionId: overOverSel,
                        entryPrice: null,
                        stakeAbs: null,
                        enteredAt: null,
                        lastEntryAt: null,
                        entryBetId: null,
                        takeProfit: null,
                        cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
                        lastClosedAt: nowIso,
                        lastExitReason: "alert_over_tp_matched",
                      };
                    } else {
                      alertOverNext = {
                        ...(alertOver0 as any),
                        phase: "entered",
                        entryMarketId: overMarketId,
                        selectionId: overOverSel,
                        entryBetId: alertEntryBetId0,
                        entryPrice: entryPriceMatched,
                        stakeAbs: matchedSafe,
                        targetPrice,
                        takeProfit,
                        lastEntryStatus: status || null,
                      };
                    }
                  } catch {
                    alertOverNext = {
                      ...(alertOver0 as any),
                      phase: "entered",
                      entryMarketId: overMarketId,
                      selectionId: overOverSel,
                      entryBetId: alertEntryBetId0,
                      entryPrice: entryPriceMatched,
                      stakeAbs: matchedSafe,
                      targetPrice,
                      takeProfit,
                      lastEntryStatus: status || null,
                    };
                  }
                } else {
                  alertOverNext = {
                    ...(alertOver0 as any),
                    phase: "entered",
                    entryMarketId: overMarketId,
                    selectionId: overOverSel,
                    entryBetId: alertEntryBetId0,
                    entryPrice: entryPriceMatched,
                    stakeAbs: matchedSafe,
                    targetPrice,
                    takeProfit,
                    lastEntryStatus: status || null,
                  };
                }
              } else {
                alertOverNext = {
                  ...(alertOver0 as any),
                  phase: "entering",
                  entryMarketId: overMarketId,
                  selectionId: overOverSel,
                  entryBetId: alertEntryBetId0,
                  lastEntryStatus: status || null,
                };
              }
            }
          }
        }

        if (canRunAlertOver && earlyHedgeOk && !alertUnderIsCooling && Boolean(momentOver.trigger)) {
          const alertUnderLineCode = Math.max(5, underLineCode + 10);
          let uErr: string | null = null;
          const uMk = await (async () => {
            try {
              const raw = await resolveBetfairOverUnderMarket({ eventId, lineCode: alertUnderLineCode, adminToken: admin.adminToken });
              return slimOuMarket(raw);
            } catch (e) {
              uErr = e instanceof Error ? e.message : String(e);
              return null;
            }
          })();
          const uMid = String(uMk?.marketId ?? "").trim();
          const uStatus = String(uMk?.marketStatus ?? "").trim().toUpperCase();
          const uSel = Number(uMk?.runners?.underSelectionId);
          const uBack = Number(uMk?.odds?.under?.back);
          const uLay = Number(uMk?.odds?.under?.lay);
          const uReady = Boolean(uMid && uStatus === "OPEN" && Number.isFinite(uSel) && uSel > 0);
          if (uReady) {
            const uEntryPriceNow = Number.isFinite(uLay) && uLay > 1 ? uLay : Number.isFinite(uBack) && uBack > 1 ? uBack : NaN;
            const denom = Number.isFinite(uEntryPriceNow) && uEntryPriceNow > 1 ? Math.max(0.05, uEntryPriceNow - 1) : 0.05;
            const underExposure0 = Number(existing?.entryMatchedSize ?? existing?.stakeAbs ?? stakeAbs);
            const underExposure = Number.isFinite(underExposure0) && underExposure0 > 0 ? Math.max(2, round2(underExposure0)) : stakeAbs;
            const overExposure0 = Number((alertOverNext as any)?.stakeAbs);
            const overExposure = Number.isFinite(overExposure0) && overExposure0 > 0 ? Math.max(2, round2(overExposure0)) : stakeAbs;
            const requiredProfit = Math.max(2, round2((underExposure + overExposure) * 1.08));
            const desiredStake = Math.max(2, round2(requiredProfit / denom));
            const cap = Number.isFinite(recoveryMaxStakeAbs) && recoveryMaxStakeAbs > 0 ? recoveryMaxStakeAbs : 100;
            const alertUnderStakeAbs = Math.max(2, Math.min(cap, desiredStake));

            const lockKey = lockKeyFor(uMid, uSel);
            const entryPriceToUse = uEntryPriceNow;

            if (!alertUnderEntryBetId0) {
              const adopted = await findExistingBackEntry(uMid, uSel);
              if (adopted?.betId) {
                const hasMatched = Number(adopted?.sizeMatched) > 0;
                const tpExisting = hasMatched ? await findExistingLayTp(uMid, uSel) : null;
                const takeProfit =
                  tpExisting && tpExisting.betId && tpExisting.price != null && tpExisting.size != null
                    ? { betId: tpExisting.betId, price: tpExisting.price, size: tpExisting.size, placedAt: tpExisting.placedAt ?? nowIso, status: tpExisting.status, errorCode: null, result: null, error: null }
                    : null;
                alertUnderNext = {
                  phase: hasMatched && takeProfit ? "entered" : "entering",
                  entryMarketId: uMid,
                  selectionId: uSel,
                  entryPrice: adopted.averagePriceMatched ?? adopted.price ?? entryPriceToUse,
                  stakeAbs: Number.isFinite(adopted.sizeMatched) && adopted.sizeMatched > 0 ? adopted.sizeMatched : Number((alertUnder0 as any)?.stakeAbs ?? alertUnderStakeAbs),
                  enteredAt: String((alertUnder0 as any)?.enteredAt ?? nowIso),
                  lastEntryAt: String((alertUnder0 as any)?.lastEntryAt ?? nowIso),
                  entryBetId: adopted.betId,
                  entryMatchedSize: adopted.sizeMatched ?? null,
                  entryRemainingSize: adopted.sizeRemaining ?? null,
                  entryMatchedAt: hasMatched ? nowIso : null,
                  takeProfit,
                  lastEntryStatus: adopted.status,
                  lastEntryErrorCode: null,
                  error: uErr,
                };
              } else if (!isEntryLocked(locksNowGlobal, lockKey) && Number.isFinite(entryPriceToUse) && entryPriceToUse > 1) {
                const res = await placeOrders({
                  adminToken: admin.adminToken,
                  marketId: uMid,
                  customerRef: mkStableCustomerRef("au", matchId, uMid, uSel),
                  instructions: [
                    {
                      selectionId: uSel,
                      side: "BACK",
                      orderType: "LIMIT",
                      limitOrder: { size: alertUnderStakeAbs, price: entryPriceToUse, persistenceType: "LAPSE" },
                    },
                  ],
                }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

                const betId = extractBetId(res);
                const lockTtlMs = (betId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
                entryLocksAfterAlert = setEntryLock(locksNowGlobal, lockKey, {
                  matchId,
                  marketId: uMid,
                  selectionId: uSel,
                  side: "BACK",
                  tradeMode: "alert_under",
                  lockedAt: nowIso,
                  betId,
                  status: extractReportStatus(res),
                  expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
                });

                alertUnderNext = {
                  phase: "entering",
                  entryMarketId: uMid,
                  selectionId: uSel,
                  entryPrice: entryPriceToUse,
                  stakeAbs: alertUnderStakeAbs,
                  enteredAt: nowIso,
                  lastEntryAt: nowIso,
                  entryBetId: betId,
                  takeProfit: null,
                  lastResult: (res as any)?.__error ? null : res ?? null,
                  lastEntryStatus: extractReportStatus(res),
                  lastEntryErrorCode: extractReportErrorCode(res),
                  error: uErr,
                };
              }
            } else {
              let sizeMatched = 0;
              let sizeRemaining = 0;
              let avgPriceMatched = NaN;
              let status = "";
              try {
                const res = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [alertUnderEntryBetId0] });
                const currentOrders = Array.isArray((res as any)?.currentOrders) ? (res as any).currentOrders : [];
                const row = currentOrders.find((o: any) => String(o?.betId ?? "").trim() === alertUnderEntryBetId0) ?? null;
                sizeMatched = Number(row?.sizeMatched);
                sizeRemaining = Number(row?.sizeRemaining);
                avgPriceMatched = Number(row?.averagePriceMatched);
                status = String(row?.status ?? "").trim().toUpperCase();
              } catch {}

              const matchedSafe = Number.isFinite(sizeMatched) && sizeMatched > 0 ? sizeMatched : 0;
              const remainingSafe = Number.isFinite(sizeRemaining) && sizeRemaining > 0 ? sizeRemaining : 0;
              const expired = alertUnderLastEntryAtMs0 && Number.isFinite(alertUnderLastEntryAtMs0) && nowMs - alertUnderLastEntryAtMs0 >= entryMaxWaitSeconds * 1000;

              if (matchedSafe <= 0 && remainingSafe > 0 && expired) {
                try {
                  await cancelOrders({ adminToken: admin.adminToken, marketId: uMid, betIds: [alertUnderEntryBetId0] });
                } catch {}
                entryLocksAfterAlert = clearEntryLock(locksNowGlobal, lockKey);
                alertUnderNext = {
                  phase: "cooldown",
                  entryMarketId: uMid,
                  selectionId: uSel,
                  entryPrice: null,
                  stakeAbs: null,
                  enteredAt: null,
                  lastEntryAt: null,
                  entryBetId: null,
                  takeProfit: null,
                  cooldownUntilMs: nowMs + Math.max(3, minCycleSecSafe) * 1000,
                  lastClosedAt: nowIso,
                  lastExitReason: "alert_under_entry_timeout",
                  error: uErr,
                };
              } else if (matchedSafe > 0) {
                if (remainingSafe > 0) {
                  try {
                    await cancelOrders({ adminToken: admin.adminToken, marketId: uMid, betIds: [alertUnderEntryBetId0] });
                  } catch {}
                }

                const entryPriceMatched =
                  Number.isFinite(avgPriceMatched) && avgPriceMatched > 1
                    ? avgPriceMatched
                    : Number((alertUnder0 as any)?.entryPrice ?? entryPriceToUse);
                const targetPrice = movePriceByTicks(entryPriceMatched, -Math.max(2, targetTicksSafe));

                let takeProfit = (alertUnder0 as any)?.takeProfit ?? null;
                if (!alertUnderTpBetId0 && Number.isFinite(targetPrice) && targetPrice > 1) {
                  const hedgeSizeAtTarget = Math.max(2, round2((entryPriceMatched * matchedSafe) / targetPrice));
                  const tpRes = await placeOrders({
                    adminToken: admin.adminToken,
                    marketId: uMid,
                    customerRef: mkStableCustomerRef("ut", matchId, uMid, uSel),
                    instructions: [
                      {
                        selectionId: uSel,
                        side: "LAY",
                        orderType: "LIMIT",
                        limitOrder: { size: hedgeSizeAtTarget, price: targetPrice, persistenceType: "LAPSE" },
                      },
                    ],
                  }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));
                  takeProfit = {
                    betId: extractBetId(tpRes),
                    price: targetPrice,
                    size: hedgeSizeAtTarget,
                    placedAt: nowIso,
                    status: extractReportStatus(tpRes),
                    errorCode: extractReportErrorCode(tpRes),
                    result: (tpRes as any)?.__error ? null : tpRes ?? null,
                    error: (tpRes as any)?.__error ? String((tpRes as any).__error) : null,
                  };
                }

                alertUnderNext = {
                  ...(alertUnder0 as any),
                  phase: "entered",
                  entryMarketId: uMid,
                  selectionId: uSel,
                  entryBetId: alertUnderEntryBetId0,
                  entryPrice: entryPriceMatched,
                  stakeAbs: matchedSafe,
                  targetPrice,
                  takeProfit,
                  lastEntryStatus: status || null,
                  error: uErr,
                };
              } else {
                alertUnderNext = {
                  ...(alertUnder0 as any),
                  phase: "entering",
                  entryMarketId: uMid,
                  selectionId: uSel,
                  entryBetId: alertUnderEntryBetId0,
                  lastEntryStatus: status || null,
                  error: uErr,
                };
              }
            }
          } else {
            alertUnderNext = { ...(alertUnder0 as any), error: uErr, phase: alertUnderPhase || "monitoring" };
          }
        }

        const baseState2 = { ...baseState, entryLocks: entryLocksAfterAlert, alertOver: alertOverNext, alertUnder: alertUnderNext, alertOverEntriesInAlert: alertOverEntriesInAlertNext };

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
              const locksNow = (baseState2 as any)?.entryLocks && typeof (baseState2 as any).entryLocks === "object" ? (baseState2 as any).entryLocks : {};
              const locksCleared =
                Number.isFinite(selectionId) && selectionId > 0 && marketId
                  ? clearEntryLock(locksNow, lockKeyFor(marketId, selectionId))
                  : locksNow;
              const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "scalpingTicks",
                  scalpingTicks: {
                    ...baseState2,
                    entryLocks: locksCleared,
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
          const locksNow = (baseState2 as any)?.entryLocks && typeof (baseState2 as any).entryLocks === "object" ? (baseState2 as any).entryLocks : {};
          const locksCleared =
            Number.isFinite(selectionId) && selectionId > 0 && marketId
              ? clearEntryLock(locksNow, lockKeyFor(marketId, selectionId))
              : locksNow;
          const nextCooldownUntilMs = nowMs + minCycleSecSafe * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "scalpingTicks",
              scalpingTicks: {
                ...baseState2,
                entryLocks: locksCleared,
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
          strategy: { ...strategy, agent: "scalpingTicks", scalpingTicks: { ...baseState2, phase: "entered", lastTpCheckAt: tpBetId ? nowIso : existing?.lastTpCheckAt } },
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
      const minMarketMatchedRaw = Number(cfg?.minMarketMatched ?? 0);
      const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? Math.max(0, Math.floor(minMarketMatchedRaw)) : 0;
      const minRunnerMatchedRaw = Number(cfg?.minRunnerMatched ?? 0);
      const minRunnerMatched = Number.isFinite(minRunnerMatchedRaw) ? Math.max(0, Math.floor(minRunnerMatchedRaw)) : 0;
      const secondsToWaitMatchRaw = Number(cfg?.secondsToWaitMatch ?? 10);
      const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? Math.max(0, Math.min(3600, Math.floor(secondsToWaitMatchRaw))) : 10;
      const maxEntriesRaw = Number(cfg?.maxEntries ?? 3);
      const maxEntries = Number.isFinite(maxEntriesRaw) ? Math.max(1, Math.min(20, Math.floor(maxEntriesRaw))) : 3;
      const entryMaxWaitSecondsRaw = Number(cfg?.entryMaxWaitSeconds ?? 15);
      const entryMaxWaitSeconds = Number.isFinite(entryMaxWaitSecondsRaw) ? Math.max(2, Math.min(120, Math.floor(entryMaxWaitSecondsRaw))) : 15;
      const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 0);
      const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? Math.max(0, Math.min(10, Math.floor(entryOffsetTicksRaw))) : 0;

      const stakeAbsCfgRaw = Number(cfg?.stakeAbs);
      const stakeAbsCfg = Number.isFinite(stakeAbsCfgRaw) ? round2(stakeAbsCfgRaw) : NaN;
      const baseStakeAbs =
        Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0
          ? Math.max(2, stakeAbsCfg)
          : Number.isFinite(bankroll) && bankroll > 0 && Number.isFinite(stakePct) && stakePct > 0
            ? Math.max(2, round2((bankroll * stakePct) / 100))
            : 2;

      const inPlay = Boolean(baseBetfair?.inPlay ?? false);
      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const existing = (strategy as any)?.asianHandicap && typeof (strategy as any).asianHandicap === "object" ? (strategy as any).asianHandicap : {};
      const phase = String(existing?.phase ?? "").trim() || "monitoring";

      const entryLockTtlSecondsRaw = Number((cfg as any)?.entryLockTtlSeconds ?? 180);
      const entryLockTtlSeconds = Number.isFinite(entryLockTtlSecondsRaw) ? Math.max(5, Math.min(3600, Math.floor(entryLockTtlSecondsRaw))) : 180;
      const entryLockPendingTtlSecondsRaw = Number((cfg as any)?.entryLockPendingTtlSeconds ?? 25);
      const entryLockPendingTtlSeconds = Number.isFinite(entryLockPendingTtlSecondsRaw)
        ? Math.max(4, Math.min(300, Math.floor(entryLockPendingTtlSecondsRaw)))
        : 25;
      const lockKeyFor = (marketId: string, selectionId: number) => {
        const mid = String(marketId ?? "").trim();
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? Math.floor(selectionId) : 0;
        return `${mid}:${sid}:BACK`;
      };
      const readEntryLocks = () => {
        const merged: Record<string, any> = {};
        const add = (raw: any) => {
          if (!raw || typeof raw !== "object") return;
          for (const [k, v] of Object.entries(raw)) {
            const key = String(k ?? "").trim();
            if (!key) continue;
            if (!v || typeof v !== "object") continue;
            merged[key] = v;
          }
        };
        add((strategy as any)?.entryLocks);
        add((existing as any)?.entryLocks);
        for (const k of Object.keys(strategy)) {
          const sub = (strategy as any)[k];
          if (!sub || typeof sub !== "object") continue;
          if (sub?.entryLocks && typeof sub.entryLocks === "object") add(sub.entryLocks);
        }
        return merged;
      };
      const pruneEntryLocks = (locks: any) => {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(locks ?? {})) {
          if (!k) continue;
          if (!v || typeof v !== "object") continue;
          const exp = Number((v as any)?.expiresAtMs);
          if (Number.isFinite(exp) && exp > nowMs) out[k] = v;
        }
        return out;
      };
      const isEntryLocked = (locks: any, key: string) => {
        const v = locks && typeof locks === "object" ? (locks as any)[key] : null;
        const exp = Number(v?.expiresAtMs);
        return Boolean(v && Number.isFinite(exp) && exp > nowMs);
      };
      const setEntryLock = (locks: any, key: string, value: any) => {
        const base = locks && typeof locks === "object" ? locks : {};
        return { ...base, [key]: value };
      };
      const clearEntryLock = (locks: any, key: string) => {
        const base = locks && typeof locks === "object" ? locks : {};
        const { [key]: _, ...rest } = base as any;
        return rest;
      };
      const mkStableCustomerRef = (action: string, matchId: string, marketId: string, selectionId: number) => {
        const a = String(action ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4) || "x";
        const id = String(matchId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const tail = id.slice(-8) || "0";
        const mid = String(marketId ?? "").replace(/[^a-zA-Z0-9]/g, "");
        const midTail = mid.slice(-6) || "m";
        const sid = Number.isFinite(selectionId) && selectionId > 0 ? String(Math.floor(selectionId)).slice(-4) : "0";
        const bucket = Math.floor(Date.now() / 4000).toString(36);
        let ref = `ah-${a}-${tail}-${midTail}${sid}-${bucket}`;
        if (ref.length > 32) ref = ref.slice(0, 32);
        return ref;
      };
      const entryLocksPruned = pruneEntryLocks(readEntryLocks());

      const cycleCount = Math.max(0, Math.floor(Number(existing?.cycleCount ?? 0) || 0));
      if (phase !== "entering" && phase !== "entered" && cycleCount >= maxEntries) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "stopped", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "max_entries", item: next });
      }

      if (!inPlay) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: phase || "monitoring", lastTickAt: nowIso, cycleCount } },
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
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, elapsedSec } },
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
            asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, skippedReason: "no_prediction" },
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
        adminToken: admin.adminToken,
      }).catch((e) => ({ __error: e instanceof Error ? e.message : String(e) }));

      const ahErr = (ahMarket as any)?.__error ? String((ahMarket as any).__error) : null;
      if (ahErr) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, error: ahErr } },
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
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId: marketId || null } },
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
            asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, marketStatus },
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
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, marketMatched } },
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
            strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, runnerMatched } },
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
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, spreadTicks } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "spread", item: next });
      }

      if (!(Number.isFinite(bestBack) && bestBack > 1 && Number.isFinite(selectionId))) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId } },
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
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "cooldown", lastTickAt: nowIso, cycleCount, marketId } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown", item: next });
      }

      const entryLockKey = lockKeyFor(marketId, selectionId);

      if (phase === "entering") {
        const entryBetId = String(existing?.entryBetId ?? "").trim() || null;
        const entryPlacedAtIso = String(existing?.lastEntryAt ?? existing?.enteredAt ?? "").trim();
        const entryPlacedAtMs = entryPlacedAtIso ? new Date(entryPlacedAtIso).getTime() : 0;

        if (!entryBetId) {
          const ageMs = entryPlacedAtMs && Number.isFinite(entryPlacedAtMs) ? nowMs - entryPlacedAtMs : Number.POSITIVE_INFINITY;
          const stillWaiting = typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < entryLockPendingTtlSeconds * 1000;
          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "asianHandicap",
              asianHandicap: {
                ...existing,
                entryLocks: entryLocksPruned,
                phase: stillWaiting ? "entering" : "monitoring",
                lastTickAt: nowIso,
                cycleCount,
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: stillWaiting ? "await_betid" : "entering_missing_betid", item: next });
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
                entryLocks: setEntryLock(entryLocksPruned, entryLockKey, {
                  marketId,
                  selectionId,
                  betId: entryBetId,
                  placedAtIso: entryPlacedAtIso || nowIso,
                  expiresAtMs: nowMs + Math.max(1000, entryLockTtlSeconds * 1000),
                }),
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
            customerRef: mkStableCustomerRef("ar", matchId, marketId, selectionId),
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
          const lockTtlMs = (newEntryBetId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
          const locksUpdated = setEntryLock(entryLocksPruned, entryLockKey, {
            marketId,
            selectionId,
            betId: newEntryBetId,
            placedAtIso: nowIso,
            expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
          });

          const next = {
            ...current,
            betfair: baseBetfair,
            strategy: {
              ...strategy,
              agent: "asianHandicap",
              asianHandicap: {
                ...existing,
                entryLocks: locksUpdated,
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
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "entering", lastTickAt: nowIso, cycleCount } },
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
              customerRef: mkStableCustomerRef("at", matchId, marketId, selectionId),
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
                  entryLocks: entryLocksPruned,
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
              const locksCleared = clearEntryLock(entryLocksPruned, entryLockKey);
              const next = {
                ...current,
                betfair: baseBetfair,
                strategy: {
                  ...strategy,
                  agent: "asianHandicap",
                  asianHandicap: {
                    ...existing,
                    entryLocks: locksCleared,
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
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "entered", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "holding", item: next });
      }

      if (phase === "cooldown") {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: { ...strategy, agent: "asianHandicap", asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount } },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "cooldown_done", item: next });
      }

      if (isEntryLocked(entryLocksPruned, entryLockKey)) {
        const next = {
          ...current,
          betfair: baseBetfair,
          strategy: {
            ...strategy,
            agent: "asianHandicap",
            asianHandicap: { ...existing, entryLocks: entryLocksPruned, phase: "monitoring", lastTickAt: nowIso, cycleCount, marketId, selectionId },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "entry_locked", item: next });
      }

      const entryPrice = movePriceByTicks(bestBack, entryOffsetTicks);
      const result = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: mkStableCustomerRef("ae", matchId, marketId, selectionId),
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
      const lockTtlMs = (entryBetId ? entryLockTtlSeconds : entryLockPendingTtlSeconds) * 1000;
      const locksUpdated = setEntryLock(entryLocksPruned, entryLockKey, {
        marketId,
        selectionId,
        betId: entryBetId,
        placedAtIso: nowIso,
        expiresAtMs: nowMs + Math.max(1000, lockTtlMs),
      });

      const next = {
        ...current,
        betfair: baseBetfair,
        strategy: {
          ...strategy,
          agent: "asianHandicap",
          asianHandicap: {
            ...existing,
            entryLocks: locksUpdated,
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

      const dryRun = Boolean((body as any)?.dryRun ?? false);
      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const bankroll = Number(cfg?.bankroll ?? 50);
      const bankrollAbs = Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 50;
      const stakeAbsCfgRaw = Number(cfg?.stakeAbs);
      const stakeAbsCfg = Number.isFinite(stakeAbsCfgRaw) ? round2(stakeAbsCfgRaw) : NaN;
      const stakeFixed = Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0 ? Math.max(2, stakeAbsCfg) : null;

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });

      const nowIso = new Date().toISOString();
      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const csState = (strategy as any)?.correctScore && typeof (strategy as any).correctScore === "object" ? (strategy as any).correctScore : {};

      const marketId = String(betfair?.correctScore?.marketId ?? "").trim();
      if (!marketId) {
        const next = {
          ...current,
          betfair,
          strategy: {
            ...strategy,
            agent: "correctScore",
            correctScore: { ...csState, lastAttemptAt: nowIso, lastAttempt: { adoptedExisting: false, placed: false, reason: "correct_score_not_ready" } },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "correct_score_not_ready", adoptedExisting: false, item: next });
      }

      const planCfg = (body as any)?.planConfig && typeof (body as any).planConfig === "object" ? (body as any).planConfig : {};
      const maxSelRaw = Number(planCfg?.maxSelections ?? 4);
      const maxSelections = Number.isFinite(maxSelRaw) ? Math.max(1, Math.min(20, Math.floor(maxSelRaw))) : 4;
      const entryScoresCsv = String(planCfg?.entryScoresCsv ?? "0-0,0-1,1-0,1-1").trim();
      const minMarketMatchedRaw = Number((planCfg as any)?.minMarketMatched ?? 0);
      const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? Math.max(0, Math.floor(minMarketMatchedRaw)) : 0;
      const enforceMinMarketMatched = Boolean((planCfg as any)?.enforceMinMarketMatched ?? false);

      const marketMatched = Number((betfair as any)?.correctScore?.matchedVolume);
      if (enforceMinMarketMatched && Number.isFinite(minMarketMatched) && minMarketMatched > 0) {
        if (!(Number.isFinite(marketMatched) && marketMatched >= minMarketMatched)) {
          const next = {
            ...current,
            betfair,
            strategy: {
              ...strategy,
              agent: "correctScore",
              correctScore: {
                ...csState,
                lastAttemptAt: nowIso,
                lastAttempt: {
                  adoptedExisting: false,
                  placed: false,
                  reason: "market_matched_low",
                  meta: { marketMatched: Number.isFinite(marketMatched) ? marketMatched : null, minMarketMatched },
                },
              },
            },
            updatedAt: nowIso,
          };
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

      const existingOrdersRes = await (async () => {
        try {
          return await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
        } catch {
          return null;
        }
      })();
      const existingOrders = Array.isArray((existingOrdersRes as any)?.currentOrders) ? (existingOrdersRes as any).currentOrders : [];
      const openOrdersCount = existingOrders.filter((o: any) => Number(o?.sizeRemaining) > 0).length;
      const matchedBetsCount = existingOrders.filter((o: any) => Number(o?.sizeMatched) > 0).length;
      const hasExistingPosition = openOrdersCount > 0 || matchedBetsCount > 0;
      if (hasExistingPosition) {
        if (!dryRun) {
          const nowIso = new Date().toISOString();
          const scoreHome = Number(current?.scoreHome);
          const scoreAway = Number(current?.scoreAway);
          const totalGoals =
            Number.isFinite(scoreHome) && Number.isFinite(scoreAway) ? Math.max(0, Math.floor(scoreHome) + Math.floor(scoreAway)) : null;
          const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
          const csState = (strategy as any)?.correctScore && typeof (strategy as any).correctScore === "object" ? (strategy as any).correctScore : {};
          const next = {
            ...current,
            betfair,
            strategy: {
              ...strategy,
              agent: "correctScore",
              correctScore: {
                ...csState,
                lastExecutionAt: nowIso,
                lastExecution: { adoptedExisting: true, openOrdersCount, matchedBetsCount },
                adoptedExistingAt: nowIso,
                adoptedExisting: { openOrdersCount, matchedBetsCount, marketId },
                ...(totalGoals != null ? { lastGoals: totalGoals } : {}),
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({
            ok: true,
            dryRun: false,
            placed: false,
            adoptedExisting: true,
            openOrdersCount,
            matchedBetsCount,
            reason: "existing_position_detected",
            item: next,
          });
        }
        return json({
          ok: true,
          dryRun: true,
          placed: false,
          adoptedExisting: true,
          openOrdersCount,
          matchedBetsCount,
          reason: "existing_position_detected",
        });
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
        const next = {
          ...current,
          betfair,
          strategy: {
            ...strategy,
            agent: "correctScore",
            correctScore: {
              ...csState,
              lastAttemptAt: nowIso,
              lastAttempt: { adoptedExisting: false, placed: false, reason: "no_runners_price" },
            },
          },
          updatedAt: nowIso,
        };
        await setQueueItem(matchId, next);
        return json({ ok: true, skipped: true, reason: "no_runners_price", adoptedExisting: false, item: next });
      }

      const stakes = (() => {
        if (stakeFixed != null) {
          return picksWithPrice.map((p) => ({ ...p, stake: stakeFixed }));
        }
        const invSum = picksWithPrice.reduce((acc, p) => acc + 1 / p.back, 0);
        return picksWithPrice.map((p) => {
          const frac = invSum > 0 ? (1 / p.back) / invSum : 1 / picksWithPrice.length;
          return { ...p, stake: Math.max(2, round2(bankrollAbs * frac)) };
        });
      })();

      const instructions = stakes.map((s) => ({
        selectionId: s.selectionId,
        side: "BACK",
        orderType: "LIMIT",
        limitOrder: { size: s.stake, price: s.back, persistenceType: "LAPSE" },
      }));

      if (dryRun) {
        return json({
          ok: true,
          dryRun: true,
          adoptedExisting: false,
          placed: false,
          marketId,
          selections: stakes,
          plan: { maxSelections, entryScoresCsv, minMarketMatched },
        });
      }

      const result = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: `cs-${matchId}-${Date.now().toString(16)}`.slice(0, 32),
        instructions,
      });

      const executedAtIso = new Date().toISOString();
      const bankrollUsed =
        stakeFixed != null
          ? round2(stakeFixed * Math.max(1, stakes.length))
          : bankrollAbs;
      const next = {
        ...current,
        betfair,
        strategy: {
          ...strategy,
          agent: "correctScore",
          correctScore: {
            ...csState,
            lastExecutionAt: executedAtIso,
            lastExecution: {
              selections: stakes,
              bankroll: bankrollUsed,
              baseScore: { home: baseHome, away: baseAway },
              entryScoresCsv,
              planType: "coverage",
            },
          },
        },
        updatedAt: executedAtIso,
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
            customerRef: `cs-auto-exit-${matchId}-${Date.now().toString(16)}`.slice(0, 32),
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
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const dryRun = Boolean((body as any)?.dryRun ?? false);
      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const force = Boolean((cfg as any)?.force ?? false);
      const cancelOpenOrdersEnabled = typeof (cfg as any)?.cancelOpenOrders === "boolean" ? Boolean((cfg as any).cancelOpenOrders) : true;
      const targetMinGreenAbsRaw = Number((cfg as any)?.targetMinGreenAbs ?? 0);
      const targetMinGreenAbs = Number.isFinite(targetMinGreenAbsRaw) ? round2(Math.max(-5000, Math.min(5000, targetMinGreenAbsRaw))) : 0;
      const maxInstructionsRaw = Number((cfg as any)?.maxInstructions ?? 3);
      const maxInstructions = Number.isFinite(maxInstructionsRaw) ? Math.max(0, Math.min(10, Math.floor(maxInstructionsRaw))) : 3;
      const maxStakePerInstructionRaw = Number((cfg as any)?.maxStakePerInstruction ?? 50);
      const maxStakePerInstruction = Number.isFinite(maxStakePerInstructionRaw)
        ? round2(Math.max(2, Math.min(2000, maxStakePerInstructionRaw)))
        : 50;

      const betfair = await resolveBetfairMatchOdds({
        homeTeam: String(current?.homeTeam ?? ""),
        awayTeam: String(current?.awayTeam ?? ""),
        utcDate: current?.utcDate == null ? null : String(current.utcDate),
        includeCorrectScore: true,
      });
      const marketId = String((betfair as any)?.correctScore?.marketId ?? "").trim();
      if (!marketId) return json({ ok: true, skipped: true, reason: "correct_score_not_ready", marketId: null });

      const marketStatus = String((betfair as any)?.marketStatus ?? "").toUpperCase();
      if (marketStatus === "CLOSED") return json({ ok: true, skipped: true, reason: "market_closed", marketId });

      const scoreHome = Number((current as any)?.scoreHome);
      const scoreAway = Number((current as any)?.scoreAway);
      const totalGoals =
        Number.isFinite(scoreHome) && Number.isFinite(scoreAway) ? Math.max(0, Math.floor(scoreHome) + Math.floor(scoreAway)) : null;
      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const csState = (strategy as any)?.correctScore && typeof (strategy as any).correctScore === "object" ? (strategy as any).correctScore : {};
      const prevGoalsRaw = Number((csState as any)?.lastGoals);
      const prevGoals = Number.isFinite(prevGoalsRaw) ? prevGoalsRaw : null;
      const goalChanged = totalGoals != null && (prevGoals == null || totalGoals !== prevGoals);
      if (!force && !goalChanged) {
        return json({ ok: true, skipped: true, reason: "no_goal_change", totalGoals, prevGoals, marketId });
      }

      const listOrders = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((listOrders as any)?.currentOrders) ? (listOrders as any).currentOrders : [];
      const openBetIds = uniqStrings(
        currentOrders
          .filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim())
          .map((o: any) => String(o.betId)),
      );
      const matchedCount = currentOrders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
      const hasMatched = matchedCount > 0;

      let cancelResult: any = null;
      if (cancelOpenOrdersEnabled && openBetIds.length > 0) {
        try {
          await cancelOrders({ adminToken: admin.adminToken, marketId, betIds: openBetIds });
          cancelResult = { cancelled: openBetIds.length };
        } catch (e) {
          cancelResult = { cancelled: 0, error: e instanceof Error ? e.message : String(e) };
        }
      }

      const nowIso = new Date().toISOString();
      if (!hasMatched) {
        if (!dryRun) {
          const next = {
            ...current,
            betfair,
            strategy: {
              ...strategy,
              agent: "correctScore",
              correctScore: {
                ...csState,
                ...(totalGoals != null ? { lastGoals: totalGoals } : {}),
                lastRebalanceAt: nowIso,
                lastRebalance: {
                  ok: true,
                  skipped: true,
                  reason: "no_matched_position",
                  cancelledOpenOrdersCount: openBetIds.length,
                  cancelResult,
                },
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "no_matched_position", cancelledOpenOrdersCount: openBetIds.length, item: next });
        }
        return json({ ok: true, dryRun: true, skipped: true, reason: "no_matched_position", cancelledOpenOrdersCount: openBetIds.length });
      }

      const pnlRes = await betfairRpc({
        adminToken: admin.adminToken,
        method: "SportsAPING/v1.0/listMarketProfitAndLoss",
        params: { marketIds: [marketId], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
      });
      const marketPnl = Array.isArray(pnlRes) ? pnlRes[0] : null;
      const pnlList = Array.isArray(marketPnl?.profitAndLosses)
        ? marketPnl.profitAndLosses
        : Array.isArray(marketPnl?.profitAndLoss)
          ? marketPnl.profitAndLoss
          : [];
      const ifWinBySel = new Map<number, number>();
      for (const p of pnlList) {
        const sid = Number((p as any)?.selectionId);
        const ifWin = Number((p as any)?.ifWin);
        if (!Number.isFinite(sid) || sid <= 0) continue;
        ifWinBySel.set(sid, Number.isFinite(ifWin) ? round2(ifWin) : 0);
      }

      const valuesBefore = Array.from(ifWinBySel.values());
      const minBefore = valuesBefore.length ? valuesBefore.reduce((m: number, v: number) => (v < m ? v : m), valuesBefore[0]) : null;
      const maxBefore = valuesBefore.length ? valuesBefore.reduce((m: number, v: number) => (v > m ? v : m), valuesBefore[0]) : null;

      const bookRes = await betfairRpc({
        adminToken: admin.adminToken,
        method: "SportsAPING/v1.0/listMarketBook",
        params: { marketIds: [marketId], priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true } },
      });
      const book = Array.isArray(bookRes) ? bookRes[0] : null;
      const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
      const layBySel = new Map<number, { price: number; size: number | null }>();
      for (const rb of runnersBook) {
        const sid = Number((rb as any)?.selectionId);
        if (!Number.isFinite(sid) || sid <= 0) continue;
        const lay0 = Array.isArray((rb as any)?.ex?.availableToLay) ? (rb as any).ex.availableToLay[0] : null;
        const price = lay0 ? Number(lay0.price) : null;
        const size = lay0 ? Number(lay0.size) : null;
        if (price && Number.isFinite(price) && price > 1.01) {
          layBySel.set(sid, { price, size: Number.isFinite(size) ? size : null });
        }
      }

      const minStake = 2;
      const instructions: any[] = [];
      const getMin = () => {
        const vals = Array.from(ifWinBySel.values());
        return vals.length ? vals.reduce((m: number, v: number) => (v < m ? v : m), vals[0]) : null;
      };

      while (instructions.length < maxInstructions) {
        const minIfWin = getMin();
        if (!(typeof minIfWin === "number" && Number.isFinite(minIfWin))) break;
        if (minIfWin >= targetMinGreenAbs) break;
        const need = targetMinGreenAbs - minIfWin;

        const candidates = Array.from(ifWinBySel.entries())
          .map(([sid, ifWin]) => {
            const lay = layBySel.get(sid) ?? null;
            if (!lay) return null;
            const p = lay.price;
            const denom = p - 1;
            if (!(Number.isFinite(p) && p > 1.01 && Number.isFinite(denom) && denom > 0)) return null;
            const upper = (ifWin - targetMinGreenAbs) / denom;
            const sizeCap = lay.size != null && Number.isFinite(lay.size) ? lay.size : null;
            const maxByLiquidity = sizeCap != null ? Math.max(0, sizeCap) : null;
            const maxSize = Math.min(maxStakePerInstruction, maxByLiquidity != null ? maxByLiquidity : maxStakePerInstruction);
            return { sid, ifWin, p, upper: Number.isFinite(upper) ? upper : 0, maxSize };
          })
          .filter((x: any) => x && x.upper >= minStake && x.maxSize >= minStake && x.ifWin > targetMinGreenAbs + 1);

        if (candidates.length === 0) break;
        candidates.sort((a: any, b: any) => b.upper - a.upper);
        const best = candidates[0];
        const sNeed = Math.max(minStake, round2(need));
        const sUpper = round2(Math.min(best.upper, best.maxSize));
        if (sNeed > sUpper) break;
        const size = round2(Math.max(minStake, Math.min(sUpper, sNeed)));
        const price = best.p;

        instructions.push({
          selectionId: best.sid,
          side: "LAY",
          orderType: "LIMIT",
          limitOrder: { size, price, persistenceType: "LAPSE" },
        });

        const liability = round2(size * (price - 1));
        for (const [sid, ifWin] of ifWinBySel.entries()) {
          if (sid === best.sid) ifWinBySel.set(sid, round2(ifWin - liability));
          else ifWinBySel.set(sid, round2(ifWin + size));
        }
      }

      const valuesAfter = Array.from(ifWinBySel.values());
      const minAfter = valuesAfter.length ? valuesAfter.reduce((m: number, v: number) => (v < m ? v : m), valuesAfter[0]) : null;
      const maxAfter = valuesAfter.length ? valuesAfter.reduce((m: number, v: number) => (v > m ? v : m), valuesAfter[0]) : null;

      if (instructions.length === 0) {
        if (!dryRun) {
          const next = {
            ...current,
            betfair,
            strategy: {
              ...strategy,
              agent: "correctScore",
              correctScore: {
                ...csState,
                ...(totalGoals != null ? { lastGoals: totalGoals } : {}),
                lastRebalanceAt: nowIso,
                lastRebalance: {
                  ok: true,
                  skipped: true,
                  reason: "no_viable_instructions",
                  minBefore,
                  minAfter: minBefore,
                  maxBefore,
                  maxAfter: maxBefore,
                  targetMinGreenAbs,
                  cancelledOpenOrdersCount: openBetIds.length,
                  cancelResult,
                },
              },
            },
            updatedAt: nowIso,
          };
          await setQueueItem(matchId, next);
          return json({ ok: true, skipped: true, reason: "no_viable_instructions", minBefore, minAfter: minBefore, item: next });
        }
        return json({ ok: true, dryRun: true, skipped: true, reason: "no_viable_instructions", minBefore, minAfter: minBefore });
      }

      if (dryRun) {
        return json({ ok: true, dryRun: true, matchId, marketId, instructions, minBefore, minAfter, maxBefore, maxAfter, targetMinGreenAbs });
      }

      const placeResult = await placeOrders({
        adminToken: admin.adminToken,
        marketId,
        customerRef: `cs-reb-${matchId}-${Date.now().toString(16)}`.slice(0, 32),
        instructions,
      });

      const next = {
        ...current,
        betfair,
        strategy: {
          ...strategy,
          agent: "correctScore",
          correctScore: {
            ...csState,
            ...(totalGoals != null ? { lastGoals: totalGoals } : {}),
            lastRebalanceAt: nowIso,
            lastRebalance: {
              ok: true,
              skipped: false,
              reason: null,
              instructions,
              placeResult,
              minBefore,
              minAfter,
              maxBefore,
              maxAfter,
              targetMinGreenAbs,
              cancelledOpenOrdersCount: openBetIds.length,
              cancelResult,
            },
          },
        },
        updatedAt: nowIso,
      };
      await setQueueItem(matchId, next);
      return json({ ok: true, placed: true, instructionsCount: instructions.length, minBefore, minAfter, item: next });
    }
    if (matchPath(path, "/automation/betfair/strategy/correctScore/tradePreview")) {
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
      if (!marketId) {
        return json({ ok: true, matchId, marketId: null, risk: null, cashOut: null, profit: null, fetchedAt: new Date().toISOString() });
      }

      const listOrders = await listCurrentOrders({ adminToken: admin.adminToken, marketIds: [marketId] });
      const currentOrders = Array.isArray((listOrders as any)?.currentOrders) ? (listOrders as any).currentOrders : [];
      const risk = currentOrders.reduce((acc: number, o: any) => {
        const side = String(o?.side ?? "").trim().toUpperCase();
        const price = Number(o?.priceSize?.price);
        const sizeRemaining = Number(o?.sizeRemaining);
        const sizeMatched = Number(o?.sizeMatched);
        const size = (Number.isFinite(sizeRemaining) ? sizeRemaining : 0) + (Number.isFinite(sizeMatched) ? sizeMatched : 0);
        if (!Number.isFinite(size) || size <= 0) return acc;
        if (side === "LAY") {
          if (!Number.isFinite(price) || price <= 1.01) return acc;
          return acc + size * (price - 1);
        }
        return acc + size;
      }, 0);

      const pnlRes = await betfairRpc({
        adminToken: admin.adminToken,
        method: "SportsAPING/v1.0/listMarketProfitAndLoss",
        params: { marketIds: [marketId], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
      });
      const marketPnl = Array.isArray(pnlRes) ? pnlRes[0] : null;
      const pnlList = Array.isArray(marketPnl?.profitAndLosses)
        ? marketPnl.profitAndLosses
        : Array.isArray(marketPnl?.profitAndLoss)
          ? marketPnl.profitAndLoss
          : [];
      const values = pnlList.map((x: any) => Number(x?.ifWin)).filter((v: any) => typeof v === "number" && Number.isFinite(v));
      const profit = values.length > 0 ? values.reduce((m: number, v: number) => (v < m ? v : m), values[0]) : null;
      const cashOut = typeof profit === "number" && Number.isFinite(profit) && Number.isFinite(risk) ? risk + profit : null;

      return json({
        ok: true,
        matchId,
        marketId,
        risk: Number.isFinite(risk) ? round2(risk) : null,
        cashOut: typeof cashOut === "number" && Number.isFinite(cashOut) ? round2(cashOut) : null,
        profit: typeof profit === "number" && Number.isFinite(profit) ? round2(profit) : null,
        fetchedAt: new Date().toISOString(),
      });
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
            customerRef: `cs-cashout-${matchId}-${Date.now().toString(16)}`.slice(0, 32),
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

    // === ROTA DE TESTE: placeOrders no Match Odds ===
    if (req.method === "POST" && path.includes("/automation/betfair/strategy/placeOrdersMatchOdds")) {
      const body = await parseJson(req).catch(() => ({})) as any;
      // Também aceita adminToken do header
      const adminTokenRaw = String(body?.adminToken ?? req.headers.get("x-automation-token") ?? "").trim();
      const matchIdTest = String(body?.matchId ?? "").trim();
      const selectionId = Number(body?.selectionId);
      const side = String(body?.side ?? "BACK").toUpperCase();
      const price = Number(body?.price);
      const size = Number(body?.size);
      if (!adminTokenRaw) return json({ ok: false, error: "adminToken obrigatório. Envie no body ou header x-automation-token" }, 400);
      if (!matchIdTest) return json({ ok: false, error: "matchId obrigatório" }, 400);
      if (!Number.isFinite(selectionId)) return json({ ok: false, error: "selectionId obrigatório" }, 400);
      if (!Number.isFinite(price) || price < 1.01) return json({ ok: false, error: "price inválido" }, 400);
      if (!Number.isFinite(size) || size <= 0) return json({ ok: false, error: "size inválido" }, 400);
      const marketId = body?.marketId ? String(body.marketId).trim() : null;
      try {
        const current = await getQueueItem(matchIdTest);
        const betfair = current?.betfair ?? {};
        const matchOddsMarketId = marketId || String(betfair?.matchOdds?.marketId ?? "").trim();
        if (!matchOddsMarketId) {
          // Tenta resolver o mercado Match Odds
          const cats = await betfairRpc({
            method: "SportsAPING/v1.0/listMarketCatalogue",
            adminToken: adminTokenRaw,
            params: {
              filter: { eventIds: [matchIdTest], marketTypeCodes: ["MATCH_ODDS"] },
              maxResults: 5,
              sort: "MAXIMUM_TRADED",
              marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
            },
          });
          const mk = Array.isArray(cats) ? cats[0] : null;
          const id = String(mk?.marketId ?? "").trim();
          if (!id) return json({ ok: false, error: "Match Odds marketId não encontrado para este evento" }, 404);
          const result = await placeOrders({
            adminToken: adminTokenRaw,
            marketId: id,
            customerRef: `test-manual-${matchIdTest}-${Date.now().toString(16)}`.slice(0, 32),
            instructions: [{
              selectionId,
              side,
              orderType: "LIMIT",
              limitOrder: { size, price, persistenceType: "LAPSE" },
            }],
          });
          return json({ ok: true, type: "placeOrder", marketId: id, result });
        }
        const result = await placeOrders({
          adminToken: adminTokenRaw,
          marketId: matchOddsMarketId,
          customerRef: `test-manual-${matchIdTest}-${Date.now().toString(16)}`.slice(0, 32),
          instructions: [{
            selectionId,
            side,
            orderType: "LIMIT",
            limitOrder: { size, price, persistenceType: "LAPSE" },
          }],
        });
        return json({ ok: true, type: "placeOrder", marketId: matchOddsMarketId, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json({ ok: false, error: message || "Erro no placeOrders Match Odds" }, 500);
      }
    }

    // ============================================================
    // ESTRATÉGIA: favoriteComeback - Favorito perdendo no HT
    // ============================================================
    if (matchPath(path, "/automation/betfair/strategy/favoriteComeback/tick")) {
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
      const existing = (strategy as any)?.favoriteComeback && typeof (strategy as any).favoriteComeback === "object" ? (strategy as any).favoriteComeback : {};

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const stakeAbsCfg = Number(cfg?.stakeAbs ?? existing?.stakeAbs ?? NaN);
      const stakeAbs = Number.isFinite(stakeAbsCfg) && stakeAbsCfg > 0 ? Math.max(2, stakeAbsCfg) : 2;
      const minHomeOddsPreLive = Number(cfg?.minHomeOddsPreLive ?? existing?.minHomeOddsPreLive ?? 1.01);
      const maxHomeOddsPreLive = Number(cfg?.maxHomeOddsPreLive ?? existing?.maxHomeOddsPreLive ?? 1.7);
      const minElapsedForHt = Number(cfg?.minElapsedForHt ?? existing?.minElapsedForHt ?? 40);
      const maxElapsedForHt = Number(cfg?.maxElapsedForHt ?? existing?.maxElapsedForHt ?? 52);

      // Pegar timeline e odds atuais
      const timeline = (baseBetfair as any)?.timeline ?? (current as any)?.betfair?.timeline ?? null;
      const elapsed = Number(timeline?.elapsed ?? 0);
      const scoreHome = Number(timeline?.scoreHome ?? (current as any)?.scoreHome ?? -1);
      const scoreAway = Number(timeline?.scoreAway ?? (current as any)?.scoreAway ?? -1);
      const odds = (current as any)?.betfair?.odds ?? baseBetfair?.odds ?? {};

      // Odds atuais do time da casa e visitante
      const homeBack = Number(odds?.home?.back ?? 0);
      const awayBack = Number(odds?.away?.back ?? 0);
      
      // Pegar preLiveOdds salvo ou estimar com base nas odds atuais
      const preLiveHomeOdds = Number(existing?.preLiveHomeOdds ?? (current as any)?.betfair?.preLiveHomeOdds ?? 0);
      const preLiveAwayOdds = Number(existing?.preLiveAwayOdds ?? (current as any)?.betfair?.preLiveAwayOdds ?? 0);

      const isInPlay = Boolean((current as any)?.betfair?.inPlay ?? baseBetfair?.inPlay ?? false);
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      // Estado da estratégia
      const phase = String(existing?.phase ?? "monitoring");
      const hasEntered = Boolean(existing?.hasEntered);
      const enteredAt = existing?.enteredAt ?? null;

      // Determinar favorito baseado nas odds pre-live
      const favoriteIsHome = preLiveHomeOdds > 0 && preLiveHomeOdds <= maxHomeOddsPreLive && preLiveHomeOdds >= minHomeOddsPreLive;
      const favoriteIsAway = preLiveAwayOdds > 0 && preLiveAwayOdds <= maxHomeOddsPreLive && preLiveAwayOdds >= minHomeOddsPreLive;

      // Placar do HT: visitante ganhando (0x1 ou 0x2) quando favorito é casa
      const isHtPlacar = elapsed >= minElapsedForHt && elapsed <= maxElapsedForHt;
      const homeLosing = scoreHome === 0 && (scoreAway === 1 || scoreAway === 2);
      const awayLosing = scoreAway === 0 && (scoreHome === 1 || scoreHome === 2);
      
      // Cenário: Favorito (casa) perdendo no HT
      const scenarioHomeFav = favoriteIsHome && homeLosing && isHtPlacar;
      // Cenário: Favorito (visitante) perdendo no HT  
      const scenarioAwayFav = favoriteIsAway && awayLosing && isHtPlacar;
      
      // Preço para entrar Back no favorito (usar odds atuais)
      const favBackPrice = favoriteIsHome ? homeBack : awayBack;
      const favSelectionId = favoriteIsHome 
        ? Number((current as any)?.betfair?.runners?.homeSelectionId ?? baseBetfair?.runners?.homeSelectionId ?? NaN)
        : Number((current as any)?.betfair?.runners?.awaySelectionId ?? baseBetfair?.runners?.awaySelectionId ?? NaN);
      const favSide = "BACK";

      // Preço LAY no azarão (visitante ou casa)
      const dogSelectionId = favoriteIsHome
        ? Number((current as any)?.betfair?.runners?.awaySelectionId ?? baseBetfair?.runners?.awaySelectionId ?? NaN)
        : Number((current as any)?.betfair?.runners?.homeSelectionId ?? baseBetfair?.runners?.homeSelectionId ?? NaN);
      const dogLayPrice = favoriteIsHome ? awayBack : homeBack;
      const dogSide = "LAY";

      // Preparar instruções
      const instructions: any[] = [];

      if (!hasEntered && (scenarioHomeFav || scenarioAwayFav)) {
        // ENTRADA 1: Back Favorito (odds maiores que pre-live)
        if (Number.isFinite(favSelectionId) && favBackPrice > 0) {
          instructions.push({
            selectionId: favSelectionId,
            handicap: 0,
            side: favSide,
            orderType: "LIMIT",
            limitOrder: { size: stakeAbs, price: favBackPrice, persistenceType: "LAPSE" },
          });
        }

        // ENTRADA 2: LAY no azarão  
        if (Number.isFinite(dogSelectionId) && dogLayPrice > 0) {
          instructions.push({
            selectionId: dogSelectionId,
            handicap: 0,
            side: dogSide,
            orderType: "LIMIT",
            limitOrder: { size: stakeAbs * 0.5, price: dogLayPrice, persistenceType: "LAPSE" },
          });
        }

        // ENTRADA 3: Both Teams to Score - SIM (se disponível)
        // BTTS é mercado separado do Match Odds, faremos em outra chamada
      }

      // Preparar estado BTTS (salvar se resolveu com sucesso)
      let bttsMarket: any = null;
      let bttsOrderResult: any = null;
      let bttsError: string | null = null;

      if (!hasEntered && (scenarioHomeFav || scenarioAwayFav)) {
        // Tentar resolver o mercado BTTS e fazer placeOrders separado
        try {
          const adminToken = String((body as any)?.adminToken ?? "").trim();
          bttsMarket = await resolveBetfairBttsMarket({
            eventId: matchId,
            adminToken,
          });
          if (bttsMarket?.marketId && Number.isFinite(bttsMarket?.runners?.yesSelectionId)) {
            const bttsPrice = bttsMarket?.odds?.yes?.back ?? null;
            if (bttsPrice && bttsPrice > 0) {
              bttsOrderResult = await placeOrders({
                adminToken,
                marketId: bttsMarket.marketId,
                customerRef: `FCBTTS_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
                instructions: [{
                  selectionId: bttsMarket.runners.yesSelectionId,
                  handicap: 0,
                  side: "BACK",
                  orderType: "LIMIT",
                  limitOrder: { size: stakeAbs * 0.5, price: bttsPrice, persistenceType: "LAPSE" },
                }],
              });
            } else {
              bttsError = `BTTS odds YES não disponível (back: ${bttsPrice})`;
            }
          } else {
            bttsError = "BTTS market não disponível ou YES selectionId inválido";
          }
        } catch (error: any) {
          bttsError = error?.message ?? String(error);
        }
      }

      const nextState: any = {
        phase: hasEntered ? "executed" : (instructions.length > 0 ? "entering" : "monitoring"),
        hasEntered: hasEntered || instructions.length > 0 || (bttsOrderResult?.status === "SUCCESS"),
        enteredAt: hasEntered ? enteredAt : (instructions.length > 0 || (bttsOrderResult?.status === "SUCCESS") ? nowIso : null),
        lastTickAt: nowIso,
        lastScoreHome: scoreHome,
        lastScoreAway: scoreAway,
        preLiveHomeOdds: preLiveHomeOdds || homeBack,
        preLiveAwayOdds: preLiveAwayOdds || awayBack,
        elapsed,
        stakeAbs,
        btts: {
          marketId: bttsMarket?.marketId ?? null,
          marketResolved: bttsMarket != null,
          yesSelectionId: bttsMarket?.runners?.yesSelectionId ?? null,
          yesPrice: bttsMarket?.odds?.yes?.back ?? null,
          orderResult: bttsOrderResult,
          orderError: bttsError,
        },
      };

      if (instructions.length > 0) {
        // Se tem instruções, fazer placeOrders no Match Odds
        try {
          const moMarketId = String((current as any)?.betfair?.marketId ?? baseBetfair?.marketId ?? "").trim();
          if (moMarketId) {
            const result = await placeOrders({
              adminToken: String((body as any)?.adminToken ?? "").trim(),
              marketId: moMarketId,
              customerRef: `FC_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
              instructions,
            });
            nextState.lastEntryResult = result;
            nextState.entryBetId = result?.instructionReports?.[0]?.betId ?? null;
            nextState.entryPrice = favBackPrice;
            nextState.entrySizeMatched = stakeAbs;
          }
        } catch (error: any) {
          nextState.lastEntryError = error?.message ?? String(error);
        }
      }

      // Salvar estado via queue update
      const updateKey = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
      const currentRaw = (await kv.get(updateKey)) ?? {};
      const nextItem = {
        ...currentRaw,
        betfair: baseBetfair || current?.betfair,
        strategy: { ...strategy, agent: "favoriteComeback", favoriteComeback: nextState },
        updatedAt: nowIso,
      };
      await kv.set(updateKey, nextItem);

      return json({
        ok: true,
        entered: instructions.length > 0,
        scenario: scenarioHomeFav ? "home_fav_losing" : scenarioAwayFav ? "away_fav_losing" : "none",
        instructions,
        state: nextState,
        item: nextItem,
      });
    }


    return json({ ok: true, skipped: true, reason: "not_implemented" });
  }

  // === ROTA DE TESTE: placeOrders no Match Odds ===
  if (req.method === "POST" && (path.includes("/automation/betfair/strategy/placeOrdersMatchOdds") || path.includes("/automation/betfair/test/placeOrders"))) {
    const adminTokenRaw = "5XnTu4rGA1Ia4iSpJIxw8Fp7aS3ejMYQA9qzQOYBGKY=";
    const matchIdTest = "1544371";
    const selectionId = 1096;
    const side = "BACK";
    const price = 1.66;
    const size = 2.0;
    if (!adminTokenRaw) return json({ ok: false, error: "adminToken obrigatório" }, 400);
    if (!matchIdTest) return json({ ok: false, error: "matchId obrigatório" }, 400);
    if (!Number.isFinite(selectionId)) return json({ ok: false, error: "selectionId obrigatório" }, 400);
    if (!Number.isFinite(price) || price < 1.01) return json({ ok: false, error: "price inválido" }, 400);
    if (!Number.isFinite(size) || size <= 0) return json({ ok: false, error: "size inválido" }, 400);
    try {
      const current = await getQueueItem(matchIdTest);
      const betfair = current?.betfair ?? {};
      const matchOddsMarketId = String(betfair?.matchOdds?.marketId ?? "1.257879109").trim();
      if (!matchOddsMarketId) {
        const cats = await betfairRpc({
          method: "SportsAPING/v1.0/listMarketCatalogue",
          adminToken: adminTokenRaw,
          params: {
            filter: { eventIds: [matchIdTest], marketTypeCodes: ["MATCH_ODDS"] },
            maxResults: 5,
            sort: "MAXIMUM_TRADED",
            marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
          },
        });
        const mk = Array.isArray(cats) ? cats[0] : null;
        const id = String(mk?.marketId ?? "").trim();
        if (!id) return json({ ok: false, error: "Match Odds marketId não encontrado para este evento" }, 404);
        const result = await placeOrders({
          adminToken: adminTokenRaw, marketId: id,
          customerRef: `test-${matchIdTest}-${Date.now().toString(16)}`.slice(0, 32),
          instructions: [{ selectionId, side, orderType: "LIMIT", limitOrder: { size, price, persistenceType: "LAPSE" } }],
        });
        return json({ ok: true, type: "placeOrder", marketId: id, result });
      }
      const result = await placeOrders({
        adminToken: adminTokenRaw, marketId: matchOddsMarketId,
        customerRef: `test-${matchIdTest}-${Date.now().toString(16)}`.slice(0, 32),
        instructions: [{ selectionId, side, orderType: "LIMIT", limitOrder: { size, price, persistenceType: "LAPSE" } }],
      });
      return json({ ok: true, type: "placeOrder", marketId: matchOddsMarketId, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro no placeOrders Match Odds" }, 500);
    }
  }

    // ============================================================
    // ESTRATÉGIA: over05htMomentum - Over 0.5 HT por momento
    // ============================================================
    if (matchPath(path, "/automation/betfair/strategy/over05htMomentum/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const baseBetfair = current?.betfair ?? {};
      const timeline = baseBetfair?.timeline ?? null;
      const elapsed = Number(timeline?.elapsed ?? 0);
      const odds = baseBetfair?.odds ?? {};
      const homeBack = Number(odds?.home?.back ?? 0);
      const homeLay = Number(odds?.home?.lay ?? 0);
      const volume = Number(baseBetfair?.matchedVolume ?? 0);
      const betfairEventId = String(baseBetfair?.eventId ?? "").trim() || matchId;

      const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
      const existing = (strategy as any)?.over05htMomentum && typeof (strategy as any).over05htMomentum === "object" ? (strategy as any).over05htMomentum : {};

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const stakeAbs = Number(cfg?.stakeAbs ?? existing?.stakeAbs ?? NaN);
      const finalStake = Number.isFinite(stakeAbs) && stakeAbs > 0 ? Math.max(2, stakeAbs) : 2;

      const spread = homeLay > 0 && homeBack > 0 ? homeLay - homeBack : 0;
      const pressaoHome = homeLay < 2.0 && homeLay > 1.1;
      const volatilidade = spread > 0.08;
      const volumeAlto = volume > 50000;
      const indicadores = [pressaoHome, volatilidade, volumeAlto].filter(Boolean).length;

      const hasEntered = Boolean(existing?.hasEntered);
      const momentumBom = indicadores >= 2 && elapsed > 5 && elapsed < 40;

      let overMarket: any = null;
      let overOrderResult: any = null;
      let overError: string | null = null;

      if (!hasEntered && momentumBom) {
        try {
          const adminToken = String((body as any)?.adminToken ?? "").trim();
          overMarket = await resolveBetfairOverUnderMarket({
            eventId: betfairEventId, lineCode: 0.5, adminToken,
          });
          if (overMarket?.marketId && Number.isFinite(overMarket?.runners?.overSelectionId)) {
            const overPrice = overMarket?.odds?.over?.back ?? null;
            if (overPrice && overPrice > 0) {
              overOrderResult = await placeOrders({
                adminToken,
                marketId: overMarket.marketId,
                customerRef: `O05HT_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
                instructions: [{
                  selectionId: overMarket.runners.overSelectionId,
                  handicap: 0, side: "BACK", orderType: "LIMIT",
                  limitOrder: { size: finalStake, price: overPrice, persistenceType: "LAPSE" },
                }],
              });
            } else {
              overError = "Over 0.5 HT odds nao disponivel";
            }
          } else {
            overError = "Over 0.5 HT market nao disponivel";
          }
        } catch (error: any) {
          overError = error?.message ?? String(error);
        }
      }

      const nextState = {
        phase: hasEntered ? "executed" : (overOrderResult?.status === "SUCCESS" ? "entered" : "monitoring"),
        hasEntered: hasEntered || overOrderResult?.status === "SUCCESS",
        lastTickAt: new Date().toISOString(),
        elapsed,
        stakeAbs: finalStake,
        momentum: { indicadores, pressaoHome, volatilidade, volumeAlto, spread, homeLay, volume },
        over: { marketId: overMarket?.marketId ?? null, orderResult: overOrderResult, orderError: overError },
      };

      const updateKey = BETFAIR_QUEUE_PREFIX + matchId;
      const currentRaw = (await kv.get(updateKey)) ?? {};
      const nextItem = {
        ...currentRaw,
        betfair: baseBetfair || current?.betfair,
        strategy: { ...strategy, agent: "over05htMomentum", over05htMomentum: nextState },
        updatedAt: new Date().toISOString(),
      };
      await kv.set(updateKey, nextItem);

      return json({ ok: true, entered: Boolean(overOrderResult?.status === "SUCCESS"), momentumBom, indicadores, overError, state: nextState });
    }

    // ============================================================
    // SISTEMA DE AJUSTE DE ORDEM - Auto-recuperação 15-20s
    // ============================================================
    // Se uma ordem não for correspondida em ~15s, cancela e
    // recoloca com preço 1 tick mais próximo do mercado atual
    if (matchPath(path, "/automation/betfair/strategy/adjustOrder/tick")) {
      const admin = requireAdminToken(body);
      if (!admin.ok) return json(admin, 401);
      const current = await getQueueItem(matchId);
      if (!current) return json({ ok: false, error: "Item não encontrado" }, 404);

      const cfg = (body as any)?.config && typeof (body as any).config === "object" ? (body as any).config : {};
      const betIdToAdjust = String(cfg?.betId ?? "").trim();
      if (!betIdToAdjust) return json({ ok: false, error: "betId obrigatório" }, 400);

      const marketIds = [String(cfg?.marketId ?? "").trim()].filter(Boolean);
      if (marketIds.length === 0) return json({ ok: false, error: "marketId obrigatório" }, 400);

      const elapsedSeconds = Number(cfg?.elapsedSeconds ?? 0);
      if (elapsedSeconds < 10) return json({ ok: false, error: `Ainda dentro do prazo (${elapsedSeconds}s < 10s)` });

      const maxTicksAbove = Number(cfg?.maxTicksAbove ?? 3);  // Máximo de ticks que pode subir
      const tickSize = Number(cfg?.tickSize ?? 0.01);  // Tamanho do tick

      let result: any = { attempt: 0, cancelled: false, newBetId: null, newOrderStatus: null };

      try {
        // 1. Verificar estado atual da ordem
        const ordersRes = await listCurrentOrders({ adminToken: admin.adminToken, betIds: [betIdToAdjust] });
        const ordersList = Array.isArray((ordersRes as any)?.currentOrders) ? (ordersRes as any).currentOrders : [];
        const order = ordersList.find((o: any) => String(o?.betId ?? "").trim() === betIdToAdjust) ?? null;

        if (!order) {
          // Ordem já foi totalmente executada ou não existe mais
          return json({ ok: true, skipped: true, reason: "ordem_ja_executada_ou_inexistente", betId: betIdToAdjust });
        }

        const sizeRemaining = Number(order?.sizeRemaining ?? 0);
        const sizeMatched = Number(order?.sizeMatched ?? 0);
        const status = String(order?.status ?? "").toUpperCase();

        if (sizeRemaining <= 0 || status === "EXECUTION_COMPLETE") {
          return json({ ok: true, skipped: true, reason: "ordem_ja_executada", sizeMatched });
        }

        // 2. Cancelar a ordem antiga
        const cancelRes = await cancelOrders({
          adminToken: admin.adminToken,
          marketId: marketIds[0],
          instructions: [{ betId: betIdToAdjust }],
        });

        const cancelReports = Array.isArray((cancelRes as any)?.instructionReports)
          ? (cancelRes as any).instructionReports
          : (Array.isArray((cancelRes as any)?.result?.instructionReports)
            ? (cancelRes as any).result.instructionReports
            : []);

        const cancelStatus = cancelReports[0]?.status ?? "FAILURE";
        result.cancelled = cancelStatus === "SUCCESS";
        const sizeCancelled = Number(cancelReports[0]?.sizeCancelled ?? 0);

        // 3. Pegar odds atualizadas do mercado
        const baseBetfair = current?.betfair ?? {};
        const marketOdds = baseBetfair?.odds ?? {};
        const homeBack = Number(marketOdds?.home?.back ?? 0);
        const homeLay = Number(marketOdds?.home?.lay ?? 0);
        const awayBack = Number(marketOdds?.away?.back ?? 0);
        const awayLay = Number(marketOdds?.away?.lay ?? 0);
        const drawBack = Number(marketOdds?.draw?.back ?? 0);
        const drawLay = Number(marketOdds?.draw?.lay ?? 0);

        const orderSide = String(order?.side ?? "").toUpperCase();
        const orderSelectionId = Number(order?.selectionId);
        const orderPrice = Number(order?.priceSize?.price ?? order?.averagePriceMatched ?? 0);
        const newSize = sizeCancelled > 0 ? sizeCancelled : sizeRemaining;

        // 4. Determinar novo preço (1 tick mais agressivo)
        // Se BACK: aumenta o preço (oferece mais pro mercado pegar)
        // Se LAY: diminui o preço (oferece menos pro mercado pegar)
        let newPrice = orderPrice;
        let ticksMoved = 0;

        if (orderSide === "BACK") {
          // BACK: subir o preço 1 tick = mais perto do lay atual
          const bestLay = orderSelectionId === Number(current?.betfair?.runners?.homeSelectionId) ? homeLay
            : orderSelectionId === Number(current?.betfair?.runners?.awaySelectionId) ? awayLay
            : drawLay;
          if (bestLay > 0) {
            newPrice = Math.min(bestLay, orderPrice + tickSize);
            ticksMoved = Math.round((newPrice - orderPrice) / tickSize);
          } else {
            newPrice = orderPrice + tickSize;
            ticksMoved = 1;
          }
        } else if (orderSide === "LAY") {
          // LAY: diminuir o preço 1 tick = mais perto do back atual
          const bestBack = orderSelectionId === Number(current?.betfair?.runners?.homeSelectionId) ? homeBack
            : orderSelectionId === Number(current?.betfair?.runners?.awaySelectionId) ? awayBack
            : drawBack;
          if (bestBack > 0) {
            newPrice = Math.max(bestBack, orderPrice - tickSize);
            ticksMoved = Math.round((orderPrice - newPrice) / tickSize);
          } else {
            newPrice = Math.max(1.01, orderPrice - tickSize);
            ticksMoved = 1;
          }
        }

        // Limitar número de ticks que pode subir
        const totalTicksMoved = Number(cfg?.previousTicksMoved ?? 0) + ticksMoved;
        if (totalTicksMoved > maxTicksAbove) {
          return json({ ok: false, error: `Já moveu ${totalTicksMoved} ticks, max permitido ${maxTicksAbove}` });
        }

        // Arredondar para 2 casas decimais
        newPrice = Math.round(newPrice * 100) / 100;
        if (newPrice < 1.01) newPrice = 1.01;

        // 5. Recolocar ordem com novo preço
        const placeRes = await placeOrders({
          adminToken: admin.adminToken,
          marketId: marketIds[0],
          customerRef: `ADJ_${betIdToAdjust.slice(-8)}_${Date.now().toString(16)}`.slice(0, 32),
          instructions: [{
            selectionId: orderSelectionId,
            handicap: 0,
            side: orderSide,
            orderType: "LIMIT",
            limitOrder: { size: Math.max(0.01, newSize), price: newPrice, persistenceType: "LAPSE" },
          }],
        });

        const placeReports = Array.isArray((placeRes as any)?.instructionReports)
          ? (placeRes as any).instructionReports
          : (Array.isArray((placeRes as any)?.result?.instructionReports)
            ? (placeRes as any).result.instructionReports
            : []);

        const placeStatus = placeReports[0]?.status ?? "FAILURE";
        const newBetId = placeReports[0]?.betId ?? null;
        result.newBetId = newBetId;
        result.newOrderStatus = placeStatus;
        result.newPrice = newPrice;
        result.oldPrice = orderPrice;
        result.ticksMoved = ticksMoved;
        result.totalTicksMoved = totalTicksMoved;
        result.sizeCancelled = sizeCancelled;
        result.orderSide = orderSide;

        // 6. Atualizar o item na queue com os novos dados
        const updateKey = BETFAIR_QUEUE_PREFIX + matchId;
        const currentRaw = (await kv.get(updateKey)) ?? {};
        const strategy = (current as any)?.strategy && typeof (current as any).strategy === "object" ? (current as any).strategy : {};
        const strategyKey = String(strategy?.agent ?? "unknown").trim();

        const updatedStrategy = {
          ...currentRaw,
          betfair: baseBetfair || current?.betfair,
          strategy: {
            ...strategy,
            [strategyKey]: {
              ...(strategy as any)?.[strategyKey],
              lastAdjustAt: new Date().toISOString(),
              adjustCount: Number((strategy as any)?.[strategyKey]?.adjustCount ?? 0) + 1,
              lastAdjustOldBetId: betIdToAdjust,
              lastAdjustNewBetId: newBetId,
              lastAdjustOldPrice: orderPrice,
              lastAdjustNewPrice: newPrice,
            },
          },
          updatedAt: new Date().toISOString(),
        };
        await kv.set(updateKey, updatedStrategy);

      } catch (error: any) {
        result.error = error?.message ?? String(error);
      }

      return json({ ok: true, ...result });
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
