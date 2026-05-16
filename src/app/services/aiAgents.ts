import { FootballMatch } from './footballDataService';

type TrainingSessionLite = {
  agentId: string;
  bestAccuracy: number;
  simulated?: boolean;
};

const loadTrainingSessionsSafe = (): TrainingSessionLite[] => {
  try {
    const raw = localStorage.getItem('training_sessions');
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s === 'object')
      .map((s) => ({
        agentId: String((s as any).agentId ?? ''),
        bestAccuracy: Number((s as any).bestAccuracy ?? 0),
        simulated: (s as any).simulated,
      }));
  } catch {
    return [];
  }
};

export interface AgentPrediction {
  agentName: string;
  agentType: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble' | 'goals' | 'btts' | 'correctscore';
  confidence: number;
  winner: 'home' | 'away' | 'draw';
  winnerConfidence: number;
  overUnder: {
    prediction: 'over' | 'under';
    line: number;
    confidence: number;
  };
  btts: {
    prediction: 'yes' | 'no';
    confidence: number;
  };
  correctScore: {
    score: string;
    confidence: number;
  };
  asianHandicap: {
    team: 'home' | 'away';
    line: number;
    confidence: number;
  };
  firstHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  secondHalf: {
    prediction: 'home' | 'away' | 'draw';
    confidence: number;
  };
  reasoning: string;
  factors: {
    formWeight: number;
    h2hWeight: number;
    statsWeight: number;
    homeAdvantage: number;
    motivation: number;
    missingPlayers: number;
  };
}

export interface AgentProfile {
  id: string;
  name: string;
  type: 'statistical' | 'form' | 'head2head' | 'advanced' | 'ensemble' | 'goals' | 'btts' | 'correctscore';
  description: string;
  specialty: string;
  accuracy: number; // Percentual de acertos históricos
  marketAccuracies?: {
    winner: number;
    btts: number;
    overUnder: number;
  };
  marketKeyStats?: Record<string, { total: number; correct: number; accuracy: number }>;
  topMarkets?: Array<{ key: string; label: string; total: number; correct: number; accuracy: number }>;
  totalPredictions: number;
  correctPredictions: number;
  avatar: string;
  strengths: string[];
}

type TrainingSample = {
  id: string;
  day: string;
  utcDate: string;
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
  score: { home: number; away: number };
  outcomes: {
    winner: 'home' | 'away' | 'draw';
    totalGoals: number;
    btts: 'yes' | 'no';
    overUnder: { line: number; outcome: 'over' | 'under' };
    correctScore: string;
  };
  agentPredictions: Array<{
    agentName: string;
    agentType: AgentPrediction['agentType'];
    winner: AgentPrediction['winner'];
    overUnder: AgentPrediction['overUnder'];
    btts: AgentPrediction['btts'];
    correctScore: AgentPrediction['correctScore'];
  }>;
};

type MetaModelV1 = {
  version: 1;
  trainedAt: string;
  sampleCount: number;
  agentNames: string[];
  winner: { classes: Array<'home' | 'draw' | 'away'>; weights: number[][] }; // 3 x (3N+1)
  btts: { weights: number[] }; // (N+1)
  overUnder: { weights: number[] }; // (N+1)
  metrics?: {
    winnerAcc: number;
    bttsAcc: number;
    overUnderAcc: number;
  };
  updates?: number;
};

const META_MODEL_KEY = 'meta_model_v1';

const loadMetaModel = (): MetaModelV1 | null => {
  try {
    const raw = localStorage.getItem(META_MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MetaModelV1;
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveMetaModel = (model: MetaModelV1) => {
  try {
    localStorage.setItem(META_MODEL_KEY, JSON.stringify(model));
  } catch {}
};

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const softmax = (logits: number[]) => {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
};

const dot = (w: number[], x: number[]) => {
  let s = 0;
  const n = Math.min(w.length, x.length);
  for (let i = 0; i < n; i++) s += w[i] * x[i];
  return s;
};

const buildFeatureVectors = (agentNames: string[], preds: TrainingSample['agentPredictions']) => {
  const byAgent = new Map<string, (typeof preds)[number]>();
  for (const p of preds) byAgent.set(p.agentName, p);

  const bttsX: number[] = [1];
  const ouX: number[] = [1];
  const winnerX: number[] = [1];

  for (const name of agentNames) {
    const p = byAgent.get(name);

    const bttsConf = typeof p?.btts?.confidence === 'number' ? Math.max(0, Math.min(100, p.btts.confidence)) : 50;
    const bttsYesProb = (p?.btts?.prediction === 'yes' ? bttsConf : 100 - bttsConf) / 100;
    bttsX.push(bttsYesProb);

    const ouConf = typeof p?.overUnder?.confidence === 'number' ? Math.max(0, Math.min(100, p.overUnder.confidence)) : 50;
    const ouOverProb = (p?.overUnder?.prediction === 'over' ? ouConf : 100 - ouConf) / 100;
    ouX.push(ouOverProb);

    const winConf = typeof p?.winnerConfidence === 'number' ? Math.max(0, Math.min(100, p.winnerConfidence)) : 50;
    const winProb = winConf / 100;
    winnerX.push(p?.winner === 'home' ? winProb : 0);
    winnerX.push(p?.winner === 'draw' ? winProb : 0);
    winnerX.push(p?.winner === 'away' ? winProb : 0);
  }

  return { bttsX, ouX, winnerX };
};

const readTrainingSamples = (): TrainingSample[] => {
  try {
    const raw = localStorage.getItem('training_samples_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version: number; items: Record<string, TrainingSample> };
    if (!parsed || parsed.version !== 1 || !parsed.items) return [];
    return Object.values(parsed.items).filter((s) => s && typeof s === 'object') as TrainingSample[];
  } catch {
    return [];
  }
};

const hash32 = (text: string) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) || 1;
};

const parseCsvRow = (line: string) => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out.map((v) => String(v ?? '').trim());
};

const guessColumnIndex = (headers: string[], candidates: Array<(h: string) => boolean>) => {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (!h) continue;
    for (const f of candidates) {
      if (f(h)) return i;
    }
  }
  return -1;
};

const parseDateToIso = (value: string) => {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const d1 = new Date(v);
  if (Number.isFinite(d1.getTime())) return d1.toISOString();
  const dt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(v);
  if (dt) {
    const yyyy = dt[1];
    const mm = dt[2];
    const dd = dt[3];
    const hh = dt[4];
    const mi = dt[5];
    const ss = dt[6] ?? '00';
    return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.000Z`).toISOString();
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`).toISOString();
  return null;
};

const getSupabaseEdgeAuth = async (): Promise<{ baseUrl: string; anonKey: string }> => {
  const env = import.meta.env as unknown as Record<string, string | boolean | undefined>;
  const sanitize = (v: string) => v.trim().replaceAll('`', '').replaceAll('"', '').replaceAll("'", '').trim();
  const fromEnvUrl = sanitize(String(env.VITE_SUPABASE_URL ?? '')).replace(/\/+$/, '');
  const fromEnvAnon = sanitize(String(env.VITE_SUPABASE_ANON_KEY ?? ''));
  const looksLikeJwt = fromEnvAnon.split('.').filter(Boolean).length === 3;
  if (fromEnvUrl && fromEnvAnon && looksLikeJwt) return { baseUrl: fromEnvUrl, anonKey: fromEnvAnon };

  const { projectId, publicAnonKey } = await import('/utils/supabase/info');
  return { baseUrl: `https://${projectId}.supabase.co`, anonKey: publicAnonKey };
};

const TRAINING_SAMPLES_SEEN_IDS = new Set<string>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryableUpsertStatus = (status: number) => status === 429 || (status >= 500 && status <= 599);

const upsertTrainingSamplesToServerOnce = async (
  items: TrainingSample[],
): Promise<{ added: number; upserted: number }> => {
  const { baseUrl, anonKey } = await getSupabaseEdgeAuth();

  const maxRetries = 6;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/functions/v1/make-server-1119702f/training/samples/upsert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      if (attempt >= maxRetries) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      await sleep(Math.min(8000, 300 * 2 ** attempt) + Math.floor(Math.random() * 150));
      continue;
    }

    const raw = await res.text().catch(() => '');
    if (res.ok) {
      const data = raw ? (JSON.parse(raw) as any) : null;
      if (!data?.ok) {
        throw new Error(String(data?.error ?? 'Falha ao salvar amostras no servidor'));
      }
      return {
        added: Math.max(0, Number(data.added) || 0),
        upserted: Math.max(0, Number(data.upserted) || 0),
      };
    }

    const retryable = isRetryableUpsertStatus(res.status) || raw.includes('SUPABASE_EDGE_RUNTIME_ERROR');
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`Falha ao salvar amostras no servidor (${res.status}): ${raw}`.slice(0, 500));
    }

    const retryAfter = res.headers.get('retry-after');
    const retryAfterMs = Number.isFinite(Number(retryAfter)) ? Math.max(0, Math.floor(Number(retryAfter) * 1000)) : 0;
    const backoffMs = Math.min(8000, 300 * 2 ** attempt) + Math.floor(Math.random() * 150);
    await sleep(Math.max(retryAfterMs, backoffMs));
  }

  throw new Error('Falha ao salvar amostras no servidor');
};

export async function upsertTrainingSamplesToServer(
  items: TrainingSample[],
): Promise<{ added: number; upserted: number }> {
  const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (safeItems.length === 0) return { added: 0, upserted: 0 };

  const byId = new Map<string, TrainingSample>();
  for (const it of safeItems) {
    const id = String((it as any)?.id ?? '').trim();
    if (!id) continue;
    byId.set(id, it);
  }
  const unique = Array.from(byId.values());
  if (unique.length === 0) return { added: 0, upserted: 0 };

  const chunkSize = 50;
  let totalAdded = 0;
  let totalUpserted = 0;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const r = await upsertTrainingSamplesToServerOnce(chunk);
    totalAdded += r.added;
    totalUpserted += r.upserted;
    if (i + chunkSize < unique.length) await sleep(120);
  }
  return { added: totalAdded, upserted: totalUpserted };
}

export async function getTrainingSamplesCountFromServer(): Promise<number | null> {
  try {
    const { baseUrl, anonKey } = await getSupabaseEdgeAuth();
    const res = await fetch(
      `${baseUrl}/functions/v1/make-server-1119702f/training/samples/count`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as any;
    if (!data?.ok) return null;
    const n = Number(data.count);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  } catch {
    return null;
  }
}

export async function listTrainingSamplesFromServer(opts?: {
  maxRows?: number;
}): Promise<TrainingSample[]> {
  const maxRows = Math.max(1, Math.floor(opts?.maxRows ?? 50000));
  const { baseUrl, anonKey } = await getSupabaseEdgeAuth();

  const out: TrainingSample[] = [];
  let offset = 0;
  while (out.length < maxRows) {
    const limit = Math.min(500, maxRows - out.length);
    const res = await fetch(
      `${baseUrl}/functions/v1/make-server-1119702f/training/samples/list`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ offset, limit }),
      },
    );
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`Falha ao ler amostras do servidor (${res.status}): ${raw}`.slice(0, 500));
    }
    const data = raw ? (JSON.parse(raw) as any) : null;
    if (!data?.ok) throw new Error(String(data?.error ?? 'Falha ao ler amostras do servidor'));
    const items = Array.isArray(data.items) ? (data.items as TrainingSample[]) : [];
    out.push(...items.filter(Boolean));
    const next = data.nextOffset;
    if (typeof next !== 'number' || !Number.isFinite(next) || next <= offset) break;
    offset = next;
    if (items.length === 0) break;
  }
  return out.slice(0, maxRows);
}

const buildTrainingSample = (match: FootballMatch, predictions: AgentPrediction[]): TrainingSample | null => {
  const home = match.score?.fullTime?.home;
  const away = match.score?.fullTime?.away;
  if (typeof home !== 'number' || typeof away !== 'number') return null;

  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(match.utcDate));
  const id = match.id.toString();
  const winner = home > away ? 'home' : home < away ? 'away' : 'draw';
  const totalGoals = home + away;
  const btts = home > 0 && away > 0 ? 'yes' : 'no';
  const line = 2.5;
  const overUnderOutcome = totalGoals > line ? 'over' : 'under';
  const correctScore = `${home}-${away}`;

  const sample: TrainingSample = {
    id,
    day,
    utcDate: match.utcDate,
    league: match.competition?.name ?? 'Unknown',
    country: match.competition?.area?.name ?? match.competition?.area?.code ?? 'Unknown',
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    score: { home, away },
    outcomes: {
      winner,
      totalGoals,
      btts,
      overUnder: { line, outcome: overUnderOutcome },
      correctScore,
    },
    agentPredictions: predictions.map((p) => ({
      agentName: p.agentName,
      agentType: p.agentType,
      winner: p.winner,
      overUnder: p.overUnder,
      btts: p.btts,
      correctScore: p.correctScore,
    })),
  };

  return sample;
};

export async function importTrainingSamplesFromCsvText(
  csvText: string,
  opts?: {
    maxRows?: number;
    onProgress?: (info: { phase: string; processed: number; total: number; percent: number }) => void;
  },
): Promise<{ added: number; skipped: number; invalid: number }> {
  const maxRows = Math.max(100, Math.floor(opts?.maxRows ?? 50000));
  const lines = String(csvText ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV inválido: sem linhas suficientes');
  }

  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());

  const idxDate = guessColumnIndex(headers, [
    (h) => h === 'date',
    (h) => h.includes('utcdate') || h.includes('utc_date'),
    (h) => h.includes('matchdate') || h.includes('match_date'),
    (h) => h.includes('datetime') || h.includes('kickoff'),
  ]);
  const idxHomeTeam = guessColumnIndex(headers, [
    (h) => h === 'home_team' || h === 'hometeam',
    (h) => h.includes('home') && h.includes('team') && !h.includes('id'),
  ]);
  const idxAwayTeam = guessColumnIndex(headers, [
    (h) => h === 'away_team' || h === 'awayteam',
    (h) => h.includes('away') && h.includes('team') && !h.includes('id'),
  ]);
  const idxHomeGoals = guessColumnIndex(headers, [
    (h) =>
      h === 'home_score' ||
      h === 'home_goals' ||
      h === 'home_goal' ||
      h === 'home_team_goal' ||
      h === 'home_score_total' ||
      h === 'fthg',
    (h) =>
      h.includes('home') &&
      (h.includes('score') || h.includes('goals') || h.includes('goal') || h.endsWith('_goal')) &&
      !h.includes('player') &&
      !h.includes('id'),
  ]);
  const idxAwayGoals = guessColumnIndex(headers, [
    (h) =>
      h === 'away_score' ||
      h === 'away_goals' ||
      h === 'away_goal' ||
      h === 'away_team_goal' ||
      h === 'away_score_total' ||
      h === 'ftag',
    (h) =>
      h.includes('away') &&
      (h.includes('score') || h.includes('goals') || h.includes('goal') || h.endsWith('_goal')) &&
      !h.includes('player') &&
      !h.includes('id'),
  ]);
  const idxLeague = guessColumnIndex(headers, [(h) => h === 'league' || h.includes('competition') || h.includes('league')]);
  const idxCountry = guessColumnIndex(headers, [(h) => h === 'country' || h.includes('nation')]);

  if (idxHomeTeam === -1 || idxAwayTeam === -1 || idxHomeGoals === -1 || idxAwayGoals === -1) {
    throw new Error('CSV não reconhecido: precisa conter colunas de time mandante/visitante e gols/placar');
  }

  const dynamicAgents = getDynamicAgentProfiles();
  const ensemble = new AgentEnsemble(dynamicAgents);

  let added = 0;
  let skipped = 0;
  let invalid = 0;
  let batch: TrainingSample[] = [];
  let processed = 0;
  let lastProgressAt = 0;

  const total = Math.min(lines.length - 1, maxRows);
  const report = (phase: string) => {
    const denom = total > 0 ? total : 1;
    const percent = Math.max(0, Math.min(100, Math.round((processed / denom) * 100)));
    opts?.onProgress?.({ phase, processed, total, percent });
  };

  const flush = async () => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    report('Enviando lote');
    const result = await upsertTrainingSamplesToServer(current);
    added += result.added;
    skipped += Math.max(0, result.upserted - result.added);
    report('Processando linhas');
  };

  report('Preparando');
  for (let i = 0; i < total; i++) {
    const row = parseCsvRow(lines[i + 1]);
    const homeTeam = row[idxHomeTeam] ?? '';
    const awayTeam = row[idxAwayTeam] ?? '';
    const hg = Number(row[idxHomeGoals]);
    const ag = Number(row[idxAwayGoals]);
    if (!homeTeam || !awayTeam || !Number.isFinite(hg) || !Number.isFinite(ag)) {
      invalid += 1;
      processed += 1;
      continue;
    }

    const utcDate =
      idxDate !== -1 ? parseDateToIso(row[idxDate] ?? '') : null;

    const league = idxLeague !== -1 ? String(row[idxLeague] ?? '').trim() : 'Kaggle';
    const country = idxCountry !== -1 ? String(row[idxCountry] ?? '').trim() : 'Unknown';

    const matchId = hash32(`${utcDate ?? 'na'}|${league}|${homeTeam}|${awayTeam}|${hg}|${ag}`);

    const match: FootballMatch = {
      id: matchId,
      utcDate: utcDate ?? new Date(Date.now() - 86400000).toISOString(),
      status: 'FINISHED',
      matchday: 0,
      homeTeam: { id: hash32(`home:${homeTeam}`), name: homeTeam, shortName: homeTeam, tla: homeTeam.slice(0, 3).toUpperCase(), crest: '' },
      awayTeam: { id: hash32(`away:${awayTeam}`), name: awayTeam, shortName: awayTeam, tla: awayTeam.slice(0, 3).toUpperCase(), crest: '' },
      score: { fullTime: { home: hg, away: ag } },
      competition: {
        id: hash32(`comp:${league}:${country}`),
        name: league || 'Kaggle',
        code: '',
        emblem: '',
        area: { name: country || 'Unknown', code: '', flag: '' },
      },
    };

    const preds = await ensemble.predictWithAllAgents(match);
    const sample = buildTrainingSample(match, preds);
    if (!sample) {
      invalid += 1;
      processed += 1;
      continue;
    }

    batch.push(sample);
    if (batch.length >= 100) await flush();
    processed += 1;

    const now = Date.now();
    if (i === 0 || i === total - 1 || i % 50 === 0 || now - lastProgressAt > 600) {
      lastProgressAt = now;
      report('Processando linhas');
    }

    if (i % 200 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  await flush();
  report('Concluído');
  return { added, skipped, invalid };
}

export async function trainMetaModelFromLocalSamples(opts?: {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  onEpoch?: (info: { epoch: number; epochs: number; winnerAcc: number; bttsAcc: number; overUnderAcc: number }) => void;
  signal?: AbortSignal;
}) {
  const epochs = Math.max(1, Math.floor(opts?.epochs ?? 40));
  const lr = Math.max(1e-4, Math.min(0.5, opts?.learningRate ?? 0.05));
  const l2 = Math.max(0, Math.min(0.01, opts?.l2 ?? 0.0005));

  let remoteSamples: TrainingSample[] = [];
  try {
    remoteSamples = await listTrainingSamplesFromServer({ maxRows: 50000 });
  } catch {}
  const samples = (remoteSamples.length > 0 ? remoteSamples : readTrainingSamples()).filter(
    (s) => Array.isArray(s.agentPredictions) && s.agentPredictions.length > 0,
  );
  const agentNames = AI_AGENTS_BASE.map((a) => a.name);

  const winnerClasses: Array<'home' | 'draw' | 'away'> = ['home', 'draw', 'away'];
  const winnerDim = 1 + agentNames.length * 3;
  const binDim = 1 + agentNames.length;

  let winnerW = Array.from({ length: 3 }, () => Array.from({ length: winnerDim }, () => 0));
  let bttsW = Array.from({ length: binDim }, () => 0);
  let ouW = Array.from({ length: binDim }, () => 0);
  const prev = loadMetaModel();
  let prevUpdates = 0;
  if (prev && prev.version === 1 && Array.isArray(prev.agentNames) && prev.agentNames.join('|') === agentNames.join('|')) {
    const okDims =
      Array.isArray(prev.winner?.weights) &&
      prev.winner.weights.length === 3 &&
      prev.winner.weights.every((w) => Array.isArray(w) && w.length === winnerDim) &&
      Array.isArray(prev.btts?.weights) &&
      prev.btts.weights.length === binDim &&
      Array.isArray(prev.overUnder?.weights) &&
      prev.overUnder.weights.length === binDim;
    if (okDims) {
      winnerW = prev.winner.weights.map((w) => w.slice());
      bttsW = prev.btts.weights.slice();
      ouW = prev.overUnder.weights.slice();
      prevUpdates = typeof prev.updates === 'number' && Number.isFinite(prev.updates) ? prev.updates : 0;
    }
  }

  const shuffle = <T,>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  shuffle(samples);
  const split = Math.max(1, Math.floor(samples.length * 0.8));
  const train = samples.slice(0, split);
  const val = samples.slice(split);

  const evalAcc = () => {
    let wOk = 0;
    let bOk = 0;
    let oOk = 0;
    let n = 0;
    for (const s of val) {
      const { bttsX, ouX, winnerX } = buildFeatureVectors(agentNames, s.agentPredictions);
      const winLogits = winnerW.map((w) => dot(w, winnerX));
      const winProbs = softmax(winLogits);
      const winPred = winnerClasses[winProbs.indexOf(Math.max(...winProbs))];
      if (winPred === s.outcomes.winner) wOk += 1;

      const bYes = sigmoid(dot(bttsW, bttsX));
      const bPred = bYes >= 0.5 ? 'yes' : 'no';
      if (bPred === s.outcomes.btts) bOk += 1;

      const oYes = sigmoid(dot(ouW, ouX));
      const oPred = oYes >= 0.5 ? 'over' : 'under';
      if (oPred === s.outcomes.overUnder.outcome) oOk += 1;

      n += 1;
    }
    const den = n || 1;
    return { winnerAcc: (wOk / den) * 100, bttsAcc: (bOk / den) * 100, overUnderAcc: (oOk / den) * 100 };
  };

  for (let epoch = 1; epoch <= epochs; epoch++) {
    if (opts?.signal?.aborted) break;
    shuffle(train);

    for (const s of train) {
      const { bttsX, ouX, winnerX } = buildFeatureVectors(agentNames, s.agentPredictions);

      const yIdx = winnerClasses.indexOf(s.outcomes.winner);
      const logits = winnerW.map((w) => dot(w, winnerX));
      const probs = softmax(logits);
      for (let c = 0; c < 3; c++) {
        const err = probs[c] - (c === yIdx ? 1 : 0);
        const w = winnerW[c];
        for (let i = 0; i < w.length; i++) {
          w[i] -= lr * (err * winnerX[i] + l2 * w[i]);
        }
      }

      const bY = s.outcomes.btts === 'yes' ? 1 : 0;
      const bP = sigmoid(dot(bttsW, bttsX));
      const bErr = bP - bY;
      for (let i = 0; i < bttsW.length; i++) {
        bttsW[i] -= lr * (bErr * bttsX[i] + l2 * bttsW[i]);
      }

      const oY = s.outcomes.overUnder.outcome === 'over' ? 1 : 0;
      const oP = sigmoid(dot(ouW, ouX));
      const oErr = oP - oY;
      for (let i = 0; i < ouW.length; i++) {
        ouW[i] -= lr * (oErr * ouX[i] + l2 * ouW[i]);
      }
    }

    const { winnerAcc, bttsAcc, overUnderAcc } = evalAcc();
    opts?.onEpoch?.({ epoch, epochs, winnerAcc, bttsAcc, overUnderAcc });
    await new Promise((r) => setTimeout(r, 0));
  }

  const metrics = evalAcc();
  const model: MetaModelV1 = {
    version: 1,
    trainedAt: new Date().toISOString(),
    sampleCount: samples.length,
    agentNames,
    winner: { classes: winnerClasses, weights: winnerW },
    btts: { weights: bttsW },
    overUnder: { weights: ouW },
    metrics,
    updates: prevUpdates + 1,
  };
  saveMetaModel(model);
  return { model, metrics };
}

export async function hydrateMetaModelFromServer(): Promise<boolean> {
  try {
    const { baseUrl, anonKey } = await getSupabaseEdgeAuth();
    const res = await fetch(
      `${baseUrl}/functions/v1/make-server-1119702f/training/meta/get`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as any;
    const model = data?.model ?? null;
    if (!model || model.version !== 1) return false;
    localStorage.setItem(META_MODEL_KEY, JSON.stringify(model));
    return true;
  } catch {
    return false;
  }
}

export async function pushLocalMetaModelToServer(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(META_MODEL_KEY);
    if (!raw) return false;
    const model = JSON.parse(raw) as any;
    if (!model || model.version !== 1) return false;

    const { baseUrl, anonKey } = await getSupabaseEdgeAuth();
    const res = await fetch(
      `${baseUrl}/functions/v1/make-server-1119702f/training/meta/set`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ model }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

const updateMetaModelOnline = (match: FootballMatch, predictions: AgentPrediction[]) => {
  const model = loadMetaModel();
  if (!model) return;
  if (!Array.isArray(predictions) || predictions.length === 0) return;

  const homeScore = match.score?.fullTime?.home;
  const awayScore = match.score?.fullTime?.away;
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return;

  const sample: TrainingSample = {
    id: match.id.toString(),
    day: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(match.utcDate),
    ),
    utcDate: match.utcDate,
    league: match.competition?.name ?? 'Unknown',
    country: match.competition?.area?.name ?? match.competition?.area?.code ?? 'Unknown',
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    score: { home: homeScore, away: awayScore },
    outcomes: {
      winner: homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw',
      totalGoals: homeScore + awayScore,
      btts: homeScore > 0 && awayScore > 0 ? 'yes' : 'no',
      overUnder: { line: 2.5, outcome: homeScore + awayScore > 2.5 ? 'over' : 'under' },
      correctScore: `${homeScore}-${awayScore}`,
    },
    agentPredictions: predictions.map((p) => ({
      agentName: p.agentName,
      agentType: p.agentType,
      winner: p.winner,
      overUnder: p.overUnder,
      btts: p.btts,
      correctScore: p.correctScore,
    })),
  };

  const lr = 0.02;
  const l2 = 0.0002;
  const agentNames = model.agentNames;
  const { bttsX, ouX, winnerX } = buildFeatureVectors(agentNames, sample.agentPredictions);

  const winnerClasses = model.winner.classes;
  const yIdx = winnerClasses.indexOf(sample.outcomes.winner);
  const logits = model.winner.weights.map((w) => dot(w, winnerX));
  const probs = softmax(logits);
  for (let c = 0; c < model.winner.weights.length; c++) {
    const err = probs[c] - (c === yIdx ? 1 : 0);
    const w = model.winner.weights[c];
    for (let i = 0; i < w.length; i++) {
      w[i] -= lr * (err * winnerX[i] + l2 * w[i]);
    }
  }

  const bY = sample.outcomes.btts === 'yes' ? 1 : 0;
  const bP = sigmoid(dot(model.btts.weights, bttsX));
  const bErr = bP - bY;
  for (let i = 0; i < model.btts.weights.length; i++) {
    model.btts.weights[i] -= lr * (bErr * bttsX[i] + l2 * model.btts.weights[i]);
  }

  const oY = sample.outcomes.overUnder.outcome === 'over' ? 1 : 0;
  const oP = sigmoid(dot(model.overUnder.weights, ouX));
  const oErr = oP - oY;
  for (let i = 0; i < model.overUnder.weights.length; i++) {
    model.overUnder.weights[i] -= lr * (oErr * ouX[i] + l2 * model.overUnder.weights[i]);
  }

  model.updates = (model.updates ?? 0) + 1;
  saveMetaModel(model);
};

export function recordTrainingSample(match: FootballMatch, predictions: AgentPrediction[]): boolean {
  const sample = buildTrainingSample(match, predictions);
  if (!sample) return false;
  if (TRAINING_SAMPLES_SEEN_IDS.has(sample.id)) return false;
  TRAINING_SAMPLES_SEEN_IDS.add(sample.id);
  void upsertTrainingSamplesToServer([sample]).catch(() => {});
  return true;
}

// Obter as estatísticas dinâmicas dos agentes (treinamento + histórico)
export function getDynamicAgentProfiles(): AgentProfile[] {
  // Histórico salvo localmente das avaliações do "Ver Resultado"
  const historyRaw = localStorage.getItem('agent_learning_history');
  const history = historyRaw ? JSON.parse(historyRaw) : {};

  // Sessões de treinamento do Kaggle
  const sessions = typeof localStorage !== 'undefined' ? loadTrainingSessionsSafe() : [];

  const toTrainingAgentId = (agentProfileId: string) => {
    const raw = String(agentProfileId || '').replace(/^agent-/, '');
    return raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
  };

  const historyV2 = (() => {
    try {
      const raw = localStorage.getItem('agent_learning_history_v2');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      if (!parsed || parsed.version !== 2 || !parsed.agents) return null;
      return parsed as {
        version: 2;
        agents: Record<
          string,
          {
            total: number;
            correct: number;
            markets?: {
              winner?: { total: number; correct: number };
              btts?: { total: number; correct: number };
              overUnder?: { total: number; correct: number };
            };
            recent?: Array<{ ts: string; winner: boolean; btts: boolean; overUnder: boolean }>;
          }
        >;
      };
    } catch {
      return null;
    }
  })();

  const historyV3 = (() => {
    try {
      const raw = localStorage.getItem('agent_learning_history_v3');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as any;
      if (!parsed || parsed.version !== 3 || !parsed.agents) return null;
      return parsed as {
        version: 3;
        agents: Record<string, { byMarket: Record<string, { total: number; correct: number }> }>;
      };
    } catch {
      return null;
    }
  })();

  const marketKeyLabel = (key: string) => {
    const k = String(key ?? '');
    if (k.startsWith('winner:')) {
      const v = k.slice('winner:'.length);
      if (v === 'home') return 'Vencedor: Casa';
      if (v === 'away') return 'Vencedor: Visitante';
      if (v === 'draw') return 'Vencedor: Empate';
      return 'Vencedor';
    }
    if (k.startsWith('btts:')) {
      const v = k.slice('btts:'.length);
      if (v === 'yes') return 'Ambos marcam: Sim';
      if (v === 'no') return 'Ambos marcam: Não';
      return 'Ambos marcam';
    }
    if (k.startsWith('ou:')) {
      const rest = k.slice('ou:'.length);
      const [side, line] = rest.split(':', 2);
      const sideLabel = side === 'over' ? 'Over' : side === 'under' ? 'Under' : 'Over/Under';
      const lineLabel = line ? ` ${line}` : '';
      return `${sideLabel}${lineLabel}`;
    }
    if (k.startsWith('cs:')) return `Placar exato: ${k.slice('cs:'.length)}`;
    if (k.startsWith('ah:')) return `Handicap: ${k.slice('ah:'.length)}`;
    return k || 'Mercado';
  };

  const priorTotal = 25;

  return AI_AGENTS_BASE.map(agent => {
    let currentAccuracy = agent.accuracy;
    
    const agentSession = sessions.find(s => s.agentId === toTrainingAgentId(agent.id));
    if (agentSession && agentSession.bestAccuracy > 0 && (agentSession as any).simulated === false) {
      const trainingBoost = (agentSession.bestAccuracy * 100) - currentAccuracy;
      if (trainingBoost > 0) currentAccuracy += trainingBoost * 0.5;
    }

    // 2) Ajuste com base no histórico real (Ver Resultado)
    const agentHistory = history[agent.id];
    const agentHistoryV2 = historyV2?.agents?.[agent.id];
    const agentHistoryV3 = historyV3?.agents?.[agent.id];

    const basePriorCorrect = (priorTotal * currentAccuracy) / 100;

    const learnedTotalV1 = agentHistory ? Number(agentHistory.total) : 0;
    const learnedCorrectV1 = agentHistory ? Number(agentHistory.correct) : 0;

    const learnedTotalV2 = agentHistoryV2 ? Number(agentHistoryV2.total) : 0;
    const learnedCorrectV2 = agentHistoryV2 ? Number(agentHistoryV2.correct) : 0;

    const learnedTotal = Math.max(0, learnedTotalV2 || learnedTotalV1);
    const learnedCorrect = Math.max(0, learnedCorrectV2 || learnedCorrectV1);

    const totalPreds = priorTotal + learnedTotal;
    const correctPreds = basePriorCorrect + learnedCorrect;

    const historyAccuracy = totalPreds > 0 ? (correctPreds / totalPreds) * 100 : currentAccuracy;
    currentAccuracy = historyAccuracy;

    const winnerAcc = (() => {
      const m = agentHistoryV2?.markets?.winner;
      if (!m || !Number.isFinite(m.total) || m.total <= 0) return currentAccuracy;
      const t = priorTotal + m.total;
      const c = basePriorCorrect + m.correct;
      return t > 0 ? (c / t) * 100 : currentAccuracy;
    })();
    const bttsAcc = (() => {
      const m = agentHistoryV2?.markets?.btts;
      if (!m || !Number.isFinite(m.total) || m.total <= 0) return currentAccuracy;
      const t = priorTotal + m.total;
      const c = basePriorCorrect + m.correct;
      return t > 0 ? (c / t) * 100 : currentAccuracy;
    })();
    const overUnderAcc = (() => {
      const m = agentHistoryV2?.markets?.overUnder;
      if (!m || !Number.isFinite(m.total) || m.total <= 0) return currentAccuracy;
      const t = priorTotal + m.total;
      const c = basePriorCorrect + m.correct;
      return t > 0 ? (c / t) * 100 : currentAccuracy;
    })();

    const marketKeyStats = (() => {
      const byMarket = agentHistoryV3?.byMarket;
      if (!byMarket || typeof byMarket !== 'object') return undefined;
      const out: Record<string, { total: number; correct: number; accuracy: number }> = {};
      for (const [k, v] of Object.entries(byMarket)) {
        const total = Math.max(0, Number((v as any)?.total ?? 0));
        const correct = Math.max(0, Number((v as any)?.correct ?? 0));
        const accuracy = total > 0 ? (correct / total) * 100 : 0;
        out[String(k)] = { total, correct, accuracy };
      }
      return out;
    })();

    const topMarkets = (() => {
      if (!marketKeyStats) return undefined;
      const items = Object.entries(marketKeyStats)
        .map(([key, v]) => ({
          key,
          label: marketKeyLabel(key),
          total: v.total,
          correct: v.correct,
          accuracy: v.total > 0 ? (v.correct / v.total) * 100 : 0,
        }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);
      return items.length ? items : undefined;
    })();

    const aggByPrefix = (prefix: string) => {
      if (!marketKeyStats) return null;
      let total = 0;
      let correct = 0;
      for (const [k, v] of Object.entries(marketKeyStats)) {
        if (!k.startsWith(prefix)) continue;
        total += v.total;
        correct += v.correct;
      }
      if (total <= 0) return null;
      return (correct / total) * 100;
    };

    const winnerAccV3 = aggByPrefix('winner:');
    const bttsAccV3 = aggByPrefix('btts:');
    const ouAccV3 = aggByPrefix('ou:');

    return {
      ...agent,
      accuracy: Math.min(95, Math.max(40, currentAccuracy)),
      marketAccuracies: {
        winner: Math.min(95, Math.max(40, winnerAccV3 ?? winnerAcc)),
        btts: Math.min(95, Math.max(40, bttsAccV3 ?? bttsAcc)),
        overUnder: Math.min(95, Math.max(40, ouAccV3 ?? overUnderAcc)),
      },
      marketKeyStats,
      topMarkets,
      totalPredictions: totalPreds,
      correctPredictions: correctPreds,
    };
  });
}

// Registrar o aprendizado do agente após um resultado real
export function learnFromMatchResult(match: FootballMatch, predictions: AgentPrediction[]) {
  const homeScore = match.score?.fullTime?.home;
  const awayScore = match.score?.fullTime?.away;
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return;

  const realWinner: 'home' | 'away' | 'draw' = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';
  const totalGoals = homeScore + awayScore;
  const realBtts: 'yes' | 'no' = homeScore > 0 && awayScore > 0 ? 'yes' : 'no';
  const realOverUnderForLine = (line: number): 'over' | 'under' => (totalGoals > line ? 'over' : 'under');
  const shouldScoreWinnerMarket = realWinner !== 'draw';

  const formatLineKey = (line: number) => {
    if (!Number.isFinite(line)) return '2.5';
    const s = Math.abs(line % 1) < 1e-9 ? line.toFixed(0) : line.toFixed(2);
    return s.replace(/0+$/g, '').replace(/\.$/g, '');
  };

  const historyRaw = localStorage.getItem('agent_learning_history');
  const history = historyRaw ? JSON.parse(historyRaw) : {};

  const v2Raw = localStorage.getItem('agent_learning_history_v2');
  const v2 = (() => {
    try {
      const parsed = v2Raw ? (JSON.parse(v2Raw) as any) : null;
      if (parsed && parsed.version === 2 && parsed.agents) return parsed as any;
    } catch {}
    return { version: 2 as const, agents: {} as any };
  })();

  const v3Raw = localStorage.getItem('agent_learning_history_v3');
  const v3 = (() => {
    try {
      const parsed = v3Raw ? (JSON.parse(v3Raw) as any) : null;
      if (parsed && parsed.version === 3 && parsed.agents) return parsed as any;
    } catch {}
    return { version: 3 as const, agents: {} as any };
  })();

  predictions.forEach((p) => {
    const agentBase = AI_AGENTS_BASE.find((a) => a.name === p.agentName);
    if (!agentBase) return;

    if (!history[agentBase.id]) history[agentBase.id] = { total: 0, correct: 0 };
    if (shouldScoreWinnerMarket) {
      history[agentBase.id].total += 1;
      if (p.winner === realWinner) history[agentBase.id].correct += 1;
    }

    if (!v2.agents[agentBase.id]) {
      v2.agents[agentBase.id] = {
        total: 0,
        correct: 0,
        markets: {
          winner: { total: 0, correct: 0 },
          btts: { total: 0, correct: 0 },
          overUnder: { total: 0, correct: 0 },
        },
        recent: [] as Array<{ ts: string; winner: boolean; btts: boolean; overUnder: boolean }>,
      };
    }

    const rec = v2.agents[agentBase.id];
    const winnerOk = shouldScoreWinnerMarket ? p.winner === realWinner : true;
    const bttsOk = p.btts?.prediction === realBtts;
    const ouLine = typeof p.overUnder?.line === 'number' ? p.overUnder.line : 2.5;
    const ouOk = p.overUnder?.prediction === realOverUnderForLine(ouLine);
    const csOk = String(p.correctScore?.score ?? '') === `${homeScore}-${awayScore}`;

    if (shouldScoreWinnerMarket) {
      rec.total += 1;
      if (winnerOk) rec.correct += 1;
    }

    if (shouldScoreWinnerMarket) {
      rec.markets.winner.total += 1;
      if (winnerOk) rec.markets.winner.correct += 1;
    }

    rec.markets.btts.total += 1;
    if (bttsOk) rec.markets.btts.correct += 1;

    rec.markets.overUnder.total += 1;
    if (ouOk) rec.markets.overUnder.correct += 1;

    rec.recent.push({ ts: new Date().toISOString(), winner: winnerOk, btts: bttsOk, overUnder: ouOk });
    if (rec.recent.length > 200) rec.recent.splice(0, rec.recent.length - 200);

    if (!v3.agents[agentBase.id]) v3.agents[agentBase.id] = { byMarket: {} as any };
    const rec3 = v3.agents[agentBase.id];
    if (!rec3.byMarket || typeof rec3.byMarket !== 'object') rec3.byMarket = {} as any;

    const bump = (key: string, ok: boolean) => {
      const k = String(key ?? '').trim();
      if (!k) return;
      if (!rec3.byMarket[k]) rec3.byMarket[k] = { total: 0, correct: 0 };
      rec3.byMarket[k].total += 1;
      if (ok) rec3.byMarket[k].correct += 1;
    };

    if (shouldScoreWinnerMarket) bump(`winner:${p.winner}`, winnerOk);
    bump(`btts:${p.btts?.prediction}`, bttsOk);
    bump(`ou:${p.overUnder?.prediction}:${formatLineKey(ouLine)}`, ouOk);
    bump(`cs:${p.correctScore?.score}`, csOk);
  });

  localStorage.setItem('agent_learning_history', JSON.stringify(history));
  localStorage.setItem('agent_learning_history_v2', JSON.stringify(v2));
  localStorage.setItem('agent_learning_history_v3', JSON.stringify(v3));
  updateMetaModelOnline(match, predictions);
}

// Perfis Base dos Agentes de IA Especialistas
export const AI_AGENTS_BASE: AgentProfile[] = [
  {
    id: 'agent-stats-master',
    name: 'StatsMaster',
    type: 'statistical',
    description: 'Especialista em análise estatística profunda',
    specialty: 'xG, Posse de bola, Finalizações',
    accuracy: 73.5,
    totalPredictions: 1247,
    correctPredictions: 917,
    avatar: '📊',
    strengths: ['Expected Goals', 'Posse de Bola', 'Finalizações no Alvo'],
  },
  {
    id: 'agent-form-analyzer',
    name: 'FormAnalyzer',
    type: 'form',
    description: 'Focado em momento atual dos times',
    specialty: 'Últimos 5 jogos, Sequências',
    accuracy: 71.2,
    totalPredictions: 1189,
    correctPredictions: 846,
    avatar: '📈',
    strengths: ['Momento do Time', 'Sequências', 'Moral dos Jogadores'],
  },
  {
    id: 'agent-h2h-expert',
    name: 'H2H Expert',
    type: 'head2head',
    description: 'Analisa histórico entre os times',
    specialty: 'Confrontos diretos, Retrospecto',
    accuracy: 68.9,
    totalPredictions: 956,
    correctPredictions: 659,
    avatar: '⚔️',
    strengths: ['Histórico H2H', 'Retrospecto Casa/Fora', 'Clássicos'],
  },
  {
    id: 'agent-deep-learning',
    name: 'DeepPredictor',
    type: 'advanced',
    description: 'Modelo de deep learning com 50+ variáveis',
    specialty: 'Machine Learning Avançado',
    accuracy: 76.8,
    totalPredictions: 2103,
    correctPredictions: 1615,
    avatar: '🧠',
    strengths: ['Pattern Recognition', 'Multi-variável', 'Contexto Tático'],
  },
  {
    id: 'agent-ensemble',
    name: 'EnsembleMaster',
    type: 'ensemble',
    description: 'Combina todos os agentes com pesos inteligentes',
    specialty: 'Consenso Ponderado',
    accuracy: 78.3,
    totalPredictions: 2103,
    correctPredictions: 1647,
    avatar: '🎯',
    strengths: ['Consenso', 'Meta-Learning', 'Ponderação Adaptativa'],
  },
  {
    id: 'agent-goals-overunder',
    name: 'GoalLine',
    type: 'goals',
    description: 'Especialista em padrões de gols e linhas Over/Under',
    specialty: 'Over/Under, ritmo, gols tardios',
    accuracy: 74.6,
    totalPredictions: 1320,
    correctPredictions: 987,
    avatar: '⚽',
    strengths: ['Over/Under', 'Padrões de Ritmo', 'Gols nos Minutos Finais'],
  },
  {
    id: 'agent-btts-specialist',
    name: 'BTTS Scout',
    type: 'btts',
    description: 'Especialista em identificar jogos com tendência de Ambas Marcam (BTTS)',
    specialty: 'BTTS, padrões casa/fora, consistência de gol',
    accuracy: 73.9,
    totalPredictions: 1088,
    correctPredictions: 804,
    avatar: '🕵️',
    strengths: ['Ambas Marcam', 'Tendência Casa/Fora', 'Padrões de Defesa Vulnerável'],
  },
  {
    id: 'agent-correct-score',
    name: 'ScoreOracle',
    type: 'correctscore',
    description: 'Especialista em placar correto e distribuição de gols',
    specialty: 'Correct Score, dutching, proteção contra goleadas',
    accuracy: 72.1,
    totalPredictions: 910,
    correctPredictions: 656,
    avatar: '🔢',
    strengths: ['Correct Score', 'Distribuição de Gols', 'Dutcher/Bookmaking'],
  },
];

/**
 * Simula análise de um agente de IA
 * Em produção, isso seria um modelo treinado que analisa dados reais
 */
export class AIAgent {
  profile: AgentProfile;

  constructor(profile: AgentProfile) {
    this.profile = profile;
  }

  /**
   * Gera previsão baseada em dados da partida
   * TODO: Integrar com modelo de ML real treinado em dados históricos
   */
  async predict(match: FootballMatch): Promise<AgentPrediction> {
    // Semente determinística baseada no ID da partida e ID do agente
    // Isso garante que o mesmo agente sempre dará a mesma previsão para a mesma partida
    const seedString = `${match.id}_${this.profile.id}`;
    let seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      seed = (seed << 5) - seed + seedString.charCodeAt(i);
      seed |= 0;
    }
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // Acurácia real (base + treino Kaggle + histórico)
    const baseConfidence = this.profile.accuracy;
    const variance = pseudoRandom() * 20 - 10; // -10 a +10
    const confidence = Math.max(50, Math.min(95, baseConfidence + variance));

    // Fatores de análise determinísticos
    const formWeight = pseudoRandom();
    const h2hWeight = pseudoRandom();
    const statsWeight = pseudoRandom();
    const homeAdvantage = 0.1 + pseudoRandom() * 0.15; // 10-25%
    const motivation = pseudoRandom() * 0.2; // 0-20% (necessidade de ganhar)
    const missingPlayers = pseudoRandom() * 0.15; // 0-15% (impacto de lesões/cartões)

    // Ajusta as chances baseando-se nos fatores e no "momento"
    // Como não temos a API de desfalques, simulamos de forma realista via semente determinística
    const homeScore = pseudoRandom() + homeAdvantage + formWeight - missingPlayers;
    const awayScore = pseudoRandom() + (1 - formWeight) + motivation;

    let winner: 'home' | 'away' | 'draw';
    let winnerConfidence: number;

    if (Math.abs(homeScore - awayScore) < 0.15) {
      winner = 'draw';
    } else if (homeScore > awayScore) {
      winner = 'home';
    } else {
      winner = 'away';
    }

    // Ajuste de vencedor por especialidade
    switch (this.profile.type) {
      case 'statistical':
        winnerConfidence = 60 + pseudoRandom() * 20;
        break;
      case 'form':
        winnerConfidence = 55 + pseudoRandom() * 25;
        break;
      case 'head2head':
        winnerConfidence = 50 + pseudoRandom() * 30;
        break;
      case 'advanced':
        winnerConfidence = 65 + pseudoRandom() * 25;
        break;
      case 'ensemble':
        winnerConfidence = 70 + pseudoRandom() * 20;
        break;
      case 'goals':
        winnerConfidence = 55 + pseudoRandom() * 20;
        break;
      case 'btts':
        winnerConfidence = 52 + pseudoRandom() * 18;
        break;
      case 'correctscore':
        winnerConfidence = 52 + pseudoRandom() * 20;
        break;
      default:
        winnerConfidence = 60;
    }

    const expectedGoals = Math.max(0, (pseudoRandom() * 3.2) + motivation - (missingPlayers * 1.3));
    const goalsBias = expectedGoals + (pseudoRandom() * 0.6 - 0.3);

    let overUnderLine = 2.5;
    let overUnderPrediction: 'over' | 'under' = goalsBias >= overUnderLine ? 'over' : 'under';
    let overUnderConfidence = 60 + pseudoRandom() * 25;

    if (this.profile.type === 'goals') {
      overUnderConfidence = 72 + pseudoRandom() * 20;
      overUnderPrediction = goalsBias >= overUnderLine ? 'over' : 'under';
    }

    let bttsPrediction: 'yes' | 'no' = pseudoRandom() > 0.45 ? 'yes' : 'no';
    let bttsConfidence = 65 + pseudoRandom() * 20;
    if (this.profile.type === 'goals') {
      bttsConfidence = Math.min(92, bttsConfidence + 8);
      bttsPrediction = goalsBias >= 2.2 ? 'yes' : bttsPrediction;
    }
    if (this.profile.type === 'btts') {
      const attackHome = 0.45 + (formWeight * 0.25) + (homeAdvantage * 0.1) + (pseudoRandom() * 0.25);
      const attackAway = 0.45 + (formWeight * 0.25) + (pseudoRandom() * 0.25);
      const leakHome = 0.25 + (pseudoRandom() * 0.5) + (missingPlayers * 0.2);
      const leakAway = 0.25 + (pseudoRandom() * 0.5) + (missingPlayers * 0.2);
      const bttsScore = (attackHome + attackAway + leakHome + leakAway) / 4;
      bttsPrediction = bttsScore >= 0.55 || goalsBias >= 2.35 ? 'yes' : 'no';
      const stabilityBoost = 8 + (statsWeight * 10) + (h2hWeight * 6);
      bttsConfidence = Math.min(95, 72 + pseudoRandom() * 18 + stabilityBoost);
    }

    let correctScorePrediction = this.generateScore(winner, pseudoRandom);
    let correctScoreConfidence = 35 + pseudoRandom() * 20;
    if (this.profile.type === 'correctscore') {
      correctScorePrediction = this.generateScoreForCorrectScore(winner, pseudoRandom, goalsBias);
      correctScoreConfidence = 48 + pseudoRandom() * 22;
    }

    return {
      agentName: this.profile.name,
      agentType: this.profile.type,
      confidence,
      winner,
      winnerConfidence,
      overUnder: {
        prediction: overUnderPrediction,
        line: overUnderLine,
        confidence: overUnderConfidence,
      },
      btts: {
        prediction: bttsPrediction,
        confidence: bttsConfidence,
      },
      correctScore: {
        score: correctScorePrediction,
        confidence: correctScoreConfidence,
      },
      asianHandicap: {
        team: winner === 'draw' ? 'home' : winner,
        line: winner === 'home' ? -0.5 : 0.5,
        confidence: 55 + pseudoRandom() * 25,
      },
      firstHalf: {
        prediction: pseudoRandom() > 0.6 ? 'draw' : winner,
        confidence: 50 + pseudoRandom() * 25,
      },
      secondHalf: {
        prediction: winner,
        confidence: 55 + pseudoRandom() * 25,
      },
      reasoning: this.generateReasoning(match, winner, pseudoRandom, missingPlayers, motivation, formWeight),
      factors: {
        formWeight,
        h2hWeight,
        statsWeight,
        homeAdvantage,
        motivation,
        missingPlayers,
      },
    };
  }

  private generateScore(winner: 'home' | 'away' | 'draw', randomFn: () => number): string {
    const scores = {
      home: ['2-0', '2-1', '3-1', '3-0', '1-0'],
      away: ['0-1', '0-2', '1-2', '1-3', '0-3'],
      draw: ['1-1', '0-0', '2-2', '3-3'],
    };
    const options = scores[winner];
    return options[Math.floor(randomFn() * options.length)];
  }

  private generateScoreForCorrectScore(
    winner: 'home' | 'away' | 'draw',
    randomFn: () => number,
    goalsBias: number,
  ): string {
    const low = goalsBias < 2.2;
    const high = goalsBias > 3.1;

    const pools = {
      homeLow: ['1-0', '2-0', '2-1', '1-1'],
      awayLow: ['0-1', '0-2', '1-2', '1-1'],
      drawLow: ['0-0', '1-1', '2-2'],
      homeHigh: ['3-1', '3-0', '4-1', '2-1'],
      awayHigh: ['1-3', '0-3', '1-4', '1-2'],
      drawHigh: ['2-2', '3-3'],
      homeMid: ['2-1', '1-0', '2-0', '3-1'],
      awayMid: ['1-2', '0-1', '0-2', '1-3'],
      drawMid: ['1-1', '0-0', '2-2'],
    };

    const key =
      winner === 'home'
        ? low
          ? 'homeLow'
          : high
            ? 'homeHigh'
            : 'homeMid'
        : winner === 'away'
          ? low
            ? 'awayLow'
            : high
              ? 'awayHigh'
              : 'awayMid'
          : low
            ? 'drawLow'
            : high
              ? 'drawHigh'
              : 'drawMid';

    const options = pools[key];
    return options[Math.floor(randomFn() * options.length)];
  }

  private generateReasoning(match: FootballMatch, winner: 'home' | 'away' | 'draw', randomFn: () => number, missing: number, motivation: number, form: number): string {
    const team = winner === 'home' ? match.homeTeam.name : 
                 winner === 'away' ? match.awayTeam.name : 'Ambos os times';
    
    let reason = `${team} demonstra superioridade técnica neste confronto. `;

    if (this.profile.type === 'goals') {
      reason += `Padrões de ritmo e tendência de gols (incluindo minutos finais) favoreceram a leitura de Over/Under. `;
    }
    if (this.profile.type === 'btts') {
      reason += `Análise de tendências de gol em casa/fora e vulnerabilidade defensiva indicou probabilidade relevante de Ambas Marcam. `;
    }
    if (this.profile.type === 'correctscore') {
      reason += `Modelagem de distribuição de gols para estimar placar correto e cenários de dutching. `;
    }
    if (missing > 0.1) {
      reason += `Desfalques importantes por lesão/cartões no time adversário pesaram na análise. `;
    }
    if (motivation > 0.15) {
      reason += `A alta necessidade de vitória e motivação no campeonato atual foi fator decisivo. `;
    }
    if (form > 0.7) {
      reason += `O excelente momento e retrospecto recente na competição justificam o favoritismo. `;
    }
    
    if (reason.length < 80) {
      reason += `Análise baseada em ${this.profile.specialty} com cruzamento de dados de treino.`;
    }

    return reason;
  }
}

/**
 * Sistema de Ensemble que combina previsões de múltiplos agentes
 */
export class AgentEnsemble {
  agents: AIAgent[];

  constructor(profiles: AgentProfile[]) {
    this.agents = profiles.map(profile => new AIAgent(profile));
  }

  async predictWithAllAgents(match: FootballMatch): Promise<AgentPrediction[]> {
    const predictions = await Promise.all(
      this.agents.map(agent => agent.predict(match))
    );
    return predictions;
  }

  private parseCorrectScore(score: unknown): { home: number; away: number } | null {
    const s = String(score ?? '').trim();
    const m = s.match(/^(\d+)\s*[-x×]\s*(\d+)$/i);
    if (!m) return null;
    const home = Number(m[1]);
    const away = Number(m[2]);
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
    if (home < 0 || away < 0) return null;
    if (home > 12 || away > 12) return null;
    return { home, away };
  }

  private deriveWinnerFromScore(goals: { home: number; away: number }): 'home' | 'away' | 'draw' {
    if (goals.home > goals.away) return 'home';
    if (goals.home < goals.away) return 'away';
    return 'draw';
  }

  private deriveBttsFromScore(goals: { home: number; away: number }): 'yes' | 'no' {
    return goals.home > 0 && goals.away > 0 ? 'yes' : 'no';
  }

  private deriveOverUnderFromScore(goals: { home: number; away: number }, line: number): 'over' | 'under' {
    const total = goals.home + goals.away;
    return total > line ? 'over' : 'under';
  }

  private pickCoherentCorrectScore(params: {
    predictions: AgentPrediction[];
    targetWinner: 'home' | 'away' | 'draw';
    targetBtts: 'yes' | 'no';
    targetOverUnder: 'over' | 'under';
    line: number;
  }): { score: string; confidence: number } {
    const { predictions, targetWinner, targetBtts, targetOverUnder, line } = params;

    const getAcc = (agentName: string) => {
      const agent = this.agents.find((a) => a.profile.name === agentName);
      return typeof agent?.profile?.accuracy === 'number' && Number.isFinite(agent.profile.accuracy) ? agent.profile.accuracy : 0;
    };

    const candidates = predictions
      .map((p) => {
        const goals = this.parseCorrectScore(p.correctScore?.score);
        if (!goals) return null;
        const derivedWinner = this.deriveWinnerFromScore(goals);
        const derivedBtts = this.deriveBttsFromScore(goals);
        const derivedOu = this.deriveOverUnderFromScore(goals, line);

        const winnerOk = derivedWinner === targetWinner;
        const bttsOk = derivedBtts === targetBtts;
        const ouOk = derivedOu === targetOverUnder;

        const acc = getAcc(p.agentName);
        const csConf = typeof p.correctScore?.confidence === 'number' ? Math.max(0, Math.min(100, p.correctScore.confidence)) : 45;

        const marketScore = (winnerOk ? 3 : -2) + (bttsOk ? 2 : 0) + (ouOk ? 1 : 0);
        const qualityScore = marketScore * 100 + acc * 1.0 + csConf * 1.0;

        return {
          score: String(p.correctScore?.score ?? '').trim(),
          confidence: Math.round(csConf),
          qualityScore,
          winnerOk,
          bttsOk,
          ouOk,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.qualityScore - a.qualityScore);

    const bestAll = candidates.find((c) => c.winnerOk && c.bttsOk && c.ouOk) ?? null;
    if (bestAll) return { score: bestAll.score, confidence: bestAll.confidence };

    const bestWinnerBtts = candidates.find((c) => c.winnerOk && c.bttsOk) ?? null;
    if (bestWinnerBtts) return { score: bestWinnerBtts.score, confidence: bestWinnerBtts.confidence };

    const bestWinnerOu = candidates.find((c) => c.winnerOk && c.ouOk) ?? null;
    if (bestWinnerOu) return { score: bestWinnerOu.score, confidence: bestWinnerOu.confidence };

    const bestWinner = candidates.find((c) => c.winnerOk) ?? null;
    if (bestWinner) return { score: bestWinner.score, confidence: bestWinner.confidence };

    const pickFrom = (options: string[]) => options[Math.floor(Math.random() * options.length)];

    const wantOver = targetOverUnder === 'over';
    const wantBtts = targetBtts === 'yes';

    if (targetWinner === 'draw') {
      if (wantBtts) return { score: wantOver ? pickFrom(['2-2', '3-3']) : '1-1', confidence: 58 };
      return { score: '0-0', confidence: 58 };
    }

    if (targetWinner === 'home') {
      if (wantBtts) return { score: pickFrom(['2-1', '3-1', '3-2']), confidence: 56 };
      return { score: wantOver ? pickFrom(['3-0', '4-0']) : pickFrom(['1-0', '2-0']), confidence: 56 };
    }

    if (wantBtts) return { score: pickFrom(['1-2', '1-3', '2-3']), confidence: 56 };
    return { score: wantOver ? pickFrom(['0-3', '0-4']) : pickFrom(['0-1', '0-2']), confidence: 56 };
  }

  private coercePredictionCoherence(params: {
    base: AgentPrediction;
    predictions: AgentPrediction[];
  }): AgentPrediction {
    const line = typeof params.base.overUnder?.line === 'number' ? params.base.overUnder.line : 2.5;
    const picked = this.pickCoherentCorrectScore({
      predictions: params.predictions,
      targetWinner: params.base.winner,
      targetBtts: params.base.btts.prediction,
      targetOverUnder: params.base.overUnder.prediction,
      line,
    });

    const goals = this.parseCorrectScore(picked.score);
    if (!goals) return params.base;

    const winner = this.deriveWinnerFromScore(goals);
    const bttsPrediction = this.deriveBttsFromScore(goals);
    const ouPrediction = this.deriveOverUnderFromScore(goals, line);

    const next: AgentPrediction = {
      ...params.base,
      winner,
      overUnder: { ...params.base.overUnder, line, prediction: ouPrediction },
      btts: { ...params.base.btts, prediction: bttsPrediction },
      correctScore: { score: picked.score, confidence: picked.confidence },
    };

    if (next.winner !== params.base.winner) next.winnerConfidence = Math.max(40, Math.min(90, Math.round(params.base.winnerConfidence * 0.65)));
    if (next.btts.prediction !== params.base.btts.prediction) next.btts.confidence = Math.max(40, Math.min(90, Math.round(params.base.btts.confidence * 0.65)));
    if (next.overUnder.prediction !== params.base.overUnder.prediction) next.overUnder.confidence = Math.max(40, Math.min(90, Math.round(params.base.overUnder.confidence * 0.65)));

    return next;
  }

  /**
   * Combina previsões usando ponderação por accuracy
   */
  async getConsensusPrediction(match: FootballMatch): Promise<AgentPrediction> {
    const predictions = await this.predictWithAllAgents(match);

    const meta = loadMetaModel();
    if (meta && meta.sampleCount >= 40) {
      const asSamplePreds: TrainingSample['agentPredictions'] = predictions.map((p) => ({
        agentName: p.agentName,
        agentType: p.agentType,
        winner: p.winner,
        overUnder: p.overUnder,
        btts: p.btts,
        correctScore: p.correctScore,
      }));

      const expectedWinnerDim = 1 + meta.agentNames.length * 3;
      const expectedBinDim = 1 + meta.agentNames.length;
      const okDims =
        Array.isArray(meta.winner.weights) &&
        meta.winner.weights.length === 3 &&
        meta.winner.weights.every((w) => Array.isArray(w) && w.length === expectedWinnerDim) &&
        Array.isArray(meta.btts.weights) &&
        meta.btts.weights.length === expectedBinDim &&
        Array.isArray(meta.overUnder.weights) &&
        meta.overUnder.weights.length === expectedBinDim;

      if (okDims) {
        const { bttsX, ouX, winnerX } = buildFeatureVectors(meta.agentNames, asSamplePreds);

        const winnerLogits = meta.winner.weights.map((w) => dot(w, winnerX));
        const winnerProbs = softmax(winnerLogits);
        const bestWinnerIdx = winnerProbs.indexOf(Math.max(...winnerProbs));
        const winner = meta.winner.classes[bestWinnerIdx] ?? 'home';
        const winnerConfidence = Math.round(Math.max(...winnerProbs) * 100);

        const bttsYesProb = sigmoid(dot(meta.btts.weights, bttsX));
        const bttsPrediction: 'yes' | 'no' = bttsYesProb >= 0.5 ? 'yes' : 'no';
        const bttsConfidence = Math.round(Math.max(bttsYesProb, 1 - bttsYesProb) * 100);

        const ouOverProb = sigmoid(dot(meta.overUnder.weights, ouX));
        const ouPrediction: 'over' | 'under' = ouOverProb >= 0.5 ? 'over' : 'under';
        const ouConfidence = Math.round(Math.max(ouOverProb, 1 - ouOverProb) * 100);

        const avgConfidence = Math.round((winnerConfidence + bttsConfidence + ouConfidence) / 3);

        const getBestCorrectScoreIndex = () => {
          const specialistIdx = this.agents.findIndex((a) => a.profile.type === 'correctscore');
          if (specialistIdx !== -1) return specialistIdx;
          let bestIdx = 0;
          let bestAcc = -Infinity;
          for (let i = 0; i < this.agents.length; i++) {
            const acc = this.agents[i].profile.accuracy;
            if (acc > bestAcc) {
              bestAcc = acc;
              bestIdx = i;
            }
          }
          return bestIdx;
        };
        const bestCorrectScoreIndex = getBestCorrectScoreIndex();
        const totalAccuracyLite = predictions.reduce((sum, p) => {
          const agent = this.agents.find((a) => a.profile.name === p.agentName);
          return sum + (agent?.profile.accuracy || 0);
        }, 0);

        const base: AgentPrediction = {
          agentName: 'Consenso IA',
          agentType: 'ensemble',
          confidence: avgConfidence,
          winner,
          winnerConfidence,
          overUnder: { prediction: ouPrediction, line: 2.5, confidence: ouConfidence },
          btts: { prediction: bttsPrediction, confidence: bttsConfidence },
          correctScore: predictions[bestCorrectScoreIndex]?.correctScore ?? predictions[0].correctScore,
          asianHandicap: predictions[bestCorrectScoreIndex]?.asianHandicap ?? predictions[0].asianHandicap,
          firstHalf: this.getConsensusHalf(predictions, 'first', totalAccuracyLite),
          secondHalf: this.getConsensusHalf(predictions, 'second', totalAccuracyLite),
          reasoning: `Meta-modelo treinado com ${meta.sampleCount} jogos (stacking) + consenso entre ${predictions.length} agentes`,
          factors: {
            formWeight: predictions.reduce((sum, p) => sum + p.factors.formWeight, 0) / predictions.length,
            h2hWeight: predictions.reduce((sum, p) => sum + p.factors.h2hWeight, 0) / predictions.length,
            statsWeight: predictions.reduce((sum, p) => sum + p.factors.statsWeight, 0) / predictions.length,
            homeAdvantage: predictions.reduce((sum, p) => sum + p.factors.homeAdvantage, 0) / predictions.length,
            motivation: predictions.reduce((sum, p) => sum + p.factors.motivation, 0) / predictions.length,
            missingPlayers: predictions.reduce((sum, p) => sum + p.factors.missingPlayers, 0) / predictions.length,
          },
        };
        return this.coercePredictionCoherence({ base, predictions });
      }
    }
    
    // Ponderação por accuracy de cada agente
    const totalAccuracy = predictions.reduce((sum, p) => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      return sum + (agent?.profile.accuracy || 0);
    }, 0);

    const getMarketAccuracy = (agentName: string, market: 'winner' | 'btts' | 'overUnder') => {
      const agent = this.agents.find((a) => a.profile.name === agentName);
      const byMarket = agent?.profile.marketAccuracies?.[market];
      return typeof byMarket === 'number' && Number.isFinite(byMarket) ? byMarket : agent?.profile.accuracy || 0;
    };

    const totalWinnerAccuracy = predictions.reduce((sum, p) => sum + getMarketAccuracy(p.agentName, 'winner'), 0);

    // Voto ponderado para vencedor
    const winnerVotes = { home: 0, away: 0, draw: 0 };
    predictions.forEach(p => {
      const weight = totalWinnerAccuracy > 0 ? getMarketAccuracy(p.agentName, 'winner') / totalWinnerAccuracy : 1 / predictions.length;
      winnerVotes[p.winner] += weight * p.winnerConfidence;
    });

    const winner = Object.entries(winnerVotes).reduce((a, b) => 
      a[1] > b[1] ? a : b
    )[0] as 'home' | 'away' | 'draw';

    // Média ponderada da confiança
    const avgConfidence = predictions.reduce((sum, p, i) => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      return sum + p.confidence * weight;
    }, 0);

    const getBestCorrectScoreIndex = () => {
      const specialistIdx = this.agents.findIndex((a) => a.profile.type === 'correctscore');
      if (specialistIdx !== -1) return specialistIdx;
      let bestIdx = 0;
      let bestAcc = -Infinity;
      for (let i = 0; i < this.agents.length; i++) {
        const acc = this.agents[i].profile.accuracy;
        if (acc > bestAcc) {
          bestAcc = acc;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    const bestCorrectScoreIndex = getBestCorrectScoreIndex();

    const base: AgentPrediction = {
      agentName: 'Consenso IA',
      agentType: 'ensemble',
      confidence: avgConfidence,
      winner,
      winnerConfidence: winnerVotes[winner],
      overUnder: this.getConsensusOverUnder(predictions, totalAccuracy),
      btts: this.getConsensusBTTS(predictions, totalAccuracy),
      correctScore: predictions[bestCorrectScoreIndex]?.correctScore ?? predictions[0].correctScore,
      asianHandicap: predictions[bestCorrectScoreIndex]?.asianHandicap ?? predictions[0].asianHandicap,
      firstHalf: this.getConsensusHalf(predictions, 'first', totalAccuracy),
      secondHalf: this.getConsensusHalf(predictions, 'second', totalAccuracy),
      reasoning: `Consenso de ${predictions.length} agentes especialistas com accuracy média de ${(totalAccuracy / predictions.length).toFixed(1)}%`,
      factors: {
        formWeight: predictions.reduce((sum, p) => sum + p.factors.formWeight, 0) / predictions.length,
        h2hWeight: predictions.reduce((sum, p) => sum + p.factors.h2hWeight, 0) / predictions.length,
        statsWeight: predictions.reduce((sum, p) => sum + p.factors.statsWeight, 0) / predictions.length,
        homeAdvantage: predictions.reduce((sum, p) => sum + p.factors.homeAdvantage, 0) / predictions.length,
        motivation: predictions.reduce((sum, p) => sum + p.factors.motivation, 0) / predictions.length,
        missingPlayers: predictions.reduce((sum, p) => sum + p.factors.missingPlayers, 0) / predictions.length,
      },
    };
    return this.coercePredictionCoherence({ base, predictions });
  }

  private getConsensusOverUnder(predictions: AgentPrediction[], totalAccuracy: number) {
    const getAcc = (agentName: string) => {
      const agent = this.agents.find((a) => a.profile.name === agentName);
      const byMarket = agent?.profile.marketAccuracies?.overUnder;
      return typeof byMarket === 'number' && Number.isFinite(byMarket) ? byMarket : agent?.profile.accuracy || 0;
    };
    const total = predictions.reduce((sum, p) => sum + getAcc(p.agentName), 0);
    const votes = { over: 0, under: 0 };
    predictions.forEach(p => {
      const acc = getAcc(p.agentName);
      const weight = total > 0 ? acc / total : 1 / predictions.length;
      votes[p.overUnder.prediction] += weight * p.overUnder.confidence;
    });
    return {
      prediction: votes.over > votes.under ? 'over' as const : 'under' as const,
      line: 2.5,
      confidence: Math.max(votes.over, votes.under),
    };
  }

  private getConsensusBTTS(predictions: AgentPrediction[], totalAccuracy: number) {
    const getAcc = (agentName: string) => {
      const agent = this.agents.find((a) => a.profile.name === agentName);
      const byMarket = agent?.profile.marketAccuracies?.btts;
      return typeof byMarket === 'number' && Number.isFinite(byMarket) ? byMarket : agent?.profile.accuracy || 0;
    };
    const total = predictions.reduce((sum, p) => sum + getAcc(p.agentName), 0);
    const votes = { yes: 0, no: 0 };
    predictions.forEach(p => {
      const acc = getAcc(p.agentName);
      const weight = total > 0 ? acc / total : 1 / predictions.length;
      votes[p.btts.prediction] += weight * p.btts.confidence;
    });
    return {
      prediction: votes.yes > votes.no ? 'yes' as const : 'no' as const,
      confidence: Math.max(votes.yes, votes.no),
    };
  }

  private getConsensusHalf(
    predictions: AgentPrediction[], 
    half: 'first' | 'second',
    totalAccuracy: number
  ) {
    const votes = { home: 0, away: 0, draw: 0 };
    const field = half === 'first' ? 'firstHalf' : 'secondHalf';
    
    predictions.forEach(p => {
      const agent = this.agents.find(a => a.profile.name === p.agentName);
      const weight = (agent?.profile.accuracy || 0) / totalAccuracy;
      votes[p[field].prediction] += weight * p[field].confidence;
    });

    const winner = Object.entries(votes).reduce((a, b) => 
      a[1] > b[1] ? a : b
    )[0] as 'home' | 'away' | 'draw';

    return {
      prediction: winner,
      confidence: votes[winner],
    };
  }
}
