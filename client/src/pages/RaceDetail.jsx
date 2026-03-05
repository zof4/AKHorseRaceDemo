import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import socket from '../socket.js';

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

    socket.on('pool_updated', onPoolUpdated);
    socket.on('bet_placed', onBetPlaced);

    return () => {
      socket.emit('leave_race', { raceId: numericRaceId });
      socket.off('pool_updated', onPoolUpdated);
      socket.off('bet_placed', onBetPlaced);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericRaceId]);

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
        <div className="mt-3 grid gap-2">
          {race.horses.map((horse) => (
            <div key={horse.id} className="tile">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{horse.post_position || '-'} - {horse.name}</p>
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
