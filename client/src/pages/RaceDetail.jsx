import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import socket from '../socket.js';

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;
const formatPercent = (value) =>
  Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '-';
const formatSigned = (value) => {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  const number = Number(value);
  return number > 0 ? `+${number}` : String(number);
};

const poolTitle = (betType) =>
  betType
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const FINAL_STATUSES = new Set(['official']);
const LIVE_REFRESH_INTERVAL_MS = 15_000;

export default function RaceDetail() {
  const { raceId } = useParams();
  const numericRaceId = Number(raceId);

  const [race, setRace] = useState(null);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingResults, setCheckingResults] = useState(false);
  const [resultsMessage, setResultsMessage] = useState('');
  const [resultsDiagnostics, setResultsDiagnostics] = useState(null);
  const [outcomeComparison, setOutcomeComparison] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState('');
  const activeResultsDiagnostics = resultsDiagnostics ?? race?.results_metadata ?? null;
  const isFinalRace = FINAL_STATUSES.has(String(race?.status ?? '').trim().toLowerCase());

  const load = async () => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
      setError('Invalid race id.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [{ race }, { pools }] = await Promise.all([api.getRace(numericRaceId), api.getPools(numericRaceId)]);
      setRace(race);
      setResultsDiagnostics(race?.results_metadata ?? null);
      setPools(pools);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshOfficialResults = async () => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
      return;
    }

    setCheckingResults(true);
    setError('');
    setResultsMessage('');
    try {
      const payload = await api.refreshRaceResults(numericRaceId);
      setResultsDiagnostics(
        payload?.autoResultImport?.metadata ??
          (payload?.autoResultImport
            ? {
                provider: payload.autoResultImport.provider ?? null,
                fetchedAt: payload.autoResultImport.fetchedAt ?? null,
                sourceUrl: payload.autoResultImport.sourceUrl ?? null,
                diagnostics: payload.autoResultImport.diagnostics ?? null
              }
            : null)
      );
      if (payload?.settlement) {
        const providerLabel = payload?.autoResultImport?.provider ? ` from ${payload.autoResultImport.provider}` : '';
        setResultsMessage(`Official results received${providerLabel} and bets were settled.`);
      } else if (payload?.autoResultImport?.message) {
        setResultsMessage(payload.autoResultImport.message);
      } else {
        setResultsMessage('No official finish posted yet.');
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCheckingResults(false);
    }
  };

  const loadOutcomeComparison = async () => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
      return;
    }

    setComparisonLoading(true);
    setComparisonError('');
    try {
      const { comparison } = await api.getRaceOutcomeComparison(numericRaceId);
      setOutcomeComparison(comparison ?? null);
    } catch (err) {
      setOutcomeComparison(null);
      setComparisonError(err.message);
    } finally {
      setComparisonLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

  useEffect(() => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
      return;
    }
    if (!Array.isArray(race?.results) || !race.results.length) {
      setOutcomeComparison(null);
      setComparisonError('');
      setComparisonLoading(false);
      return;
    }
    loadOutcomeComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericRaceId, race?.results?.length]);

  useEffect(() => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
      return undefined;
    }

    socket.emit('join_race', { raceId: numericRaceId });

    const onPoolUpdated = (payload) => {
      if (Number(payload?.raceId) !== numericRaceId || !Array.isArray(payload?.pools)) {
        return;
      }
      setPools(payload.pools);
    };

    const onBetPlaced = (payload) => {
      if (Number(payload?.bet?.race_id) !== numericRaceId) {
        return;
      }
      load();
    };

    const onRaceStatus = (payload) => {
      if (Number(payload?.raceId) !== numericRaceId) {
        return;
      }
      load();
    };

    const onRaceResults = (payload) => {
      if (Number(payload?.raceId) !== numericRaceId) {
        return;
      }
      load();
    };

    const onBetsSettled = (payload) => {
      if (Number(payload?.raceId) !== numericRaceId) {
        return;
      }
      load();
    };

    socket.on('pool_updated', onPoolUpdated);
    socket.on('bet_placed', onBetPlaced);
    socket.on('race_status', onRaceStatus);
    socket.on('race_results', onRaceResults);
    socket.on('bets_settled', onBetsSettled);

    return () => {
      socket.emit('leave_race', { raceId: numericRaceId });
      socket.off('pool_updated', onPoolUpdated);
      socket.off('bet_placed', onBetPlaced);
      socket.off('race_status', onRaceStatus);
      socket.off('race_results', onRaceResults);
      socket.off('bets_settled', onBetsSettled);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericRaceId]);

  useEffect(() => {
    if (!Number.isInteger(numericRaceId) || numericRaceId <= 0 || isFinalRace) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      load();
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericRaceId, isFinalRace]);

  if (loading) {
    return <section className="panel">Loading race detail...</section>;
  }

  if (error) {
    return (
      <section className="panel">
        <p className="text-sm text-rose-700">{error}</p>
      </section>
    );
  }

  if (!race) {
    return (
      <section className="panel">
        <p className="text-sm text-stone-600">Race not found.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <article className="panel">
        <p className="kicker">Race Card</p>
        <h2 className="page-title mt-1">{race.name}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {race.track} • Race {race.race_number || '-'} • {race.distance || 'Distance TBD'} • {race.class || 'Class TBD'}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="tile">
            <p className="tile-title">Status</p>
            <p className="tile-value text-base capitalize">{race.status}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Takeout</p>
            <p className="tile-value text-base">{(Number(race.takeout_pct || 0) * 100).toFixed(1)}%</p>
          </div>
          <div className="tile">
            <p className="tile-title">Horses</p>
            <p className="tile-value text-base">{race.horses.length}</p>
          </div>
        </div>
        {race.horses.some((horse) => Number(horse.scratched)) ? (
          <p className="mt-2 text-xs text-rose-700">
            Scratched: {race.horses.filter((horse) => Number(horse.scratched)).map((horse) => horse.name).join(', ')}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn-primary" to={`/races/${race.id}/bet`}>
            Place Bet
          </Link>
          <Link className="btn-secondary" to={`/algorithm?raceId=${race.id}`}>
            Open In Algorithm
          </Link>
          <button className="btn-secondary" type="button" onClick={load}>
            Refresh Card
          </button>
          <button className="btn-secondary" type="button" onClick={refreshOfficialResults} disabled={checkingResults}>
            {checkingResults ? 'Checking Results...' : 'Check Official Results'}
          </button>
        </div>
        {resultsMessage ? <p className="mt-2 text-xs text-emerald-700">{resultsMessage}</p> : null}
      </article>

      {Array.isArray(race.results) && race.results.length ? (
        <article className="panel">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">Official Finish</h3>
            <button className="btn-secondary" type="button" onClick={loadOutcomeComparison} disabled={comparisonLoading}>
              {comparisonLoading ? 'Updating...' : 'Refresh Comparison'}
            </button>
          </div>
          <ul className="mt-3 grid gap-2">
            {race.results.map((result) => (
              <li key={`${result.horse_id}-${result.finish_position}`} className="tile">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">
                    {result.finish_position}. {result.horse_name}
                  </p>
                  <p className="text-xs text-stone-600">Post {result.post_position || '-'}</p>
                </div>
              </li>
            ))}
          </ul>
        </article>
      ) : race.status === 'official' ? (
        <article className="panel">
          <h3 className="text-base font-semibold">Official Finish</h3>
          <p className="mt-2 text-sm text-stone-600">Race is official, but finish order has not been synced yet.</p>
        </article>
      ) : null}

      {activeResultsDiagnostics ? (
        <article className="panel">
          <h3 className="text-base font-semibold">Results Diagnostics</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="tile">
              <p className="tile-title">Provider</p>
              <p className="tile-value text-base">{activeResultsDiagnostics.provider || '-'}</p>
            </div>
            <div className="tile">
              <p className="tile-title">Fetched</p>
              <p className="tile-value text-sm">{formatTimestamp(activeResultsDiagnostics.fetchedAt)}</p>
            </div>
            <div className="tile">
              <p className="tile-title">Extraction</p>
              <p className="tile-value text-sm">
                {activeResultsDiagnostics.diagnostics?.extraction?.label ||
                  activeResultsDiagnostics.diagnostics?.extraction?.method ||
                  '-'}
              </p>
            </div>
            <div className="tile">
              <p className="tile-title">Attempts</p>
              <p className="tile-value text-base">
                {Array.isArray(activeResultsDiagnostics.diagnostics?.attempts)
                  ? activeResultsDiagnostics.diagnostics.attempts.length
                  : '-'}
              </p>
            </div>
          </div>

          {activeResultsDiagnostics.sourceUrl ? (
            <p className="mt-3 text-xs text-stone-600">
              Source:{' '}
              <a
                className="font-semibold text-[var(--accent-main)] underline"
                href={activeResultsDiagnostics.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {activeResultsDiagnostics.sourceUrl}
              </a>
            </p>
          ) : null}

          {activeResultsDiagnostics.diagnostics?.parseCandidates ? (
            <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
              <p className="font-semibold">Parser candidates</p>
              <ul className="mt-2 grid gap-1">
                {Object.entries(activeResultsDiagnostics.diagnostics.parseCandidates).map(([key, value]) => (
                  <li key={`parse-${key}`} className="flex items-center justify-between gap-2">
                    <span>{key}</span>
                    <strong>{Number(value || 0)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ) : null}

      {Array.isArray(race.results) && race.results.length ? (
        <article className="panel">
          <h3 className="text-base font-semibold">Prediction Vs Actual</h3>
          {comparisonLoading ? <p className="mt-2 text-sm text-stone-500">Building comparison...</p> : null}
          {comparisonError ? <p className="mt-2 text-sm text-rose-700">{comparisonError}</p> : null}

          {outcomeComparison ? (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="tile">
                  <p className="tile-title">Winner</p>
                  <p className="tile-value text-base">{outcomeComparison.summary?.winnerHorse || '-'}</p>
                  <p className="text-xs text-stone-600">
                    Model rank {outcomeComparison.summary?.winnerModelRank ?? '-'} • Ending odds{' '}
                    {outcomeComparison.summary?.winnerEndingOdds || '-'}
                  </p>
                </div>
                <div className="tile">
                  <p className="tile-title">Model Top Pick</p>
                  <p className="tile-value text-base">{outcomeComparison.summary?.modelTopPick || '-'}</p>
                  <p className="text-xs text-stone-600">
                    Finished {outcomeComparison.summary?.modelTopPickFinish ?? '-'} • MAE{' '}
                    {Number.isFinite(Number(outcomeComparison.summary?.meanAbsoluteRankError))
                      ? Number(outcomeComparison.summary.meanAbsoluteRankError).toFixed(3)
                      : '-'}
                  </p>
                </div>
                <div className="tile">
                  <p className="tile-title">Exacta Order</p>
                  <p className={`tile-value text-base ${outcomeComparison.summary?.exactaOrderHit ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {outcomeComparison.summary?.exactaOrderHit ? 'Hit' : 'Miss'}
                  </p>
                </div>
                <div className="tile">
                  <p className="tile-title">Trifecta Order</p>
                  <p className={`tile-value text-base ${outcomeComparison.summary?.trifectaOrderHit ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {outcomeComparison.summary?.trifectaOrderHit ? 'Hit' : 'Miss'}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-2">
                {Array.isArray(outcomeComparison.rows)
                  ? outcomeComparison.rows.map((row) => (
                      <div key={row.horseId} className="tile">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-stone-900">
                              {row.finishPosition}. {row.horseName}
                            </p>
                            <p className="text-xs text-stone-600">
                              Model #{row.modelRank ?? '-'} • Delta {formatSigned(row.rankDelta)} • Ending odds {row.endingOdds || '-'}
                            </p>
                          </div>
                          <p className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-semibold text-stone-700">
                            Model win {formatPercent(row.modelWinProbability)}
                          </p>
                        </div>
                      </div>
                    ))
                  : null}
              </div>
            </>
          ) : null}
        </article>
      ) : null}

      <article className="panel">
        <h3 className="text-base font-semibold">Horses</h3>
        <div className="mt-3 grid gap-2">
          {race.horses.map((horse) => (
            <div key={horse.id} className={`tile ${Number(horse.scratched) ? 'border-rose-200 bg-rose-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {horse.post_position || '-'} - {horse.name}
                    {Number(horse.scratched) ? ' (SCR)' : ''}
                  </p>
                  <p className="text-xs text-stone-600">Odds {horse.morning_line_odds || '-'} • BRIS {Number(horse.brisnet_signal ?? 0).toFixed(0)}</p>
                </div>
                <p className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-semibold text-stone-700">
                  Speed {Number(horse.speed_rating ?? 0).toFixed(0)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Pools & Probables</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {pools.map((pool) => (
            <div key={pool.bet_type} className="tile">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{poolTitle(pool.bet_type)}</p>
                <p className="text-sm text-stone-600">{formatMoney(pool.total_amount)}</p>
              </div>
              {Array.isArray(pool.ladder) && pool.ladder.length ? (
                <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                  {pool.ladder.slice(0, 5).map((entry) => (
                    <li key={`${pool.bet_type}-${entry.combination}`} className="flex items-center justify-between">
                      <span>{entry.combination}</span>
                      <span>${Number(entry.probablePayoutPerDollar || 0).toFixed(2)}/$1</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-stone-500">No combinations wagered yet.</p>
              )}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
