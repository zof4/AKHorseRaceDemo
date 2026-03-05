import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const asPercent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const pad = (value) => String(value).padStart(2, '0');

const dateKeyFor = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const extractPresetDateKey = (preset) => {
  const config = preset?.raceConfig;
  if (!config) {
    return null;
  }
  return `${config.year}-${pad(config.month)}-${pad(config.day)}`;
};

const extractRaceDateKey = (race) => {
  const externalId = String(race?.external_id ?? '');
  const match = externalId.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  if (race?.post_time) {
    const date = new Date(race.post_time);
    if (!Number.isNaN(date.getTime())) {
      return dateKeyFor(date);
    }
  }

  return null;
};

export default function Algorithm() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [races, setRaces] = useState([]);
  const [race, setRace] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [bankroll, setBankroll] = useState(100);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [dayMode, setDayMode] = useState('today');
  const [loading, setLoading] = useState(true);
  const [refreshingMarket, setRefreshingMarket] = useState(false);
  const [brisnetIntel, setBrisnetIntel] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Waiting for first refresh.');

  const selectedRaceId = Number(searchParams.get('raceId') || 0);

  const todayKey = useMemo(() => {
    const now = new Date();
    return dateKeyFor(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const tomorrowKey = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dateKeyFor(tomorrow);
  }, []);

  const filteredRaces = useMemo(() => {
    const targetKey = dayMode === 'today' ? todayKey : tomorrowKey;
    const matches = races.filter((entry) => extractRaceDateKey(entry) === targetKey);
    return matches.length ? matches : races;
  }, [races, dayMode, todayKey, tomorrowKey]);

  const selectedRace = useMemo(
    () => filteredRaces.find((entry) => entry.id === selectedRaceId) ?? filteredRaces[0] ?? null,
    [filteredRaces, selectedRaceId]
  );

  const loadRaces = async () => {
    const { races } = await api.listRaces();
    setRaces(races);
    return races;
  };

  const loadRaceDetail = async (raceId) => {
    const { race } = await api.getRace(raceId);
    setRace(race);
    return race;
  };

  const runAnalysis = async (raceId, bankrollValue = bankroll) => {
    const { ranked, undercoverWinner, topBets, counterBets, tierSuggestions } = await api.analyzeRace(
      raceId,
      bankrollValue
    );
    setAnalysis({ ranked, undercoverWinner, topBets, counterBets, tierSuggestions });
  };

  const autoImportTodayTomorrow = async () => {
    const { presets } = await api.listRacePresets();
    const targetDateKeys = new Set([todayKey, tomorrowKey]);
    const presetIds = presets
      .filter((preset) => targetDateKeys.has(extractPresetDateKey(preset)))
      .map((preset) => preset.id);

    if (presetIds.length) {
      await api.importRacePresets({ presetIds });
      return;
    }

    await api.importRacePresets({});
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setError('');

      try {
        await autoImportTodayTomorrow();
        const raceRows = await loadRaces();
        if (!raceRows.length) {
          setLoading(false);
          return;
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!filteredRaces.length) {
      return;
    }

    if (!filteredRaces.some((entry) => entry.id === selectedRaceId)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('raceId', String(filteredRaces[0].id));
        return next;
      });
    }
  }, [filteredRaces, selectedRaceId, setSearchParams]);

  useEffect(() => {
    if (!selectedRace) {
      return;
    }

    const sync = async () => {
      setError('');
      try {
        await loadRaceDetail(selectedRace.id);
        await runAnalysis(selectedRace.id, bankroll);
      } catch (err) {
        setError(err.message);
      }
    };

    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace?.id]);

  useEffect(() => {
    if (!autoRefresh || !selectedRace) {
      return undefined;
    }

    const timer = setInterval(() => {
      refreshMarket();
    }, 60000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, selectedRace?.id, bankroll]);

  const refreshMarket = async () => {
    if (!selectedRace || refreshingMarket) {
      return;
    }

    setRefreshingMarket(true);
    setError('');
    setStatus('Refreshing live odds and BRISNET signals...');

    try {
      const payload = await api.refreshRaceMarket(selectedRace.id, bankroll);
      await loadRaceDetail(selectedRace.id);
      setAnalysis(payload.analysis);
      setBrisnetIntel(payload.market?.brisnet ?? null);
      setStatus(
        `Market refreshed: odds updates ${payload.updated.odds}, signal updates ${payload.updated.signals} at ${new Date(
          payload.fetchedAt
        ).toLocaleTimeString()}.`
      );
    } catch (err) {
      setError(err.message);
      setStatus('Refresh failed.');
    } finally {
      setRefreshingMarket(false);
    }
  };

  const onRaceChange = (event) => {
    const raceId = Number(event.target.value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('raceId', String(raceId));
      return next;
    });
    setBrisnetIntel(null);
  };

  const onRecalculate = async () => {
    if (!selectedRace) {
      return;
    }

    try {
      setError('');
      await runAnalysis(selectedRace.id, bankroll);
      setStatus('Analysis recalculated.');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <section className="panel">Loading algorithm workspace...</section>;
  }

  if (!races.length) {
    return (
      <section className="panel">
        <h2 className="text-lg font-semibold">Algorithm Systems</h2>
        <p className="mt-2 text-sm text-stone-600">No races are imported yet.</p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <article className="panel">
        <h2 className="text-lg font-semibold">Algorithm Systems</h2>
        <p className="mt-1 text-sm text-stone-600">
          Races auto-import from today ({todayKey}) and tomorrow ({tomorrowKey}); no manual import needed.
        </p>
        <div className="mt-3 inline-flex overflow-hidden rounded-md border border-stone-300">
          <button
            type="button"
            onClick={() => setDayMode('today')}
            className={`px-3 py-2 text-sm font-semibold ${
              dayMode === 'today' ? 'bg-amber-800 text-white' : 'bg-white text-stone-700'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDayMode('tomorrow')}
            className={`px-3 py-2 text-sm font-semibold ${
              dayMode === 'tomorrow' ? 'bg-amber-800 text-white' : 'bg-white text-stone-700'
            }`}
          >
            Tomorrow
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-600">
            Race
            <select className="input mt-1" value={selectedRace?.id ?? ''} onChange={onRaceChange}>
              {filteredRaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.track} #{entry.race_number || '-'})
                </option>
              ))}
            </select>
          </label>
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
            Auto refresh
          </label>
          <button className="btn-secondary" type="button" onClick={refreshMarket} disabled={refreshingMarket}>
            {refreshingMarket ? 'Refreshing...' : 'Refresh Market'}
          </button>
          <button className="btn-primary" type="button" onClick={onRecalculate}>
            Recalculate
          </button>
        </div>
        <p className="mt-2 text-sm text-stone-600">{status}</p>
        {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      </article>

      {race ? (
        <article className="panel">
          <h3 className="text-base font-semibold">{race.name}</h3>
          <p className="mt-1 text-xs text-stone-600">
            {race.track} • Race {race.race_number || '-'} • {race.distance || 'Distance TBD'} •
            {'  '}status: {race.status}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[900px] text-left text-sm">
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
                  <th className="px-2 py-2">BRIS</th>
                </tr>
              </thead>
              <tbody>
                {race.horses.map((horse) => (
                  <tr key={horse.id} className="border-b border-stone-200">
                    <td className="px-2 py-2">{horse.name}</td>
                    <td className="px-2 py-2">{horse.morning_line_odds || '-'}</td>
                    <td className="px-2 py-2">{Number(horse.speed_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.form_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.class_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.pace_fit_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.distance_fit_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.connections_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.consistency_rating ?? 0).toFixed(0)}</td>
                    <td className="px-2 py-2">{Number(horse.brisnet_signal ?? 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      <article className="panel">
        <h3 className="text-base font-semibold">BRISNET Intelligence</h3>
        {brisnetIntel ? (
          <div className="mt-2 grid gap-2 text-sm text-stone-700">
            <p>
              Spot Play:{' '}
              {brisnetIntel.spotPlay
                ? `${brisnetIntel.spotPlay.horseName} (Race ${brisnetIntel.spotPlay.raceNumber}, quoted ${brisnetIntel.spotPlay.quotedOdds})`
                : 'No spot play matched this selected race.'}
            </p>
            <p>
              Optix Matches:{' '}
              {Array.isArray(brisnetIntel.optixSelections) && brisnetIntel.optixSelections.length
                ? brisnetIntel.optixSelections.join(', ')
                : 'None returned for this race.'}
            </p>
            <p className="text-xs text-stone-600">
              Signal formula: baseline 50, +40 spot-play match, +25 Optix mention.
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            No BRISNET payload loaded yet. Run Refresh Market to ingest latest signals.
          </p>
        )}
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
          {(race?.sources || []).map((source) => (
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
