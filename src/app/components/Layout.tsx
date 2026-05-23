import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { hydrateApiConfigFromServer, loadApiConfig, saveApiConfig } from '../services/apiConfig';

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
          prediction: null,
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
      const stakeMO = Number.isFinite(matchOddsLayStakeAbs) ? Math.max(2, Math.min(10000, matchOddsLayStakeAbs)) : 10;
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

        state.items[matchId] = {
          createdAt,
          scenario,
          minute,
          scoreHome: sh,
          scoreAway: sa,
          awayOddAtEntry: awayOdd,
          homeFavProb,
          homeWinRate,
          matchOdds: { marketId, selectionIdAway, layPrice, stake: stakeMO, takeProfitAbs },
          correctScore:
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
              : undefined,
        };
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
              scenario === 'losing_0_2'
                ? [
                    { key: 'winner', label: 'Match Odds (1X2)', enabled: true, details: null },
                    { key: 'correctScore', label: 'Placar correto', enabled: true, details: null },
                  ]
                : [{ key: 'winner', label: 'Match Odds (1X2)', enabled: true, details: null }],
          }).catch(() => null);
        } catch {}

        await placeOrders({
          adminToken,
          marketId,
          customerRef: `FR_MO_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
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

        if (scenario === 'losing_0_2' && state.items[matchId]?.correctScore?.selections?.length) {
          const csMarketId = String(state.items[matchId].correctScore!.marketId);
          const csInstructions = state.items[matchId].correctScore!.selections.map((s) => ({
            selectionId: s.selectionId,
            handicap: 0,
            side: 'LAY',
            orderType: 'LIMIT',
            limitOrder: { size: s.stake, price: s.layPrice, persistenceType: 'LAPSE' },
          }));
          await placeOrders({
            adminToken,
            marketId: csMarketId,
            customerRef: `FR_CS_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
            instructions: csInstructions.slice(0, 8),
          }).catch(() => null);
        }

        writeStatus({ enabled: true, kind: 'entry', text: `Entrada efetuada (${(v as any)?.homeTeam ?? ''} x ${(v as any)?.awayTeam ?? ''})` });
      }

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
              await placeOrders({
                adminToken,
                marketId: entry.matchOdds.marketId,
                customerRef: `FR_MO_EXIT_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
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
              next.items[matchId] = { ...entry, closed: { ...(entry.closed ?? {}), matchOdds: true, at: new Date().toISOString() } };
              writeStore(next);
              writeStatus({ enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' });
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
              await placeOrders({
                adminToken,
                marketId: entry.correctScore.marketId,
                customerRef: `FR_CS_EXIT_${matchId}_${Date.now().toString(16)}`.slice(0, 32),
                instructions: exitInstructions.slice(0, 8),
              }).catch(() => null);
              next.items[matchId] = { ...next.items[matchId], closed: { ...(next.items[matchId].closed ?? {}), correctScore: true, at: new Date().toISOString() } };
              writeStore(next);
              writeStatus({ enabled: true, kind: 'monitoring', text: 'Monitorando oportunidades…' });
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
      if (mode === 'page') return;

      const cfg = loadApiConfig();
      const adminToken = String(cfg?.automationAdminToken ?? '').trim();
      if (!adminToken) return;

      const bankrollTotalRaw = Number(cfg?.betfairBankroll ?? 0);
      const bankrollTotal = Number.isFinite(bankrollTotalRaw) && bankrollTotalRaw > 0 ? bankrollTotalRaw : 0;
      const marketPercents = (cfg?.betfairMarketPercents && typeof cfg.betfairMarketPercents === 'object') ? cfg.betfairMarketPercents : {};
      const overUnderPct = Number(marketPercents.overUnder ?? 10);
      const bankrollForOverUnder =
        Number.isFinite(bankrollTotal) && bankrollTotal > 0 && Number.isFinite(overUnderPct) && overUnderPct > 0
          ? Math.round(((bankrollTotal * overUnderPct) / 100) * 100) / 100
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
          const agent = String((x as any)?.strategy?.agent ?? '').trim();
          return agent === 'scalpingTicks';
        })
        .slice(0, 8);

      for (const x of targets) {
        const matchId = String((x as any)?.matchId ?? '').trim();
        if (!matchId) continue;
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
      }
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
