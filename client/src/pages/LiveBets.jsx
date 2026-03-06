import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import socket from '../socket.js';

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const formatBetType = (value) =>
  String(value || '')
    .replaceAll('_', ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');

const buildPotentialEstimate = (bet, poolsByType) => {
  const pool = poolsByType[bet.bet_type];
  if (!pool?.ladder?.length || !Array.isArray(bet.expanded_combinations)) {
    return null;
  }

  const probableByCombination = new Map(
    pool.ladder.map((entry) => [String(entry.combination), Number(entry.probablePayoutPerDollar || 0)])
  );

  const payouts = bet.expanded_combinations
    .map((combo) => combo.join('-'))
    .map((combination) => probableByCombination.get(combination))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((perDollar) => Number((perDollar * Number(bet.base_amount || 0)).toFixed(2)));

  if (!payouts.length) {
    return null;
  }

  const min = Math.min(...payouts);
  const max = Math.max(...payouts);
  const mean = payouts.reduce((acc, value) => acc + value, 0) / payouts.length;
  return {
    min,
    max,
    mean: Number(mean.toFixed(2))
  };
};

export default function LiveBets() {
  const [races, setRaces] = useState([]);
  const [bets, setBets] = useState([]);
  const [raceId, setRaceId] = useState('all');
  const [poolsByRace, setPoolsByRace] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedRaceId = raceId === 'all' ? null : Number(raceId);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [{ races: nextRaces }, { bets: nextBets }] = await Promise.all([
        api.listRaces(),
        api.listBets(selectedRaceId ? { raceId: selectedRaceId } : {})
      ]);

      setRaces(nextRaces);
      setBets(nextBets);

      const raceIds = selectedRaceId
        ? [selectedRaceId]
        : [...new Set(nextBets.map((bet) => Number(bet.race_id)).filter((id) => Number.isInteger(id) && id > 0))];

      if (!raceIds.length) {
        setPoolsByRace({});
        return;
      }

      const poolsEntries = await Promise.all(
        raceIds.map(async (id) => {
          const { pools } = await api.getPools(id);
          const byType = Object.fromEntries(pools.map((pool) => [pool.bet_type, pool]));
          return [id, byType];
        })
      );
      setPoolsByRace(Object.fromEntries(poolsEntries));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedRaceId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onBetPlaced = () => load();
    const onPoolUpdated = () => load();
    const onRaceCreated = () => load();
    const onRaceResults = () => load();
    const onBetsSettled = () => load();

    socket.on('bet_placed', onBetPlaced);
    socket.on('pool_updated', onPoolUpdated);
    socket.on('race_created', onRaceCreated);
    socket.on('race_results', onRaceResults);
    socket.on('bets_settled', onBetsSettled);

    const interval = window.setInterval(load, 15000);

    return () => {
      socket.off('bet_placed', onBetPlaced);
      socket.off('pool_updated', onPoolUpdated);
      socket.off('race_created', onRaceCreated);
      socket.off('race_results', onRaceResults);
      socket.off('bets_settled', onBetsSettled);
      window.clearInterval(interval);
    };
  }, [load]);

  const racesById = useMemo(
    () => Object.fromEntries(races.map((race) => [Number(race.id), race])),
    [races]
  );

  return (
    <section className="grid gap-4">
      <article className="panel">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="kicker">Realtime Feed</p>
            <h2 className="page-title mt-1">Live Bets</h2>
            <p className="mt-1 text-sm text-stone-600">All player tickets, costs, and probable payout ranges.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-stone-600">
              Race filter
              <select
                className="input mt-1"
                value={raceId}
                onChange={(event) => setRaceId(event.target.value)}
              >
                <option value="all">All races</option>
                {races.map((race) => (
                  <option key={race.id} value={race.id}>
                    #{race.id} {race.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-secondary" type="button" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
      </article>

      <article className="panel">
        {loading ? <p className="text-sm text-stone-500">Loading bet feed...</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}

        {!loading && !error ? (
          bets.length ? (
            <ul className="grid gap-3">
              {bets.map((bet) => {
                const race = racesById[Number(bet.race_id)];
                const estimate = buildPotentialEstimate(bet, poolsByRace[Number(bet.race_id)] ?? {});
                const isSettled = typeof bet.is_winner === 'number';

                return (
                  <li key={bet.id} className="tile">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-stone-900">
                          {bet.user_name} • {formatBetType(bet.bet_type)}
                        </p>
                        <p className="text-xs text-stone-600">
                          {race?.name || `Race ${bet.race_id}`} • Modifier: {formatBetType(bet.bet_modifier)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-stone-900">{formatMoney(bet.total_cost)}</p>
                    </div>

                    <p className="mt-2 text-xs text-stone-600">
                      Combos: {bet.num_combinations} • Base: {formatMoney(bet.base_amount)}
                    </p>

                    {estimate ? (
                      <p className="mt-1 text-xs text-stone-700">
                        Potential range: {formatMoney(estimate.min)} - {formatMoney(estimate.max)} (mean{' '}
                        {formatMoney(estimate.mean)})
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-stone-500">Potential range pending pool data.</p>
                    )}

                    <p className="mt-1 text-xs text-stone-600">
                      {isSettled
                        ? `Settled: ${Number(bet.is_winner) ? 'WIN' : 'LOSS'}${
                            Number(bet.payout || 0) > 0 ? ` • Payout ${formatMoney(bet.payout)}` : ''
                          }`
                        : 'Status: Open'}
                    </p>

                    <div className="mt-3 flex gap-2">
                      <Link className="btn-secondary" to={`/races/${bet.race_id}`}>
                        View Race
                      </Link>
                      <Link className="btn-secondary" to={`/races/${bet.race_id}/bet`}>
                        Bet This Race
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No bets placed yet.</p>
          )
        ) : null}
      </article>
    </section>
  );
}
