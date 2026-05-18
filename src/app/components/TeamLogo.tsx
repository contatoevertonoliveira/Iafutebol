import { useEffect, useMemo, useRef, useState } from 'react';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballService } from '../services/apiFootballService';

const apiLogoCacheMem = new Map<string, string | null>();
const apiLogoInFlight = new Map<string, Promise<string | null>>();
const API_LOGO_CACHE_KEY = 'teamLogoApiCache_v1';
let apiLogoFetchActive = 0;
const apiLogoFetchWaiters: Array<() => void> = [];

const acquireApiLogoSlot = async () => {
  const limit = 2;
  if (apiLogoFetchActive < limit) {
    apiLogoFetchActive += 1;
    return;
  }
  await new Promise<void>((resolve) => apiLogoFetchWaiters.push(resolve));
  apiLogoFetchActive += 1;
};

const releaseApiLogoSlot = () => {
  apiLogoFetchActive = Math.max(0, apiLogoFetchActive - 1);
  const next = apiLogoFetchWaiters.shift();
  if (next) next();
};

interface TeamLogoProps {
  teamName: string | null | undefined;
  logoUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showName?: boolean;
  className?: string;
}

const sizeClasses = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
  xl: 'w-16 h-16',
};

const textSizeClasses = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
};

export function TeamLogo({
  teamName,
  logoUrl,
  size = 'md',
  showName = true,
  className = '',
}: TeamLogoProps) {
  const safeTeamName = String(teamName ?? '').trim() || '—';
  const cacheKey = useMemo(() => {
    const k = safeTeamName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^0-9a-z\s]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return k || safeTeamName.toLowerCase();
  }, [safeTeamName]);
  const triedApiRef = useRef(false);

  const getInitials = (name: string | null | undefined) => {
    const safe = String(name ?? '').trim();
    if (!safe) return '—';
    return safe
      .split(/\s+/g)
      .map((word) => word.trim())
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const stripDiacritics = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const buildTeamBaseCandidates = (name: string) => {
    const raw = String(name ?? '').trim();
    if (!raw) return [] as string[];

    const normalized = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    const ascii = stripDiacritics(normalized);

    const normalizeKey = (v: string) =>
      stripDiacritics(String(v ?? '').toLowerCase())
        .replace(/['’]/g, '')
        .replace(/[()]/g, '')
        .replace(/[^0-9a-z\s._-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const key = normalizeKey(normalized);

    const heurAliases = (() => {
      if (key.includes('mainz')) return ['fsv_mainz_05', 'mainz_05', 'mainz'];
      if (key.includes('hoffenheim')) return ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'];
      return [] as string[];
    })();

    const aliasMap: Record<string, string[]> = {
      mainz: ['fsv_mainz_05', 'mainz_05', 'mainz'],
      hoffenheim: ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'],
      '1899 hoffenheim': ['1899_hoffenheim', 'hoffenheim'],
      'tsg hoffenheim': ['1899_hoffenheim', 'hoffenheim', 'tsg_hoffenheim'],
      'fsv mainz 05': ['fsv_mainz_05', 'mainz_05', 'mainz'],
    };

    const aliases = [...(aliasMap[key] ?? []), ...heurAliases];

    const prefixTokens = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ud', 'afc', 'cfc', 'sv', 'fsv', 'vfb', 'vfl', 'tsg', 'ssc', 'tsv', 'ksv', 'ssv', 'rc']);

    const suffixNoise = (t: string) => {
      const v = String(t ?? '').trim().toLowerCase();
      if (!v) return false;
      if (/^u\d{1,2}$/.test(v)) return true;
      if (['ii', 'iii', 'iv', 'b', 'w', 'women', 'feminino', 'fem', 'reserves', 'reserve'].includes(v)) return true;
      return false;
    };

    const tokenize = (v: string) =>
      String(v ?? '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[()]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/[\s_]+/g)
        .map((x) => x.trim())
        .filter(Boolean);

    const toDisplay = (tokens: string[]) => tokens.join(' ').trim();

    const compactNumberPrefix = (tokens: string[]) => {
      const t0 = tokens[0] ?? '';
      const t1 = tokens[1] ?? '';
      if (/^\d+$/.test(t0) && prefixTokens.has(t1)) {
        return [`${t0}.${t1}`, ...tokens.slice(2)];
      }
      return tokens;
    };

    const stripPrefix = (tokens: string[]) => {
      if (tokens.length === 0) return tokens;
      const t0 = tokens[0] ?? '';
      if (prefixTokens.has(t0)) return tokens.slice(1);
      if (/^\d+\.(fc|cf|sc|ac|cd|ud)$/i.test(t0)) return tokens;
      if (/^\d+$/.test(t0) && prefixTokens.has(tokens[1] ?? '')) return tokens;
      return tokens;
    };

    const stripSuffixes = (tokens: string[]) => {
      const copy = [...tokens];
      while (copy.length > 1 && suffixNoise(copy[copy.length - 1] ?? '')) copy.pop();
      return copy;
    };

    const variants = new Set<string>();
    const push = (v: string) => {
      const s = String(v ?? '').trim();
      if (s) variants.add(s);
    };

    for (const a of aliases) push(String(a).trim());
    push(normalized);
    push(ascii);

    const baseTokens = tokenize(normalized);
    const baseTokensAscii = tokenize(ascii);

    const addTokenVariants = (tokens: string[]) => {
      push(toDisplay(tokens));
      push(toDisplay(stripSuffixes(tokens)));
      push(toDisplay(stripPrefix(tokens)));
      push(toDisplay(stripSuffixes(stripPrefix(tokens))));
      push(toDisplay(compactNumberPrefix(tokens)));
      push(toDisplay(stripSuffixes(compactNumberPrefix(tokens))));
    };

    addTokenVariants(baseTokens);
    addTokenVariants(baseTokensAscii);

    const toFileBase = (s: string) =>
      String(s ?? '')
        .normalize('NFC')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^0-9a-zA-Z\u00C0-\u024F\u1E00-\u1EFF._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');

    const out = Array.from(variants)
      .map((v) => toFileBase(v))
      .filter(Boolean);

    const outAscii = out.map((v) => stripDiacritics(v)).filter(Boolean);

    return Array.from(new Set([...out, ...outAscii]));
  };

  const readCachedApiLogo = (key: string) => {
    if (apiLogoCacheMem.has(key)) return apiLogoCacheMem.get(key) ?? null;
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(API_LOGO_CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      if (!parsed || parsed.version !== 1 || !parsed.items || typeof parsed.items !== 'object') return null;
      const v = parsed.items[key];
      const logo = typeof v?.logo === 'string' ? v.logo.trim() : '';
      if (!logo) {
        apiLogoCacheMem.set(key, null);
        return null;
      }
      apiLogoCacheMem.set(key, logo);
      return logo;
    } catch {
      return null;
    }
  };

  const writeCachedApiLogo = (key: string, logo: string | null) => {
    apiLogoCacheMem.set(key, logo);
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(API_LOGO_CACHE_KEY);
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const next = parsed && parsed.version === 1 && parsed.items && typeof parsed.items === 'object'
        ? { version: 1 as const, items: { ...parsed.items } as Record<string, any> }
        : { version: 1 as const, items: {} as Record<string, any> };
      next.items[key] = { logo: logo ?? '', fetchedAt: new Date().toISOString() };
      localStorage.setItem(API_LOGO_CACHE_KEY, JSON.stringify(next));
    } catch {}
  };

  const scoreTeamName = (candidate: string, query: string) => {
    const norm = (v: string) =>
      String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^0-9a-z\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const c = norm(candidate);
    const q = norm(query);
    if (!c || !q) return 0;
    if (c === q) return 200;
    let score = 0;
    if (c.includes(q)) score += 55;
    if (c.startsWith(q)) score += 35;
    if (q.includes(c)) score += 25;
    const ct = new Set(c.split(' ').filter(Boolean));
    const qt = q.split(' ').filter(Boolean);
    let hits = 0;
    for (const t of qt) if (ct.has(t)) hits += 1;
    score += hits * 12;
    score -= Math.abs(c.length - q.length) * 0.5;
    return score;
  };

  const fetchApiLogo = async () => {
    const existing = readCachedApiLogo(cacheKey);
    if (existing) return existing;
    const inFlight = apiLogoInFlight.get(cacheKey);
    if (inFlight) return await inFlight;

    const p = (async () => {
      await acquireApiLogoSlot();
      const cfg = loadApiConfig();
      const apiKey = String(cfg?.apiFootballKey ?? '').trim();
      if (!apiKey) return null;

      const service = new ApiFootballService(apiKey);
      const queries = [
        safeTeamName,
        safeTeamName.replace(/\([^)]*\)/g, '').trim(),
        safeTeamName.replace(/\b(fc|cf|sc|ac|cd|ud|afc)\b/gi, '').replace(/\s+/g, ' ').trim(),
      ]
        .map((q) => String(q ?? '').trim())
        .filter((q) => q.length >= 3);

      for (const q of queries) {
        let items: any[] = [];
        try {
          items = await service.getTeams({ search: q });
        } catch {
          items = [];
        }
        const best = (Array.isArray(items) ? items : [])
          .map((t) => {
            const name = String((t as any)?.name ?? '');
            const logo = String((t as any)?.logo ?? '').trim();
            if (!name || !logo) return null;
            return { logo, score: scoreTeamName(name, safeTeamName) };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .sort((a, b) => b.score - a.score)[0] ?? null;

        if (best && best.score >= 40) {
          writeCachedApiLogo(cacheKey, best.logo);
          return best.logo;
        }
      }

      writeCachedApiLogo(cacheKey, null);
      return null;
    })()
      .finally(() => {
        releaseApiLogoSlot();
      })
      .finally(() => {
        apiLogoInFlight.delete(cacheKey);
      });

    apiLogoInFlight.set(cacheKey, p);
    return await p;
  };

  const cachedApiLogo = useMemo(() => readCachedApiLogo(cacheKey), [cacheKey]);
  const [apiLogo, setApiLogo] = useState<string | null>(cachedApiLogo);

  const buildSources = () => {
    const localBases = buildTeamBaseCandidates(safeTeamName);
    const exts = ['png', 'svg', 'webp'];
    const local = localBases.flatMap((b) => exts.map((ext) => encodeURI(`/assets/times/${b}.${ext}`)));
    const remote = String(logoUrl ?? '').trim();
    const api = String(apiLogo ?? '').trim();
    const urls = [...local, ...(remote ? [encodeURI(remote)] : []), ...(api ? [encodeURI(api)] : [])].filter(Boolean);
    return Array.from(new Set(urls)).slice(0, 40);
  };

  const sources = buildSources();
  const [sourceIndex, setSourceIndex] = useState(0);
  const activeSrc = sources[sourceIndex] ?? '';

  useEffect(() => {
    if (apiLogo) return;
    if (activeSrc) return;
    if (triedApiRef.current) return;
    triedApiRef.current = true;
    void fetchApiLogo().then((logo) => {
      if (logo) setApiLogo(logo);
    });
  }, [activeSrc, apiLogo]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {activeSrc ? (
        <img
          src={activeSrc}
          alt={`${safeTeamName} logo`}
          className={`${sizeClasses[size]} object-contain`}
          onError={() => setSourceIndex((i) => i + 1)}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold ${
            size === 'xs' ? 'text-[8px]' : size === 'sm' ? 'text-[10px]' : 'text-xs'
          }`}
        >
          {getInitials(teamName)}
        </div>
      )}
      {showName && (
        <span className={`font-medium ${textSizeClasses[size]}`}>
          {safeTeamName}
        </span>
      )}
    </div>
  );
}
