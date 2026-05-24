import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { hydrateApiConfigFromServer, loadApiConfig, saveApiConfig } from '../services/apiConfig';
import { ApiFootballService, useApiFootballLiveUpdates } from '../services/apiFootballService';
import { toast } from 'sonner';

const TIME_ZONE = 'America/Sao_Paulo';

const normalizeTeamName = (name: string) => {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toTokens = (name: string) => {
  const raw = normalizeTeamName(name).toLowerCase();
  if (!raw) return [];
  const stop = new Set([
    'fc',
    'cf',
    'sc',
    'ac',
    'afc',
    'cd',
    'ud',
    'fk',
    'sk',
    'sv',
    'sl',
    'sp',
    'club',
    'calcio',
    'team',
    'de',
    'la',
    'el',
    'the',
    'sport',
    'sporting',
  ]);
  return raw
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t));
};

const overlapScore = (a: string, b: string) => {
  const ta = toTokens(a);
  const tb = new Set(toTokens(b));
  if (ta.length === 0 || tb.size === 0) return 0;
  const hits = ta.filter((t) => tb.has(t)).length;
  return hits / Math.max(ta.length, tb.size);
};

const getMatchYmd = (d: Date) => {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const list = Array.isArray(items) ? items : [];
  const size = Number.isFinite(concurrency) ? Math.max(1, Math.min(8, Math.floor(concurrency))) : 1;
  const results: R[] = new Array(list.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= list.length) return;
      results[idx] = await fn(list[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, list.length) }, () => worker()));
  return results;
};

export function Layout() {
  const favoriteRescueStatusKey = 'favorite_rescue_status_v1';
  const sidebarCollapsedKey = 'sidebar_collapsed_v1';
  const readStatus = () => {
    try {
      const raw = localStorage.getItem(favoriteRescueStatusKey);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      if (!parsed || parsed.version !== 1) {
        return { version: 1, enabled: false, kind: 'inactive', text: 'Desativado', updatedAt: new Date(0).toISOString() };
      }
      return parsed as {
        version: 1;
        enabled: boolean;
        kind: 'inactive' | 'monitoring' | 'entry' | 'exit_mo' | 'exit_cs' | 'error';
        text: string;
        updatedAt: string;
        lastErrorAt?: string;
        error?: string;
      };
    } catch {
      return { version: 1, enabled: false, kind: 'inactive', text: 'Desativado', updatedAt: new Date(0).toISOString() };
    }
  };
  const writeStatus = (patch: Partial<ReturnType<typeof readStatus>>) => {
    const cur = readStatus();
    const next = { ...cur, ...patch, version: 1, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(favoriteRescueStatusKey, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event('favoriteRescueStatusChanged'));
  };

  const [favoriteRescueEnabled, setFavoriteRescueEnabled] = useState(false);
  const [statusSnapshot, setStatusSnapshot] = useState(() => readStatus());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(sidebarCollapsedKey) === '1';
    } catch {
      return false;
    }
  });
  const [automationFixtureIdsBase, setAutomationFixtureIdsBase] = useState<Array<number | string>>([]);
  const [automationFixtureIdsDetailed, setAutomationFixtureIdsDetailed] = useState<Array<number | string>>([]);
  const automationQueueSnapshotRef = useRef<any[]>([]);
  const [automationQueueSnapshotTick, setAutomationQueueSnapshotTick] = useState(0);
  const lastFundsSyncAtRef = useRef(0);
  const lastLiveSnapshotPushAtRef = useRef(0);
  const fixtureIdByMatchIdRef = useRef<Record<string, number>>({});
  const isResolvingFixtureIdsRef = useRef(false);
  const lastFixtureIdResolveAtRef = useRef(0);
  const goalAlertToastRef = useRef<Record<string, { lastBetId: string | null; lastToastAtMs: number }>>({});

  const apiFootballLiveBaseRaw = useApiFootballLiveUpdates(automationFixtureIdsBase, {
    enabled: automationFixtureIdsBase.length > 0,
    fast: false,
  });
  const apiFootballLiveDetailedRaw = useApiFootballLiveUpdates(automationFixtureIdsDetailed, {
    enabled: automationFixtureIdsDetailed.length > 0,
    includeDetails: true,
    fast: true,
  });
  const apiFootballLiveByFixtureId = useMemo(() => {
    return { ...apiFootballLiveBaseRaw, ...apiFootballLiveDetailedRaw };
  }, [apiFootballLiveBaseRaw, apiFootballLiveDetailedRaw]);
  const apiFootballLiveRef = useRef<Record<string, any>>({});

  useEffect(() => {
    apiFootballLiveRef.current = apiFootballLiveByFixtureId as any;
  }, [apiFootballLiveByFixtureId]);

  useEffect(() => {
    try {
      localStorage.setItem(sidebarCollapsedKey, sidebarCollapsed ? '1' : '0');
    } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    void hydrateApiConfigFromServer();
    const sync = () => {
      const cfg = loadApiConfig();
      const fr =
        (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object' ? (cfg.betfairRobotLimits as any).favoriteRescue : null) ?? null;
      const enabled = Boolean(fr?.enabled ?? false);
      setFavoriteRescueEnabled(enabled);
      setStatusSnapshot(readStatus());
    };
    sync();
    const t = window.setInterval(sync, 2_000);
    const onStatusChanged = () => sync();
    const onConfigChanged = () => sync();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === favoriteRescueStatusKey) sync();
    };
    window.addEventListener('favoriteRescueStatusChanged' as any, onStatusChanged as any);
    window.addEventListener('apiConfigChanged', onConfigChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('favoriteRescueStatusChanged' as any, onStatusChanged as any);
      window.removeEventListener('apiConfigChanged', onConfigChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    let inFlight = false;

    const getEdgeHeaders = async () => {
      const { publicAnonKey } = await import('/utils/supabase/info');
      return {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      } as const;
    };

    const runOnce = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { projectId } = await import('/utils/supabase/info');
        const headers = await getEdgeHeaders();
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
          method: 'POST',
          headers,
          body: '{}',
        });
        const raw = await res.text().catch(() => '');
        const data = raw ? JSON.parse(raw) : null;
        if (!res.ok || !data?.ok) return;
        const items = Array.isArray(data?.items) ? (data.items as any[]) : [];
        automationQueueSnapshotRef.current = items;
        setAutomationQueueSnapshotTick((x) => x + 1);

        const idsBase: Array<number | string> = [];
        const idsDetailed: Array<number | string> = [];
        const seenBase = new Set<number>();
        const seenDetailed = new Set<number>();
        const fixtureByMatchId: Record<string, number> = {};
        for (const it of items) {
          const status = String((it as any)?.status ?? '').trim();
          const id = String((it as any)?.matchId ?? '').trim();
          if (!id) continue;
          const fidRaw = Number((it as any)?.fixtureId ?? id);
          const fid = Number.isFinite(fidRaw) && fidRaw > 0 ? Math.floor(fidRaw) : 0;
          if (fid > 0) fixtureByMatchId[id] = fid;
          if (status !== 'stopped') {
            if (fid > 0 && !seenBase.has(fid)) {
              seenBase.add(fid);
              idsBase.push(fid);
            }
          }
          if (status === 'running' || status === 'paused' || Boolean((it as any)?.betfair?.inPlay) || typeof (it as any)?.live?.elapsed === 'number') {
            if (fid > 0 && !seenDetailed.has(fid)) {
              seenDetailed.add(fid);
              idsDetailed.push(fid);
            }
          }
        }
        fixtureIdByMatchIdRef.current = fixtureByMatchId;
        setAutomationFixtureIdsBase(idsBase.slice(0, 60));
        setAutomationFixtureIdsDetailed(idsDetailed.slice(0, 18));

        const maybeResolveFixtureIds = async () => {
          const nowMs = Date.now();
          if (isResolvingFixtureIdsRef.current) return;
          if (nowMs - lastFixtureIdResolveAtRef.current < 60_000) return;
          lastFixtureIdResolveAtRef.current = nowMs;

          const cfg = loadApiConfig();
          const apiFootballKey = String((cfg as any)?.apiFootballKey ?? '').trim();
          if (!apiFootballKey) return;

          const candidates = items
            .filter((x) => String((x as any)?.status ?? '').trim() !== 'stopped')
            .filter((x) => {
              const matchId = String((x as any)?.matchId ?? '').trim();
              if (!matchId) return false;
              const fid = Number((x as any)?.fixtureId ?? matchId);
              if (Number.isFinite(fid) && fid > 0) return false;
              const homeTeam = String((x as any)?.homeTeam ?? '').trim();
              const awayTeam = String((x as any)?.awayTeam ?? '').trim();
              return Boolean(homeTeam && awayTeam);
            })
            .slice(0, 4);
          if (candidates.length === 0) return;

          isResolvingFixtureIdsRef.current = true;
          try {
            const service = new ApiFootballService(apiFootballKey);
            const fixturesCache = new Map<string, any[]>();
            const updates: Array<{ matchId: string; patch: any }> = [];

            for (const x of candidates) {
              const matchId = String((x as any)?.matchId ?? '').trim();
              if (!matchId) continue;
              const utc = String((x as any)?.utcDate ?? (x as any)?.betfair?.marketStartTime ?? '').trim();
              const homeTeam = String((x as any)?.homeTeam ?? '').trim();
              const awayTeam = String((x as any)?.awayTeam ?? '').trim();
              if (!utc || !homeTeam || !awayTeam) continue;
              const d = new Date(utc);
              if (!Number.isFinite(d.getTime())) continue;
              const ymd = getMatchYmd(d);

              let fixtures = fixturesCache.get(ymd);
              if (!fixtures) {
                fixtures = await service.getFixtures({ date: ymd, timezone: TIME_ZONE, maxPages: 5 }).catch(() => []);
                fixturesCache.set(ymd, fixtures);
              }

              const matchTs = d.getTime();
              let best: { nameScore: number; diffMin: number; fixtureId: number } | null = null;
              for (const f of Array.isArray(fixtures) ? fixtures : []) {
                const fixtureId = Number((f as any)?.fixture?.id);
                if (!Number.isFinite(fixtureId) || fixtureId <= 0) continue;
                const homeName = String((f as any)?.teams?.home?.name ?? '');
                const awayName = String((f as any)?.teams?.away?.name ?? '');
                const s1 = overlapScore(homeTeam, homeName);
                const s2 = overlapScore(awayTeam, awayName);
                const sSwap1 = overlapScore(homeTeam, awayName);
                const sSwap2 = overlapScore(awayTeam, homeName);
                const direct = (s1 + s2) / 2;
                const swapped = (sSwap1 + sSwap2) / 2;
                const nameScore = Math.max(direct, swapped);

                const t = Number((f as any)?.fixture?.timestamp ?? 0);
                const fixtureTs = Number.isFinite(t) && t > 0 ? t * 1000 : new Date(String((f as any)?.fixture?.date ?? '')).getTime();
                const diffMin = Number.isFinite(fixtureTs) ? Math.abs(fixtureTs - matchTs) / 60000 : 99999;

                if (!best || nameScore > best.nameScore || (nameScore === best.nameScore && diffMin < best.diffMin)) {
                  best = { nameScore, diffMin, fixtureId: Math.floor(fixtureId) };
                }
              }

              if (!best) continue;
              if (best.nameScore < 0.45) continue;
              if (!Number.isFinite(best.diffMin) || best.diffMin > 180) continue;
              updates.push({ matchId, patch: { fixtureId: best.fixtureId } });
            }

            if (updates.length === 0) return;

            const { projectId } = await import('/utils/supabase/info');
            const headers = await getEdgeHeaders();
            await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/batchUpdate`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ updates }),
            }).catch(() => null);
          } finally {
            isResolvingFixtureIdsRef.current = false;
          }
        };

        void maybeResolveFixtureIds();
      } catch {}
      finally {
        inFlight = false;
      }
    };

    void runOnce();
    const t = window.setInterval(() => void runOnce(), 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const feedKey = 'favorite_rescue_feed_v1';
    const nowIso = new Date().toISOString();
    const isLiveStatusShort = (s: string) => {
      const k = String(s ?? '').trim().toUpperCase();
      if (!k) return false;
      return ['1H', '2H', 'HT', 'ET', 'LIVE', 'IN_PLAY', 'INPLAY', 'PAUSED', 'BREAK', 'INT', 'SUSP', 'SUSPENDED'].includes(k);
    };
    const isFinishedStatusShort = (s: string) => {
      const k = String(s ?? '').trim().toUpperCase();
      if (!k) return false;
      return ['FT', 'AET', 'PEN', 'AWD', 'CANC', 'PST', 'ABD'].includes(k);
    };

    const items = automationQueueSnapshotRef.current;
    const itemsOut: Record<string, any> = {};
    for (const x of items) {
      const matchId = String((x as any)?.matchId ?? '').trim();
      if (!matchId) continue;
      if (String((x as any)?.status ?? '').trim() === 'stopped') continue;

      const fid = fixtureIdByMatchIdRef.current[matchId] ?? 0;
      const apiLive = fid > 0 ? (apiFootballLiveByFixtureId[String(fid)] ?? null) : null;
      const statusShort = typeof apiLive?.statusShort === 'string' ? apiLive.statusShort : null;
      const status =
        (statusShort && isFinishedStatusShort(statusShort)) || String((x as any)?.betfair?.marketStatus ?? '').toUpperCase() === 'CLOSED'
          ? 'finished'
          : (statusShort && isLiveStatusShort(statusShort)) || Boolean((x as any)?.betfair?.inPlay) || typeof apiLive?.elapsed === 'number'
            ? 'live'
            : 'scheduled';

      itemsOut[matchId] = {
        updatedAt: nowIso,
        status,
        utcDate: typeof (x as any)?.utcDate === 'string' ? (x as any).utcDate : null,
        homeTeam: typeof (x as any)?.homeTeam === 'string' ? (x as any).homeTeam : null,
        awayTeam: typeof (x as any)?.awayTeam === 'string' ? (x as any).awayTeam : null,
        liveElapsed: typeof apiLive?.elapsed === 'number' ? apiLive.elapsed : typeof (x as any)?.live?.elapsed === 'number' ? (x as any).live.elapsed : null,
        liveStatusShort: statusShort,
        scoreHome: typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : typeof (x as any)?.scoreHome === 'number' ? (x as any).scoreHome : null,
        scoreAway: typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : typeof (x as any)?.scoreAway === 'number' ? (x as any).scoreAway : null,
        cardsHome: typeof apiLive?.cardsHome === 'number' ? apiLive.cardsHome : null,
        cardsAway: typeof apiLive?.cardsAway === 'number' ? apiLive.cardsAway : null,
        shotsOnGoalHome: typeof apiLive?.shotsOnGoalHome === 'number' ? apiLive.shotsOnGoalHome : null,
        shotsOnGoalAway: typeof apiLive?.shotsOnGoalAway === 'number' ? apiLive.shotsOnGoalAway : null,
        dangerousAttacksHome: typeof apiLive?.dangerousAttacksHome === 'number' ? apiLive.dangerousAttacksHome : null,
        dangerousAttacksAway: typeof apiLive?.dangerousAttacksAway === 'number' ? apiLive.dangerousAttacksAway : null,
        attacksHome: typeof apiLive?.attacksHome === 'number' ? apiLive.attacksHome : null,
        attacksAway: typeof apiLive?.attacksAway === 'number' ? apiLive.attacksAway : null,
        cornersHome: typeof apiLive?.cornersHome === 'number' ? apiLive.cornersHome : null,
        cornersAway: typeof apiLive?.cornersAway === 'number' ? apiLive.cornersAway : null,
        betfair: (x as any)?.betfair ?? null,
      };
    }

    try {
      const raw = localStorage.getItem(feedKey);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const prevItems = parsed?.version === 1 && parsed?.items && typeof parsed.items === 'object' ? parsed.items : {};
      const nextItems = { ...prevItems, ...itemsOut };
      const prunedEntries = Object.entries(nextItems)
        .map(([id, v]) => [id, v] as const)
        .filter(([, v]) => v && typeof v === 'object')
        .slice(0, 1000);
      const payload = { version: 1 as const, updatedAt: nowIso, items: Object.fromEntries(prunedEntries) };
      localStorage.setItem(feedKey, JSON.stringify(payload));
      window.dispatchEvent(new Event('favoriteRescueFeedChanged'));

      const nowMs = Date.now();
      if (nowMs - lastLiveSnapshotPushAtRef.current >= 10_000) {
        lastLiveSnapshotPushAtRef.current = nowMs;
        void (async () => {
          try {
            const cfg = loadApiConfig();
            const adminToken = String(cfg?.automationAdminToken ?? '').trim();
            if (!adminToken) return;
            const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;
            const sanitize = (v: string) => v.trim().replaceAll('`', '').replaceAll('"', '').replaceAll("'", '').trim();
            const fromEnvUrl = sanitize(String(env.VITE_SUPABASE_URL ?? '')).replace(/\/+$/, '');
            const fromEnvAnon = sanitize(String(env.VITE_SUPABASE_ANON_KEY ?? ''));
            const looksLikeJwt = fromEnvAnon.split('.').filter(Boolean).length === 3;

            const { projectId, publicAnonKey } = await import('/utils/supabase/info');
            const baseUrl = fromEnvUrl && looksLikeJwt ? fromEnvUrl : `https://${projectId}.supabase.co`;
            const anonKey = fromEnvAnon && looksLikeJwt ? fromEnvAnon : publicAnonKey;
            const headers = {
              'Content-Type': 'application/json',
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
            } as const;

            const primaryBase = `${baseUrl}/functions/v1`;
            const fallbackBase = `https://${projectId}.supabase.co/functions/v1`;
            const body = JSON.stringify({ adminToken, items: payload.items });

            const tryFetch = async (baseUrl: string) => {
              const res = await fetch(`${baseUrl}/automation-server-1119702f/automation/live/snapshot/upsert`, { method: 'POST', headers, body }).catch(() => null);
              if (!res || !res.ok) throw new Error('snapshot_upsert_failed');
              return true;
            };

            try {
              await tryFetch(primaryBase);
            } catch {
              try {
                if (primaryBase !== fallbackBase) await tryFetch(fallbackBase);
              } catch {}
            }
          } catch {}
        })();
      }
    } catch {}
  }, [apiFootballLiveByFixtureId, automationQueueSnapshotTick]);

  useEffect(() => {
    try {
      localStorage.setItem('favorite_rescue_runner_mode_v1', 'layout');
    } catch {}

    const feedKey = 'favorite_rescue_feed_v1';
    const storeKey = 'favorite_rescue_state_v1';

    const readFeed = () => {
      try {
        const raw = localStorage.getItem(feedKey);
        const parsed = raw ? (JSON.parse(raw) as any) : null;
        if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
          return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
        }
        return parsed as { version: 1; updatedAt: string; items: Record<string, any> };
      } catch {
        return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
      }
    };

    const requestedFixturesKey = 'requested_fixtures_v1';
    const readRequestedFixtureIds = () => {
      try {
        const raw = localStorage.getItem(requestedFixturesKey);
        if (!raw) return new Set<string>();
        const parsed = JSON.parse(raw) as any;
        if (!parsed || !parsed.items || typeof parsed.items !== 'object') return new Set<string>();
        const version = Number(parsed.version);
        if (version !== 1 && version !== 2) return new Set<string>();
        return new Set(Object.keys(parsed.items).map(String));
      } catch {
        return new Set<string>();
      }
    };

    const ensureRequestedFixture = (fixtureId: string) => {
      const id = String(fixtureId ?? '').trim();
      if (!id) return;
      try {
        const raw = localStorage.getItem(requestedFixturesKey);
        const parsed = raw ? (JSON.parse(raw) as any) : null;
        const nextStore = (() => {
          if (parsed && typeof parsed === 'object' && parsed.version === 2 && parsed.items && typeof parsed.items === 'object') {
            return { version: 2 as const, items: { ...parsed.items } } as any;
          }
          if (parsed && typeof parsed === 'object' && parsed.version === 1 && parsed.items && typeof parsed.items === 'object') {
            const v1 = parsed.items as Record<string, { fixtureId?: number }>;
            const items: Record<string, { source: 'api-football'; fixtureId: number }> = {};
            for (const k of Object.keys(v1)) {
              const fid = Number(v1[k]?.fixtureId ?? k);
              if (!Number.isFinite(fid) || fid <= 0) continue;
              items[String(fid)] = { source: 'api-football', fixtureId: fid };
            }
            return { version: 2 as const, items };
          }
          return { version: 2 as const, items: {} as Record<string, { source: 'api-football'; fixtureId: number }> };
        })();

        const fid = Number(id);
        if (Number.isFinite(fid) && fid > 0) {
          nextStore.items[id] = { source: 'api-football', fixtureId: fid };
        }
        localStorage.setItem(requestedFixturesKey, JSON.stringify(nextStore));
        window.dispatchEvent(new Event('requestedFixturesChanged'));
      } catch {}
    };

    const readPredictionFromCache = (matchId: string) => {
      try {
        const raw = localStorage.getItem('matchesCache_v3');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as any;
        if (!parsed || parsed.version !== 3) return null;
        const preds = parsed.predictions && typeof parsed.predictions === 'object' ? parsed.predictions : null;
        if (!preds) return null;
        const p = preds[String(matchId)] ?? null;
        return p && typeof p === 'object' ? p : null;
      } catch {
        return null;
      }
    };

    const ahAutoKey = 'asian_handicap_auto_state_v1';
    const dayKeySp = () =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    type AhAutoState = {
      version: 1;
      dayKey: string;
      lastEnqueuedAt?: string;
      items: Record<string, { enqueuedAt: string; team: 'home' | 'away'; line: number; confidence: number }>;
    };

    const readAhAuto = (): AhAutoState => {
      const today = dayKeySp();
      try {
        const raw = localStorage.getItem(ahAutoKey);
        const parsed = raw ? (JSON.parse(raw) as any) : null;
        if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
          return { version: 1, dayKey: today, items: {} };
        }
        if (String(parsed.dayKey) !== today) return { version: 1, dayKey: today, items: {} };
        return parsed as AhAutoState;
      } catch {
        return { version: 1, dayKey: today, items: {} };
      }
    };

    const writeAhAuto = (next: AhAutoState) => {
      try {
        localStorage.setItem(ahAutoKey, JSON.stringify(next));
      } catch {}
    };

    type RescueState = {
      version: 1;
      items: Record<
        string,
        {
          createdAt: string;
          scenario: 'losing_0_1' | 'losing_0_2';
          minute: number | null;
          scoreHome: number;
          scoreAway: number;
          awayOddAtEntry: number;
          homeFavProb: number | null;
          homeWinRate: number | null;
          matchOdds: { marketId: string; selectionIdAway: number; layPrice: number; stake: number; takeProfitAbs: number };
          correctScore?: {
            marketId: string;
            selections: Array<{ scoreKey: string; selectionId: number; layPrice: number; stake: number; takeProfitAbs: number }>;
          };
          closed?: { matchOdds?: boolean; correctScore?: boolean; at?: string };
        }
      >;
    };

    const readStore = (): RescueState => {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) return { version: 1, items: {} };
        const parsed = JSON.parse(raw) as RescueState;
        if (parsed?.version !== 1 || !parsed?.items || typeof parsed.items !== 'object') return { version: 1, items: {} };
        return parsed;
      } catch {
        return { version: 1, items: {} };
      }
    };

    const writeStore = (next: RescueState) => {
      try {
        localStorage.setItem(storeKey, JSON.stringify(next));
      } catch {}
    };

    const impliedProbHome = (betfair: any) => {
      const ho = Number(betfair?.odds?.home?.back);
      const doo = Number(betfair?.odds?.draw?.back);
      const ao = Number(betfair?.odds?.away?.back);
      if (!Number.isFinite(ho) || !Number.isFinite(doo) || !Number.isFinite(ao)) return null;
      if (ho <= 1 || doo <= 1 || ao <= 1) return null;
      const ph = 1 / ho;
      const pd = 1 / doo;
      const pa = 1 / ao;
      const sum = ph + pd + pa;
      if (!Number.isFinite(sum) || sum <= 0) return null;
      return ph / sum;
    };

    const homeWinRateFromPreLive = (preLive: any) => {
      const played = Number(preLive?.homeLast?.played);
      const w = Number(preLive?.homeLast?.w);
      if (!Number.isFinite(played) || played <= 0) return null;
      if (!Number.isFinite(w) || w < 0) return null;
      if (played < 5) return null;
      return w / played;
    };

    const getEdgeHeaders = async () => {
      const { publicAnonKey } = await import('/utils/supabase/info');
      return {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      };
    };

    const enqueueAutomation = async (args: {
      matchId: string;
      source: string;
      utcDate: string | null;
      homeTeam: string | null;
      awayTeam: string | null;
      scoreHome: number | null;
      scoreAway: number | null;
      prediction?: any;
    }) => {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/add`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          matchId: args.matchId,
          source: args.source,
          utcDate: args.utcDate,
          homeTeam: args.homeTeam,
          awayTeam: args.awayTeam,
          homeCrest: null,
          awayCrest: null,
          scoreHome: args.scoreHome,
          scoreAway: args.scoreAway,
          prediction: args.prediction ?? null,
        }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      return data?.item ?? null;
    };

    const updateAutomationItem = async (matchId: string, patch: any) => {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ matchId, patch }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      return data?.item ?? null;
    };

    const placeOrders = async (args: { adminToken: string; marketId: string; instructions: any[]; customerRef: string }) => {
      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/betfair/placeOrders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ adminToken: args.adminToken, marketId: args.marketId, instructions: args.instructions, customerRef: args.customerRef }),
      });
      const raw = await res.text().catch(() => '');
      const data = raw ? JSON.parse(raw) : null;
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `HTTP ${res.status} ${res.statusText}`));
      return data?.result ?? null;
    };

    const mkStableCustomerRef = (prefix: string, matchId: string, marketId: string, selectionId: number) => {
      const bucket = Math.floor(Date.now() / 4000).toString(36);
      const a = String(prefix ?? '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
        .slice(0, 6);
      const tailMatch = String(matchId ?? '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-7);
      const tailMarket = String(marketId ?? '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-7);
      const sid = Number.isFinite(selectionId) ? Math.max(0, Math.floor(selectionId)).toString(36) : '0';
      const ref = `${a}-${tailMatch}-${tailMarket}-${sid}-${bucket}`;
      return ref.slice(0, 32);
    };

    const didPlaceOrdersSucceed = (res: any) => {
      const topStatus = String(res?.status ?? '').trim().toUpperCase();
      if (topStatus === 'SUCCESS') return true;
      const reports = Array.isArray(res?.instructionReports) ? (res.instructionReports as any[]) : [];
      for (const r of reports) {
        const s = String(r?.status ?? '').trim().toUpperCase();
        const betId = String(r?.betId ?? '').trim();
        if (s === 'SUCCESS' && betId) return true;
      }
      return false;
    };

    const runOnce = async () => {
      const cfgNow = loadApiConfig();
      const fr =
        (cfgNow?.betfairRobotLimits && typeof cfgNow.betfairRobotLimits === 'object' ? (cfgNow.betfairRobotLimits as any).favoriteRescue : null) ?? null;
      const enabled = Boolean(fr?.enabled ?? false);
      if (!enabled) {
        writeStatus({ enabled: false, kind: 'inactive', text: 'Desativado' });
        return;
      }

      const adminToken = String(cfgNow?.automationAdminToken ?? '').trim();
      if (!adminToken) {
        writeStatus({ enabled: true, kind: 'error', text: 'Oscilando: configure o Automation Admin Token.' });
        return;
      }

      const feed = readFeed();
      const feedUpdatedAtMs = new Date(feed.updatedAt).getTime();
      const feedAgeMs = Number.isFinite(feedUpdatedAtMs) ? Date.now() - feedUpdatedAtMs : Number.POSITIVE_INFINITY;
      if (!(feedAgeMs >= 0 && feedAgeMs <= 65_000)) {
        writeStatus({ enabled: true, kind: 'error', text: 'Oscilando: sem atualização recente dos cards.' });
        return;
      }

      writeStatus({ enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' });

      const minFavWinProb = Number(fr?.minFavWinProb);
      const minHomeWinRate = Number(fr?.minHomeWinRate);
      const awayOddsMinLosing01 = Number(fr?.awayOddsMinLosing01);
      const awayOddsMinLosing02 = Number(fr?.awayOddsMinLosing02);
      const matchOddsLayStakeAbs = Number(fr?.matchOddsLayStakeAbs);
      const correctScoreLayStakeAbs = Number(fr?.correctScoreLayStakeAbs);
      const matchOddsTakeProfitMinPct = Number(fr?.matchOddsTakeProfitMinPct);
      const matchOddsTakeProfitMaxPct = Number(fr?.matchOddsTakeProfitMaxPct);
      const correctScoreTakeProfitPct = Number(fr?.correctScoreTakeProfitPct);
      const extremeCorrectScoresCsv = String(fr?.extremeCorrectScoresCsv ?? '0-3,0-4,1-4,0-5');

      const safeMinFavWinProb = Number.isFinite(minFavWinProb) ? Math.max(0.05, Math.min(0.95, minFavWinProb)) : 0.55;
      const safeMinHomeWinRate = Number.isFinite(minHomeWinRate) ? Math.max(0.05, Math.min(0.95, minHomeWinRate)) : 0.8;
      const safeAwayOdds01 = Number.isFinite(awayOddsMinLosing01) ? Math.max(1.01, Math.min(50, awayOddsMinLosing01)) : 1.65;
      const safeAwayOdds02 = Number.isFinite(awayOddsMinLosing02) ? Math.max(1.01, Math.min(50, awayOddsMinLosing02)) : 1.3;
      const stakeMO = Number.isFinite(matchOddsLayStakeAbs) ? Math.max(2, Math.min(10000, matchOddsLayStakeAbs)) : 2;
      const stakeCS = Number.isFinite(correctScoreLayStakeAbs) ? Math.max(2, Math.min(10000, correctScoreLayStakeAbs)) : 2;
      const takeMinPct = Number.isFinite(matchOddsTakeProfitMinPct) ? Math.max(0, Math.min(1, matchOddsTakeProfitMinPct)) : 0.1;
      const takeMaxPct = Number.isFinite(matchOddsTakeProfitMaxPct) ? Math.max(0, Math.min(1, matchOddsTakeProfitMaxPct)) : 0.15;
      const csTakePct = Number.isFinite(correctScoreTakeProfitPct) ? Math.max(0, Math.min(1, correctScoreTakeProfitPct)) : 0.03;

      const extremes = extremeCorrectScoresCsv
        .split(',')
        .map((x) => String(x).trim())
        .filter(Boolean)
        .map((x) => x.replace(/\s+/g, '').replace(':', '-').replace('–', '-').replace('—', '-'))
        .filter((x) => /^\d+-\d+$/.test(x))
        .slice(0, 8);

      const bankrollTotalRaw = Number(cfgNow?.betfairBankroll ?? 0);
      const bankrollTotal = Number.isFinite(bankrollTotalRaw) && bankrollTotalRaw > 0 ? bankrollTotalRaw : 0;

      const state = readStore();

      for (const [matchId, v] of Object.entries(feed.items)) {
        const status = String((v as any)?.status ?? '').trim();
        if (status !== 'live') continue;

        const statusShort = String((v as any)?.liveStatusShort ?? '').trim().toUpperCase();
        const minuteRaw = typeof (v as any)?.liveElapsed === 'number' ? (v as any).liveElapsed : null;
        const minute = minuteRaw != null && Number.isFinite(minuteRaw) ? Math.max(0, Math.floor(minuteRaw)) : null;
        const isFirstHalf = statusShort === '1H' || (minute != null && minute >= 0 && minute <= 45);
        if (!isFirstHalf) continue;

        const sh = typeof (v as any)?.scoreHome === 'number' ? (v as any).scoreHome : null;
        const sa = typeof (v as any)?.scoreAway === 'number' ? (v as any).scoreAway : null;
        if (sh == null || sa == null) continue;
        if (!(sh === 0 && (sa === 1 || sa === 2))) continue;
        if (state.items[matchId]) continue;

        const betfair = (v as any)?.betfair ?? null;
        if (!betfair) continue;

        const homeFavProb = impliedProbHome(betfair);
        const homeWinRate = homeWinRateFromPreLive((v as any)?.preLive ?? null);
        const qualifiesFavorite = (homeFavProb != null && homeFavProb >= safeMinFavWinProb) || (homeWinRate != null && homeWinRate >= safeMinHomeWinRate);
        if (!qualifiesFavorite) continue;

        const awayOdd = Number((betfair as any)?.odds?.away?.back);
        if (!Number.isFinite(awayOdd) || awayOdd <= 1) continue;
        if (sa === 1 && awayOdd < safeAwayOdds01) continue;
        if (sa === 2 && awayOdd < safeAwayOdds02) continue;

        const marketId = String((betfair as any)?.marketId ?? '').trim();
        const selectionIdAway = Number((betfair as any)?.runners?.awaySelectionId ?? NaN);
        const layPrice = Number((betfair as any)?.odds?.away?.lay ?? (betfair as any)?.odds?.away?.back ?? NaN);
        if (!marketId || !Number.isFinite(selectionIdAway) || !Number.isFinite(layPrice) || layPrice <= 1) continue;

        const takePct = (() => {
          const lo = Math.min(takeMinPct, takeMaxPct);
          const hi = Math.max(takeMinPct, takeMaxPct);
          const u = Math.random();
          return lo + (hi - lo) * u;
        })();
        const takeProfitAbs = bankrollTotal > 0 ? Math.round((bankrollTotal * takePct) * 100) / 100 : 0;
        const csTakeProfitAbs = bankrollTotal > 0 ? Math.round((bankrollTotal * csTakePct) * 100) / 100 : 0;

        const scenario = sa === 2 ? ('losing_0_2' as const) : ('losing_0_1' as const);
        const createdAt = new Date().toISOString();

        const entryCandidate = {
          createdAt,
          scenario,
          minute,
          scoreHome: sh,
          scoreAway: sa,
          awayOddAtEntry: awayOdd,
          homeFavProb,
          homeWinRate,
          matchOdds: { marketId, selectionIdAway, layPrice, stake: stakeMO, takeProfitAbs },
        };

        const moRes = await placeOrders({
          adminToken,
          marketId,
          customerRef: mkStableCustomerRef('frmo', matchId, marketId, selectionIdAway),
          instructions: [
            {
              selectionId: selectionIdAway,
              handicap: 0,
              side: 'LAY',
              orderType: 'LIMIT',
              limitOrder: { size: stakeMO, price: layPrice, persistenceType: 'LAPSE' },
            },
          ],
        }).catch(() => null);

        if (!didPlaceOrdersSucceed(moRes)) continue;

        const csCandidate =
          scenario === 'losing_0_2' && (betfair as any)?.correctScore?.marketId && extremes.length > 0
            ? {
                marketId: String((betfair as any).correctScore.marketId),
                selections: extremes
                  .map((k) => {
                    const r = (betfair as any)?.correctScore?.runners?.[k] ?? null;
                    const sid = Number(r?.selectionId ?? NaN);
                    const lp = Number(r?.lay ?? r?.back ?? NaN);
                    if (!Number.isFinite(sid) || !Number.isFinite(lp) || lp <= 1) return null;
                    return { scoreKey: k, selectionId: sid, layPrice: lp, stake: stakeCS, takeProfitAbs: csTakeProfitAbs };
                  })
                  .filter((x: any) => Boolean(x)),
              }
            : null;

        const csToPlace = csCandidate && csCandidate.selections.length ? csCandidate : null;
        let csPlaced = false;
        if (csToPlace) {
          const csInstructions = csToPlace.selections.map((s) => ({
            selectionId: s.selectionId,
            handicap: 0,
            side: 'LAY',
            orderType: 'LIMIT',
            limitOrder: { size: s.stake, price: s.layPrice, persistenceType: 'LAPSE' },
          }));
          const csRes = await placeOrders({
            adminToken,
            marketId: String(csToPlace.marketId),
            customerRef: mkStableCustomerRef('frcs', matchId, String(csToPlace.marketId), 0),
            instructions: csInstructions.slice(0, 8),
          }).catch(() => null);
          csPlaced = didPlaceOrdersSucceed(csRes);
        }

        state.items[matchId] = { ...entryCandidate, ...(csPlaced && csToPlace ? { correctScore: csToPlace } : {}) };
        writeStore(state);

        try {
          await enqueueAutomation({
            matchId,
            source: 'api-football',
            utcDate: (v as any)?.utcDate ?? null,
            homeTeam: (v as any)?.homeTeam ?? null,
            awayTeam: (v as any)?.awayTeam ?? null,
            scoreHome: sh,
            scoreAway: sa,
          }).catch(() => null);
          await updateAutomationItem(matchId, {
            status: 'running',
            strategy: {
              agent: 'favoriteRescue',
              favoriteRescue: { createdAt, scenario, minute, scoreHome: sh, scoreAway: sa, awayOddAtEntry: awayOdd, homeFavProb, homeWinRate },
            },
            markets:
              scenario === 'losing_0_2' && csPlaced
                ? [
                    { key: 'winner', label: 'Match Odds (1X2)', enabled: true, details: null },
                    { key: 'correctScore', label: 'Placar correto', enabled: true, details: null },
                  ]
                : [{ key: 'winner', label: 'Match Odds (1X2)', enabled: true, details: null }],
          }).catch(() => null);
        } catch {}

        writeStatus({ enabled: true, kind: 'entry', text: `Entrada efetuada (${(v as any)?.homeTeam ?? ''} x ${(v as any)?.awayTeam ?? ''})` });
      }

      const maybeStartAsianHandicapAuto = async () => {
        const rawLimits =
          (cfgNow?.betfairRobotLimits && typeof cfgNow.betfairRobotLimits === 'object' ? (cfgNow.betfairRobotLimits as any).asianHandicap : null) ?? null;
        if (!rawLimits || typeof rawLimits !== 'object') return;

        const autoEnabled = Boolean((rawLimits as any)?.autoEnabled ?? false);
        if (!autoEnabled) return;

        const autoOnlyRequested = Boolean((rawLimits as any)?.autoOnlyRequestedFixtures ?? true);
        const autoMinConfidenceRaw = Number((rawLimits as any)?.autoMinConfidence ?? 75);
        const autoMinConfidence = Number.isFinite(autoMinConfidenceRaw) ? Math.max(50, Math.min(95, Math.floor(autoMinConfidenceRaw))) : 75;
        const autoCooldownMinutesRaw = Number((rawLimits as any)?.autoCooldownMinutes ?? 20);
        const autoCooldownMinutes = Number.isFinite(autoCooldownMinutesRaw) ? Math.max(0, Math.min(240, Math.floor(autoCooldownMinutesRaw))) : 20;
        const autoMaxPerDayRaw = Number((rawLimits as any)?.autoMaxPerDay ?? 8);
        const autoMaxPerDay = Number.isFinite(autoMaxPerDayRaw) ? Math.max(0, Math.min(50, Math.floor(autoMaxPerDayRaw))) : 8;

        const ahAuto = readAhAuto();
        const lastEnqIso = String(ahAuto.lastEnqueuedAt ?? '').trim();
        const lastEnqMs = lastEnqIso ? new Date(lastEnqIso).getTime() : 0;
        if (autoCooldownMinutes > 0 && lastEnqMs && Number.isFinite(lastEnqMs) && Date.now() - lastEnqMs < autoCooldownMinutes * 60_000) return;
        if (autoMaxPerDay > 0 && Object.keys(ahAuto.items).length >= autoMaxPerDay) return;

        const requestedIds = autoOnlyRequested ? readRequestedFixtureIds() : null;

        const { projectId } = await import('/utils/supabase/info');
        const headers = await getEdgeHeaders();
        const qRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
          method: 'POST',
          headers,
          body: '{}',
        }).catch(() => null);
        const qRaw = qRes ? await qRes.text().catch(() => '') : '';
        const qData = qRaw ? JSON.parse(qRaw) : null;
        const existingQueueIds = new Set<string>(
          Array.isArray(qData?.items) ? (qData.items as any[]).map((x) => String((x as any)?.matchId ?? '').trim()).filter(Boolean) : [],
        );

        const bankrollForAh =
          Number.isFinite(bankrollTotal) && bankrollTotal > 0
            ? Math.round(bankrollTotal * 100) / 100
            : 50;

        for (const [matchId, v] of Object.entries(feed.items)) {
          const status = String((v as any)?.status ?? '').trim();
          if (status !== 'live') continue;
          if (autoOnlyRequested && requestedIds && !requestedIds.has(matchId)) continue;
          if (ahAuto.items[matchId]) continue;
          if (existingQueueIds.has(matchId)) continue;

          const prediction = readPredictionFromCache(matchId);
          if (!prediction) {
            ensureRequestedFixture(matchId);
            continue;
          }

          const pAh = (prediction as any)?.asianHandicap ?? null;
          const team = String(pAh?.team ?? '').trim();
          const line = Number(pAh?.line);
          const confidence = Number(pAh?.confidence);
          if ((team !== 'home' && team !== 'away') || !Number.isFinite(line) || !Number.isFinite(confidence)) continue;
          if (confidence < autoMinConfidence) continue;

          const utcDate = (v as any)?.utcDate ?? null;
          const homeTeam = (v as any)?.homeTeam ?? null;
          const awayTeam = (v as any)?.awayTeam ?? null;
          const scoreHome = typeof (v as any)?.scoreHome === 'number' ? (v as any).scoreHome : null;
          const scoreAway = typeof (v as any)?.scoreAway === 'number' ? (v as any).scoreAway : null;

          await enqueueAutomation({
            matchId,
            source: 'api-football',
            utcDate,
            homeTeam,
            awayTeam,
            scoreHome,
            scoreAway,
            prediction,
          }).catch(() => null);

          await updateAutomationItem(matchId, {
            status: 'running',
            strategy: { agent: 'asianHandicap', asianHandicap: { phase: 'monitoring', startedAt: new Date().toISOString(), startedBy: 'independent' } },
            markets: [{ key: 'asianHandicap', label: 'Handicap Asiático', enabled: true, details: null }],
          }).catch(() => null);

          ahAuto.items[matchId] = { enqueuedAt: new Date().toISOString(), team: team as any, line, confidence };
          ahAuto.lastEnqueuedAt = new Date().toISOString();
          writeAhAuto(ahAuto);

          const live = {
            fetchedAt: String(feed.updatedAt),
            elapsed: typeof (v as any)?.liveElapsed === 'number' ? (v as any).liveElapsed : null,
            scoreHome,
            scoreAway,
          };
          await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/asianHandicap/tick`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ matchId, adminToken, live, config: { bankroll: bankrollForAh, ...(rawLimits as any) } }),
          }).catch(() => null);

          return;
        }
      };

      await maybeStartAsianHandicapAuto().catch(() => null);

      const next = readStore();
      const ids = Object.keys(next.items);
      if (ids.length === 0) return;

      for (const matchId of ids) {
        const entry = next.items[matchId];
        if (!entry) continue;
        const v = feed.items[matchId] ?? null;
        const betfair = (v as any)?.betfair ?? null;
        if (!betfair) continue;

        if (!entry.closed?.matchOdds) {
          const awayBack = Number((betfair as any)?.odds?.away?.back);
          if (Number.isFinite(awayBack) && awayBack > 1 && entry.matchOdds.takeProfitAbs > 0) {
            const profit = entry.matchOdds.stake * (awayBack - entry.matchOdds.layPrice);
            if (profit >= entry.matchOdds.takeProfitAbs) {
              writeStatus({ enabled: true, kind: 'exit_mo', text: 'Saída automática (MO)…' });
              const moExitRes = await placeOrders({
                adminToken,
                marketId: entry.matchOdds.marketId,
                customerRef: mkStableCustomerRef('frmx', matchId, entry.matchOdds.marketId, entry.matchOdds.selectionIdAway),
                instructions: [
                  {
                    selectionId: entry.matchOdds.selectionIdAway,
                    handicap: 0,
                    side: 'BACK',
                    orderType: 'LIMIT',
                    limitOrder: { size: entry.matchOdds.stake, price: awayBack, persistenceType: 'LAPSE' },
                  },
                ],
              }).catch(() => null);
              if (didPlaceOrdersSucceed(moExitRes)) {
                next.items[matchId] = { ...entry, closed: { ...(entry.closed ?? {}), matchOdds: true, at: new Date().toISOString() } };
                writeStore(next);
                writeStatus({ enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' });
              }
            }
          }
        }

        if (!entry.closed?.correctScore && entry.correctScore?.marketId && entry.correctScore.selections.length) {
          const cs = (betfair as any)?.correctScore ?? null;
          const csRunners = cs?.runners ?? null;
          if (csRunners && typeof csRunners === 'object') {
            let shouldExit = false;
            const exitInstructions: any[] = [];
            for (const sel of entry.correctScore.selections) {
              const r = csRunners?.[sel.scoreKey] ?? null;
              const back = Number(r?.back);
              if (!Number.isFinite(back) || back <= 1) continue;
              const profit = sel.stake * (back - sel.layPrice);
              if (profit >= sel.takeProfitAbs && sel.takeProfitAbs > 0) {
                shouldExit = true;
                exitInstructions.push({
                  selectionId: sel.selectionId,
                  handicap: 0,
                  side: 'BACK',
                  orderType: 'LIMIT',
                  limitOrder: { size: sel.stake, price: back, persistenceType: 'LAPSE' },
                });
              }
            }
            if (shouldExit && exitInstructions.length) {
              writeStatus({ enabled: true, kind: 'exit_cs', text: 'Saída automática (CS)…' });
              const csExitRes = await placeOrders({
                adminToken,
                marketId: entry.correctScore.marketId,
                customerRef: mkStableCustomerRef('frcx', matchId, entry.correctScore.marketId, 0),
                instructions: exitInstructions.slice(0, 8),
              }).catch(() => null);
              if (didPlaceOrdersSucceed(csExitRes)) {
                next.items[matchId] = {
                  ...next.items[matchId],
                  closed: { ...(next.items[matchId].closed ?? {}), correctScore: true, at: new Date().toISOString() },
                };
                writeStore(next);
                writeStatus({ enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' });
              }
            }
          }
        }
      }
    };

    const tick = () => {
      void runOnce().catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        writeStatus({ enabled: true, kind: 'error', text: `Oscilando: ${msg}` });
      });
    };

    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const cur = String(localStorage.getItem('automation_runner_mode_v1') ?? '').trim();
      if (!cur) localStorage.setItem('automation_runner_mode_v1', 'layout');
    } catch {}

    let inFlight = false;

    const getEdgeHeaders = async () => {
      const { publicAnonKey } = await import('/utils/supabase/info');
      return {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      } as const;
    };

    const normalizeAgent = (agentRaw: unknown) => {
      const s = String(agentRaw ?? '').trim().toLowerCase();
      if (s === 'scalpingticks' || s === 'scalping_ticks') return 'scalpingTicks';
      if (s === 'scalpinggoals' || s === 'scalping_goals' || s === 'scalping_goals_above') return 'scalpingTicks';
      if (s === 'overgoalslimit' || s === 'over_goals_limit') return 'overGoalsLimit';
      if (s === 'asianhandicap' || s === 'asian_handicap' || s === 'handicap_asiatico' || s === 'handicapasiatico') return 'asianHandicap';
      if (s === 'favoriterescue' || s === 'favorite_rescue' || s === 'lay_favorito_perdendo') return 'favoriteRescue';
      if (s === 'correctscore' || s === 'correct_score') return 'correctScore';
      return s || null;
    };

    const readTestMode = () => {
      try {
        return localStorage.getItem('automation_test_mode_v1') === '1';
      } catch {
        return false;
      }
    };

    const readRunnerMode = () => {
      try {
        const mode = String(localStorage.getItem('automation_runner_mode_v1') ?? '').trim();
        if (mode !== 'page') return mode;
        const ts = Number(localStorage.getItem('automation_runner_page_heartbeat_v1') ?? 0);
        if (Number.isFinite(ts) && Date.now() - ts < 20_000) return 'page';
        return 'layout';
      } catch {
        return '';
      }
    };

    const runOnce = async () => {
      if (readRunnerMode() === 'page') return;

      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      if (!adminToken) return;

      const bankrollTotalStored = Number(cfg?.betfairBankroll ?? 0);
      let bankrollTotal = bankrollTotalStored;
      const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};

      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      const shouldAutoSync = !Number.isFinite(bankrollTotalStored) || bankrollTotalStored <= 0;
      if (shouldAutoSync) {
        const nowTs = Date.now();
        if (nowTs - lastFundsSyncAtRef.current > 60_000) {
          lastFundsSyncAtRef.current = nowTs;
          try {
            const fundsRes = await fetch(`https://${projectId}.supabase.co/functions/v1/betfair-core-server-1119702f/automation/betfair/account/funds`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ adminToken }),
            });
            const fundsRaw = await fundsRes.text().catch(() => '');
            const fundsData = fundsRaw ? JSON.parse(fundsRaw) : null;
            if (fundsRes.ok && fundsData?.ok && typeof fundsData?.summary?.availableToBetBalance === 'number') {
              const nextBankroll = fundsData.summary.availableToBetBalance;
              if (Number.isFinite(nextBankroll) && nextBankroll >= 0) {
                bankrollTotal = nextBankroll;
                if (!Number.isFinite(bankrollTotalStored) || Math.abs(nextBankroll - bankrollTotalStored) > 0.01) {
                  const nextCfg = loadApiConfig();
                  if (nextCfg) saveApiConfig({ ...nextCfg, betfairBankroll: nextBankroll });
                }
              }
            }
          } catch {}
        }
      }

      const bankrollForCorrectScore =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0
          ? Math.round(bankrollTotal * 100) / 100
          : 50;
      const bankrollForOverUnder =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0
          ? Math.round(bankrollTotal * 100) / 100
          : 50;

      const testModeActive = readTestMode();
      await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/refreshOdds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          max: testModeActive ? 10 : 30,
          minFreshSeconds: testModeActive ? 25 : 10,
          includeCorrectScore: !testModeActive,
          runCorrectScorePlan: !testModeActive,
          ...(testModeActive
            ? {}
            : {
                planConfig: {
                  minProfitPct: 0.03,
                  targetProfitPct: 0.03,
                  maxProfitPct: 0.05,
                  bankroll: bankrollForCorrectScore,
                  maxSelections: 10,
                  maxGoals: 3,
                  includeAnyOther: true,
                },
              }),
        }),
      }).catch(() => null);

      const qRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      const qRaw = await qRes.text().catch(() => '');
      const qData = qRaw ? JSON.parse(qRaw) : null;
      if (!qRes.ok || !qData?.ok) return;
      const snapshot = Array.isArray(qData?.items) ? (qData.items as any[]) : [];

      if (testModeActive) return;

      const oglTickedMatchIds = new Set<string>();

      const frLimits =
        (robotLimits && typeof robotLimits === 'object' ? (robotLimits as any).favoriteRescue : null) ?? null;
      const goalAlertEnabled = Boolean((frLimits as any)?.goalAlertEnabled ?? (frLimits as any)?.enabled ?? false);
      if (goalAlertEnabled) {
        const readDashboardFeed = () => {
          try {
            const raw = localStorage.getItem('favorite_rescue_feed_v1');
            const parsed = raw ? (JSON.parse(raw) as any) : null;
            if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
              return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
            }
            return parsed as { version: 1; updatedAt: string; items: Record<string, any> };
          } catch {
            return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
          }
        };

        const feed = readDashboardFeed();
        const feedUpdatedAtMs = new Date(feed.updatedAt).getTime();
        const feedAgeMs = Number.isFinite(feedUpdatedAtMs) ? Date.now() - feedUpdatedAtMs : Number.POSITIVE_INFINITY;
        const feedOk = feedAgeMs >= 0 && feedAgeMs <= 65_000;

        const goalAlertMinMinuteRaw = Number((frLimits as any)?.goalAlertMinMinute ?? 5);
        const goalAlertMinMinute = Number.isFinite(goalAlertMinMinuteRaw) ? Math.max(0, Math.min(115, Math.floor(goalAlertMinMinuteRaw))) : 5;
        const goalAlertMaxPerTickRaw = Number((frLimits as any)?.goalAlertMaxPerTick ?? 2);
        const goalAlertMaxPerTick = Number.isFinite(goalAlertMaxPerTickRaw) ? Math.max(0, Math.min(10, Math.floor(goalAlertMaxPerTickRaw))) : 2;
        const goalAlertToastCooldownSecRaw = Number((frLimits as any)?.goalAlertToastCooldownSec ?? 30);
        const goalAlertToastCooldownMs = (Number.isFinite(goalAlertToastCooldownSecRaw) ? Math.max(5, Math.min(300, goalAlertToastCooldownSecRaw)) : 30) * 1000;

        const existingQueueIds = new Set<string>(snapshot.map((x) => String((x as any)?.matchId ?? '').trim()).filter(Boolean));

        const enqueueIfMissing = async (args: {
          matchId: string;
          utcDate: string | null;
          homeTeam: string | null;
          awayTeam: string | null;
          scoreHome: number | null;
          scoreAway: number | null;
        }) => {
          if (existingQueueIds.has(args.matchId)) return;
          await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/add`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              matchId: args.matchId,
              source: 'api-football',
              utcDate: args.utcDate,
              homeTeam: args.homeTeam,
              awayTeam: args.awayTeam,
              homeCrest: null,
              awayCrest: null,
              scoreHome: args.scoreHome,
              scoreAway: args.scoreAway,
              prediction: null,
            }),
          }).catch(() => null);
          existingQueueIds.add(args.matchId);
        };

        const lim = (robotLimits as any)?.overGoalsLimit && typeof (robotLimits as any).overGoalsLimit === 'object' ? (robotLimits as any).overGoalsLimit : {};
        const minOdds = Number(lim?.minOdds);
        const maxEntries = Number(lim?.maxEntries);
        const profitTargetPct = Number(lim?.profitTargetPct);
        const minDeltaTraded = Number(lim?.minDeltaTraded);
        const dominanceRatio = Number(lim?.dominanceRatio);
        const minSecondsBetweenEntries = Number(lim?.minSecondsBetweenEntries);
        const stakePct = Number(lim?.stakePct);
        const stakeAbs = Number((lim as any)?.stakeAbs);
        const entryOffsetTicks = Number(lim?.entryOffsetTicks);
        const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);

        if (feedOk && goalAlertMaxPerTick > 0) {
          const candidates = Object.entries(feed.items)
            .map(([matchId, v]) => {
              const status = String((v as any)?.status ?? '').trim();
              if (status !== 'live') return null;
              const minuteRaw = typeof (v as any)?.liveElapsed === 'number' ? (v as any).liveElapsed : null;
              const minute = minuteRaw != null && Number.isFinite(minuteRaw) ? Math.max(0, Math.floor(minuteRaw)) : null;
              if (minute == null || minute < goalAlertMinMinute) return null;
              return { matchId, v, minute };
            })
            .filter((x): x is { matchId: string; v: any; minute: number } => Boolean(x))
            .sort((a, b) => b.minute - a.minute)
            .slice(0, 20);

          let used = 0;
          for (const c of candidates) {
            if (used >= goalAlertMaxPerTick) break;
            const matchId = c.matchId;
            const v = c.v;
            const utcDate = (v as any)?.utcDate ?? null;
            const homeTeam = (v as any)?.homeTeam ?? null;
            const awayTeam = (v as any)?.awayTeam ?? null;
            const scoreHome = typeof (v as any)?.scoreHome === "number" ? (v as any).scoreHome : null;
            const scoreAway = typeof (v as any)?.scoreAway === "number" ? (v as any).scoreAway : null;

            await enqueueIfMissing({ matchId, utcDate, homeTeam, awayTeam, scoreHome, scoreAway });
            await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/update`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ matchId, patch: { status: 'running' } }),
            }).catch(() => null);

            if (oglTickedMatchIds.has(matchId)) continue;
            oglTickedMatchIds.add(matchId);

            const statsPayload = (() => {
              const hasAny =
                typeof (v as any)?.dangerousAttacksHome === 'number' ||
                typeof (v as any)?.dangerousAttacksAway === 'number' ||
                typeof (v as any)?.attacksHome === 'number' ||
                typeof (v as any)?.attacksAway === 'number' ||
                typeof (v as any)?.shotsOnGoalHome === 'number' ||
                typeof (v as any)?.shotsOnGoalAway === 'number' ||
                typeof (v as any)?.cornersHome === 'number' ||
                typeof (v as any)?.cornersAway === 'number' ||
                typeof (v as any)?.cardsHome === 'number' ||
                typeof (v as any)?.cardsAway === 'number';
              if (!hasAny) return null;
              return {
                fetchedAt: feed.updatedAt,
                dangerousAttacksHome: (v as any)?.dangerousAttacksHome ?? null,
                dangerousAttacksAway: (v as any)?.dangerousAttacksAway ?? null,
                attacksHome: (v as any)?.attacksHome ?? null,
                attacksAway: (v as any)?.attacksAway ?? null,
                shotsOnGoalHome: (v as any)?.shotsOnGoalHome ?? null,
                shotsOnGoalAway: (v as any)?.shotsOnGoalAway ?? null,
                cornersHome: (v as any)?.cornersHome ?? null,
                cornersAway: (v as any)?.cornersAway ?? null,
                cardsHome: (v as any)?.cardsHome ?? null,
                cardsAway: (v as any)?.cardsAway ?? null,
              };
            })();

            const res = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/overGoalsLimit/tick`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                matchId,
                adminToken,
                stats: statsPayload,
                config: {
                  bankroll: bankrollForOverUnder,
                  bankrollTotal,
                  ...(Number.isFinite(minOdds) ? { minOdds } : {}),
                  ...(Number.isFinite(maxEntries) ? { maxEntries } : {}),
                  ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
                  ...(Number.isFinite(minDeltaTraded) ? { minDeltaTraded } : {}),
                  ...(Number.isFinite(dominanceRatio) ? { dominanceRatio } : {}),
                  ...(Number.isFinite(minSecondsBetweenEntries) ? { minSecondsBetweenEntries } : {}),
                  ...(Number.isFinite(stakePct) ? { stakePct } : {}),
                  ...(Number.isFinite(stakeAbs) ? { stakeAbs } : {}),
                  ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
                  ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
                },
              }),
            }).catch(() => null);
            const raw = res ? await res.text().catch(() => '') : '';
            const data = raw ? JSON.parse(raw) : null;
            if (!res || !res.ok || !data?.ok) continue;

            const item = data?.item ?? null;
            const ogl = item?.strategy?.overGoalsLimit ?? null;
            const entryBetId = String(ogl?.entryBetId ?? '').trim() || null;
            const entryMarketId = String(ogl?.entryMarketId ?? '').trim() || null;
            const entryLineCode = Number(ogl?.entryLineCode ?? ogl?.lineCodeOver);
            const entryPrice = Number(ogl?.entryPrice);
            const stakeAbsShown = Number(ogl?.stakeAbs);

            if (entryBetId) {
              const mem = goalAlertToastRef.current[matchId] ?? { lastBetId: null, lastToastAtMs: 0 };
              const nowMs = Date.now();
              if (mem.lastBetId !== entryBetId && nowMs - mem.lastToastAtMs >= goalAlertToastCooldownMs) {
                const line = Number.isFinite(entryLineCode) && entryLineCode > 0 ? entryLineCode / 10 : null;
                const lineTxt = line != null ? `${line}` : '';
                const title = `Alerta de gol: entrada em Over ${lineTxt} (${String(homeTeam ?? '')} x ${String(awayTeam ?? '')})`;
                const descParts = [
                  entryMarketId ? `Mercado ${entryMarketId}` : null,
                  Number.isFinite(entryPrice) && entryPrice > 1 ? `odd ${entryPrice}` : null,
                  Number.isFinite(stakeAbsShown) && stakeAbsShown > 0 ? `stake ${stakeAbsShown}` : null,
                ].filter(Boolean);
                toast.info(title, { description: descParts.join(' • ') });
                goalAlertToastRef.current[matchId] = { lastBetId: entryBetId, lastToastAtMs: nowMs };
              }
            }

            used += 1;
          }
        }
      }

      const csLim = (robotLimits as any)?.correctScore && typeof (robotLimits as any).correctScore === 'object' ? (robotLimits as any).correctScore : {};
      const csProfitTargetPct = Number((csLim as any)?.minProfitPct);
      const csMaxSelections = Number(csLim?.maxSelections);
      const csEntryScoresCsv = String(csLim?.entryScoresCsv ?? '0-0,0-1,1-0,1-1');
      const csMinMarketMatched = Number(csLim?.minMarketMatched);
      const csStakeAbs = Number((csLim as any)?.stakeAbs);
      const csStakePct = Number((csLim as any)?.stakePct);
      const csMaxSelectionsSafe = Number.isFinite(csMaxSelections) ? Math.max(1, Math.min(20, Math.floor(csMaxSelections))) : 6;
      const csStakeAbsSafe = Number.isFinite(csStakeAbs) ? Math.max(0, Math.round(csStakeAbs * 100) / 100) : NaN;
      const csStakePctSafe = Number.isFinite(csStakePct) ? Math.max(0, Math.min(100, Math.round(csStakePct * 10000) / 10000)) : NaN;
      const csStakeAbsUsed =
        Number.isFinite(csStakeAbsSafe) && csStakeAbsSafe > 0
          ? csStakeAbsSafe
          : Number.isFinite(bankrollForCorrectScore) && bankrollForCorrectScore > 0 && Number.isFinite(csStakePctSafe) && csStakePctSafe > 0
            ? Math.max(2, Math.round(((bankrollForCorrectScore * csStakePctSafe) / 100) * 100) / 100)
            : NaN;
      const bankrollUsedForCs =
        Number.isFinite(csStakeAbsUsed) && csStakeAbsUsed > 0
          ? Math.round((csStakeAbsUsed * csMaxSelectionsSafe) * 100) / 100
          : bankrollForCorrectScore;

      const csTickTargets = snapshot
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => normalizeAgent((x as any)?.strategy?.agent) === 'correctScore')
        .slice(0, 6);

      await mapWithConcurrency(csTickTargets, 2, async (x) => {
        const lastTick = String((x as any).strategy?.correctScore?.lastTickAt ?? '').trim();
        const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
        if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 9_000) return null;
        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/tick`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId: (x as any).matchId,
            adminToken,
            config: {
              bankroll: bankrollUsedForCs,
              ...(Number.isFinite(csStakeAbsUsed) ? { stakeAbs: csStakeAbsUsed } : {}),
              ...(Number.isFinite(csProfitTargetPct) ? { profitTargetPct: csProfitTargetPct } : {}),
            },
          }),
        }).catch(() => null);
        return null;
      });

      const csExecTargets = snapshot
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => normalizeAgent((x as any)?.strategy?.agent) === 'correctScore')
        .filter((x) => Boolean((x as any)?.betfair?.correctScore?.marketId))
        .filter((x) => !String((x as any)?.strategy?.correctScore?.adoptedExistingAt ?? '').trim())
        .filter((x) => {
          const ms = Array.isArray((x as any)?.markets) ? ((x as any).markets as any[]) : [];
          const cs = ms.find((m) => String((m as any)?.key ?? '').trim() === 'correctScore') ?? null;
          return cs ? Boolean((cs as any).enabled) : true;
        })
        .slice(0, 6);

      await mapWithConcurrency(csExecTargets, 2, async (x) => {
        const lastExec = String((x as any)?.strategy?.correctScore?.lastExecutionAt ?? '').trim();
        if (lastExec) return null;
        const apiLive = apiFootballLiveRef.current[String((x as any)?.matchId ?? '')] ?? null;
        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId: (x as any).matchId,
            dryRun: false,
            adminToken,
            live: apiLive
              ? {
                  fetchedAt: apiLive.fetchedAt,
                  elapsed: apiLive.elapsed,
                  scoreHome: apiLive.goalsHome,
                  scoreAway: apiLive.goalsAway,
                }
              : null,
            config: { bankroll: bankrollUsedForCs, ...(Number.isFinite(csStakeAbsUsed) ? { stakeAbs: csStakeAbsUsed } : {}) },
            planConfig: {
              planType: 'coverage',
              maxSelections: Number.isFinite(csMaxSelections) ? csMaxSelections : undefined,
              entryScoresCsv: csEntryScoresCsv,
              minMarketMatched: Number.isFinite(csMinMarketMatched) ? csMinMarketMatched : undefined,
            },
          }),
        }).catch(() => null);
        return null;
      });

      const csRebalanceTargets = snapshot
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => normalizeAgent((x as any)?.strategy?.agent) === 'correctScore')
        .filter((x) => Boolean((x as any)?.betfair?.correctScore?.marketId))
        .filter(
          (x) =>
            Boolean(String((x as any)?.strategy?.correctScore?.lastExecutionAt ?? '').trim()) ||
            Boolean(String((x as any)?.strategy?.correctScore?.adoptedExistingAt ?? '').trim()),
        )
        .slice(0, 6);

      const nowTs = Date.now();
      await mapWithConcurrency(csRebalanceTargets, 2, async (x) => {
        const lastReb = String((x as any)?.strategy?.correctScore?.lastRebalanceAt ?? '').trim();
        const lastRebTs = lastReb ? new Date(lastReb).getTime() : 0;
        if (lastRebTs && Number.isFinite(lastRebTs) && nowTs - lastRebTs < 30_000) return null;

        const apiLive = apiFootballLiveRef.current[String((x as any)?.matchId ?? '')] ?? null;
        const goalsHome = typeof apiLive?.goalsHome === 'number' ? apiLive.goalsHome : (x as any).scoreHome;
        const goalsAway = typeof apiLive?.goalsAway === 'number' ? apiLive.goalsAway : (x as any).scoreAway;
        const totalGoals =
          typeof goalsHome === 'number' && typeof goalsAway === 'number' ? Math.max(0, Math.floor(goalsHome) + Math.floor(goalsAway)) : null;
        const lastGoals = Number((x as any)?.strategy?.correctScore?.lastGoals);
        const prevGoals = Number.isFinite(lastGoals) ? lastGoals : null;
        if (totalGoals != null && prevGoals != null && totalGoals === prevGoals) return null;

        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/correctScore/rebalance`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId: (x as any).matchId,
            adminToken,
            dryRun: false,
            config: { targetMinGreenAbs: 0, maxInstructions: 3, maxStakePerInstruction: 50 },
          }),
        }).catch(() => null);
        return null;
      });

      const oglTargets = snapshot
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => normalizeAgent((x as any)?.strategy?.agent) === 'overGoalsLimit')
        .slice(0, 8);
      await mapWithConcurrency(oglTargets, 2, async (x) => {
        const mid = String((x as any)?.matchId ?? '').trim();
        if (mid) {
          if (oglTickedMatchIds.has(mid)) return null;
          oglTickedMatchIds.add(mid);
        }
        const lastTick = String((x as any)?.strategy?.overGoalsLimit?.lastTickAt ?? '').trim();
        const lastTickTs = lastTick ? new Date(lastTick).getTime() : 0;
        if (lastTickTs && Number.isFinite(lastTickTs) && Date.now() - lastTickTs < 10_000) return null;
        const live = apiFootballLiveRef.current[String((x as any)?.matchId ?? '')] ?? null;
        const lim = (robotLimits as any)?.overGoalsLimit && typeof (robotLimits as any).overGoalsLimit === 'object' ? (robotLimits as any).overGoalsLimit : {};
        const minOdds = Number(lim?.minOdds);
        const maxEntries = Number(lim?.maxEntries);
        const profitTargetPct = Number(lim?.profitTargetPct);
        const minDeltaTraded = Number(lim?.minDeltaTraded);
        const dominanceRatio = Number(lim?.dominanceRatio);
        const minSecondsBetweenEntries = Number(lim?.minSecondsBetweenEntries);
        const stakePct = Number(lim?.stakePct);
        const stakeAbs = Number((lim as any)?.stakeAbs);
        const entryOffsetTicks = Number(lim?.entryOffsetTicks);
        const secondsToWaitMatch = Number(lim?.secondsToWaitMatch);
        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/overGoalsLimit/tick`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId: (x as any).matchId,
            adminToken,
            stats: live
              ? {
                  fetchedAt: live.fetchedAt,
                  dangerousAttacksHome: live.dangerousAttacksHome,
                  dangerousAttacksAway: live.dangerousAttacksAway,
                  attacksHome: live.attacksHome,
                  attacksAway: live.attacksAway,
                  shotsOnGoalHome: live.shotsOnGoalHome,
                  shotsOnGoalAway: live.shotsOnGoalAway,
                  cornersHome: live.cornersHome,
                  cornersAway: live.cornersAway,
                  cardsHome: live.cardsHome,
                  cardsAway: live.cardsAway,
                }
              : null,
            config: {
              bankroll: bankrollForOverUnder,
              bankrollTotal,
              ...(Number.isFinite(minOdds) ? { minOdds } : {}),
              ...(Number.isFinite(maxEntries) ? { maxEntries } : {}),
              ...(Number.isFinite(profitTargetPct) ? { profitTargetPct } : {}),
              ...(Number.isFinite(minDeltaTraded) ? { minDeltaTraded } : {}),
              ...(Number.isFinite(dominanceRatio) ? { dominanceRatio } : {}),
              ...(Number.isFinite(minSecondsBetweenEntries) ? { minSecondsBetweenEntries } : {}),
              ...(Number.isFinite(stakePct) ? { stakePct } : {}),
              ...(Number.isFinite(stakeAbs) ? { stakeAbs } : {}),
              ...(Number.isFinite(entryOffsetTicks) ? { entryOffsetTicks } : {}),
              ...(Number.isFinite(secondsToWaitMatch) ? { secondsToWaitMatch } : {}),
            },
          }),
        }).catch(() => null);
        return null;
      });
    };

    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void runOnce().finally(() => {
        inFlight = false;
      });
    };

    tick();
    const t = window.setInterval(tick, 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('scalping_ticks_runner_mode_v1', 'layout');
    } catch {}

    let inFlight = false;

    const getEdgeHeaders = async () => {
      const { publicAnonKey } = await import('/utils/supabase/info');
      return {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      } as const;
    };

    const readFeed = () => {
      try {
        const raw = localStorage.getItem('favorite_rescue_feed_v1');
        const parsed = raw ? (JSON.parse(raw) as any) : null;
        if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
          return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
        }
        return parsed as { version: 1; updatedAt: string; items: Record<string, any> };
      } catch {
        return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
      }
    };

    const runOnce = async () => {
      const mode = (() => {
        try {
          return String(localStorage.getItem('scalping_ticks_runner_mode_v1') ?? '').trim();
        } catch {
          return '';
        }
      })();
      if (mode === 'page') {
        let ts = 0;
        try {
          ts = Number(localStorage.getItem('scalping_ticks_runner_page_heartbeat_v1') ?? 0);
        } catch {}
        if (Number.isFinite(ts) && Date.now() - ts < 20_000) return;
      }

      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      if (!adminToken) return;

      const bankrollTotalRaw = Number(cfg?.betfairBankroll ?? 0);
      const bankrollTotal = Number.isFinite(bankrollTotalRaw) && bankrollTotalRaw > 0 ? bankrollTotalRaw : 0;
      const bankrollForOverUnder =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0
          ? Math.round(bankrollTotal * 100) / 100
          : 50;
      const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
      const ticksLimits = (robotLimits as any)?.scalpingTicks && typeof (robotLimits as any).scalpingTicks === 'object' ? (robotLimits as any).scalpingTicks : {};

      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      const feed = readFeed();
      const feedUpdatedAtMs = new Date(feed.updatedAt).getTime();
      const feedAgeMs = Number.isFinite(feedUpdatedAtMs) ? Date.now() - feedUpdatedAtMs : Number.POSITIVE_INFINITY;
      const feedOk = feedAgeMs >= 0 && feedAgeMs <= 65_000;

      const qRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      const qRaw = await qRes.text().catch(() => '');
      const qData = qRaw ? JSON.parse(qRaw) : null;
      if (!qRes.ok || !qData?.ok) return;
      const items = Array.isArray(qData?.items) ? (qData.items as any[]) : [];

      const targets = items
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => {
          return normalizeAgent((x as any)?.strategy?.agent) === 'scalpingTicks';
        })
        .slice(0, 8);

      await mapWithConcurrency(targets, 2, async (x) => {
        const matchId = String((x as any)?.matchId ?? '').trim();
        if (!matchId) return null;
        const feedItem = feedOk ? ((feed.items as any)[matchId] ?? null) : null;
        const live =
          feedItem && typeof feedItem === 'object'
            ? {
                fetchedAt: String(feed.updatedAt),
                elapsed: typeof (feedItem as any)?.liveElapsed === 'number' ? (feedItem as any).liveElapsed : null,
                scoreHome: typeof (feedItem as any)?.scoreHome === 'number' ? (feedItem as any).scoreHome : null,
                scoreAway: typeof (feedItem as any)?.scoreAway === 'number' ? (feedItem as any).scoreAway : null,
              }
            : null;

        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/scalpingTicks/tick`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId,
            adminToken,
            live,
            config: { bankroll: bankrollForOverUnder, ...(ticksLimits as any) },
          }),
        }).catch(() => null);
        return null;
      });
    };

    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void runOnce().finally(() => {
        inFlight = false;
      });
    };

    tick();
    const t = window.setInterval(tick, 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('asian_handicap_runner_mode_v1', 'layout');
    } catch {}

    let inFlight = false;

    const getEdgeHeaders = async () => {
      const { publicAnonKey } = await import('/utils/supabase/info');
      return {
        'Content-Type': 'application/json',
        apikey: publicAnonKey,
        Authorization: `Bearer ${publicAnonKey}`,
      } as const;
    };

    const readFeed = () => {
      try {
        const raw = localStorage.getItem('favorite_rescue_feed_v1');
        const parsed = raw ? (JSON.parse(raw) as any) : null;
        if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') {
          return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
        }
        return parsed as { version: 1; updatedAt: string; items: Record<string, any> };
      } catch {
        return { version: 1 as const, updatedAt: new Date(0).toISOString(), items: {} as Record<string, any> };
      }
    };

    const runOnce = async () => {
      const mode = (() => {
        try {
          return String(localStorage.getItem('asian_handicap_runner_mode_v1') ?? '').trim();
        } catch {
          return '';
        }
      })();
      if (mode === 'page') {
        let ts = 0;
        try {
          ts = Number(localStorage.getItem('asian_handicap_runner_page_heartbeat_v1') ?? 0);
        } catch {}
        if (Number.isFinite(ts) && Date.now() - ts < 20_000) return;
      }

      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      if (!adminToken) return;

      const bankrollTotalRaw = Number(cfg?.betfairBankroll ?? 0);
      const bankrollTotal = Number.isFinite(bankrollTotalRaw) && bankrollTotalRaw > 0 ? bankrollTotalRaw : 0;
      const bankrollForAh =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0
          ? Math.round(bankrollTotal * 100) / 100
          : 50;

      const robotLimits = (cfg?.betfairRobotLimits && typeof cfg.betfairRobotLimits === 'object') ? cfg.betfairRobotLimits : {};
      const ahLimits = (robotLimits as any)?.asianHandicap && typeof (robotLimits as any).asianHandicap === 'object' ? (robotLimits as any).asianHandicap : {};

      const { projectId } = await import('/utils/supabase/info');
      const headers = await getEdgeHeaders();

      const feed = readFeed();
      const feedUpdatedAtMs = new Date(feed.updatedAt).getTime();
      const feedAgeMs = Number.isFinite(feedUpdatedAtMs) ? Date.now() - feedUpdatedAtMs : Number.POSITIVE_INFINITY;
      const feedOk = feedAgeMs >= 0 && feedAgeMs <= 65_000;

      const qRes = await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/queue/list`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      const qRaw = await qRes.text().catch(() => '');
      const qData = qRaw ? JSON.parse(qRaw) : null;
      if (!qRes.ok || !qData?.ok) return;
      const items = Array.isArray(qData?.items) ? (qData.items as any[]) : [];

      const targets = items
        .filter((x) => String((x as any)?.status ?? '').trim() === 'running')
        .filter((x) => String((x as any)?.strategy?.agent ?? '').trim() === 'asianHandicap')
        .slice(0, 6);

      await mapWithConcurrency(targets, 2, async (x) => {
        const matchId = String((x as any)?.matchId ?? '').trim();
        if (!matchId) return null;
        const feedItem = feedOk ? ((feed.items as any)[matchId] ?? null) : null;
        const live =
          feedItem && typeof feedItem === 'object'
            ? {
                fetchedAt: String(feed.updatedAt),
                elapsed: typeof (feedItem as any)?.liveElapsed === 'number' ? (feedItem as any).liveElapsed : null,
                scoreHome: typeof (feedItem as any)?.scoreHome === 'number' ? (feedItem as any).scoreHome : null,
                scoreAway: typeof (feedItem as any)?.scoreAway === 'number' ? (feedItem as any).scoreAway : null,
              }
            : null;

        await fetch(`https://${projectId}.supabase.co/functions/v1/automation-server-1119702f/automation/betfair/strategy/asianHandicap/tick`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            matchId,
            adminToken,
            live,
            config: { bankroll: bankrollForAh, ...(ahLimits as any) },
          }),
        }).catch(() => null);
        return null;
      });
    };

    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void runOnce().finally(() => {
        inFlight = false;
      });
    };

    tick();
    const t = window.setInterval(tick, 10_000);
    return () => window.clearInterval(t);
  }, []);

  const traffic = useMemo(() => {
    if (!favoriteRescueEnabled) {
      return { tone: 'red' as const, label: 'Desativado', details: 'Agente independente desativado.' };
    }
    const updatedAtMs = new Date(statusSnapshot.updatedAt).getTime();
    const ageMs = Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Number.POSITIVE_INFINITY;
    const stale = !(ageMs >= 0 && ageMs <= 65_000);
    if (statusSnapshot.kind === 'error' || stale) {
      const reason = statusSnapshot.kind === 'error' ? statusSnapshot.text : 'Oscilando: sem atualização recente.';
      return { tone: 'amber' as const, label: 'Oscilando', details: reason };
    }
    return { tone: 'emerald' as const, label: 'Funcionando', details: statusSnapshot.text || 'Monitorando…' };
  }, [favoriteRescueEnabled, statusSnapshot]);

  const bgClass =
    traffic.tone === 'emerald'
      ? 'bg-emerald-600 border-emerald-700'
      : traffic.tone === 'amber'
        ? 'bg-amber-500 border-amber-600'
        : 'bg-red-600 border-red-700';
  const dotClass = traffic.tone === 'emerald' ? 'bg-emerald-200' : traffic.tone === 'amber' ? 'bg-amber-200' : 'bg-red-200';
  const dotAnimClass = traffic.tone === 'emerald' || traffic.tone === 'amber' ? 'animate-pulse [animation-duration:2.8s]' : '';
  const bottomLeftClass = sidebarCollapsed ? 'md:left-16' : 'md:left-64';

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((v) => !v)} />
      </div>
      <main className="flex-1 overflow-x-hidden pb-32 md:pb-14">
        <MobileHeader />
        <Outlet />
        <div className={`fixed left-0 right-0 bottom-16 md:bottom-0 ${bottomLeftClass} z-30 border-t ${bgClass}`}>
          <div className="px-3 py-1.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${dotClass} ${dotAnimClass}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-[11px] font-semibold text-white truncate">Agente independente</div>
                  <Badge className="h-5 px-2 text-[10px] font-semibold bg-white/15 text-white border border-white/20">{traffic.label}</Badge>
                  {favoriteRescueEnabled && statusSnapshot.kind !== 'inactive' ? (
                    <Badge className="h-5 px-2 text-[10px] font-semibold bg-white/15 text-white border border-white/20">
                      {statusSnapshot.kind === 'monitoring'
                        ? 'Monitorando…'
                        : statusSnapshot.kind === 'entry'
                          ? 'Entrada…'
                          : statusSnapshot.kind === 'exit_mo'
                            ? 'Saída MO…'
                            : statusSnapshot.kind === 'exit_cs'
                              ? 'Saída CS…'
                              : statusSnapshot.kind === 'error'
                                ? 'Erro…'
                                : '—'}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-[11px] text-white/90 truncate">{traffic.details}</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <div className="text-[11px] text-white/90">Ativar</div>
              <Switch
                checked={favoriteRescueEnabled}
                onCheckedChange={(checked) => {
                  const cfg = loadApiConfig();
                  if (!cfg) return;
                  const next: any = { ...cfg, betfairRobotLimits: { ...(cfg.betfairRobotLimits ?? {}) } };
                  next.betfairRobotLimits.favoriteRescue = { ...(next.betfairRobotLimits.favoriteRescue ?? {}), enabled: checked };
                  saveApiConfig(next);
                  setFavoriteRescueEnabled(checked);
                  writeStatus(
                    checked
                      ? { enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' }
                      : { enabled: false, kind: 'inactive', text: 'Desativado' },
                  );
                }}
              />
            </div>
          </div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
}
