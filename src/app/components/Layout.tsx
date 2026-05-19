import { useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { MobileHeader } from './MobileHeader';
import { MobileBottomNav } from './MobileBottomNav';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { loadApiConfig, saveApiConfig } from '../services/apiConfig';

export function Layout() {
  const favoriteRescueStatusKey = 'favorite_rescue_status_v1';
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

  useEffect(() => {
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

  return (
    <div className="flex min-h-screen bg-gray-50">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      <main className="flex-1 overflow-x-hidden pb-32 md:pb-14">
        <MobileHeader />
        <Outlet />
        <div className={`fixed left-0 right-0 bottom-16 md:bottom-0 md:left-64 z-30 border-t ${bgClass}`}>
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
