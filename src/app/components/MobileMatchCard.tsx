import { Match, Prediction } from '../data/mockData';
import { TeamLogo } from './TeamLogo';

type MobileMatchCardProps = {
  match: Match & {
    result?: { home: number | null; away: number | null };
    liveElapsed?: number | null;
    liveExtra?: number | null;
  };
  prediction?: Prediction | null;
  homeCrest?: string;
  awayCrest?: string;
  onViewDetails: (matchId: string) => void;
};

export function MobileMatchCard({ match, prediction, homeCrest, awayCrest, onViewDetails }: MobileMatchCardProps) {
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const bttsOpportunity =
    Boolean(prediction) &&
    prediction?.btts?.prediction === 'yes' &&
    typeof prediction?.btts?.confidence === 'number' &&
    prediction.btts.confidence >= 75;

  const scoreHome = typeof match.result?.home === 'number' ? match.result.home : null;
  const scoreAway = typeof match.result?.away === 'number' ? match.result.away : null;

  const liveMinute = (() => {
    if (!isLive) return null;
    if (typeof match.liveElapsed !== 'number') return null;
    const base = Math.max(0, Math.floor(match.liveElapsed));
    const extra = typeof match.liveExtra === 'number' && match.liveExtra > 0 ? match.liveExtra : null;
    if (extra) return `${base}+${extra}'`;
    return `${base}'`;
  })();

  const startsIn = (() => {
    if (isLive || isFinished) return null;
    const ms = new Date(match.date).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const mins = Math.floor(ms / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `COMEÇA EM ${m}MIN`;
    return `COMEÇA EM ${h}H ${m}MIN`;
  })();

  const prob = (() => {
    if (!prediction) return null;
    const winner = prediction.winner.prediction;
    const winnerConf = Math.max(0, Math.min(100, Math.round(prediction.winner.confidence)));
    const rest = 100 - winnerConf;
    const half = Math.round(rest / 2);
    const other = rest - half;

    const home = winner === 'home' ? winnerConf : winner === 'away' ? other : half;
    const away = winner === 'away' ? winnerConf : winner === 'home' ? other : half;
    const draw = winner === 'draw' ? winnerConf : rest - other;

    return { home, draw, away };
  })();

  const signals = (() => {
    if (!prediction || !prob) return null;
    const over15 =
      prediction.overUnder?.prediction === 'over' && typeof prediction.overUnder.confidence === 'number'
        ? Math.round(prediction.overUnder.confidence)
        : null;
    const bttsYes =
      prediction.btts?.prediction === 'yes' && typeof prediction.btts.confidence === 'number'
        ? Math.round(prediction.btts.confidence)
        : null;
    const layHome = Math.max(0, 100 - prob.home);
    const layAway = Math.max(0, 100 - prob.away);
    return { over15, bttsYes, layHome, layAway };
  })();

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 flex items-center justify-between">
        <div className="text-xs font-semibold">
          {isLive ? (
            <span className="text-red-600">● AO VIVO{liveMinute ? ` - ${liveMinute}` : ''}</span>
          ) : startsIn ? (
            <span className="text-gray-500">{startsIn}</span>
          ) : (
            <span className="text-gray-500">{isFinished ? 'FINALIZADO' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {bttsOpportunity ? (
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              BTTS SIM {Math.round(prediction!.btts.confidence)}%
            </div>
          ) : null}
          <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700">
            {match.league.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4">
        <div className="grid grid-cols-3 items-center">
          <div className="flex flex-col items-center gap-2 min-w-0">
            <TeamLogo teamName={match.homeTeam} logoUrl={homeCrest} size="lg" showName={false} />
            <div className="text-sm font-semibold truncate">{match.homeTeam}</div>
          </div>

          <div className="flex flex-col items-center justify-center">
            {typeof scoreHome === 'number' && typeof scoreAway === 'number' ? (
              <div className="text-4xl font-bold text-gray-900 tabular-nums">
                {scoreHome}-{scoreAway}
              </div>
            ) : (
              <div className="text-2xl font-bold text-gray-900 tabular-nums">{match.time}</div>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 min-w-0">
            <TeamLogo teamName={match.awayTeam} logoUrl={awayCrest} size="lg" showName={false} />
            <div className="text-sm font-semibold truncate">{match.awayTeam}</div>
          </div>
        </div>

        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl p-3">
          <div className="text-[11px] font-bold tracking-wide text-blue-700">PROBABILIDADE DE VITÓRIA (IA)</div>
          {prob ? (
            <>
              <div className="mt-2 h-2 w-full rounded-full bg-white overflow-hidden flex">
                <div className="h-full bg-blue-700" style={{ width: `${prob.home}%` }} />
                <div className="h-full bg-gray-300" style={{ width: `${prob.draw}%` }} />
                <div className="h-full bg-blue-500" style={{ width: `${prob.away}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-3 text-xs text-gray-700">
                <div className="text-left">
                  <div className="font-bold text-blue-700">{prob.home}%</div>
                  <div className="truncate">{match.homeTeam}</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-700">{prob.draw}%</div>
                  <div>Empate</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-blue-600">{prob.away}%</div>
                  <div className="truncate">{match.awayTeam}</div>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-gray-600">Gerando previsão...</div>
          )}
        </div>

        {signals ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {signals.bttsYes !== null ? (
              <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                BTTS {signals.bttsYes}%
              </div>
            ) : null}
            {signals.over15 !== null ? (
              <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                Over 1.5 {signals.over15}%
              </div>
            ) : null}
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
              Lay Casa {signals.layHome}%
            </div>
            <div className="text-[11px] font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
              Lay Fora {signals.layAway}%
            </div>
          </div>
        ) : null}

        <button
          className="mt-4 w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 rounded-xl transition-colors disabled:bg-gray-200 disabled:text-gray-600 disabled:cursor-not-allowed"
          onClick={() => onViewDetails(match.id)}
          disabled={!prediction}
        >
          Ver análise completa
        </button>
      </div>
    </div>
  );
}
