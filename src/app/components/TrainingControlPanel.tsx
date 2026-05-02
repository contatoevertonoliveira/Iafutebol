import { useMemo, useRef, useState, useEffect } from 'react';
import { 
  Play, Pause, StopCircle, RefreshCw, Download, Database,
  Bell, BellOff, Settings, BarChart3, Clock,
  CheckCircle, XCircle, AlertCircle, Loader2
} from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { toast } from 'sonner';
import { hydrateMetaModelFromServer, importTrainingSamplesFromCsvText } from '../services/aiAgents';
import { loadApiConfig } from '../services/apiConfig';
import {
  trainingWorker,
  getTrainingAgentConfigs,
  loadTrainingSessions,
  loadNotificationConfig,
  saveNotificationConfig,
  loadIncrementalDatasets,
  downloadIncrementalDataset,
  getTrainingSummary,
  cleanupOldSessions,
  canResumeTraining,
  type TrainingSession,
  type NotificationConfig,
  type IncrementalDataset
} from '../services/optimizedTrainingService';

interface TrainingControlPanelProps {
  className?: string;
}

type ImportProgressState = {
  title: string;
  phase: string;
  processed: number;
  total: number;
  percent: number;
};

export default function TrainingControlPanel({ className = '' }: TrainingControlPanelProps) {
  const queueKey = 'training_queue_v1';
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [currentSession, setCurrentSession] = useState<TrainingSession | null>(null);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig>(loadNotificationConfig());
  const [datasets, setDatasets] = useState<IncrementalDataset[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [summary, setSummary] = useState(getTrainingSummary());
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [kaggleCsvFile, setKaggleCsvFile] = useState<File | null>(null);
  const [isImportingKaggle, setIsImportingKaggle] = useState(false);
  const [kaggleDatasetRef, setKaggleDatasetRef] = useState('technika148/football-database');
  const [kaggleFileName, setKaggleFileName] = useState('');
  const [kaggleFiles, setKaggleFiles] = useState<Array<{ name: string; size?: number }>>([]);
  const [isListingKaggleFiles, setIsListingKaggleFiles] = useState(false);
  const [localCsvFiles, setLocalCsvFiles] = useState<File[]>([]);
  const [localFolderFiles, setLocalFolderFiles] = useState<File[]>([]);
  const [isImportingLocalCsv, setIsImportingLocalCsv] = useState(false);
  const [isImportingFolder, setIsImportingFolder] = useState(false);
  const [sqliteFiles, setSqliteFiles] = useState<File[]>([]);
  const [sqliteTables, setSqliteTables] = useState<string[]>([]);
  const [sqliteCompatibleTables, setSqliteCompatibleTables] = useState<string[]>([]);
  const [sqliteSelectedTable, setSqliteSelectedTable] = useState('');
  const [sqliteImportAllTables, setSqliteImportAllTables] = useState(false);
  const [sqliteMaxRows, setSqliteMaxRows] = useState(50000);
  const [isLoadingSqliteTables, setIsLoadingSqliteTables] = useState(false);
  const [isImportingSqlite, setIsImportingSqlite] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [trainingQueue, setTrainingQueue] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(queueKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const isStartingFromQueueRef = useRef(false);

  const agentConfigs = useMemo(() => getTrainingAgentConfigs(), []);

  const isAnyImporting = isImportingKaggle || isImportingLocalCsv || isImportingFolder || isImportingSqlite;

  // Atualizar dados periodicamente
  useEffect(() => {
    (async () => {
      await hydrateMetaModelFromServer();
      refreshData();
    })();
    
    const interval = setInterval(() => {
      refreshData();
    }, 5000); // Atualizar a cada 5 segundos
    
    return () => clearInterval(interval);
  }, []);

  const refreshData = () => {
    setSessions(loadTrainingSessions());
    setCurrentSession(trainingWorker.getCurrentSession());
    setDatasets(loadIncrementalDatasets());
    setSummary(getTrainingSummary());
  };

  const norm = (s: string) => String(s ?? '').trim().toLowerCase().replaceAll(' ', '').replaceAll('-', '_');
  const hasAny = (cols: string[], predicates: Array<(h: string) => boolean>) =>
    cols.some((c) => {
      const h = norm(c);
      return predicates.some((p) => p(h));
    });
  const canImportTable = (cols: string[]) => {
    const homeTeamNameOk = hasAny(cols, [
      (h) => h === 'home_team' || h === 'hometeam',
      (h) => h.includes('home') && h.includes('team') && !h.includes('id'),
    ]);
    const awayTeamNameOk = hasAny(cols, [
      (h) => h === 'away_team' || h === 'awayteam',
      (h) => h.includes('away') && h.includes('team') && !h.includes('id'),
    ]);
    const homeGoalsOk = hasAny(cols, [
      (h) => h === 'home_score' || h === 'home_goals' || h === 'home_goal' || h === 'home_team_goal' || h === 'fthg',
      (h) =>
        h.includes('home') &&
        (h.includes('score') || h.includes('goals') || h.endsWith('_goal')) &&
        !h.includes('player') &&
        !h.includes('id'),
    ]);
    const awayGoalsOk = hasAny(cols, [
      (h) => h === 'away_score' || h === 'away_goals' || h === 'away_goal' || h === 'away_team_goal' || h === 'ftag',
      (h) =>
        h.includes('away') &&
        (h.includes('score') || h.includes('goals') || h.endsWith('_goal')) &&
        !h.includes('player') &&
        !h.includes('id'),
    ]);
    const schemaWithNames = homeTeamNameOk && awayTeamNameOk && homeGoalsOk && awayGoalsOk;

    const homeTeamIdOk = hasAny(cols, [(h) => h === 'home_team_api_id' || h === 'home_team_id']);
    const awayTeamIdOk = hasAny(cols, [(h) => h === 'away_team_api_id' || h === 'away_team_id']);
    const schemaEuropeanSoccer = homeTeamIdOk && awayTeamIdOk && hasAny(cols, [(h) => h === 'home_team_goal']) && hasAny(cols, [(h) => h === 'away_team_goal']);

    return schemaWithNames || schemaEuropeanSoccer;
  };

  const handleImportKaggleCsv = async () => {
    if (!kaggleCsvFile) {
      toast.error('Selecione um arquivo CSV');
      return;
    }

    setIsImportingKaggle(true);
    try {
      const text = await kaggleCsvFile.text();
      const title = `Importando CSV (${kaggleCsvFile.name})`;
      setImportProgress({ title, phase: 'Preparando', processed: 0, total: 0, percent: 0 });
      const result = await importTrainingSamplesFromCsvText(text, {
        maxRows: 50000,
        onProgress: (p) => setImportProgress({ title, ...p }),
      });
      toast.success(
        `Importação concluída: +${result.added} amostras (puladas: ${result.skipped}, inválidas: ${result.invalid})`,
      );
      refreshData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar CSV');
    } finally {
      setIsImportingKaggle(false);
      setImportProgress(null);
    }
  };

  const handleDownloadFromKaggle = async () => {
    const cfg = loadApiConfig();
    const username = String(cfg?.kaggleUsername ?? '').trim();
    const apiKey = String(cfg?.kaggleApiKey ?? '').trim();
    if (!username || !apiKey) {
      toast.error('Configure o usuário e a chave do Kaggle em Configurações');
      return;
    }
    const dataset = String(kaggleDatasetRef ?? '').trim();
    const fileName = String(kaggleFileName ?? '').trim();
    if (!dataset || !dataset.includes('/')) {
      toast.error('Dataset inválido. Use owner/dataset-slug');
      return;
    }
    if (!fileName) {
      toast.error('Informe o nome do arquivo (fileName) do dataset');
      return;
    }

    setIsImportingKaggle(true);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/kaggle/download-csv`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ username, apiKey, dataset, fileName, maxBytes: 12 * 1024 * 1024 }),
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(`Resposta inválida do servidor (${res.status}). ${raw.slice(0, 120)}`);
      }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `Erro ao baixar CSV do Kaggle (${res.status})`));

      const title = `Importando Kaggle (${String(data.fileName ?? 'csv')})`;
      setImportProgress({ title, phase: 'Preparando', processed: 0, total: 0, percent: 0 });
      const result = await importTrainingSamplesFromCsvText(String(data.csvText ?? ''), {
        maxRows: 50000,
        onProgress: (p) => setImportProgress({ title, ...p }),
      });
      toast.success(`Kaggle OK (${data.fileName}). +${result.added} amostras`);
      refreshData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao baixar/importar Kaggle');
    } finally {
      setIsImportingKaggle(false);
      setImportProgress(null);
    }
  };

  const handleListKaggleFiles = async () => {
    const cfg = loadApiConfig();
    const username = String(cfg?.kaggleUsername ?? '').trim();
    const apiKey = String(cfg?.kaggleApiKey ?? '').trim();
    if (!username || !apiKey) {
      toast.error('Configure o usuário e a chave do Kaggle em Configurações');
      return;
    }
    const dataset = String(kaggleDatasetRef ?? '').trim();
    if (!dataset || !dataset.includes('/')) {
      toast.error('Dataset inválido. Use owner/dataset-slug');
      return;
    }

    setIsListingKaggleFiles(true);
    try {
      const { projectId, publicAnonKey } = await import('/utils/supabase/info');
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-1119702f/kaggle/list-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${publicAnonKey}`,
        },
        body: JSON.stringify({ username, apiKey, dataset }),
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        const hint = raw.toLowerCase().includes('not found') || raw.toLowerCase().includes('cannot')
          ? ' A Edge Function parece não estar atualizada/deployada com a rota kaggle/list-files.'
          : '';
        throw new Error(`Resposta inválida do servidor (${res.status}). ${raw.slice(0, 120)}${hint}`);
      }
      if (!res.ok || !data?.ok) throw new Error(String(data?.error ?? `Erro ao listar arquivos do Kaggle (${res.status})`));
      const files = Array.isArray(data.files) ? (data.files as Array<{ name: string; size?: number }>) : [];
      setKaggleFiles(files);
      if (!kaggleFileName) {
        const preferred =
          files.find((f) => f.name.toLowerCase().endsWith('.csv') && f.name.toLowerCase().includes('match')) ??
          files.find((f) => f.name.toLowerCase().endsWith('.csv') && f.name.toLowerCase().includes('result')) ??
          files.find((f) => f.name.toLowerCase().endsWith('.csv')) ??
          null;
        if (preferred) setKaggleFileName(preferred.name);
      }
      toast.success(`Arquivos encontrados: ${files.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao listar arquivos do Kaggle');
    } finally {
      setIsListingKaggleFiles(false);
    }
  };

  const importCsvFiles = async (files: File[], label: string) => {
    const csvFiles = files.filter((f) => String(f.name || '').toLowerCase().endsWith('.csv'));
    if (csvFiles.length === 0) {
      toast.error('Nenhum CSV encontrado');
      return;
    }

    let added = 0;
    let skipped = 0;
    let invalid = 0;

    for (let i = 0; i < csvFiles.length; i++) {
      const file = csvFiles[i];
      const title = `${label} (${i + 1}/${csvFiles.length}): ${file.name}`;
      setImportProgress({ title, phase: 'Preparando', processed: 0, total: 0, percent: 0 });
      const text = await file.text();
      const result = await importTrainingSamplesFromCsvText(text, {
        maxRows: 50000,
        onProgress: (p) => setImportProgress({ title, ...p }),
      });
      added += result.added;
      skipped += result.skipped;
      invalid += result.invalid;

      if (i % 2 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    toast.success(`${label}: +${added} amostras (puladas: ${skipped}, inválidas: ${invalid})`);
    refreshData();
  };

  const handleImportLocalCsvFiles = async () => {
    if (localCsvFiles.length === 0) {
      toast.error('Selecione um ou mais arquivos CSV');
      return;
    }
    setIsImportingLocalCsv(true);
    try {
      await importCsvFiles(localCsvFiles, `Arquivos locais (${localCsvFiles.length})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar CSVs');
    } finally {
      setIsImportingLocalCsv(false);
      setImportProgress(null);
    }
  };

  const handleImportFolder = async () => {
    if (localFolderFiles.length === 0) {
      toast.error('Selecione uma pasta com arquivos CSV');
      return;
    }
    setIsImportingFolder(true);
    try {
      await importCsvFiles(localFolderFiles, `Pasta (${localFolderFiles.length} arquivo(s))`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar pasta');
    } finally {
      setIsImportingFolder(false);
      setImportProgress(null);
    }
  };

  const handleLoadSqliteTables = async () => {
    const sqliteFile = sqliteFiles[0] ?? null;
    if (!sqliteFile) {
      toast.error('Selecione um arquivo .sqlite/.db');
      return;
    }
    setIsLoadingSqliteTables(true);
    try {
      const [{ default: initSqlJs }, wasmMod] = await Promise.all([
        import('sql.js'),
        import('sql.js/dist/sql-wasm.wasm?url'),
      ]);
      const wasmUrl = (wasmMod as any).default as string;
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const buf = new Uint8Array(await sqliteFile.arrayBuffer());
      const db = new SQL.Database(buf);
      const res = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const names = (res?.[0]?.values ?? []).map((row: any[]) => String(row?.[0] ?? '')).filter(Boolean);
      const compatible: string[] = [];
      for (const t of names) {
        const pragma = db.exec(`PRAGMA table_info("${t.replaceAll('"', '""')}")`);
        const cols = (pragma?.[0]?.values ?? []).map((r: any[]) => String(r?.[1] ?? '')).filter(Boolean);
        if (cols.length > 0 && canImportTable(cols)) compatible.push(t);
      }
      setSqliteTables(names);
      setSqliteCompatibleTables(compatible);
      setSqliteSelectedTable((prev) => (prev && names.includes(prev) ? prev : compatible[0] ?? names[0] ?? ''));
      toast.success(`Tabelas: ${names.length} (compatíveis: ${compatible.length})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao ler tabelas do SQLite');
    } finally {
      setIsLoadingSqliteTables(false);
    }
  };

  const handleImportSqlite = async () => {
    if (sqliteFiles.length === 0) {
      toast.error('Selecione um arquivo .sqlite/.db');
      return;
    }
    if (sqliteFiles.length === 1 && !sqliteSelectedTable && !sqliteImportAllTables) {
      toast.error('Selecione uma tabela');
      return;
    }

    setIsImportingSqlite(true);
    try {
      const [{ default: initSqlJs }, wasmMod] = await Promise.all([
        import('sql.js'),
        import('sql.js/dist/sql-wasm.wasm?url'),
      ]);
      const wasmUrl = (wasmMod as any).default as string;
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const maxRows = Math.max(1, Math.floor(Number(sqliteMaxRows) || 50000));

      const escapeCsv = (v: unknown) => {
        const s = String(v ?? '');
        if (/[,"\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
        return s;
      };

      let totalAdded = 0;
      let totalSkipped = 0;
      let totalInvalid = 0;
      let invalidFiles = 0;
      let totalTablesImported = 0;

      for (let fIdx = 0; fIdx < sqliteFiles.length; fIdx++) {
        const file = sqliteFiles[fIdx];
        const buf = new Uint8Array(await file.arrayBuffer());
        const db = new SQL.Database(buf);

        const resTables = db.exec(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        const tables = (resTables?.[0]?.values ?? []).map((row: any[]) => String(row?.[0] ?? '')).filter(Boolean);

        const preferred = String(sqliteSelectedTable ?? '').trim();
        const importAll = sqliteFiles.length === 1 && sqliteImportAllTables;
        const targetTables = importAll
          ? (sqliteCompatibleTables.length > 0 ? sqliteCompatibleTables : tables)
          : (preferred ? [preferred] : tables);

        let importedAnyTable = false;
        for (let tIdx = 0; tIdx < targetTables.length; tIdx++) {
          const table = targetTables[tIdx];
          if (!tables.includes(table)) continue;

          const pragma = db.exec(`PRAGMA table_info("${table.replaceAll('"', '""')}")`);
          const columns = (pragma?.[0]?.values ?? []).map((r: any[]) => String(r?.[1] ?? '')).filter(Boolean);
          if (columns.length === 0) continue;
          if (!canImportTable(columns)) continue;

          const colSet = new Set(columns.map(norm));
          const isEuropeanMatch =
            colSet.has('home_team_api_id') &&
            colSet.has('away_team_api_id') &&
            colSet.has('home_team_goal') &&
            colSet.has('away_team_goal');

          let csvText = '';
          if (isEuropeanMatch) {
            const safeTable = table.replaceAll('"', '""');
            const query =
              `SELECT ` +
              `m.date AS date, ` +
              `COALESCE(l.name, '') AS league, ` +
              `COALESCE(c.name, '') AS country, ` +
              `COALESCE(th.team_long_name, CAST(m.home_team_api_id AS TEXT)) AS home_team, ` +
              `COALESCE(ta.team_long_name, CAST(m.away_team_api_id AS TEXT)) AS away_team, ` +
              `m.home_team_goal AS home_score, ` +
              `m.away_team_goal AS away_score ` +
              `FROM "${safeTable}" m ` +
              `LEFT JOIN "League" l ON m.league_id = l.id ` +
              `LEFT JOIN "Country" c ON m.country_id = c.id ` +
              `LEFT JOIN "Team" th ON m.home_team_api_id = th.team_api_id ` +
              `LEFT JOIN "Team" ta ON m.away_team_api_id = ta.team_api_id ` +
              `WHERE m.home_team_goal IS NOT NULL AND m.away_team_goal IS NOT NULL ` +
              `LIMIT ${maxRows}`;

            const data = db.exec(query);
            const result = data?.[0] ?? null;
            const outCols = Array.isArray(result?.columns) ? result.columns.map(String) : [];
            const rows = Array.isArray(result?.values) ? result.values : [];
            if (outCols.length === 0) continue;

            const csvLines: string[] = [];
            csvLines.push(outCols.map(escapeCsv).join(','));
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i] as any[];
              csvLines.push(outCols.map((_, idx) => escapeCsv(row?.[idx])).join(','));
              if (i % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
            }
            csvText = csvLines.join('\n');
          } else {
            const query = `SELECT * FROM "${table.replaceAll('"', '""')}" LIMIT ${maxRows}`;
            const data = db.exec(query);
            const rows = data?.[0]?.values ?? [];

            const csvLines: string[] = [];
            csvLines.push(columns.map(escapeCsv).join(','));
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i] as any[];
              csvLines.push(columns.map((_, idx) => escapeCsv(row?.[idx])).join(','));
              if (i % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
            }
            csvText = csvLines.join('\n');
          }

          const title = `SQLite (${file.name}) ${table} (${tIdx + 1}/${targetTables.length})`;
          setImportProgress({ title, phase: 'Preparando', processed: 0, total: 0, percent: 0 });
          const result = await importTrainingSamplesFromCsvText(csvText, {
            maxRows,
            onProgress: (p) => setImportProgress({ title, ...p }),
          });
          totalAdded += result.added;
          totalSkipped += result.skipped;
          totalInvalid += result.invalid;
          totalTablesImported += 1;
          importedAnyTable = true;

          await new Promise((r) => setTimeout(r, 0));
        }

        if (!importedAnyTable) {
          if (sqliteFiles.length === 1 && preferred && !importAll) {
            throw new Error(`Tabela "${preferred}" não encontrada/compatível em ${file.name}`);
          }
          invalidFiles += 1;
          continue;
        }

        if (fIdx % 1 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      const baseLabel =
        sqliteFiles.length === 1
          ? sqliteImportAllTables
            ? `SQLite (${sqliteFiles[0]?.name}) tabelas: ${totalTablesImported}`
            : `SQLite (${sqliteSelectedTable})`
          : `SQLite (${sqliteFiles.length} arquivos)`;
      const extra = invalidFiles > 0 ? ` (arquivos ignorados: ${invalidFiles})` : '';
      toast.success(`${baseLabel}: +${totalAdded} amostras (puladas: ${totalSkipped}, inválidas: ${totalInvalid})${extra}`);
      refreshData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao importar SQLite');
    } finally {
      setIsImportingSqlite(false);
      setImportProgress(null);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(trainingQueue));
    } catch {}
  }, [trainingQueue]);

  useEffect(() => {
    if (isStartingFromQueueRef.current) return;
    if (currentSession) return;
    if (trainingQueue.length === 0) return;

    const nextAgentId = trainingQueue[0];
    isStartingFromQueueRef.current = true;
    void trainingWorker
      .startTraining(nextAgentId)
      .then(() => {
        toast.success(`Treinamento iniciado para ${nextAgentId}`);
        setTrainingQueue((q) => q.slice(1));
        refreshData();
      })
      .catch((error) => {
        toast.error(`Erro ao iniciar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        setTrainingQueue((q) => q.slice(1));
      })
      .finally(() => {
        isStartingFromQueueRef.current = false;
      });
  }, [currentSession, trainingQueue]);

  const enqueueAgents = (agentIds: string[]) => {
    const valid = agentIds.filter((id) => agentConfigs.some((c) => c.agentId === id));
    if (valid.length === 0) return;
    setTrainingQueue((q) => {
      const set = new Set(q);
      valid.forEach((id) => set.add(id));
      return Array.from(set);
    });
    toast.success(`${valid.length} agente(s) adicionado(s) à fila`);
  };

  const toggleSelected = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(agentId)) return prev.filter((id) => id !== agentId);
      return [...prev, agentId];
    });
  };

  const latestSessionByAgent = useMemo(() => {
    const map = new Map<string, TrainingSession>();
    for (const s of sessions) {
      const prev = map.get(s.agentId);
      if (!prev || new Date(s.startTime).getTime() > new Date(prev.startTime).getTime()) {
        map.set(s.agentId, s);
      }
    }
    return map;
  }, [sessions]);

  const handleStartTraining = async (agentId: string) => {
    try {
      const sessionId = await trainingWorker.startTraining(agentId);
      toast.success(`Treinamento iniciado para ${agentId}`);
      refreshData();
    } catch (error) {
      toast.error(`Erro ao iniciar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handlePauseTraining = async () => {
    try {
      await trainingWorker.pauseTraining();
      toast.info('Treinamento pausado');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao pausar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleResumeTraining = async () => {
    try {
      await trainingWorker.resumeTraining();
      toast.info('Treinamento retomado');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao retomar treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleStopTraining = async () => {
    try {
      await trainingWorker.stopTraining();
      toast.warning('Treinamento interrompido');
      refreshData();
    } catch (error) {
      toast.error(`Erro ao interromper treinamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    }
  };

  const handleDownloadDataset = async (datasetId: string) => {
    setIsDownloading(true);
    try {
      const dataset = await downloadIncrementalDataset(datasetId);
      toast.success(`Dataset atualizado: ${dataset.newMatches} novas partidas`);
      setDatasets(loadIncrementalDatasets());
    } catch (error) {
      toast.error(`Erro ao baixar dataset: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleNotificationToggle = (key: keyof NotificationConfig) => {
    const newConfig = { ...notificationConfig, [key]: !notificationConfig[key] };
    setNotificationConfig(newConfig);
    saveNotificationConfig(newConfig);
    toast.success('Configurações de notificação atualizadas');
  };

  const handleCleanup = () => {
    cleanupOldSessions(7); // Manter apenas últimas 7 dias
    toast.info('Sessões antigas removidas');
    refreshData();
  };

  const getStatusColor = (status: TrainingSession['status']) => {
    switch (status) {
      case 'running': return 'bg-green-100 text-green-800 border-green-300';
      case 'paused': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'completed': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'failed': return 'bg-red-100 text-red-800 border-red-300';
      case 'stopped': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: TrainingSession['status']) => {
    switch (status) {
      case 'running': return <Play className="w-4 h-4" />;
      case 'paused': return <Pause className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'failed': return <XCircle className="w-4 h-4" />;
      case 'stopped': return <StopCircle className="w-4 h-4" />;
      default: return <AlertCircle className="w-4 h-4" />;
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <Card className="p-4 border border-yellow-200 bg-yellow-50 text-yellow-900">
        O treinamento exibido aqui é simulado e serve para testar o fluxo. A performance real dos agentes é calibrada pelo histórico de acertos/erros dos jogos finalizados.
      </Card>

      {isAnyImporting && importProgress && (
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{importProgress.title}</div>
              <div className="text-xs text-gray-600">
                {importProgress.phase}
                {importProgress.total > 0 ? ` • ${importProgress.processed}/${importProgress.total}` : ''}
              </div>
            </div>
            <div className="text-sm font-semibold text-gray-900 tabular-nums">{importProgress.percent}%</div>
          </div>
          <div className="mt-3">
            <Progress value={importProgress.percent} />
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-2">Kaggle (CSV)</h3>
        <div className="text-sm text-gray-600 mb-4">
          Importe um CSV real do Kaggle para criar base histórica. O sistema gera previsões dos agentes para essas partidas e salva como amostras de treino.
        </div>

        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <Label>Arquivo CSV</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="mt-2 block w-full text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setKaggleCsvFile(file);
              }}
            />
          </div>
          <Button onClick={handleImportKaggleCsv} disabled={!kaggleCsvFile || isImportingKaggle} className="bg-blue-700 hover:bg-blue-800">
            {isImportingKaggle ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Importar
          </Button>
        </div>

        <div className="mt-4 grid md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-1">
            <Label>Dataset (owner/slug)</Label>
            <input
              className="mt-2 block w-full text-sm border border-gray-200 rounded-md px-3 py-2"
              value={kaggleDatasetRef}
              onChange={(e) => setKaggleDatasetRef(e.target.value)}
              placeholder="owner/dataset-slug"
            />
          </div>
          <div className="md:col-span-1">
            <Label>fileName</Label>
            <input
              className="mt-2 block w-full text-sm border border-gray-200 rounded-md px-3 py-2"
              value={kaggleFileName}
              onChange={(e) => setKaggleFileName(e.target.value)}
              placeholder="ex: matches.csv"
              list="kaggle-files"
            />
            <datalist id="kaggle-files">
              {kaggleFiles.map((f) => (
                <option key={f.name} value={f.name} />
              ))}
            </datalist>
          </div>
          <div className="md:col-span-1">
            <div className="flex gap-2">
              <Button
                onClick={handleListKaggleFiles}
                disabled={isListingKaggleFiles || isImportingKaggle}
                variant="outline"
                className="flex-1"
              >
                {isListingKaggleFiles ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Listar
              </Button>
              <Button onClick={handleDownloadFromKaggle} disabled={isImportingKaggle} variant="outline" className="flex-1">
                {isImportingKaggle ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Baixar
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-2">Dataset Local (CSV / Pasta)</h3>
        <div className="text-sm text-gray-600 mb-4">
          Você pode baixar manualmente datasets e importar vários CSVs de uma vez, ou selecionar uma pasta com CSVs.
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Arquivos CSV (múltiplos)</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              className="mt-2 block w-full text-sm"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setLocalCsvFiles(files);
              }}
            />
            <div className="mt-1 text-xs text-gray-500">
              Selecionados: {localCsvFiles.length}
            </div>
          </div>
          <Button
            onClick={handleImportLocalCsvFiles}
            disabled={localCsvFiles.length === 0 || isImportingLocalCsv}
            className="bg-blue-700 hover:bg-blue-800"
          >
            {isImportingLocalCsv ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Importar
          </Button>
        </div>

        <div className="mt-4 grid md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Pasta (CSV)</Label>
            <input
              type="file"
              multiple
              accept=".csv,text/csv"
              className="mt-2 block w-full text-sm"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setLocalFolderFiles(files);
              }}
              {...({ webkitdirectory: 'true', directory: 'true' } as any)}
            />
            <div className="mt-1 text-xs text-gray-500">
              Arquivos detectados: {localFolderFiles.length}
            </div>
          </div>
          <Button
            onClick={handleImportFolder}
            disabled={localFolderFiles.length === 0 || isImportingFolder}
            variant="outline"
          >
            {isImportingFolder ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Importar pasta
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-2">SQLite (.sqlite / .db)</h3>
        <div className="text-sm text-gray-600 mb-4">
          Se você baixou um dataset em SQLite, selecione um ou mais arquivos. Para 1 arquivo você pode escolher a tabela; para vários, o sistema tenta detectar automaticamente a tabela compatível (ou usa o nome da tabela se você preencher).
        </div>

        <div className="grid md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <Label>Arquivos SQLite</Label>
            <input
              type="file"
              accept=".sqlite,.db,application/x-sqlite3"
              multiple
              className="mt-2 block w-full text-sm"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setSqliteFiles(files);
                setSqliteTables([]);
                setSqliteCompatibleTables([]);
                setSqliteSelectedTable('');
                setSqliteImportAllTables(false);
              }}
            />
            <div className="mt-1 text-xs text-gray-500">
              {sqliteFiles.length === 0 ? 'Nenhum arquivo selecionado' : sqliteFiles.length === 1 ? sqliteFiles[0]?.name : `${sqliteFiles.length} arquivos selecionados`}
            </div>
          </div>
          <Button
            onClick={handleLoadSqliteTables}
            disabled={sqliteFiles.length === 0 || isLoadingSqliteTables || isImportingSqlite}
            variant="outline"
          >
            {isLoadingSqliteTables ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
            Ler tabelas
          </Button>
        </div>

        <div className="mt-4 grid md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-1">
            <Label>Tabela</Label>
            <select
              className="mt-2 block w-full text-sm border border-gray-200 rounded-md px-3 py-2"
              value={sqliteSelectedTable}
              onChange={(e) => setSqliteSelectedTable(e.target.value)}
              disabled={sqliteTables.length === 0 || sqliteFiles.length > 1 || sqliteImportAllTables}
            >
              {sqliteTables.length === 0 ? (
                <option value="">Nenhuma tabela carregada</option>
              ) : (
                sqliteTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              )}
            </select>
            <div className="mt-2 flex items-center justify-between">
              <Label className="text-xs text-gray-600">Importar todas as tabelas compatíveis</Label>
              <Switch
                checked={sqliteImportAllTables}
                onCheckedChange={(checked) => setSqliteImportAllTables(checked)}
                disabled={sqliteFiles.length !== 1 || sqliteTables.length === 0}
              />
            </div>
            {sqliteFiles.length === 1 && sqliteTables.length > 0 && (
              <div className="mt-1 text-xs text-gray-500">
                Compatíveis detectadas: {sqliteCompatibleTables.length}
              </div>
            )}
          </div>
          <div className="md:col-span-1">
            <Label>Limite de linhas</Label>
            <input
              type="number"
              min={1}
              className="mt-2 block w-full text-sm border border-gray-200 rounded-md px-3 py-2"
              value={sqliteMaxRows}
              onChange={(e) => setSqliteMaxRows(Number(e.target.value))}
            />
          </div>
          <Button
            onClick={handleImportSqlite}
            disabled={sqliteFiles.length === 0 || (sqliteFiles.length === 1 && !sqliteSelectedTable && !sqliteImportAllTables) || isImportingSqlite || isLoadingSqliteTables}
            className="bg-blue-700 hover:bg-blue-800"
          >
            {isImportingSqlite ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            {sqliteFiles.length > 1 ? 'Importar todos' : sqliteImportAllTables ? 'Importar tabelas' : 'Importar SQLite'}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Controle de Treinamento
          </h3>
          <Badge className={currentSession ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
            {currentSession ? 'Worker Ativo' : 'Worker Inativo'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Button
            onClick={() => enqueueAgents(selectedAgentIds)}
            disabled={selectedAgentIds.length === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            <Play className="w-4 h-4 mr-2" />
            Treinar selecionados
          </Button>
          <Button onClick={() => enqueueAgents(agentConfigs.map((c) => c.agentId))} variant="outline">
            <Play className="w-4 h-4 mr-2" />
            Treinar todos
          </Button>
          <Button onClick={() => setSelectedAgentIds([])} variant="outline">
            Limpar seleção
          </Button>
          <Button onClick={() => setTrainingQueue([])} variant="outline">
            Limpar fila
          </Button>

          <div className="flex-1" />

          <Button
            onClick={handlePauseTraining}
            disabled={!currentSession || currentSession.status !== 'running'}
            variant="outline"
            className="border-yellow-500 text-yellow-700 hover:bg-yellow-50"
          >
            <Pause className="w-4 h-4 mr-2" />
            Pausar
          </Button>

          <Button
            onClick={handleResumeTraining}
            disabled={!currentSession || !canResumeTraining(currentSession.sessionId)}
            variant="outline"
            className="border-blue-500 text-blue-700 hover:bg-blue-50"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retomar
          </Button>

          <Button
            onClick={handleStopTraining}
            disabled={!currentSession}
            variant="outline"
            className="border-red-500 text-red-700 hover:bg-red-50"
          >
            <StopCircle className="w-4 h-4 mr-2" />
            Parar
          </Button>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="font-semibold text-gray-900 mb-2">Agentes</div>
            <div className="space-y-2">
              {agentConfigs.map((cfg) => {
                const checked = selectedAgentIds.includes(cfg.agentId);
                const latest = latestSessionByAgent.get(cfg.agentId) ?? null;
                return (
                  <div key={cfg.agentId} className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(cfg.agentId)}
                      />
                      <span className="font-medium text-gray-900 truncate">{cfg.name}</span>
                      <span className="text-xs text-gray-500 truncate">({cfg.maxEpochs} épocas)</span>
                    </label>

                    <div className="flex items-center gap-2 shrink-0">
                      {latest && (
                        <Badge className={getStatusColor(latest.status)}>
                          {getStatusIcon(latest.status)}
                          <span className="ml-1">{latest.status}</span>
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        onClick={() => {
                          if (currentSession) enqueueAgents([cfg.agentId]);
                          else void handleStartTraining(cfg.agentId);
                        }}
                        disabled={!!currentSession && trainingQueue.includes(cfg.agentId)}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Treinar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-gray-900">Fila</div>
              <Badge variant="outline">{trainingQueue.length}</Badge>
            </div>
            {trainingQueue.length === 0 ? (
              <div className="text-sm text-gray-600">Nenhum agente na fila.</div>
            ) : (
              <div className="space-y-2">
                {trainingQueue.map((agentId, idx) => {
                  const cfg = agentConfigs.find((c) => c.agentId === agentId);
                  return (
                    <div key={`${agentId}-${idx}`} className="flex items-center justify-between">
                      <div className="text-sm text-gray-900">
                        {idx + 1}. {cfg?.name ?? agentId}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTrainingQueue((q) => q.filter((id, i) => !(i === idx && id === agentId)))}
                      >
                        Remover
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sessão Atual */}
        {currentSession && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-semibold text-gray-900">{currentSession.agentId}</h4>
                <p className="text-sm text-gray-600">
                  Sessão: {currentSession.sessionId.substring(0, 8)}...
                </p>
              </div>
              <Badge className={getStatusColor(currentSession.status)}>
                {getStatusIcon(currentSession.status)}
                <span className="ml-1">{currentSession.status}</span>
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso:</span>
                <span>{currentSession.completedEpochs}/{currentSession.totalEpochs} épocas</span>
              </div>
              <Progress 
                value={(currentSession.completedEpochs / currentSession.totalEpochs) * 100} 
                className="h-2"
              />
              
              <div className="flex justify-between text-sm">
                <span>Melhor Accuracy{currentSession.simulated ? ' (simulado)' : ''}:</span>
                <span className="font-semibold">{currentSession.bestAccuracy.toFixed(2)}%</span>
              </div>
              
              <div className="flex justify-between text-sm">
                <span>Checkpoints:</span>
                <span>{currentSession.checkpoints.length} salvos</span>
              </div>

              {currentSession.status === 'failed' && currentSession.errorMessage && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {currentSession.errorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Estatísticas */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5" />
          Estatísticas de Treinamento
        </h3>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <div className="text-sm text-blue-700 mb-1">Sessões Totais</div>
            <div className="text-2xl font-bold text-blue-900">{summary.totalSessions}</div>
          </div>
          
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="text-sm text-green-700 mb-1">Concluídas</div>
            <div className="text-2xl font-bold text-green-900">{summary.completedSessions}</div>
          </div>
          
          <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
            <div className="text-sm text-yellow-700 mb-1">Tempo Total</div>
            <div className="text-2xl font-bold text-yellow-900">{summary.totalTrainingTime}h</div>
          </div>
          
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <div className="text-sm text-purple-700 mb-1">Melhoria Média (simulado)</div>
            <div className="text-2xl font-bold text-purple-900">+{summary.averageAccuracyImprovement}%</div>
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={handleCleanup}>
            Limpar Sessões Antigas
          </Button>
        </div>
      </Card>

      {/* Datasets Incrementais */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          <Download className="w-5 h-5" />
          Datasets Incrementais
        </h3>
        
        <div className="space-y-4">
          {datasets.map(dataset => (
            <div key={dataset.datasetId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
              <div>
                <h4 className="font-semibold">{dataset.name}</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>Total: {dataset.totalMatches.toLocaleString()} partidas</div>
                  <div>Novas: {dataset.newMatches.toLocaleString()} partidas</div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Último download: {new Date(dataset.lastDownloaded).toLocaleDateString()}
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col items-end gap-2">
                <Badge className={dataset.incrementalUpdates ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                  {dataset.incrementalUpdates ? 'Incremental' : 'Completo'}
                </Badge>
                <Button 
                  size="sm" 
                  onClick={() => handleDownloadDataset(dataset.datasetId)}
                  disabled={isDownloading}
                >
                  {isDownloading ? 'Baixando...' : 'Atualizar'}
                </Button>
              </div>
            </div>
          ))}
          
          {datasets.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Download className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum dataset configurado</p>
              <p className="text-sm mt-1">Configure o Kaggle API para começar</p>
            </div>
          )}
        </div>
      </Card>

      {/* Notificações */}
      <Card className="p-6">
        <h3 className="text-xl font-bold flex items-center gap-2 mb-4">
          {notificationConfig.enableToast ? (
            <Bell className="w-5 h-5 text-green-600" />
          ) : (
            <BellOff className="w-5 h-5 text-gray-400" />
          )}
          Configurações de Notificação
        </h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="toast-notifications" className="font-semibold">
                Notificações Toast
              </Label>
              <p className="text-sm text-gray-600">Mostrar notificações no navegador</p>
            </div>
            <Switch
              id="toast-notifications"
              checked={notificationConfig.enableToast}
              onCheckedChange={() => handleNotificationToggle('enableToast')}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-complete" className="font-semibold">
                Notificar Conclusão
              </Label>
              <p className="text-sm text-gray-600">Quando treinamento for concluído</p>
            </div>
            <Switch
              id="notify-complete"
              checked={notificationConfig.notifyOnComplete}
              onCheckedChange={() => handleNotificationToggle('notifyOnComplete')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-error" className="font-semibold">
                Notificar Erros
              </Label>
              <p className="text-sm text-gray-600">Quando ocorrer erro no treinamento</p>
            </div>
            <Switch
              id="notify-error"
              checked={notificationConfig.notifyOnError}
              onCheckedChange={() => handleNotificationToggle('notifyOnError')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="notify-early-stop" className="font-semibold">
                Notificar Early Stopping
              </Label>
              <p className="text-sm text-gray-600">Quando early stopping for ativado</p>
            </div>
            <Switch
              id="notify-early-stop"
              checked={notificationConfig.notifyOnEarlyStop}
              onCheckedChange={() => handleNotificationToggle('notifyOnEarlyStop')}
              disabled={!notificationConfig.enableToast}
            />
          </div>
        </div>
      </Card>

      {/* Histórico de Sessões */}
      <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">Histórico de Sessões</h3>
        
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {sessions.slice().reverse().map(session => (
            <div key={session.sessionId} className="p-3 border rounded-lg hover:bg-gray-50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(session.status)}
                  <span className="font-semibold">{session.agentId}</span>
                  <Badge className={getStatusColor(session.status)}>
                    {session.status}
                  </Badge>
                </div>
                <span className="text-sm text-gray-500">
                  {new Date(session.startTime).toLocaleDateString()}
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-gray-600">Épocas:</span>{' '}
                  <span className="font-semibold">{session.completedEpochs}/{session.totalEpochs}</span>
                </div>
                <div>
                  <span className="text-gray-600">Accuracy{session.simulated ? ' (simulado)' : ''}:</span>{' '}
                  <span className="font-semibold">{session.bestAccuracy.toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-gray-600">Checkpoints:</span>{' '}
                  <span className="font-semibold">{session.checkpoints.length}</span>
                </div>
                <div>
                  <span className="text-gray-600">Duração:</span>{' '}
                  <span className="font-semibold">
                    {session.endTime ? (
                      `${Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000)}min`
                    ) : 'Em andamento'}
                  </span>
                </div>
              </div>

              {session.status === 'failed' && session.errorMessage && (
                <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {session.errorMessage}
                </div>
              )}
              
              {session.checkpoints.length > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Primeiro checkpoint: {session.checkpoints[0].accuracy.toFixed(2)}%</span>
                    <span>Último checkpoint: {session.checkpoints[session.checkpoints.length - 1].accuracy.toFixed(2)}%</span>
                  </div>
                  <Progress 
                    value={((session.checkpoints.length * session.config.checkpointInterval) / session.totalEpochs) * 100}
                    className="h-1"
                  />
                </div>
              )}
            </div>
          ))}
          
          {sessions.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhuma sessão de treinamento registrada</p>
              <p className="text-sm mt-1">Inicie um treinamento para ver o histórico</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
