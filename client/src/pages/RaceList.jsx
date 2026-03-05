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
  const [error, setError] = useState('');

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
    load();
  }, []);

  return (
    <section className="grid gap-4">
      <article className="panel flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Races</h2>
          <p className="text-sm text-stone-600">Manual races are available now. API race ingest lands in the next phase.</p>
        </div>
        <Link className="btn-secondary" to="/races/new">
          New Race
        </Link>
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
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                        badgeClasses[race.status] || 'bg-stone-100 text-stone-700'
                      }`}
                    >
                      {race.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    Horses: {race.horse_count} • Takeout: {(Number(race.takeout_pct) * 100).toFixed(1)}%
                  </p>
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
