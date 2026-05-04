import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Copy, ExternalLink, Loader2, Paperclip, Send, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { loadApiConfig } from '../services/apiConfig';
import { ApiFootballLeague, ApiFootballMatch, ApiFootballService } from '../services/apiFootballService';

type BotEntryMarket =
  | 'over_0_5'
  | 'over_1_5'
  | 'over_2_5'
  | 'under_2_5'
  | 'under_3_5'
  | 'btts_yes'
  | 'btts_no'
  | 'lay_home'
  | 'lay_away'
  | 'lay_draw';

type BotBetTimeType = 'Antes do minuto (no live)' | 'Depois do minuto (no live)' | 'Entre dois minutos (no live)';
type BotBetEntryType = 'Back' | 'Lay';
type BotBetOddType = 'Odds até' | 'Odds acima de' | 'Entre duas odds';
type BotBetTicksMode = 'Forçar ticks' | 'Propor ticks';
type BotBetComparison = 'Igual a' | 'Menor ou igual a' | 'Maior ou igual a';
type BotBetFixedMode = 'Fixo';
type BotBetGoalsScope = 'Total' | 'Casa' | 'Visitante';
type BotBetGoalsPeriod = 'Jogo todo' | '1º tempo' | '2º tempo';
type BotBetOddsStage = 'Pré-live' | 'Live';
type BotBetExitType = 'Gols a favor' | 'Gols contra' | 'Tempo' | 'Tempo de exposição' | 'Stop win' | 'Stop loss' | 'Avançado';
type BotBetExitForm = 'Hedge' | 'Freebet';

type BotBetExitBlock = {
  name: string;
  exitType: BotBetExitType;
  exitForm: BotBetExitForm;
  params?: Record<string, any>;
};

type BotBetGoalsCondition = {
  scope: BotBetGoalsScope;
  period: BotBetGoalsPeriod;
  mode: BotBetFixedMode;
  operator: BotBetComparison;
  value: number;
};

type BotBetOddsCondition = {
  stage: BotBetOddsStage;
  oddField: string;
  mode: BotBetFixedMode;
  operator: BotBetComparison;
  value: number;
};

type BotBetStatCondition = {
  stat: string;
  mode: BotBetFixedMode;
  operator: BotBetComparison;
  value: number;
};

type BotBetLiveBehaviorCondition = {
  behavior: string;
  mode: BotBetFixedMode;
  operator: BotBetComparison;
  value: number;
};

type BotDraftV1 = {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  description: string;
  entryWindowMin: number;
  entryMarket: BotEntryMarket;
  targetOdd: number | null;
  stakeSuggested: number | null;
  goalsMaxBeforeEntry: number | null;
  oddsConditions: string[];
  preLiveStatsConditions: string[];
  liveBehaviorConditions: string[];
  selectedLeagues: Array<{ id: number; name: string; country: string; type: string; season: number }>;
  exitConditions: string[];
  botBetTimeType?: BotBetTimeType;
  botBetMinute?: number | null;
  botBetMinuteFrom?: number | null;
  botBetMinuteTo?: number | null;
  botBetEntryType?: BotBetEntryType;
  botBetMarket?: string;
  botBetOddType?: BotBetOddType;
  botBetOddMin?: number | null;
  botBetOddMax?: number | null;
  botBetStake?: number | null;
  botBetTicksMode?: BotBetTicksMode;
  botBetTicks?: number | null;
  botBetMaxGapTicks?: number | null;
  botBetMinLiquidity?: number | null;
  botBetMaxLiquidity?: number | null;
  botBetGoalsConditions?: BotBetGoalsCondition[];
  botBetOddsConditions?: BotBetOddsCondition[];
  botBetPreLiveStatsConditions?: BotBetStatCondition[];
  botBetLiveBehaviorConditions?: BotBetLiveBehaviorCondition[];
  botBetIncludedLeagues?: Array<{ id: number; name: string; country: string; type: string; season: number }>;
  botBetExcludedLeagues?: Array<{ id: number; name: string; country: string; type: string; season: number }>;
  botBetExitBlocks?: BotBetExitBlock[];
};

type BotsStoreV1 = {
  version: 1;
  items: BotDraftV1[];
};

const botsKey = 'bots_v1';
const botsChatKey = 'bots_chat_v1';
const botsExternalInsightsKey = 'bots_external_insights_v1';

const nowIso = () => new Date().toISOString();
const clipText = (text: string, max: number) => {
  const t = String(text ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
};

const fileToBase64 = (file: File) =>
  new Promise<{ mime: string; base64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      const comma = raw.indexOf(',');
      if (comma < 0) return reject(new Error('Formato inválido'));
      const meta = raw.slice(0, comma);
      const data = raw.slice(comma + 1);
      const mime = meta.match(/^data:([^;]+);base64$/i)?.[1] ?? file.type ?? 'image/png';
      resolve({ mime, base64: data });
    };
    reader.readAsDataURL(file);
  });

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
};

type PendingImage = {
  id: string;
  name: string;
  mime: string;
  base64: string;
  size: number;
};

type BotsChatV1 = {
  version: 1;
  messages: ChatMessage[];
};

const readBotsChat = (): BotsChatV1 => {
  try {
    const raw = localStorage.getItem(botsChatKey);
    if (!raw) return { version: 1, messages: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as any).version === 1 && Array.isArray((parsed as any).messages)) {
      return { version: 1, messages: (parsed as any).messages as ChatMessage[] };
    }
    return { version: 1, messages: [] };
  } catch {
    return { version: 1, messages: [] };
  }
};

const writeBotsChat = (chat: BotsChatV1) => {
  const isQuota = (e: unknown) => {
    const anyE = e as any;
    const name = String(anyE?.name ?? '');
    const code = Number(anyE?.code ?? NaN);
    return name === 'QuotaExceededError' || code === 22 || code === 1014;
  };

  const compact = (c: BotsChatV1, maxMessages: number, maxTotalChars: number) => {
    let msgs = Array.isArray(c.messages) ? c.messages.slice(-maxMessages) : [];
    msgs = msgs.map((m) => ({
      ...m,
      text: clipText(m.text, m.role === 'assistant' ? 14000 : 4000),
    }));
    let total = msgs.reduce((sum, m) => sum + String(m.text ?? '').length, 0);
    while (total > maxTotalChars && msgs.length > 1) {
      total -= String(msgs[0]?.text ?? '').length;
      msgs = msgs.slice(1);
    }
    return { version: 1 as const, messages: msgs };
  };

  try {
    localStorage.setItem(botsChatKey, JSON.stringify(chat));
    return;
  } catch (e) {
    if (!isQuota(e)) return;
  }

  const attempts = [
    compact(chat, 80, 220_000),
    compact(chat, 40, 120_000),
    compact(chat, 20, 60_000),
    compact(chat, 10, 30_000),
  ];

  for (const c of attempts) {
    try {
      localStorage.setItem(botsChatKey, JSON.stringify(c));
      return;
    } catch (e) {
      if (!isQuota(e)) return;
    }
  }
};

type ExternalInsight = {
  id: string;
  provider: 'deepseek' | 'openai' | 'anthropic' | 'google';
  model: string;
  prompt: string;
  response: string;
  createdAt: string;
  botId: string;
};

type ExternalInsightsV1 = {
  version: 1;
  items: ExternalInsight[];
};

const readExternalInsights = (): ExternalInsightsV1 => {
  try {
    const raw = localStorage.getItem(botsExternalInsightsKey);
    if (!raw) return { version: 1, items: [] };
    const parsed = JSON.parse(raw) as any;
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
    return { version: 1, items: parsed.items as ExternalInsight[] };
  } catch {
    return { version: 1, items: [] };
  }
};

const appendExternalInsight = (insight: ExternalInsight) => {
  const store = readExternalInsights();
  const safeInsight: ExternalInsight = {
    ...insight,
    prompt: clipText(insight.prompt, 2000),
    response: clipText(insight.response, 20000),
  };

  const next = { version: 1 as const, items: [safeInsight, ...store.items].slice(0, 120) };
  try {
    localStorage.setItem(botsExternalInsightsKey, JSON.stringify(next));
    window.dispatchEvent(new Event('botsExternalInsightsChanged'));
  } catch {}
};

const createEmptyBot = (): BotDraftV1 => ({
  version: 1,
  id: `bot_${Math.random().toString(16).slice(2)}_${Date.now()}`,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  name: '',
  description: '',
  entryWindowMin: 75,
  entryMarket: 'over_1_5',
  targetOdd: null,
  stakeSuggested: null,
  goalsMaxBeforeEntry: 0,
  oddsConditions: [],
  preLiveStatsConditions: [],
  liveBehaviorConditions: [],
  selectedLeagues: [],
  exitConditions: [],
  botBetTimeType: 'Antes do minuto (no live)',
  botBetMinute: 75,
  botBetMinuteFrom: null,
  botBetMinuteTo: null,
  botBetEntryType: 'Back',
  botBetMarket: 'Mais de 1.5 FT',
  botBetOddType: 'Odds até',
  botBetOddMin: null,
  botBetOddMax: null,
  botBetStake: null,
  botBetTicksMode: 'Forçar ticks',
  botBetTicks: 2,
  botBetMaxGapTicks: 10,
  botBetMinLiquidity: null,
  botBetMaxLiquidity: null,
  botBetGoalsConditions: [],
  botBetOddsConditions: [],
  botBetPreLiveStatsConditions: [],
  botBetLiveBehaviorConditions: [],
  botBetIncludedLeagues: [],
  botBetExcludedLeagues: [],
  botBetExitBlocks: [],
});

const readBotsStore = (): BotsStoreV1 => {
  try {
    const raw = localStorage.getItem(botsKey);
    if (!raw) return { version: 1, items: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as any).version === 1 && Array.isArray((parsed as any).items)) {
      return { version: 1, items: (parsed as any).items as BotDraftV1[] };
    }
    return { version: 1, items: [] };
  } catch {
    return { version: 1, items: [] };
  }
};

const writeBotsStore = (store: BotsStoreV1) => {
  localStorage.setItem(botsKey, JSON.stringify(store));
  window.dispatchEvent(new Event('botsChanged'));
};

const marketLabel = (m: BotEntryMarket) => {
  switch (m) {
    case 'over_0_5':
      return 'Over 0.5 Gols';
    case 'over_1_5':
      return 'Over 1.5 Gols';
    case 'over_2_5':
      return 'Over 2.5 Gols';
    case 'under_2_5':
      return 'Under 2.5 Gols';
    case 'under_3_5':
      return 'Under 3.5 Gols';
    case 'btts_yes':
      return 'Ambos Marcam (SIM)';
    case 'btts_no':
      return 'Ambos Marcam (NÃO)';
    case 'lay_home':
      return 'Lay Casa';
    case 'lay_away':
      return 'Lay Fora';
    case 'lay_draw':
      return 'Lay Empate';
    default:
      return String(m);
  }
};

type BotSuggestion = {
  title: string;
  notes: string[];
  patch: Partial<BotDraftV1>;
};

const TIME_ZONE = 'America/Sao_Paulo';

const uniqById = <T extends { id: number }>(items: T[]) => {
  const map = new Map<number, T>();
  for (const it of items) {
    const id = Number((it as any)?.id);
    if (!Number.isFinite(id)) continue;
    if (!map.has(id)) map.set(id, it);
  }
  return Array.from(map.values());
};

const getIncludedLeagues = (b: BotDraftV1) => {
  const fromNew = Array.isArray(b.botBetIncludedLeagues) ? b.botBetIncludedLeagues : [];
  const legacy = Array.isArray(b.selectedLeagues) ? b.selectedLeagues : [];
  return uniqById([...fromNew, ...legacy]);
};

const getExcludedLeagueIds = (b: BotDraftV1) => {
  const ids = new Set<number>();
  const ex = Array.isArray(b.botBetExcludedLeagues) ? b.botBetExcludedLeagues : [];
  for (const it of ex) {
    const id = Number((it as any)?.id);
    if (Number.isFinite(id)) ids.add(id);
  }
  return ids;
};

const parseUserNumber = (raw: string): number | null => {
  const s = String(raw ?? '').trim().replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const inferGoalsCapForEntryMarket = (m: BotEntryMarket): number => {
  switch (m) {
    case 'over_0_5':
      return 0;
    case 'over_1_5':
      return 1;
    case 'over_2_5':
      return 2;
    case 'under_2_5':
      return 2;
    case 'under_3_5':
      return 3;
    default:
      return 2;
  }
};

const inferGoalLineFromMarket = (market: BotEntryMarket): number | null => {
  switch (market) {
    case 'over_0_5':
      return 0.5;
    case 'over_1_5':
      return 1.5;
    case 'over_2_5':
      return 2.5;
    case 'under_2_5':
      return 2.5;
    case 'under_3_5':
      return 3.5;
    default:
      return null;
  }
};

const botBetStatLabel = (team: 'casa' | 'visitante', metric: string, scope?: 'casa' | 'fora' | 'casa/fora') => {
  const s = scope ?? 'casa/fora';
  return `[pre-live ult. 10 jogos] ${team} - jogando ${s} - ${metric}`;
};

const defaultBotBetPreLiveStatsConditions = (entryMarket: BotEntryMarket, aggressive: boolean): BotBetStatCondition[] => {
  const line = inferGoalLineFromMarket(entryMarket);
  const isUnder = entryMarket.startsWith('under_');
  const isOver = entryMarket.startsWith('over_');
  const wantsGoalsLine = typeof line === 'number' && Number.isFinite(line);

  const pctValue = aggressive ? 55 : 45;
  const xgValue = aggressive ? 1.45 : 1.3;

  const conditions: BotBetStatCondition[] = [];
  if (wantsGoalsLine && (isOver || isUnder)) {
    const aboveMetric = `jogos acima de ${String(line).replace(',', '.')} gols tempo total %`;
    const belowMetric = `jogos abaixo de ${String(line).replace(',', '.')} gols tempo total %`;
    const metric = isOver ? aboveMetric : belowMetric;
    conditions.push({
      stat: botBetStatLabel('casa', metric, 'casa'),
      mode: 'Fixo',
      operator: 'Maior ou igual a',
      value: pctValue,
    });
    conditions.push({
      stat: botBetStatLabel('visitante', metric, 'fora'),
      mode: 'Fixo',
      operator: 'Maior ou igual a',
      value: pctValue,
    });
  }

  if (isOver) {
    conditions.push({
      stat: botBetStatLabel('casa', 'média de gols esperados (xg)', 'casa'),
      mode: 'Fixo',
      operator: 'Maior ou igual a',
      value: xgValue,
    });
    conditions.push({
      stat: botBetStatLabel('visitante', 'média de gols esperados (xg)', 'fora'),
      mode: 'Fixo',
      operator: 'Maior ou igual a',
      value: xgValue,
    });
  }

  if (isUnder) {
    conditions.push({
      stat: botBetStatLabel('casa', 'média de gols esperados (xg)', 'casa'),
      mode: 'Fixo',
      operator: 'Menor ou igual a',
      value: xgValue,
    });
    conditions.push({
      stat: botBetStatLabel('visitante', 'média de gols esperados (xg)', 'fora'),
      mode: 'Fixo',
      operator: 'Menor ou igual a',
      value: xgValue,
    });
  }

  return conditions.slice(0, 8);
};

const defaultBotBetLiveBehaviorConditions = (args: {
  entryMarket: BotEntryMarket;
  aggressive: boolean;
  firstHalf: boolean;
  disable?: boolean;
}): BotBetLiveBehaviorCondition[] => {
  if (args.disable) return [];
  const isOver = args.entryMarket.startsWith('over_');
  const isUnder = args.entryMarket.startsWith('under_');
  if (!isOver && !isUnder) return [];

  const prefix = args.firstHalf ? 'Estatísticas 1º tempo - ' : 'Estatísticas - ';
  const ap = `${prefix}ataques perigosos`;
  const shots = `${prefix}total de chutes`;
  const inBox = `${prefix}chutes dentro da área`;

  const apHigh = args.aggressive ? 22 : 18;
  const shotsHigh = args.aggressive ? 8 : 6;
  const inBoxHigh = args.aggressive ? 3 : 2;

  const apLow = args.aggressive ? 20 : 18;
  const shotsLow = args.aggressive ? 8 : 7;

  const mk = (behavior: string, operator: BotBetComparison, value: number): BotBetLiveBehaviorCondition => ({
    behavior,
    mode: 'Fixo',
    operator,
    value,
  });

  if (isOver) {
    return [
      mk(`${ap} casa`, 'Maior ou igual a', apHigh),
      mk(`${ap} visitante`, 'Maior ou igual a', apHigh),
      mk(`${shots} casa`, 'Maior ou igual a', shotsHigh),
      mk(`${shots} visitante`, 'Maior ou igual a', shotsHigh),
      mk(`${inBox} casa`, 'Maior ou igual a', inBoxHigh),
      mk(`${inBox} visitante`, 'Maior ou igual a', inBoxHigh),
    ].slice(0, 8);
  }

  return [
    mk(`${ap} casa`, 'Menor ou igual a', apLow),
    mk(`${ap} visitante`, 'Menor ou igual a', apLow),
    mk(`${shots} casa`, 'Menor ou igual a', shotsLow),
    mk(`${shots} visitante`, 'Menor ou igual a', shotsLow),
  ].slice(0, 8);
};

const defaultBotBetExitBlocks = (args: { entryType: BotBetEntryType; aggressive: boolean; stake: number }): BotBetExitBlock[] => {
  const stake = Number.isFinite(args.stake) && args.stake > 0 ? args.stake : 1;
  if (args.entryType === 'Lay') {
    return [
      {
        name: 'Proteção',
        exitType: 'Stop loss',
        exitForm: 'Hedge',
        params: { loss: Math.round(stake * 0.4 * 100) / 100 },
      },
      {
        name: 'Saída com lucro',
        exitType: 'Stop win',
        exitForm: 'Hedge',
        params: { win: Math.round(stake * (args.aggressive ? 0.35 : 0.25) * 100) / 100 },
      },
    ];
  }

  return [
    {
      name: 'Proteção',
      exitType: 'Stop loss',
      exitForm: 'Hedge',
      params: { loss: Math.round(stake * 0.4 * 100) / 100 },
    },
    {
      name: 'Saída com lucro',
      exitType: 'Stop win',
      exitForm: 'Hedge',
      params: { win: Math.round(stake * (args.aggressive ? 0.5 : 0.35) * 100) / 100 },
    },
  ];
};

type SimTotals = {
  base: number;
  entries: number;
  greens: number;
  reds: number;
  hitRate: number;
  avgOdd: number;
  profit: number;
};

type SimResult = {
  totals: SimTotals;
  byLeague: Array<{ leagueId: number; leagueName: string; country: string; season: number; totals: SimTotals }>;
  meta: { from: string; to: string; leaguesSimulated: number; leaguesTotal: number; note: string };
};

const getYmd = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const isFinishedFixture = (m: ApiFootballMatch) => {
  const s = String(m?.fixture?.status?.short ?? '').toUpperCase();
  return ['FT', 'AET', 'PEN', 'FINISHED'].includes(s);
};

const getFullTimeGoals = (m: ApiFootballMatch) => {
  const home = m?.goals?.home;
  const away = m?.goals?.away;
  return {
    home: typeof home === 'number' && Number.isFinite(home) ? home : null,
    away: typeof away === 'number' && Number.isFinite(away) ? away : null,
  };
};

const getHalfTimeGoals = (m: ApiFootballMatch) => {
  const home = (m as any)?.score?.halftime?.home;
  const away = (m as any)?.score?.halftime?.away;
  return {
    home: typeof home === 'number' && Number.isFinite(home) ? home : null,
    away: typeof away === 'number' && Number.isFinite(away) ? away : null,
  };
};

const parseMarket = (market: string) => {
  const raw = String(market ?? '').trim();
  const low = raw.toLowerCase();
  const num = low.match(/([0-9]+(?:[.,][0-9]+)?)/);
  const line = num ? Number(String(num[1]).replace(',', '.')) : null;
  const isHT = /\bht\b/i.test(raw) || /1º\s*tempo|primeiro\s*tempo/i.test(raw);
  return { raw, low, line, isHT };
};

const evalBackOutcome = (market: string, m: ApiFootballMatch): boolean | null => {
  const { low, line, isHT } = parseMarket(market);
  const score = isHT ? getHalfTimeGoals(m) : getFullTimeGoals(m);
  if (score.home === null || score.away === null) return null;

  const total = score.home + score.away;

  if (low.startsWith('mais de') && typeof line === 'number' && Number.isFinite(line)) {
    return total > line;
  }
  if (low.startsWith('menos de') && typeof line === 'number' && Number.isFinite(line)) {
    return total < line;
  }
  if (low.startsWith('ambas marcam')) {
    if (low.includes('não') || low.includes('nao')) return !(score.home > 0 && score.away > 0);
    return score.home > 0 && score.away > 0;
  }
  if (low.startsWith('resultado final')) {
    if (low.includes('casa')) return score.home > score.away;
    if (low.includes('visitante') || low.includes('fora')) return score.away > score.home;
    if (low.includes('empate')) return score.home === score.away;
  }
  if (low.startsWith('dupla chance')) {
    if (low.includes('casa') && low.includes('empate')) return score.home >= score.away;
    if (low.includes('empate') && (low.includes('fora') || low.includes('visitante'))) return score.away >= score.home;
    if (low.includes('casa') && (low.includes('fora') || low.includes('visitante'))) return score.home !== score.away;
  }
  if (low.startsWith('placar exato')) {
    const mScore = low.match(/placar\s*exato\s*(\d)\s*[-x]\s*(\d)/i);
    if (!mScore) return null;
    const h = Number(mScore[1]);
    const a = Number(mScore[2]);
    return score.home === h && score.away === a;
  }
  if (low.startsWith('qualquer outro placar')) {
    if (low.includes('casa')) return score.home > score.away;
    if (low.includes('visitante') || low.includes('fora')) return score.away > score.home;
    if (low.includes('empate')) return score.home === score.away;
  }
  return null;
};

const assumedOdd = (b: BotDraftV1) => {
  const t = b.botBetOddType ?? 'Odds até';
  const min = typeof b.botBetOddMin === 'number' ? b.botBetOddMin : null;
  const max = typeof b.botBetOddMax === 'number' ? b.botBetOddMax : null;
  const target = typeof b.targetOdd === 'number' ? b.targetOdd : null;
  if (t === 'Entre duas odds' && min !== null && max !== null) return (min + max) / 2;
  if (t === 'Odds acima de' && min !== null) return min;
  if (t === 'Odds até' && max !== null) return max;
  if (target !== null) return target;
  return 1.74;
};

const assumedStake = (b: BotDraftV1) => {
  const s = typeof b.botBetStake === 'number' ? b.botBetStake : typeof b.stakeSuggested === 'number' ? b.stakeSuggested : null;
  return s !== null && Number.isFinite(s) && s > 0 ? s : 1;
};

const makeTotals = (base: number, entries: number, greens: number, reds: number, avgOdd: number, profit: number): SimTotals => {
  const hitRate = entries === 0 ? 0 : Math.round((greens / entries) * 100);
  return {
    base,
    entries,
    greens,
    reds,
    hitRate,
    avgOdd: Number.isFinite(avgOdd) ? Math.round(avgOdd * 100) / 100 : 0,
    profit: Math.round(profit * 100) / 100,
  };
};

const inferBotBetOddField = (entryType: BotBetEntryType, market: string): string => {
  const m = String(market ?? '').trim().toLowerCase();
  if (!m) return '';
  const prefix = entryType === 'Lay' ? 'Lay' : 'Back';

  if (m.includes('resultado final') && m.includes('casa')) return `${prefix} match odds casa`;
  if (m.includes('resultado final') && (m.includes('visitante') || m.includes('fora'))) return `${prefix} match odds visitante`;
  if (m.includes('resultado final') && m.includes('empate')) return `${prefix} match odds empate`;

  const exact = m.match(/placar\s*exato\s*(\d)\s*[-x]\s*(\d)/);
  if (exact) return `${prefix} placar exato ${exact[1]}x${exact[2]}`;

  if (m.includes('mais de') && m.includes('ht')) {
    const g = m.match(/mais de\s*([0-9]+(?:[.,][0-9]+)?)/);
    return g ? `${prefix} over primeiro tempo ${String(g[1]).replace(',', '.')} gols` : '';
  }
  if (m.includes('menos de') && m.includes('ht')) {
    const g = m.match(/menos de\s*([0-9]+(?:[.,][0-9]+)?)/);
    return g ? `${prefix} under primeiro tempo ${String(g[1]).replace(',', '.')} gols` : '';
  }
  if (m.includes('mais de') && m.includes('ft')) {
    const g = m.match(/mais de\s*([0-9]+(?:[.,][0-9]+)?)/);
    return g ? `${prefix} over ${String(g[1]).replace(',', '.')} gols` : '';
  }
  if (m.includes('menos de') && m.includes('ft')) {
    const g = m.match(/menos de\s*([0-9]+(?:[.,][0-9]+)?)/);
    return g ? `${prefix} under ${String(g[1]).replace(',', '.')} gols` : '';
  }

  if (m.includes('ambas marcam')) {
    if (m.includes('não') || m.includes('nao')) return `${prefix} ambos marcam não`;
    return `${prefix} ambos marcam sim`;
  }

  if (m.includes('dupla chance')) {
    if (m.includes('casa') && m.includes('empate')) return `${prefix} dupla chance casa ou empate`;
    if (m.includes('empate') && (m.includes('fora') || m.includes('visitante'))) return `${prefix} dupla chance empate ou visitante`;
    if (m.includes('casa') && (m.includes('fora') || m.includes('visitante'))) return `${prefix} dupla chance casa ou visitante`;
  }

  return `${prefix} match odds casa`;
};

const guessBotBetMarketFromEntry = (entryMarket: BotEntryMarket): string => {
  switch (entryMarket) {
    case 'over_0_5':
      return 'Mais de 0.5 FT';
    case 'over_1_5':
      return 'Mais de 1.5 FT';
    case 'over_2_5':
      return 'Mais de 2.5 FT';
    case 'under_2_5':
      return 'Menos de 2.5 FT';
    case 'under_3_5':
      return 'Menos de 3.5 FT';
    case 'btts_yes':
      return 'Ambas Marcam Sim';
    case 'btts_no':
      return 'Ambas Marcam Não';
    case 'lay_home':
      return 'Resultado Final Casa FT';
    case 'lay_away':
      return 'Resultado Final Visitante FT';
    case 'lay_draw':
      return 'Resultado Final Empate FT';
    default:
      return 'Mais de 1.5 FT';
  }
};

const buildSuggestion = (prompt: string): BotSuggestion => {
  const text = String(prompt ?? '').toLowerCase();

  const wantsUnder = /under|menos de|segur|conserv|amarrad/.test(text);
  const wantsOver = /over|mais de|gols|gol|late goal|fim de jogo/.test(text);
  const wantsLay = /lay|contra/.test(text);
  const wantsBtts = /btts|ambos marcam/.test(text);
  const wantsCup = /copa|mata[- ]mata|knockout|final|semi|quartas/.test(text);
  const aggressive = /agress|alta odd|odd alta|martingale|gale|soros|recupera/.test(text);

  let entryMarket: BotEntryMarket = 'over_1_5';
  if (wantsLay) entryMarket = 'lay_home';
  else if (wantsBtts && !/nao|não/.test(text)) entryMarket = 'btts_yes';
  else if (wantsBtts && /nao|não/.test(text)) entryMarket = 'btts_no';
  else if (wantsUnder) entryMarket = 'under_2_5';
  else if (wantsOver) entryMarket = 'over_1_5';

  const entryWindowMin = aggressive ? 55 : 75;
  const targetOdd = wantsLay ? (aggressive ? 2.4 : 2.0) : aggressive ? 1.85 : 1.65;
  const stakeSuggested = aggressive ? 2.0 : 1.0;

  const entryType: BotBetEntryType = wantsLay ? 'Lay' : 'Back';

  const betweenMin = text.match(/entre\s+(\d{1,3})\s*(?:e|até)\s*(\d{1,3})\s*(?:min|m)\b/);
  const afterMin = text.match(/depois\s+(?:do\s+)?minuto\s+(\d{1,3})\b/);
  const beforeMin = text.match(/(?:antes|até)\s+(?:do\s+)?minuto\s+(\d{1,3})\b/);

  let botBetTimeType: BotBetTimeType = 'Antes do minuto (no live)';
  let botBetMinute: number | null = entryWindowMin;
  let botBetMinuteFrom: number | null = null;
  let botBetMinuteTo: number | null = null;

  if (betweenMin) {
    botBetTimeType = 'Entre dois minutos (no live)';
    botBetMinuteFrom = Math.max(0, Math.min(120, Number(betweenMin[1])));
    botBetMinuteTo = Math.max(0, Math.min(120, Number(betweenMin[2])));
    botBetMinute = null;
  } else if (afterMin) {
    botBetTimeType = 'Depois do minuto (no live)';
    botBetMinute = Math.max(0, Math.min(120, Number(afterMin[1])));
  } else if (beforeMin) {
    botBetTimeType = 'Antes do minuto (no live)';
    botBetMinute = Math.max(0, Math.min(120, Number(beforeMin[1])));
  }

  const oddsBetween = text.match(/odds?\s*entre\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:e|até)\s*([0-9]+(?:[.,][0-9]+)?)/);
  const oddsAtMost = text.match(/odds?\s*(?:até|no máximo)\s*([0-9]+(?:[.,][0-9]+)?)/);
  const oddsAtLeast = text.match(/odds?\s*(?:acima de|a partir de|mínima|minima)\s*([0-9]+(?:[.,][0-9]+)?)/);

  let botBetOddType: BotBetOddType = 'Odds até';
  let botBetOddMin: number | null = null;
  let botBetOddMax: number | null = null;
  if (oddsBetween) {
    botBetOddType = 'Entre duas odds';
    botBetOddMin = parseUserNumber(oddsBetween[1]);
    botBetOddMax = parseUserNumber(oddsBetween[2]);
  } else if (oddsAtLeast) {
    botBetOddType = 'Odds acima de';
    botBetOddMin = parseUserNumber(oddsAtLeast[1]);
  } else if (oddsAtMost) {
    botBetOddType = 'Odds até';
    botBetOddMax = parseUserNumber(oddsAtMost[1]);
  }

  let botBetMarket = guessBotBetMarketFromEntry(entryMarket);
  const exact = text.match(/placar\s*exato\s*(\d)\s*[-x]\s*(\d)/);
  if (exact) {
    botBetMarket = `Placar Exato ${exact[1]}-${exact[2]}`;
  } else if (/ambas\s+marcam/.test(text)) {
    botBetMarket = /nao|não/.test(text) ? 'Ambas Marcam Não' : 'Ambas Marcam Sim';
  } else if (/dupla\s*chance/.test(text)) {
    if (/casa.*empate|empate.*casa/.test(text)) botBetMarket = 'Dupla Chance Casa ou Empate';
    else if (/empate.*fora|fora.*empate/.test(text)) botBetMarket = 'Dupla Chance Empate ou Fora';
    else if (/casa.*fora|fora.*casa/.test(text)) botBetMarket = 'Dupla Chance Casa ou Fora';
  } else if (/qualquer\s+outro\s+placar/.test(text)) {
    if (/casa/.test(text)) botBetMarket = 'Qualquer outro placar Casa';
    else if (/visitante|fora/.test(text)) botBetMarket = 'Qualquer outro placar Visitante';
    else if (/empate/.test(text)) botBetMarket = 'Qualquer outro placar Empate';
  } else if (/ht|1º\s*tempo|primeiro\s*tempo/.test(text) && /(mais de|over)/.test(text)) {
    const g = text.match(/(?:mais de|over)\s*(\d(?:[.,]\d)?)\s*(?:gols?)?/);
    if (g) botBetMarket = `Mais de ${String(g[1]).replace(',', '.')} HT`;
  } else if (/ht|1º\s*tempo|primeiro\s*tempo/.test(text) && /(menos de|under)/.test(text)) {
    const g = text.match(/(?:menos de|under)\s*(\d(?:[.,]\d)?)\s*(?:gols?)?/);
    if (g) botBetMarket = `Menos de ${String(g[1]).replace(',', '.')} HT`;
  }

  const firstHalf = /ht|1º\s*tempo|primeiro\s*tempo/.test(text) || /HT\b/.test(botBetMarket);
  const disableLive = /sem\s+live|sem\s+comportamento|s[oó]\s+pr[eé]-live/.test(text);

  const botBetOddsStage: BotBetOddsStage = /ao vivo|live/.test(text) ? 'Live' : 'Pré-live';
  const oddField = inferBotBetOddField(entryType, botBetMarket);
  const botBetOddsConditions: BotBetOddsCondition[] = [];
  if (oddField) {
    if (botBetOddType === 'Entre duas odds' && botBetOddMin !== null && botBetOddMax !== null) {
      botBetOddsConditions.push({
        stage: botBetOddsStage,
        oddField,
        mode: 'Fixo',
        operator: 'Maior ou igual a',
        value: botBetOddMin,
      });
      botBetOddsConditions.push({
        stage: botBetOddsStage,
        oddField,
        mode: 'Fixo',
        operator: 'Menor ou igual a',
        value: botBetOddMax,
      });
    } else if (botBetOddType === 'Odds acima de' && botBetOddMin !== null) {
      botBetOddsConditions.push({
        stage: botBetOddsStage,
        oddField,
        mode: 'Fixo',
        operator: 'Maior ou igual a',
        value: botBetOddMin,
      });
    } else {
      const v = botBetOddMax ?? targetOdd ?? botBetOddMin;
      if (typeof v === 'number' && Number.isFinite(v)) {
        botBetOddsConditions.push({
          stage: botBetOddsStage,
          oddField,
          mode: 'Fixo',
          operator: 'Menor ou igual a',
          value: v,
        });
      }
    }
  }

  const goalsCap = inferGoalsCapForEntryMarket(entryMarket);
  const botBetGoalsConditions: BotBetGoalsCondition[] = [
    {
      scope: 'Total',
      period: /ht|1º\s*tempo|primeiro\s*tempo/.test(text) ? '1º tempo' : 'Jogo todo',
      mode: 'Fixo',
      operator: entryMarket.startsWith('over_') ? 'Menor ou igual a' : 'Menor ou igual a',
      value: goalsCap,
    },
  ];
  const botBetPreLiveStatsConditions = defaultBotBetPreLiveStatsConditions(entryMarket, aggressive);
  const botBetLiveBehaviorConditions = defaultBotBetLiveBehaviorConditions({
    entryMarket,
    aggressive,
    firstHalf,
    disable: disableLive,
  });
  const botBetExitBlocks = defaultBotBetExitBlocks({ entryType, aggressive, stake: stakeSuggested });

  const oddsConditions = [
    wantsLay ? 'Odd do favorito <= 1.75' : null,
    wantsUnder ? 'Odd do Under 2.5 entre 1.60 e 2.10' : null,
    wantsOver ? 'Odd do Over 1.5 entre 1.45 e 2.00' : null,
  ].filter((v): v is string => Boolean(v));

  const preLiveStatsConditions = [
    wantsUnder ? 'Média de gols (pré-live) baixa na temporada (<= 2.5)' : 'Média de gols (pré-live) >= 2.6',
    wantsLay ? 'Favorito com % vitórias >= 55%' : 'Ambos com criação de chances (xG) razoável',
  ];

  const liveBehaviorConditions = [
    wantsUnder ? 'Jogo travado: 0-0 até 25min com poucas finalizações' : 'Pressão: finalizações (no alvo) crescendo após 20min',
    wantsLay ? 'Favorito pressionado (Lay) com posse improdutiva e contra-ataques sofridos' : 'Zonas perigosas: ataques perigosos constantes',
  ];

  const exitConditions = [
    wantsLay ? 'Fechar com green após 1 gol do underdog' : 'Fechar com green após 1 gol (hedge)',
    aggressive ? 'Stop curto: -30% da stake' : 'Stop: -40% da stake',
    wantsCup ? 'Em copa/mata-mata: reduzir exposição e sair mais cedo' : null,
  ].filter((v): v is string => Boolean(v));

  const notes = [
    wantsCup ? 'Copa/mata-mata tende a mudar comportamento (mais cautela). Use saída mais conservadora.' : 'Ajuste odds/tempo conforme liga e perfil.',
    'Valide sempre a liquidez e atraso de transmissão no botBet antes de automatizar.',
  ];

  const title =
    wantsLay ? 'Sugestão: Lay (contra favorito)' : wantsUnder ? 'Sugestão: Under (controle de risco)' : 'Sugestão: Over (tendência a gols)';

  return {
    title,
    notes,
    patch: {
      entryMarket,
      entryWindowMin,
      targetOdd,
      stakeSuggested,
      goalsMaxBeforeEntry: wantsOver ? 1 : 0,
      oddsConditions,
      preLiveStatsConditions,
      liveBehaviorConditions,
      exitConditions,
      botBetEntryType: entryType,
      botBetTimeType,
      botBetMinute,
      botBetMinuteFrom,
      botBetMinuteTo,
      botBetMarket,
      botBetOddType,
      botBetOddMin,
      botBetOddMax,
      botBetStake: stakeSuggested,
      botBetGoalsConditions,
      botBetOddsConditions,
      botBetPreLiveStatsConditions,
      botBetLiveBehaviorConditions,
      botBetExitBlocks,
    },
  };
};

const mergeBotWithSuggestion = (bot: BotDraftV1, s: BotSuggestion, userText: string): BotDraftV1 => {
  const next: BotDraftV1 = {
    ...bot,
    ...s.patch,
    updatedAt: nowIso(),
    oddsConditions: Array.isArray(s.patch.oddsConditions) ? s.patch.oddsConditions : bot.oddsConditions,
    preLiveStatsConditions: Array.isArray(s.patch.preLiveStatsConditions) ? s.patch.preLiveStatsConditions : bot.preLiveStatsConditions,
    liveBehaviorConditions: Array.isArray(s.patch.liveBehaviorConditions) ? s.patch.liveBehaviorConditions : bot.liveBehaviorConditions,
    exitConditions: Array.isArray(s.patch.exitConditions) ? s.patch.exitConditions : bot.exitConditions,
  };

  if (!next.name.trim()) {
    next.name = `${marketLabel(next.entryMarket)} • ${new Date().toLocaleDateString('pt-BR')}`;
  }

  if (!next.description.trim()) {
    next.description = userText.trim().slice(0, 240);
  }

  return next;
};

const formatAssistantReply = (s: BotSuggestion, bot: BotDraftV1, targetAccuracy: number | null) => {
  const lines: string[] = [];
  lines.push(`${s.title}`);
  lines.push('');
  lines.push('Configuração sugerida (para montar no botBet):');
  lines.push(`- Tipo de entrada: ${bot.botBetEntryType ?? '—'}`);
  lines.push(`- Mercado: ${bot.botBetMarket ?? '—'}`);
  if (bot.botBetTimeType === 'Entre dois minutos (no live)') {
    lines.push(`- Tempo: ${bot.botBetTimeType} (${bot.botBetMinuteFrom ?? '—'} a ${bot.botBetMinuteTo ?? '—'})`);
  } else {
    lines.push(`- Tempo: ${bot.botBetTimeType ?? '—'} (${bot.botBetMinute ?? bot.entryWindowMin} min)`);
  }
  if (bot.botBetOddType === 'Entre duas odds') {
    lines.push(`- Odd: ${bot.botBetOddType} (${bot.botBetOddMin ?? '—'} a ${bot.botBetOddMax ?? '—'})`);
  } else if (bot.botBetOddType === 'Odds acima de') {
    lines.push(`- Odd: ${bot.botBetOddType} (${bot.botBetOddMin ?? '—'})`);
  } else {
    lines.push(`- Odd: ${bot.botBetOddType ?? '—'} (${bot.botBetOddMax ?? bot.targetOdd ?? '—'})`);
  }
  lines.push(`- Stake: ${bot.botBetStake ?? bot.stakeSuggested ?? '—'}`);
  lines.push(`- Gols máx antes da entrada: ${bot.goalsMaxBeforeEntry ?? '—'}`);
  if (bot.botBetTicksMode || bot.botBetMaxGapTicks || bot.botBetMinLiquidity || bot.botBetMaxLiquidity) {
    lines.push(
      `- Avançado: ${bot.botBetTicksMode ?? '—'} (${bot.botBetTicks ?? '—'}) • gap máx ticks ${bot.botBetMaxGapTicks ?? '—'} • liquidez ${bot.botBetMinLiquidity ?? '—'} a ${bot.botBetMaxLiquidity ?? '—'}`,
    );
  }
  lines.push('');
  if (Array.isArray(bot.botBetGoalsConditions) && bot.botBetGoalsConditions.length > 0) {
    lines.push('Página 2 • Condição de gols:');
    for (const g of bot.botBetGoalsConditions) {
      lines.push(`- ${g.scope} • ${g.period} • ${g.mode} • ${g.operator} • ${g.value}`);
    }
    lines.push('');
  }
  if (Array.isArray(bot.botBetOddsConditions) && bot.botBetOddsConditions.length > 0) {
    lines.push('Página 2 • Condições das odds:');
    for (const o of bot.botBetOddsConditions) {
      lines.push(`- ${o.stage} • ${o.oddField} • ${o.mode} • ${o.operator} • ${o.value}`);
    }
    lines.push('');
  }
  if (Array.isArray(bot.botBetPreLiveStatsConditions) && bot.botBetPreLiveStatsConditions.length > 0) {
    lines.push('Página 2 • Estatísticas pré-live:');
    for (const st of bot.botBetPreLiveStatsConditions) {
      lines.push(`- ${st.stat} • ${st.mode} • ${st.operator} • ${st.value}`);
    }
    lines.push('');
  }
  if (Array.isArray(bot.botBetLiveBehaviorConditions) && bot.botBetLiveBehaviorConditions.length > 0) {
    lines.push('Página 2 • Comportamento ao vivo:');
    for (const b of bot.botBetLiveBehaviorConditions) {
      lines.push(`- ${b.behavior} • ${b.mode} • ${b.operator} • ${b.value}`);
    }
    lines.push('');
  }
  if (Array.isArray(bot.botBetExitBlocks) && bot.botBetExitBlocks.length > 0) {
    lines.push('Condições de saída:');
    for (const ex of bot.botBetExitBlocks) {
      const params = ex.params ? ` • ${Object.entries(ex.params).map(([k, v]) => `${k}: ${v}`).join(' | ')}` : '';
      lines.push(`- ${ex.name} • ${ex.exitType} • ${ex.exitForm}${params}`);
    }
    lines.push('');
  }
  if (typeof targetAccuracy === 'number') {
    lines.push(`Meta de assertividade: ${targetAccuracy}%`);
    lines.push('Observação: a meta depende de backtest/validação no botBet (amostra, ligas e janela).');
    lines.push('');
  }
  if (bot.oddsConditions.length > 0) {
    lines.push('Condições de odds:');
    for (const c of bot.oddsConditions) lines.push(`- ${c}`);
    lines.push('');
  }
  if (bot.preLiveStatsConditions.length > 0) {
    lines.push('Pré-live:');
    for (const c of bot.preLiveStatsConditions) lines.push(`- ${c}`);
    lines.push('');
  }
  if (bot.liveBehaviorConditions.length > 0) {
    lines.push('Ao vivo:');
    for (const c of bot.liveBehaviorConditions) lines.push(`- ${c}`);
    lines.push('');
  }
  if (bot.exitConditions.length > 0) {
    lines.push('Saídas:');
    for (const c of bot.exitConditions) lines.push(`- ${c}`);
    lines.push('');
  }
  if (Array.isArray(s.notes) && s.notes.length > 0) {
    lines.push('Notas:');
    for (const n of s.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push('Quando você rodar no botBet e trouxer os resultados aqui, envie: liga(s), período, nº de jogos e % de acerto + ROI.');
  return lines.join('\n');
};

const normalizeProviderLabel = (p: string) => {
  if (p === 'deepseek') return 'DeepSeek';
  if (p === 'google') return 'Gemini';
  if (p === 'openai') return 'ChatGPT';
  if (p === 'anthropic') return 'Claude';
  return 'Local';
};

const extractFirstJsonBlock = (text: string): any | null => {
  const t = String(text ?? '');
  const fenced = t.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : null;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = t.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
  return null;
};

const mapEntryMarket = (v: any): BotEntryMarket | null => {
  const s = String(v ?? '').trim().toLowerCase();
  const direct = [
    'over_0_5',
    'over_1_5',
    'over_2_5',
    'under_2_5',
    'under_3_5',
    'btts_yes',
    'btts_no',
    'lay_home',
    'lay_away',
    'lay_draw',
  ] as const;
  if ((direct as readonly string[]).includes(s)) return s as BotEntryMarket;
  if (s.includes('over 0.5') || s.includes('mais de 0.5')) return 'over_0_5';
  if (s.includes('over 1.5') || s.includes('mais de 1.5')) return 'over_1_5';
  if (s.includes('over 2.5') || s.includes('mais de 2.5')) return 'over_2_5';
  if (s.includes('under 2.5') || s.includes('menos de 2.5')) return 'under_2_5';
  if (s.includes('under 3.5') || s.includes('menos de 3.5')) return 'under_3_5';
  if (s.includes('ambos') && (s.includes('sim') || s.includes('yes'))) return 'btts_yes';
  if (s.includes('ambos') && (s.includes('não') || s.includes('nao') || s.includes('no'))) return 'btts_no';
  if (s.includes('lay') && s.includes('casa')) return 'lay_home';
  if (s.includes('lay') && (s.includes('fora') || s.includes('away'))) return 'lay_away';
  if (s.includes('lay') && s.includes('empate')) return 'lay_draw';
  return null;
};

const applyBotPatch = (base: BotDraftV1, patch: any): BotDraftV1 => {
  if (!patch || typeof patch !== 'object') return base;
  const next: BotDraftV1 = { ...base, updatedAt: nowIso() };
  if (typeof patch.name === 'string') next.name = patch.name;
  if (typeof patch.description === 'string') next.description = patch.description;
  if (patch.entryWindowMin !== undefined) {
    const n = Number(patch.entryWindowMin);
    if (Number.isFinite(n)) next.entryWindowMin = Math.max(0, Math.floor(n));
  }
  if (patch.targetOdd !== undefined) {
    const n = Number(patch.targetOdd);
    next.targetOdd = Number.isFinite(n) ? n : base.targetOdd;
  }
  if (patch.stakeSuggested !== undefined) {
    const n = Number(patch.stakeSuggested);
    next.stakeSuggested = Number.isFinite(n) ? n : base.stakeSuggested;
  }
  if (patch.goalsMaxBeforeEntry !== undefined) {
    const n = Number(patch.goalsMaxBeforeEntry);
    next.goalsMaxBeforeEntry = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : base.goalsMaxBeforeEntry;
  }
  const mapped = mapEntryMarket(patch.entryMarket);
  if (mapped) next.entryMarket = mapped;
  if (typeof patch.botBetTimeType === 'string') next.botBetTimeType = patch.botBetTimeType as any;
  if (patch.botBetMinute !== undefined) {
    const n = Number(patch.botBetMinute);
    next.botBetMinute = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }
  if (patch.botBetMinuteFrom !== undefined) {
    const n = Number(patch.botBetMinuteFrom);
    next.botBetMinuteFrom = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }
  if (patch.botBetMinuteTo !== undefined) {
    const n = Number(patch.botBetMinuteTo);
    next.botBetMinuteTo = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }
  if (typeof patch.botBetEntryType === 'string') next.botBetEntryType = patch.botBetEntryType as any;
  if (typeof patch.botBetMarket === 'string') next.botBetMarket = patch.botBetMarket;
  if (typeof patch.botBetOddType === 'string') next.botBetOddType = patch.botBetOddType as any;
  if (patch.botBetOddMin !== undefined) {
    const n = Number(patch.botBetOddMin);
    next.botBetOddMin = Number.isFinite(n) ? n : null;
  }
  if (patch.botBetOddMax !== undefined) {
    const n = Number(patch.botBetOddMax);
    next.botBetOddMax = Number.isFinite(n) ? n : null;
  }
  if (patch.botBetStake !== undefined) {
    const n = Number(patch.botBetStake);
    next.botBetStake = Number.isFinite(n) ? n : null;
  }
  if (typeof patch.botBetTicksMode === 'string') next.botBetTicksMode = patch.botBetTicksMode as any;
  if (patch.botBetTicks !== undefined) {
    const n = Number(patch.botBetTicks);
    next.botBetTicks = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }
  if (patch.botBetMaxGapTicks !== undefined) {
    const n = Number(patch.botBetMaxGapTicks);
    next.botBetMaxGapTicks = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
  }
  if (patch.botBetMinLiquidity !== undefined) {
    const n = Number(patch.botBetMinLiquidity);
    next.botBetMinLiquidity = Number.isFinite(n) ? n : null;
  }
  if (patch.botBetMaxLiquidity !== undefined) {
    const n = Number(patch.botBetMaxLiquidity);
    next.botBetMaxLiquidity = Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(patch.botBetGoalsConditions)) {
    next.botBetGoalsConditions = patch.botBetGoalsConditions
      .map((x: any) => ({
        scope: String(x?.scope ?? 'Total') as any,
        period: String(x?.period ?? 'Jogo todo') as any,
        mode: 'Fixo' as const,
        operator: String(x?.operator ?? 'Menor ou igual a') as any,
        value: Number(x?.value),
      }))
      .filter((x: any) => Number.isFinite(x.value));
  }
  if (Array.isArray(patch.botBetOddsConditions)) {
    next.botBetOddsConditions = patch.botBetOddsConditions
      .map((x: any) => ({
        stage: String(x?.stage ?? 'Pré-live') as any,
        oddField: String(x?.oddField ?? ''),
        mode: 'Fixo' as const,
        operator: String(x?.operator ?? 'Menor ou igual a') as any,
        value: Number(x?.value),
      }))
      .filter((x: any) => x.oddField && Number.isFinite(x.value));
  }
  if (Array.isArray(patch.botBetPreLiveStatsConditions)) {
    next.botBetPreLiveStatsConditions = patch.botBetPreLiveStatsConditions
      .map((x: any) => ({
        stat: String(x?.stat ?? ''),
        mode: 'Fixo' as const,
        operator: String(x?.operator ?? 'Maior ou igual a') as any,
        value: Number(x?.value),
      }))
      .filter((x: any) => x.stat && Number.isFinite(x.value));
  }
  if (Array.isArray(patch.botBetLiveBehaviorConditions)) {
    next.botBetLiveBehaviorConditions = patch.botBetLiveBehaviorConditions
      .map((x: any) => ({
        behavior: String(x?.behavior ?? ''),
        mode: 'Fixo' as const,
        operator: String(x?.operator ?? 'Maior ou igual a') as any,
        value: Number(x?.value),
      }))
      .filter((x: any) => x.behavior && Number.isFinite(x.value));
  }
  if (Array.isArray(patch.botBetExitBlocks)) {
    next.botBetExitBlocks = patch.botBetExitBlocks
      .map((x: any) => ({
        name: String(x?.name ?? '').trim() || 'Bloco',
        exitType: String(x?.exitType ?? 'Stop loss') as any,
        exitForm: String(x?.exitForm ?? 'Hedge') as any,
        params: x?.params && typeof x.params === 'object' ? x.params : undefined,
      }))
      .slice(0, 5);
  }
  if (Array.isArray(patch.oddsConditions)) next.oddsConditions = patch.oddsConditions.map((x: any) => String(x)).filter(Boolean);
  if (Array.isArray(patch.preLiveStatsConditions))
    next.preLiveStatsConditions = patch.preLiveStatsConditions.map((x: any) => String(x)).filter(Boolean);
  if (Array.isArray(patch.liveBehaviorConditions))
    next.liveBehaviorConditions = patch.liveBehaviorConditions.map((x: any) => String(x)).filter(Boolean);
  if (Array.isArray(patch.exitConditions)) next.exitConditions = patch.exitConditions.map((x: any) => String(x)).filter(Boolean);
  return next;
};

const buildBotsSystemPrompt = (goal: number | null) => {
  const g = typeof goal === 'number' ? `Meta de assertividade desejada: ${goal}%.` : '';
  return [
    'Você é um especialista em trade esportivo e automação de entradas (futebol).',
    'Tarefa: sugerir a configuração de um bot para o botBet com foco em consistência e controle de risco.',
    g,
    'Responda sempre em pt-BR.',
    'Saída obrigatória:',
    '1) Um bloco ```json``` contendo { "botConfig": { ... } } com os campos abaixo (use apenas quando tiver confiança):',
    '- name, description',
    '- botBetTimeType (opções: "Antes do minuto (no live)" | "Depois do minuto (no live)" | "Entre dois minutos (no live)")',
    '- botBetMinute (quando for antes/depois) OU botBetMinuteFrom/botBetMinuteTo (quando for entre dois minutos)',
    '- botBetEntryType (opções: "Back" | "Lay")',
    '- botBetMarket (use nomes exatamente como no botBet, ex: "Mais de 2.5 FT", "Menos de 1.5 HT", "Ambas Marcam Sim", "Placar Exato 1-0", "Resultado Final Casa FT")',
    '- botBetOddType (opções: "Odds até" | "Odds acima de" | "Entre duas odds")',
    '- botBetOddMin/botBetOddMax conforme o tipo de odd',
    '- botBetStake',
    '- botBetTicksMode (opções: "Forçar ticks" | "Propor ticks"), botBetTicks, botBetMaxGapTicks, botBetMinLiquidity, botBetMaxLiquidity',
    '- botBetGoalsConditions[] (cada item: { scope: "Total"|"Casa"|"Visitante", period: "Jogo todo"|"1º tempo"|"2º tempo", mode: "Fixo", operator: "Igual a"|"Menor ou igual a"|"Maior ou igual a", value: number })',
    '- botBetOddsConditions[] (cada item: { stage: "Pré-live"|"Live", oddField: string, mode: "Fixo", operator: "Igual a"|"Menor ou igual a"|"Maior ou igual a", value: number })',
    '- botBetPreLiveStatsConditions[] (cada item: { stat: string, mode: "Fixo", operator: "Igual a"|"Menor ou igual a"|"Maior ou igual a", value: number })',
    '- botBetLiveBehaviorConditions[] (cada item: { behavior: string, mode: "Fixo", operator: "Igual a"|"Menor ou igual a"|"Maior ou igual a", value: number })',
    '- botBetExitBlocks[] (cada item: { name: string, exitType: "Gols a favor"|"Gols contra"|"Tempo"|"Tempo de exposição"|"Stop win"|"Stop loss"|"Avançado", exitForm: "Hedge"|"Freebet", params?: object })',
    'Opcional (quando o usuário anexar prints de resumo/resultado do botBet): inclua também "botBetObserved" no JSON com o que conseguir extrair:',
    '- botBetObserved: { base, entries, greens, reds, hitRate, avgOdd, profit, includedCount, excludedCount }',
    '- oddsConditions[], preLiveStatsConditions[], liveBehaviorConditions[], exitConditions[]',
    '2) Depois do JSON, uma explicação curta com rationale e uma checklist de validação no botBet.',
    'Não invente resultados; proponha como validar e como ajustar quando a performance real não bater a meta.',
    '',
    'Observação importante sobre oddField:',
    '- Use exatamente os nomes do botBet, exemplos: "Back match odds casa", "Back under 2.5 gols", "Back over primeiro tempo 1.5 gols", "Back ambos marcam sim", "Back dupla chance casa ou empate", "Back placar exato 1x0".',
    '- Para bots do tipo Lay, use os mesmos padrões com prefixo "Lay ..." (ex: "Lay match odds casa", "Lay under 2.5 gols", "Lay placar exato 0x0").',
    '',
    'Observação importante sobre estatísticas pré-live (stat):',
    '- Use exatamente os nomes do botBet, exemplos: "[pre-live ult. 10 jogos] casa - jogando casa/fora - número de vitórias",',
    '  "[pre-live ult. 10 jogos] visitante - jogando casa/fora - jogos acima de 2.5 gols tempo total %",',
    '  "[pre-live ult. 10 jogos] casa - jogando casa/fora - média de gols esperados (xg)",',
    '  "[pre-live ult. 10 jogos] casa - jogando casa/fora - gols marcados 0-15 min %",',
    '  "[pre-live ult. 10 jogos] casa - jogando casa/fora - marcou primeiro gol no 1º tempo e venceu %",',
    '  "[pre-live ult. 10 jogos] casa - jogando casa/fora - placar correto ft 1x0 %".',
    '  Também existem variações "jogando casa" e "jogando fora" (use conforme o time).',
    '',
    'Observação importante sobre comportamento live (behavior):',
    '- Use exatamente os nomes do botBet, exemplos: "Detalhes gerais - posição tabela casa", "Detalhes gerais - posição tabela visitante", "Detalhes gerais - posição tabela diferença",',
    '  "Estatísticas - posse de bola casa", "Estatísticas - ataques perigosos visitante", "Estatísticas - total de chutes casa", "Estatísticas - escanteios visitante",',
    '  "Estatísticas - chutes dentro da área casa", "Estatísticas - chutes bloqueados visitante", "Estatísticas - grandes chances perdidas casa",',
    '  e também versões "Estatísticas 1º tempo - ..." quando quiser filtrar pelo 1º tempo.',
    '',
    'Observação importante sobre condições de saída (exit blocks):',
    '- Um bot pode ter até 5 blocos.',
    '- Campos: name, exitType (Gols a favor | Gols contra | Tempo | Tempo de exposição | Stop win | Stop loss | Avançado) e exitForm (Hedge | Freebet).',
  ]
    .filter(Boolean)
    .join('\n');
};

const callExternalBotsAssistant = async (args: {
  provider: 'deepseek' | 'openai' | 'anthropic' | 'google';
  apiKey: string;
  model: string;
  system: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userText: string;
  images?: Array<{ mime: string; base64: string }>;
}) => {
  const { projectId, publicAnonKey } = await import('/utils/supabase/info');
  const baseUrl = `https://${projectId}.supabase.co/functions/v1/make-server-1119702f`;
  const timeoutMs = 45_000;
  const fetchWithTimeout = async (input: string, init: RequestInit) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (e) {
      const name = String((e as any)?.name ?? '');
      if (name === 'AbortError') {
        throw new Error('Timeout ao aguardar resposta da IA externa (45s).');
      }
      throw e;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const images = Array.isArray(args.images) ? args.images.filter((x) => x?.mime && x?.base64).slice(0, 4) : [];

  if (args.provider === 'anthropic') {
    const url = 'https://api.anthropic.com/v1/messages';
    const userContent =
      images.length > 0
        ? [
            { type: 'text', text: args.userText },
            ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } })),
          ]
        : args.userText;
    const body = {
      model: args.model,
      max_tokens: 900,
      system: args.system,
      messages: [
        ...args.history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userContent },
      ],
    };

    const res = await fetchWithTimeout(`${baseUrl}/proxy/anthropic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({ url, apiKey: args.apiKey, body }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Falha Anthropic: ${res.status} ${res.statusText}${t ? ` - ${t}` : ''}`);
    }
    const data = (await res.json().catch(() => null)) as any;
    const parts = Array.isArray(data?.content) ? data.content : [];
    const text = parts.map((p: any) => (p?.type === 'text' ? String(p.text ?? '') : '')).join('\n').trim();
    if (!text) throw new Error('Resposta vazia da Anthropic');
    return text;
  }

  if (args.provider === 'google') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`;
    const contents = [
      ...args.history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [
          { text: args.userText },
          ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
        ],
      },
    ];

    const body = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents,
      generationConfig: { temperature: 0.25 },
    };

    const res = await fetchWithTimeout(`${baseUrl}/proxy/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publicAnonKey}`,
      },
      body: JSON.stringify({ url, apiKey: args.apiKey, body }),
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          'Proxy Google (Gemini/Gemma) não encontrado no Supabase (404). Isso normalmente significa que a Edge Function ainda não foi atualizada/deployada com o endpoint /proxy/google.',
        );
      }
      const t = await res.text().catch(() => '');
      throw new Error(`Falha Gemini: ${res.status} ${res.statusText}${t ? ` - ${t}` : ''}`);
    }
    const data = (await res.json().catch(() => null)) as any;
    const parts = Array.isArray(data?.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts : [];
    const text = parts.map((p: any) => String(p?.text ?? '')).join('\n').trim();
    if (!text) throw new Error('Resposta vazia do Gemini');
    return text;
  }

  if (args.provider === 'deepseek' && images.length > 0) {
    throw new Error('O provedor DeepSeek configurado não suporta leitura de imagens. Troque para ChatGPT (OpenAI) ou Claude (Anthropic).');
  }

  const url = args.provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.deepseek.com/v1/chat/completions';
  const userContent =
    images.length > 0
      ? [
          { type: 'text', text: args.userText },
          ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
        ]
      : args.userText;
  const body = {
    model: args.model,
    temperature: 0.25,
    messages: [
      { role: 'system', content: args.system },
      ...args.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userContent },
    ],
  };

  const endpoint = args.provider === 'openai' ? `${baseUrl}/proxy/openai` : `${baseUrl}/proxy/deepseek`;
  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publicAnonKey}`,
    },
    body: JSON.stringify({ url, apiKey: args.apiKey, body }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Falha ${args.provider}: ${res.status} ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  const data = (await res.json().catch(() => null)) as any;
  const text = String(data?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error(`Resposta vazia de ${args.provider}`);
  return text;
};

export default function BotsPage() {
  const [tab, setTab] = useState<'assistant' | 'mybots'>('assistant');
  const [draft, setDraft] = useState<BotDraftV1>(() => createEmptyBot());
  const [botsTick, setBotsTick] = useState(0);
  const bots = useMemo(() => {
    void botsTick;
    return readBotsStore().items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [botsTick]);

  const [targetAccuracy, setTargetAccuracy] = useState('70');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => readBotsChat().messages);
  const [lastSuggestion, setLastSuggestion] = useState<BotSuggestion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [llmTick, setLlmTick] = useState(0);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [leaguesQuery, setLeaguesQuery] = useState('');
  const [leaguesResults, setLeaguesResults] = useState<ApiFootballLeague[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState('');
  const [includedFilter, setIncludedFilter] = useState('');
  const [excludedFilter, setExcludedFilter] = useState('');

  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState('');
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simTick, setSimTick] = useState(0);

  const addPendingFiles = async (files: File[]) => {
    const allowed = files.filter((f) => f && f.type && f.type.startsWith('image/'));
    if (allowed.length === 0) return;

    const maxFiles = 4;
    const maxBytes = 2_200_000;
    const nextNew: PendingImage[] = [];
    for (const f of allowed) {
      if (nextNew.length >= maxFiles) break;
      if (f.size > maxBytes) {
        toast.error(`Imagem muito grande: ${f.name} (máx ~2MB)`);
        continue;
      }
      try {
        const { mime, base64 } = await fileToBase64(f);
        nextNew.push({
          id: `img_${Math.random().toString(16).slice(2)}_${Date.now()}`,
          name: f.name || 'print',
          mime,
          base64,
          size: f.size,
        });
      } catch {
        toast.error(`Não foi possível ler a imagem: ${f.name}`);
      }
    }
    setPendingImages((prev) => {
      const current = Array.isArray(prev) ? prev.slice(0, maxFiles) : [];
      return [...current, ...nextNew].slice(0, maxFiles);
    });
  };

  useEffect(() => {
    writeBotsChat({ version: 1, messages });
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const onCfg = () => setLlmTick((v) => v + 1);
    window.addEventListener('apiConfigChanged', onCfg);
    return () => window.removeEventListener('apiConfigChanged', onCfg);
  }, []);

  useEffect(() => {
    const onSim = () => setSimTick((v) => v + 1);
    window.addEventListener('apiConfigChanged', onSim);
    return () => window.removeEventListener('apiConfigChanged', onSim);
  }, []);

  const llm = useMemo(() => {
    void llmTick;
    const cfg = loadApiConfig();
    const enabled = Boolean(cfg?.llmEnabled) && cfg?.llmProvider && cfg.llmProvider !== 'none';
    const provider = (cfg?.llmProvider ?? 'none') as any;
    const model =
      provider === 'deepseek'
        ? String(cfg?.deepseekModel ?? 'deepseek-chat')
        : provider === 'google'
          ? String(cfg?.googleModel ?? 'gemma-4-26b-a4b-it')
        : provider === 'openai'
          ? String(cfg?.openaiModel ?? 'gpt-4o-mini')
          : provider === 'anthropic'
            ? String(cfg?.anthropicModel ?? 'claude-3-5-sonnet-latest')
            : '';
    const apiKey =
      provider === 'deepseek'
        ? String(cfg?.deepseekApiKey ?? '')
        : provider === 'google'
          ? String(cfg?.googleApiKey ?? '')
        : provider === 'openai'
          ? String(cfg?.openaiApiKey ?? '')
          : provider === 'anthropic'
            ? String(cfg?.anthropicApiKey ?? '')
            : '';
    const ready = enabled && Boolean(apiKey.trim()) && Boolean(model.trim());
    return { enabled, provider, model, apiKey, ready } as const;
  }, [llmTick]);

  const apiFootballKey = useMemo(() => {
    void llmTick;
    const cfg = loadApiConfig();
    return String(cfg?.apiFootballKey ?? '').trim();
  }, [llmTick]);

  const includedLeagues = useMemo(() => getIncludedLeagues(draft), [draft]);
  const excludedLeagueIds = useMemo(() => getExcludedLeagueIds(draft), [draft]);

  const filteredIncludedLeagues = useMemo(() => {
    const q = includedFilter.trim().toLowerCase();
    const items = includedLeagues.filter((l) => !excludedLeagueIds.has(l.id));
    if (!q) return items;
    return items.filter((l) => `${l.name} ${l.country} ${l.id}`.toLowerCase().includes(q));
  }, [excludedLeagueIds, includedFilter, includedLeagues]);

  const filteredExcludedLeagues = useMemo(() => {
    const q = excludedFilter.trim().toLowerCase();
    const ex = Array.isArray(draft.botBetExcludedLeagues) ? draft.botBetExcludedLeagues : [];
    const items = uniqById(ex);
    if (!q) return items;
    return items.filter((l) => `${l.name} ${l.country} ${l.id}`.toLowerCase().includes(q));
  }, [draft.botBetExcludedLeagues, excludedFilter]);

  const leagueToSimple = (l: ApiFootballLeague) => ({
    id: Number(l.id),
    name: String(l.name ?? '—'),
    country: String(l.country ?? '—'),
    type: String(l.type ?? '—'),
    season: Number(l.season ?? new Date().getFullYear()),
  });

  const addIncludedLeague = (l: ApiFootballLeague) => {
    const item = leagueToSimple(l);
    if (!Number.isFinite(item.id)) return;
    setDraft((prev) => {
      const inc = Array.isArray(prev.botBetIncludedLeagues) ? prev.botBetIncludedLeagues : [];
      const ex = Array.isArray(prev.botBetExcludedLeagues) ? prev.botBetExcludedLeagues : [];
      return {
        ...prev,
        updatedAt: nowIso(),
        botBetIncludedLeagues: uniqById([...inc, item]),
        botBetExcludedLeagues: ex.filter((x) => Number((x as any)?.id) !== item.id),
      };
    });
  };

  const addExcludedLeague = (l: ApiFootballLeague) => {
    const item = leagueToSimple(l);
    if (!Number.isFinite(item.id)) return;
    setDraft((prev) => {
      const inc = Array.isArray(prev.botBetIncludedLeagues) ? prev.botBetIncludedLeagues : [];
      const ex = Array.isArray(prev.botBetExcludedLeagues) ? prev.botBetExcludedLeagues : [];
      return {
        ...prev,
        updatedAt: nowIso(),
        botBetIncludedLeagues: inc.filter((x) => Number((x as any)?.id) !== item.id),
        botBetExcludedLeagues: uniqById([...ex, item]),
      };
    });
  };

  const removeIncludedLeague = (id: number) => {
    setDraft((prev) => {
      const inc = Array.isArray(prev.botBetIncludedLeagues) ? prev.botBetIncludedLeagues : [];
      return { ...prev, updatedAt: nowIso(), botBetIncludedLeagues: inc.filter((x) => Number((x as any)?.id) !== id) };
    });
  };

  const removeExcludedLeague = (id: number) => {
    setDraft((prev) => {
      const ex = Array.isArray(prev.botBetExcludedLeagues) ? prev.botBetExcludedLeagues : [];
      return { ...prev, updatedAt: nowIso(), botBetExcludedLeagues: ex.filter((x) => Number((x as any)?.id) !== id) };
    });
  };

  const includePromisingLeagues = () => {
    if (!simResult) {
      toast.error('Rode a simulação para identificar torneios promissores');
      return;
    }
    const goal = Number(String(targetAccuracy ?? '').replace(',', '.'));
    const threshold = Number.isFinite(goal) ? Math.max(0, Math.min(100, goal)) : 70;
    const promising = simResult.byLeague
      .filter((x) => x.totals.entries >= 20 && x.totals.hitRate >= threshold && x.totals.profit >= 0)
      .slice(0, 60)
      .map((x) => ({
        id: x.leagueId,
        name: x.leagueName,
        country: x.country,
        type: 'League',
        season: x.season,
      }));

    setDraft((prev) => {
      const inc = Array.isArray(prev.botBetIncludedLeagues) ? prev.botBetIncludedLeagues : [];
      const ex = Array.isArray(prev.botBetExcludedLeagues) ? prev.botBetExcludedLeagues : [];
      const nextInc = uniqById([...inc, ...promising]).slice(0, 250);
      const nextEx = ex.filter((l) => !nextInc.some((x) => x.id === (l as any).id));
      return { ...prev, updatedAt: nowIso(), botBetIncludedLeagues: nextInc, botBetExcludedLeagues: nextEx };
    });
    toast.success('Torneios promissores incluídos');
  };

  const excludeNonPromisingLeagues = () => {
    if (!simResult) {
      toast.error('Rode a simulação para identificar torneios não promissores');
      return;
    }
    const goal = Number(String(targetAccuracy ?? '').replace(',', '.'));
    const threshold = Number.isFinite(goal) ? Math.max(0, Math.min(100, goal)) : 70;
    const cut = Math.max(0, threshold - 5);
    const bad = simResult.byLeague
      .filter((x) => x.totals.entries >= 20 && x.totals.hitRate < cut)
      .slice(0, 120)
      .map((x) => ({
        id: x.leagueId,
        name: x.leagueName,
        country: x.country,
        type: 'League',
        season: x.season,
      }));

    setDraft((prev) => {
      const inc = Array.isArray(prev.botBetIncludedLeagues) ? prev.botBetIncludedLeagues : [];
      const ex = Array.isArray(prev.botBetExcludedLeagues) ? prev.botBetExcludedLeagues : [];
      const nextEx = uniqById([...ex, ...bad]).slice(0, 500);
      const nextInc = inc.filter((l) => !nextEx.some((x) => x.id === (l as any).id));
      return { ...prev, updatedAt: nowIso(), botBetExcludedLeagues: nextEx, botBetIncludedLeagues: nextInc };
    });
    toast.success('Torneios não promissores excluídos');
  };

  useEffect(() => {
    const q = leaguesQuery.trim();
    if (q.length < 2) {
      setLeaguesResults([]);
      setLeaguesError('');
      return;
    }
    if (!apiFootballKey) {
      setLeaguesResults([]);
      setLeaguesError('Configure a API-Football em Configurações para buscar torneios.');
      return;
    }

    const controller = new AbortController();
    const t = setTimeout(() => {
      (async () => {
        setLeaguesLoading(true);
        setLeaguesError('');
        try {
          const service = new ApiFootballService(apiFootballKey);
          const items = await service.getLeaguesCatalog({ search: q, current: true, maxPages: 4 });
          if (controller.signal.aborted) return;
          setLeaguesResults(Array.isArray(items) ? items.slice(0, 60) : []);
        } catch (e) {
          if (controller.signal.aborted) return;
          setLeaguesResults([]);
          setLeaguesError(e instanceof Error ? e.message : 'Erro ao buscar torneios');
        } finally {
          if (!controller.signal.aborted) setLeaguesLoading(false);
        }
      })();
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [apiFootballKey, leaguesQuery]);

  const runSimulation = async () => {
    if (!apiFootballKey) {
      setSimResult(null);
      setSimError('Configure a API-Football em Configurações para simular.');
      return;
    }
    const allIncluded = includedLeagues.filter((l) => !excludedLeagueIds.has(l.id));
    if (allIncluded.length === 0) {
      setSimResult(null);
      setSimError('');
      return;
    }

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 11);
    const from = getYmd(fromDate);
    const to = getYmd(toDate);

    const leaguesToSim = allIncluded.slice(0, 6);
    setSimLoading(true);
    setSimError('');
    try {
      const service = new ApiFootballService(apiFootballKey);
      const odd = assumedOdd(draft);
      const stake = assumedStake(draft);
      const entryType = (draft.botBetEntryType ?? 'Back') as BotBetEntryType;
      const market = String(draft.botBetMarket ?? '').trim();

      const byLeagueMap = new Map<number, { leagueId: number; leagueName: string; country: string; season: number; base: number; entries: number; greens: number; reds: number; profit: number }>();
      let base = 0;
      let entries = 0;
      let greens = 0;
      let reds = 0;
      let profit = 0;

      const toYear = new Date().getFullYear();
      const seasons = Array.from(new Set([toYear, toYear - 1]));

      for (const league of leaguesToSim) {
        const leagueId = Number(league.id);
        if (!Number.isFinite(leagueId)) continue;

        const fixtures: ApiFootballMatch[] = [];
        for (const season of seasons) {
          try {
            const items = await service.getFixtures({
              league: leagueId,
              season,
              from,
              to,
              timezone: TIME_ZONE,
              maxPages: 6,
            });
            fixtures.push(...(Array.isArray(items) ? items : []));
          } catch {}
        }

        const dedup = new Map<number, ApiFootballMatch>();
        for (const f of fixtures) {
          const id = Number(f?.fixture?.id);
          if (!Number.isFinite(id)) continue;
          if (!dedup.has(id)) dedup.set(id, f);
        }

        const finished = Array.from(dedup.values()).filter(isFinishedFixture);
        const leagueName = String(finished[0]?.league?.name ?? league.name ?? '—');
        const country = String(finished[0]?.league?.country ?? league.country ?? '—');
        const season = Number(finished[0]?.league?.season ?? league.season ?? toYear);

        const acc = byLeagueMap.get(leagueId) ?? { leagueId, leagueName, country, season, base: 0, entries: 0, greens: 0, reds: 0, profit: 0 };
        acc.base += finished.length;
        base += finished.length;

        for (const f of finished) {
          const out = evalBackOutcome(market, f);
          if (out === null) continue;
          const win = entryType === 'Lay' ? !out : out;
          acc.entries += 1;
          entries += 1;
          if (win) {
            acc.greens += 1;
            greens += 1;
            acc.profit += entryType === 'Lay' ? stake : stake * Math.max(0, odd - 1);
            profit += entryType === 'Lay' ? stake : stake * Math.max(0, odd - 1);
          } else {
            acc.reds += 1;
            reds += 1;
            acc.profit -= entryType === 'Lay' ? stake * Math.max(0, odd - 1) : stake;
            profit -= entryType === 'Lay' ? stake * Math.max(0, odd - 1) : stake;
          }
        }

        byLeagueMap.set(leagueId, acc);
      }

      const byLeague = Array.from(byLeagueMap.values())
        .map((x) => ({
          leagueId: x.leagueId,
          leagueName: x.leagueName,
          country: x.country,
          season: x.season,
          totals: makeTotals(x.base, x.entries, x.greens, x.reds, odd, x.profit),
        }))
        .sort((a, b) => b.totals.profit - a.totals.profit);

      const totals = makeTotals(base, entries, greens, reds, odd, profit);
      const note =
        'Simulação aproximada baseada em placar final/HT e odd assumida (não aplica filtros de odds/estatísticas live no histórico).';
      setSimResult({ totals, byLeague, meta: { from, to, leaguesSimulated: leaguesToSim.length, leaguesTotal: allIncluded.length, note } });
    } catch (e) {
      setSimResult(null);
      setSimError(e instanceof Error ? e.message : 'Erro ao simular');
    } finally {
      setSimLoading(false);
    }
  };

  useEffect(() => {
    void simTick;
    const t = setTimeout(() => void runSimulation(), 650);
    return () => clearTimeout(t);
  }, [
    draft.botBetEntryType,
    draft.botBetMarket,
    draft.botBetOddType,
    draft.botBetOddMin,
    draft.botBetOddMax,
    draft.botBetStake,
    draft.botBetIncludedLeagues,
    draft.botBetExcludedLeagues,
    draft.selectedLeagues,
    simTick,
  ]);

  const clearChat = () => {
    setMessages([]);
    setChatInput('');
    setLastSuggestion(null);
    setDraft(createEmptyBot());
    toast.success('Chat reiniciado');
  };

  const saveDraft = () => {
    const store = readBotsStore();
    const next = { ...draft, name: draft.name.trim() ? draft.name : `${marketLabel(draft.entryMarket)} • ${new Date().toLocaleDateString('pt-BR')}`, updatedAt: nowIso() };
    const idx = store.items.findIndex((b) => b.id === next.id);
    const items = idx >= 0 ? store.items.map((b, i) => (i === idx ? next : b)) : [next, ...store.items];
    writeBotsStore({ version: 1, items });
    setBotsTick((v) => v + 1);
    toast.success('Bot salvo');
  };

  const loadBot = (id: string) => {
    const b = readBotsStore().items.find((x) => x.id === id);
    if (!b) return;
    setDraft({ ...b });
    setTab('assistant');
    toast.success('Bot carregado no assistente');
  };

  const duplicateBot = (id: string) => {
    const b = readBotsStore().items.find((x) => x.id === id);
    if (!b) return;
    const copy = { ...b, id: `bot_${Math.random().toString(16).slice(2)}_${Date.now()}`, createdAt: nowIso(), updatedAt: nowIso(), name: `${b.name} (cópia)` };
    const store = readBotsStore();
    writeBotsStore({ version: 1, items: [copy, ...store.items] });
    setBotsTick((v) => v + 1);
    toast.success('Bot duplicado');
  };

  const deleteBot = (id: string) => {
    const store = readBotsStore();
    writeBotsStore({ version: 1, items: store.items.filter((b) => b.id !== id) });
    setBotsTick((v) => v + 1);
    toast.success('Bot removido');
  };

  const exportBot = async (id: string) => {
    const b = readBotsStore().items.find((x) => x.id === id);
    if (!b) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(b, null, 2));
      toast.success('Config do bot copiada (JSON)');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const exportCurrent = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
      toast.success('Config atual copiada (JSON)');
    } catch {
      toast.error('Não foi possível copiar');
    }
  };

  const sendToAssistant = async () => {
    const text = chatInput.trim();
    const images = pendingImages.slice(0, 4);
    const goal = Number(String(targetAccuracy ?? '').replace(',', '.'));
    const goalValue = Number.isFinite(goal) ? Math.max(0, Math.min(100, goal)) : null;
    if ((!text && images.length === 0) || thinking) return;

    const userMsg: ChatMessage = {
      id: `m_${Math.random().toString(16).slice(2)}_${Date.now()}`,
      role: 'user',
      text: clipText(`${text || 'Print(s) anexado(s)'}${images.length ? `\n\n[prints anexados: ${images.length}]` : ''}`, 8000),
      createdAt: nowIso(),
    };

    setMessages((prev) => [...prev, userMsg].slice(-200));
    setChatInput('');
    setPendingImages([]);
    setThinking(true);

    try {
      let nextBot = draft;
      let assistantText = '';

      if (llm.ready && (llm.provider === 'deepseek' || llm.provider === 'openai' || llm.provider === 'anthropic' || llm.provider === 'google')) {
        const system = buildBotsSystemPrompt(goalValue);
        const history = messages
          .slice(-8)
          .map((m) => ({ role: m.role, content: m.text }))
          .filter((m) => m.content.trim().length > 0);

        const userText = [
          'Contexto:',
          '- Este chat é para desenvolver/refinar bots para o botBet.',
          '- Você deve sugerir parâmetros e como validar (sem inventar resultados).',
          images.length > 0 ? `- O usuário anexou ${images.length} print(s) (imagens) com resumo/resultado do botBet. Faça OCR/leitura visual e extraia dados.` : null,
          images.length > 0
            ? '- Extraia também: Nome, Mercado, Aposta (Back/Lay), Odds entrada, Stake, Minutos de entrada, Estratégia; lista de condições; torneios incluídos/excluídos; e métricas (Base, Entradas, Greens, Reds, Taxa, Odd média, Lucro/Prejuízo).'
            : null,
          '',
          'Bot atual (JSON):',
          JSON.stringify(draft),
          '',
          'Mensagem do usuário:',
          text || '(somente prints)',
        ].join('\n');

        const external = await callExternalBotsAssistant({
          provider: llm.provider as any,
          apiKey: llm.apiKey,
          model: llm.model,
          system,
          history,
          userText,
          images: images.length > 0 ? images.map((i) => ({ mime: i.mime, base64: i.base64 })) : undefined,
        });

        assistantText = `[${normalizeProviderLabel(llm.provider)} • ${llm.model}]\n\n${external}`;

        const parsed = extractFirstJsonBlock(external);
        const botConfig = parsed?.botConfig ?? parsed?.config ?? parsed?.bot ?? null;
        if (botConfig) {
          nextBot = applyBotPatch(draft, botConfig);
        }

        appendExternalInsight({
          id: `ins_${Math.random().toString(16).slice(2)}_${Date.now()}`,
          provider: llm.provider as any,
          model: llm.model,
          prompt: text,
          response: external,
          createdAt: nowIso(),
          botId: nextBot.id,
        });

        setDraft(nextBot);
        setLastSuggestion(null);
      } else {
        if (images.length > 0) {
          const assistantMsg: ChatMessage = {
            id: `m_${Math.random().toString(16).slice(2)}_${Date.now() + 1}`,
            role: 'assistant',
            text: clipText(
              'Recebi os prints, mas para eu ler/analisar imagens aqui no chat você precisa ativar uma IA externa com visão (Configurações → IAs Externas): selecione ChatGPT (OpenAI) ou Claude (Anthropic).',
              24000,
            ),
            createdAt: nowIso(),
          };
          setMessages((prev) => [...prev, assistantMsg].slice(-200));
          return;
        }
        const s = buildSuggestion(text);
        nextBot = mergeBotWithSuggestion(draft, s, text);
        assistantText = formatAssistantReply(s, nextBot, goalValue);
        setDraft(nextBot);
        setLastSuggestion(s);
      }

      const assistantMsg: ChatMessage = {
        id: `m_${Math.random().toString(16).slice(2)}_${Date.now() + 1}`,
        role: 'assistant',
        text: clipText(assistantText, 24000),
        createdAt: nowIso(),
      };

      setMessages((prev) => [...prev, assistantMsg].slice(-200));
    } catch (e) {
      const s = buildSuggestion(text);
      const nextBot = mergeBotWithSuggestion(draft, s, text);
      setDraft(nextBot);
      setLastSuggestion(s);
      const errText = e instanceof Error ? e.message : 'Falha ao consultar IA externa';
      const assistantMsg: ChatMessage = {
        id: `m_${Math.random().toString(16).slice(2)}_${Date.now() + 1}`,
        role: 'assistant',
        text: clipText(
          `Falha ao usar IA externa. Fallback local aplicado.\n\nErro: ${errText}\n\n${formatAssistantReply(s, nextBot, goalValue)}`,
          24000,
        ),
        createdAt: nowIso(),
      };
      setMessages((prev) => [...prev, assistantMsg].slice(-200));
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Bot className="w-8 h-8 text-blue-700" />
              <h1 className="text-3xl font-bold text-gray-900">Bots</h1>
              <Badge variant="outline" className="tabular-nums">
                botBet
              </Badge>
            </div>
            <div className="mt-2 text-gray-600">
              Construa estratégias e parâmetros para automatizar entradas no trade de futebol.
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => window.open('https://beta.botbet.com/', '_blank', 'noopener,noreferrer')}
            className="shrink-0"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Abrir botBet
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="assistant">Assistente</TabsTrigger>
            <TabsTrigger value="mybots">Meus bots</TabsTrigger>
          </TabsList>

          <TabsContent value="assistant">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-purple-700" />
                    <div className="text-lg font-bold text-gray-900">Assistente de bots</div>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Converse com o assistente, teste no botBet e traga os resultados para refinarmos os parâmetros.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={clearChat}>
                    Reiniciar
                  </Button>
                  <Button variant="outline" onClick={() => void exportCurrent()}>
                    Copiar JSON
                  </Button>
                  <Button onClick={saveDraft} className="bg-blue-600 hover:bg-blue-700">
                    Salvar bot
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid lg:grid-cols-[1fr_380px] gap-5">
                <div className="border rounded-lg overflow-hidden bg-white flex flex-col">
                  <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm">Chat</div>
                      <Badge
                        variant="outline"
                        className={
                          llm.enabled
                            ? llm.ready
                              ? 'bg-green-100 text-green-800 border-green-300'
                              : 'bg-yellow-100 text-yellow-900 border-yellow-300'
                            : 'bg-gray-100 text-gray-800 border-gray-300'
                        }
                      >
                        IA: {llm.enabled ? `${normalizeProviderLabel(llm.provider)}${llm.ready ? '' : ' (configurar)'}` : 'Local'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-600">Meta (%)</div>
                      <Input
                        value={targetAccuracy}
                        onChange={(e) => setTargetAccuracy(e.target.value)}
                        className="h-8 w-20 tabular-nums"
                        placeholder="70"
                      />
                    </div>
                  </div>

                  <div className="p-3 space-y-3 max-h-[58vh] overflow-auto">
                    {messages.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        Descreva o bot e depois cole aqui os resultados do botBet para refinarmos.
                      </div>
                    ) : (
                      messages.map((m) => (
                        <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                          <div
                            className={
                              m.role === 'user'
                                ? 'max-w-[92%] rounded-2xl px-4 py-3 bg-blue-600 text-white whitespace-pre-wrap'
                                : 'max-w-[92%] rounded-2xl px-4 py-3 bg-gray-100 text-gray-900 whitespace-pre-wrap'
                            }
                          >
                            {m.text}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="p-3 border-t bg-white">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = '';
                        void addPendingFiles(files);
                      }}
                    />
                    {pendingImages.length > 0 ? (
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs text-gray-700">
                          <span className="font-semibold">Prints anexados:</span> {pendingImages.length} (não fica salvo)
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setPendingImages([])} className="h-8">
                          <X className="w-4 h-4 mr-2" />
                          Limpar
                        </Button>
                      </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                      <Button
                        variant="outline"
                        className="h-10 px-3"
                        disabled={thinking}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="w-4 h-4" />
                      </Button>
                      <Textarea
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ex: Quero um bot conservador para Under 2.5 em jogos equilibrados. Depois eu trago os resultados do botBet..."
                        className="min-h-16"
                        disabled={thinking}
                        onPaste={(e) => {
                          const items = Array.from(e.clipboardData?.items ?? []);
                          const files = items
                            .filter((it) => it.kind === 'file' && String(it.type ?? '').startsWith('image/'))
                            .map((it) => it.getAsFile())
                            .filter(Boolean) as File[];
                          if (files.length > 0) {
                            e.preventDefault();
                            void addPendingFiles(files);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendToAssistant();
                          }
                        }}
                      />
                      <Button
                        className="bg-purple-600 hover:bg-purple-700 h-10 px-3"
                        onClick={sendToAssistant}
                        disabled={thinking || (!chatInput.trim() && pendingImages.length === 0)}
                      >
                        {thinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900">Assistente Premium</div>
                        <div className="text-xs text-gray-600 mt-1">
                          Simulação em tempo real dos jogos nos últimos 11 meses (amostra) • {simResult ? `${simResult.meta.from} → ${simResult.meta.to}` : '—'}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void runSimulation()} disabled={simLoading}>
                        {simLoading ? 'Simulando…' : 'Atualizar'}
                      </Button>
                    </div>

                    {simError ? (
                      <div className="mt-3 p-3 rounded-lg border border-red-200 bg-red-50 text-red-900 text-sm">{simError}</div>
                    ) : null}

                    {simResult ? (
                      <div className="mt-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">BASE</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.base}</div>
                          </div>
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">ENTRADAS</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.entries}</div>
                          </div>
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">TAXA</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.hitRate}%</div>
                          </div>
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">GREENS</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.greens}</div>
                          </div>
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">REDS</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.reds}</div>
                          </div>
                          <div className="p-3 rounded-lg border bg-white">
                            <div className="text-[11px] text-gray-600">ODD MÉDIA</div>
                            <div className="text-lg font-bold text-gray-900 tabular-nums">{simResult.totals.avgOdd}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-gray-900">Lucro/Prejuízo</div>
                          <div className={`text-sm font-bold tabular-nums ${simResult.totals.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            R$ {simResult.totals.profit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-gray-600">
                          {simResult.meta.note} • Torneios simulados: {simResult.meta.leaguesSimulated}/{simResult.meta.leaguesTotal}
                        </div>

                        {simResult.byLeague.length > 0 ? (
                          <div className="mt-3">
                            <div className="text-xs font-semibold text-gray-700 mb-2">Por torneio</div>
                            <div className="border rounded-lg overflow-auto max-h-44 divide-y">
                              {simResult.byLeague.slice(0, 12).map((x) => (
                                <div key={x.leagueId} className="px-3 py-2 bg-white flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-900 truncate">{x.leagueName}</div>
                                    <div className="text-[11px] text-gray-600 truncate">{x.country} • {x.season} • entradas {x.totals.entries}</div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="text-xs font-bold text-gray-900 tabular-nums">{x.totals.hitRate}%</div>
                                    <div className={`text-xs font-bold tabular-nums ${x.totals.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                      R$ {x.totals.profit.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-gray-600">Selecione torneios para ver a simulação.</div>
                    )}
                  </Card>

                  <Card className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold text-gray-900">Bot atual</div>
                      <Badge variant="outline" className="tabular-nums">
                        {marketLabel(draft.entryMarket)}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="text-xs text-gray-600 mb-1">Nome</div>
                        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value, updatedAt: nowIso() })} />
                      </div>
                      <div>
                        <div className="text-xs text-gray-600 mb-1">Descrição</div>
                        <Textarea
                          value={draft.description}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value, updatedAt: nowIso() })}
                          className="min-h-20"
                        />
                      </div>
                      <div className="text-xs text-gray-600 tabular-nums">
                        Até {draft.entryWindowMin}min • Odd {draft.targetOdd ?? '—'} • Stake {draft.stakeSuggested ?? '—'} • Gols máx {draft.goalsMaxBeforeEntry ?? '—'}
                      </div>
                      {lastSuggestion ? (
                        <div className="text-xs text-gray-600">
                          Última sugestão: <span className="font-semibold text-gray-800">{lastSuggestion.title}</span>
                        </div>
                      ) : null}
                    </div>
                  </Card>

                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900">Seleção de torneios</div>
                        <div className="text-xs text-gray-600 mt-1">
                          Busque torneios da API-Football e defina incluídos/excluídos (atualiza a simulação).
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={includePromisingLeagues} disabled={!simResult || simLoading}>
                          Incluir Promissores
                        </Button>
                        <Button variant="outline" size="sm" onClick={excludeNonPromisingLeagues} disabled={!simResult || simLoading}>
                          Excluir Não Promissores
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3">
                      <Input
                        value={leaguesQuery}
                        onChange={(e) => setLeaguesQuery(e.target.value)}
                        placeholder="Buscar torneio por nome ou ID…"
                      />
                      {leaguesLoading ? <div className="text-xs text-gray-600 mt-2">Buscando…</div> : null}
                      {leaguesError ? (
                        <div className="mt-2 p-2 rounded-lg border border-red-200 bg-red-50 text-red-900 text-xs">{leaguesError}</div>
                      ) : null}

                      {leaguesResults.length > 0 ? (
                        <div className="mt-2 border rounded-lg overflow-auto max-h-44 divide-y">
                          {leaguesResults.map((l) => (
                            <div key={l.id} className="px-3 py-2 bg-white flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900 truncate">{l.name}</div>
                                <div className="text-[11px] text-gray-600 truncate">{l.country} • {l.type} • {l.season} • ID {l.id}</div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button variant="outline" size="sm" onClick={() => addIncludedLeague(l)}>
                                  Incluir
                                </Button>
                                <Button variant="outline" size="sm" className="text-red-700" onClick={() => addExcludedLeague(l)}>
                                  Excluir
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 grid md:grid-cols-2 gap-3">
                      <div className="border rounded-lg overflow-hidden bg-white">
                        <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between gap-2">
                          <div className="font-semibold text-gray-900 text-sm">Torneios incluídos</div>
                          <Badge variant="outline" className="tabular-nums">{filteredIncludedLeagues.length}</Badge>
                        </div>
                        <div className="p-3">
                          <Input value={includedFilter} onChange={(e) => setIncludedFilter(e.target.value)} placeholder="Filtrar…" />
                        </div>
                        <div className="max-h-56 overflow-auto divide-y">
                          {filteredIncludedLeagues.map((l) => (
                            <div key={l.id} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900 truncate">{l.name}</div>
                                <div className="text-[11px] text-gray-600 truncate">{l.country} • {l.season} • ID {l.id}</div>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => removeIncludedLeague(l.id)}>
                                Remover
                              </Button>
                            </div>
                          ))}
                          {filteredIncludedLeagues.length === 0 ? (
                            <div className="p-3 text-sm text-gray-600">Nenhum torneio incluído.</div>
                          ) : null}
                        </div>
                      </div>

                      <div className="border rounded-lg overflow-hidden bg-white">
                        <div className="px-3 py-2 bg-gray-50 border-b flex items-center justify-between gap-2">
                          <div className="font-semibold text-gray-900 text-sm">Torneios excluídos</div>
                          <Badge variant="outline" className="tabular-nums">{filteredExcludedLeagues.length}</Badge>
                        </div>
                        <div className="p-3">
                          <Input value={excludedFilter} onChange={(e) => setExcludedFilter(e.target.value)} placeholder="Filtrar…" />
                        </div>
                        <div className="max-h-56 overflow-auto divide-y">
                          {filteredExcludedLeagues.map((l) => (
                            <div key={l.id} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900 truncate">{l.name}</div>
                                <div className="text-[11px] text-gray-600 truncate">{l.country} • {l.season} • ID {l.id}</div>
                              </div>
                              <Button variant="outline" size="sm" className="text-red-700" onClick={() => removeExcludedLeague(l.id)}>
                                Remover
                              </Button>
                            </div>
                          ))}
                          {filteredExcludedLeagues.length === 0 ? (
                            <div className="p-3 text-sm text-gray-600">Nenhum torneio excluído.</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="mybots">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-bold text-gray-900">Meus bots</div>
                <Button variant="outline" onClick={() => setBotsTick((v) => v + 1)}>
                  Atualizar
                </Button>
              </div>

              <div className="mt-4 space-y-3">
                {bots.map((b) => (
                  <div key={b.id} className="p-4 bg-white border rounded-lg flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-gray-900 truncate">{b.name}</div>
                        <Badge variant="outline" className="tabular-nums">
                          {marketLabel(b.entryMarket)}
                        </Badge>
                        <Badge variant="outline" className="tabular-nums">
                          até {b.entryWindowMin}min
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-600 mt-1 line-clamp-2">{b.description || '—'}</div>
                      <div className="text-xs text-gray-500 mt-2 tabular-nums">
                        Atualizado em {new Date(b.updatedAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="sm" onClick={() => loadBot(b.id)}>
                            Abrir
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6}>
                          Carrega no assistente
                        </TooltipContent>
                      </Tooltip>
                      <Button variant="outline" size="sm" onClick={() => duplicateBot(b.id)}>
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => void exportBot(b.id)}>
                        JSON
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-700" onClick={() => deleteBot(b.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {bots.length === 0 ? <div className="text-sm text-gray-600">Nenhum bot salvo ainda.</div> : null}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
