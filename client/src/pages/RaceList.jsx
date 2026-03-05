import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const badgeClasses = {
  open: 'bg-emerald-100 text-emerald-800',
  upcoming: 'bg-blue-100 text-blue-800',
  closed: 'bg-amber-100 text-amber-900',
  official: 'bg-stone-200 text-stone-800'
};

export default function RaceList() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importStatus, setImportStatus] = useState('');
  const [error, setError] = useState('');

  const pad = (value) => String(value).padStart(2, '0');
  const dateKeyFor = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const extractPresetDateKey = (preset) => {
    const config = preset?.raceConfig;
    if (!config) {
      return null;
    }
    return `${config.year}-${pad(config.month)}-${pad(config.day)}`;
  };

  const importTodayTomorrow = async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const targetKeys = new Set([dateKeyFor(today), dateKeyFor(tomorrow)]);

    const { presets } = await api.listRacePresets();
    const presetIds = presets
      .filter((preset) => targetKeys.has(extractPresetDateKey(preset)))
      .map((preset) => preset.id);

    if (presetIds.length) {
      await api.importRacePresets({ presetIds });
      setImportStatus(`Auto-imported ${presetIds.length} presets for today/tomorrow.`);
    } else {
      await api.importRacePresets({});
      setImportStatus('Auto-imported default presets.');
    }

    try {
      const dates = [...targetKeys];
      const result = await api.importEquibaseRaces({ trackCode: 'OP', dates });
      if (Array.isArray(result.imported) && result.imported.length) {
        setImportStatus((prev) => `${prev} Added ${result.imported.length} live Equibase races.`);
      }
    } catch (err) {
      setImportStatus((prev) => `${prev} Live Equibase import skipped (${err.message}).`);
    }
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { races } = await api.listRaces();
      setRaces(races);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError('');
      try {
        await importTodayTomorrow();
        await load();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="grid gap-4">
      <article className="panel flex items-start justify-between gap-4">
        <div>
          <p className="kicker">Race Cards</p>
          <h2 className="page-title mt-1">Races</h2>
          <p className="text-sm text-stone-600">
            Today/tomorrow cards auto-import from presets plus live Equibase entries.
          </p>
          {importStatus ? <p className="mt-1 text-xs text-emerald-700">{importStatus}</p> : null}
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" to="/races/new">
            New Race
          </Link>
        </div>
      </article>

      <article className="panel">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Current Card</h3>
          <button className="btn-secondary" type="button" onClick={load}>
            Refresh
          </button>
        </div>

        {loading ? <p className="text-sm text-stone-500">Loading races...</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        {!loading && !error ? (
          races.length ? (
            <ul className="grid gap-3">
              {races.map((race) => (
                <li key={race.id} className="rounded-md border border-stone-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-stone-900">{race.name}</p>
                      <p className="text-xs text-stone-600">
                        {race.track} {race.race_number ? `• Race ${race.race_number}` : ''}
                      </p>
                    </div>
                    <span className={`status-chip ${badgeClasses[race.status] || 'bg-stone-100 text-stone-700'}`}>
                      {race.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    Horses: {race.horse_count} • Takeout: {(Number(race.takeout_pct) * 100).toFixed(1)}%
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Link className="btn-secondary" to={`/races/${race.id}`}>
                      View Card
                    </Link>
                    <Link className="btn-primary" to={`/races/${race.id}/bet`}>
                      Place Bet
                    </Link>
                    <Link className="btn-secondary" to={`/algorithm?raceId=${race.id}`}>
                      Open In Algorithm
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No races yet. Create one to start betting setup.</p>
          )
        ) : null}
      </article>
    </section>
  );
}
