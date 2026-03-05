import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const poolTitle = (betType) =>
  betType
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

export default function RaceDetail() {
  const { raceId } = useParams();
  const numericRaceId = Number(raceId);

  const [race, setRace] = useState(null);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      setPools(pools);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId]);

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
        <h2 className="text-lg font-semibold">{race.name}</h2>
        <p className="mt-1 text-sm text-stone-600">
          {race.track} • Race {race.race_number || '-'} • {race.distance || 'Distance TBD'} • {race.class || 'Class TBD'}
        </p>
        <p className="mt-1 text-xs text-stone-500">
          Status: {race.status} • Takeout: {(Number(race.takeout_pct || 0) * 100).toFixed(1)}%
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link className="btn-primary" to={`/races/${race.id}/bet`}>
            Place Bet
          </Link>
          <Link className="btn-secondary" to={`/algorithm?raceId=${race.id}`}>
            Open In Algorithm
          </Link>
          <button className="btn-secondary" type="button" onClick={load}>
            Refresh Pools
          </button>
        </div>
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Horses</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-stone-300 text-xs uppercase tracking-wide text-stone-500">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Horse</th>
                <th className="px-2 py-2">Odds</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2">Speed</th>
                <th className="px-2 py-2">BRIS</th>
              </tr>
            </thead>
            <tbody>
              {race.horses.map((horse) => (
                <tr key={horse.id} className="border-b border-stone-200">
                  <td className="px-2 py-2">{horse.post_position || '-'}</td>
                  <td className="px-2 py-2">{horse.name}</td>
                  <td className="px-2 py-2">{horse.morning_line_odds || '-'}</td>
                  <td className="px-2 py-2">{Number(horse.class_rating ?? 0).toFixed(0)}</td>
                  <td className="px-2 py-2">{Number(horse.speed_rating ?? 0).toFixed(0)}</td>
                  <td className="px-2 py-2">{Number(horse.brisnet_signal ?? 0).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel">
        <h3 className="text-base font-semibold">Pools & Probables</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {pools.map((pool) => (
            <div key={pool.bet_type} className="rounded-md border border-stone-200 p-3">
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
