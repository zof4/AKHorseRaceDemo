import { useEffect, useMemo, useState } from 'react';
import { defaultHorses, liveRaceConfig, raceMeta, raceSources } from '../lib/algorithmSeed.js';

const NUMERIC_FIELDS = [
  'speed',
  'form',
  'class',
  'paceFit',
  'distanceFit',
  'connections',
  'consistency',
  'volatility',
  'lateKick',
  'improvingTrend'
];

const asPercent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;

const emptyHorse = (index) => ({
  name: `New Horse ${index + 1}`,
  odds: '10/1',
  speed: 70,
  form: 70,
  class: 70,
  paceFit: 70,
  distanceFit: 70,
  connections: 70,
  consistency: 70,
  volatility: 50,
  lateKick: 70,
  improvingTrend: 70,
  history: 'No note.'
});

export default function Algorithm() {
  const [horses, setHorses] = useState(() => structuredClone(defaultHorses));
  const [bankroll, setBankroll] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [status, setStatus] = useState('Waiting for first live-odds refresh.');
  const [analysis, setAnalysis] = useState(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingOdds, setLoadingOdds] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(
    () => `${raceMeta.name} | ${raceMeta.date} | ${raceMeta.class} | ${raceMeta.distance} | Purse ${raceMeta.purse}`,
    []
  );

  const runAnalysis = async (nextHorses = horses, nextBankroll = bankroll) => {
    if (nextHorses.filter((horse) => horse.name.trim()).length < 3) {
      setAnalysis(null);
      setError('Add at least three horses to run analysis.');
      return;
    }

    setLoadingAnalysis(true);
    setError('');

    try {
      const response = await fetch('/api/algorithm/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ horses: nextHorses, bankroll: nextBankroll })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Analyze failed (${response.status})`);
      }

      setAnalysis(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const refreshLiveOdds = async () => {
    if (loadingOdds) {
      return;
    }

    setLoadingOdds(true);
    setStatus('Fetching live odds...');
    setError('');

    try {
      const response = await fetch('/api/algorithm/live-odds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceConfig: liveRaceConfig,
          horseNames: horses.map((horse) => horse.name)
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Live odds failed (${response.status})`);
      }

      const oddsMap = payload.oddsByHorse || {};
      let updated = 0;
      const nextHorses = horses.map((horse) => {
        const nextOdds = oddsMap[horse.name];
        if (!nextOdds || nextOdds === horse.odds) {
          return horse;
        }
        updated += 1;
        return { ...horse, odds: nextOdds };
      });

      setHorses(nextHorses);
      setStatus(`${updated} odds updated from ${payload.provider} at ${new Date(payload.fetchedAt).toLocaleTimeString()}.`);
      await runAnalysis(nextHorses, bankroll);
    } catch (err) {
      setError(err.message);
      setStatus('Live odds refresh failed.');
    } finally {
      setLoadingOdds(false);
    }
  };

  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const ms = Math.max(15, Number(liveRaceConfig.refreshSeconds || 60)) * 1000;
    const id = setInterval(() => {
      refreshLiveOdds();
    }, ms);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, horses, bankroll]);

  const updateHorse = (index, key, rawValue) => {
    const value = NUMERIC_FIELDS.includes(key) ? Number(rawValue) : rawValue;
    const nextHorses = horses.map((horse, horseIndex) => {
      if (horseIndex !== index) {
        return horse;
      }
      if (NUMERIC_FIELDS.includes(key)) {
        const numeric = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
        return { ...horse, [key]: numeric };
      }
      return { ...horse, [key]: value };
    });

    setHorses(nextHorses);
  };

  const addHorse = () => {
    setHorses((prev) => [...prev, emptyHorse(prev.length)]);
  };

  const onRecalculate = () => {
    runAnalysis(horses, bankroll);
  };

  return (
    <section className="grid gap-4">
      <article className="panel">
        <h2 className="text-lg font-semibold">Algorithm Systems</h2>
        <p className="mt-1 text-sm text-stone-600">{summary}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-700">
          <li>Score each horse on weighted performance and risk factors.</li>
          <li>Convert base ratings into model probability and value edge vs. market odds.</li>
          <li>Generate top-five tickets plus a sleeper outside top-level picks.</li>
          <li>Produce counter-bets so users can fade the model baseline.</li>
        </ol>
      </article>

      <article className="panel">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-600">
            Bankroll ($)
            <input
              className="input mt-1"
              type="number"
              min="10"
              step="10"
              value={bankroll}
              onChange={(event) => setBankroll(Number(event.target.value) || 100)}
            />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto refresh odds
          </label>
          <button className="btn-secondary" type="button" onClick={refreshLiveOdds} disabled={loadingOdds}>
            {loadingOdds ? 'Refreshing...' : 'Refresh Live Odds'}
          </button>
          <button className="btn-secondary" type="button" onClick={addHorse}>
            Add Horse
          </button>
          <button className="btn-primary" type="button" onClick={onRecalculate} disabled={loadingAnalysis}>
            {loadingAnalysis ? 'Calculating...' : 'Recalculate'}
          </button>
        </div>
        <p className="mt-3 text-sm text-stone-600">Live odds status: {status}</p>
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </article>

      <article className="panel overflow-x-auto">
        <table className="min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-xs uppercase tracking-wide text-stone-500">
              <th className="px-2 py-2">Horse</th>
              <th className="px-2 py-2">Odds</th>
              <th className="px-2 py-2">Speed</th>
              <th className="px-2 py-2">Form</th>
              <th className="px-2 py-2">Class</th>
              <th className="px-2 py-2">Pace</th>
              <th className="px-2 py-2">Distance</th>
              <th className="px-2 py-2">Conn.</th>
              <th className="px-2 py-2">Consist.</th>
              <th className="px-2 py-2">Vol.</th>
              <th className="px-2 py-2">Late</th>
              <th className="px-2 py-2">Trend</th>
            </tr>
          </thead>
          <tbody>
            {horses.map((horse, index) => (
              <tr key={`${horse.name}-${index}`} className="border-b border-stone-200">
                <td className="px-2 py-2">
                  <input
                    className="input min-w-44"
                    value={horse.name}
                    onChange={(event) => updateHorse(index, 'name', event.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    className="input min-w-20"
                    value={horse.odds}
                    onChange={(event) => updateHorse(index, 'odds', event.target.value)}
                  />
                </td>
                {NUMERIC_FIELDS.map((field) => (
                  <td key={field} className="px-2 py-2">
                    <input
                      className="input min-w-16"
                      type="number"
                      min="0"
                      max="100"
                      value={horse[field]}
                      onChange={(event) => updateHorse(index, field, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel">
          <h3 className="text-base font-semibold">Top Five Bets</h3>
          <ul className="mt-3 grid gap-2 text-sm">
            {(analysis?.topBets || []).map((bet) => (
              <li key={`${bet.rank}-${bet.ticket}`} className="rounded-md border border-stone-200 p-2">
                <p>
                  <strong>#{bet.rank}</strong> {bet.type} - {bet.ticket}
                </p>
                <p className="text-xs text-stone-600">
                  {bet.risk} risk, stake {bet.stake}
                </p>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3 className="text-base font-semibold">Undercover Winner</h3>
          {analysis?.undercoverWinner ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
              <p>
                <strong>{analysis.undercoverWinner.name}</strong> ({analysis.undercoverWinner.odds})
              </p>
              <p>Model edge: {asPercent(analysis.undercoverWinner.valueEdge)}</p>
              <p className="text-xs text-stone-600">{analysis.undercoverWinner.history || 'No note.'}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-stone-500">No sleeper available for the current field size.</p>
          )}
        </article>

        <article className="panel">
          <h3 className="text-base font-semibold">Algorithm Slip</h3>
          <ul className="mt-3 grid gap-2 text-sm">
            {(analysis?.topBets || []).map((bet) => (
              <li key={`algo-${bet.rank}`} className="rounded-md border border-stone-200 p-2">
                {bet.type}: <strong>{bet.ticket}</strong> ({bet.stake})
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h3 className="text-base font-semibold">Opposition Slip</h3>
          <ul className="mt-3 grid gap-2 text-sm">
            {(analysis?.counterBets || []).map((bet) => (
              <li key={`counter-${bet.type}`} className="rounded-md border border-stone-200 p-2">
                {bet.type}: <strong>{bet.ticket}</strong> ({bet.stake})
              </li>
            ))}
          </ul>
        </article>
      </section>

      <article className="panel">
        <h3 className="text-base font-semibold">Three-Tier Suggestions</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {(analysis?.tierSuggestions || []).map((entry) => (
            <div key={entry.tier} className="rounded-md border border-stone-200 p-3 text-sm">
              <p className="font-semibold">{entry.tier}</p>
              <p>
                {entry.horse.name} ({entry.horse.odds})
              </p>
              <p className="text-xs text-stone-600">Model: {asPercent(entry.horse.modelProbability)}</p>
              <p className="text-xs text-stone-600">Market: {asPercent(entry.horse.marketProbability)}</p>
              <p className="text-xs text-stone-600">Edge: {asPercent(entry.horse.valueEdge)}</p>
              <p className="mt-1 text-xs text-stone-700">{entry.strategy}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Sources Used</h3>
        <ul className="mt-3 grid gap-3 text-sm">
          {raceSources.map((source) => (
            <li key={source.url} className="rounded-md border border-stone-200 p-3">
              <a className="font-semibold text-amber-900 underline" href={source.url} target="_blank" rel="noreferrer">
                {source.title}
              </a>
              <p className="mt-1 text-xs text-stone-600">{source.usedFor}</p>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
