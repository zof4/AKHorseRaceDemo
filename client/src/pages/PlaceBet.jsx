import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { BET_TYPES, getBetModifiersForType, getBetType } from '../lib/betTypes.js';
import { useUser } from '../context/UserContext.jsx';

const parseId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const buildInitialSelectionState = (positions) => ({
  straightPositions: Array.from({ length: positions }, () => null),
  boxHorseIds: [],
  wheelAnchorHorseId: null,
  wheelAnchorPosition: 1,
  wheelOtherHorseIds: [],
  keyHorseIds: [],
  keyOtherHorseIds: [],
  partWheelPositions: Array.from({ length: positions }, () => [])
});

export default function PlaceBet() {
  const { raceId } = useParams();
  const numericRaceId = Number(raceId);

  const { currentUser, setUser } = useUser();

  const [race, setRace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [betTypeId, setBetTypeId] = useState('exacta');
  const [betModifier, setBetModifier] = useState('straight');
  const [baseAmount, setBaseAmount] = useState(1);
  const [quote, setQuote] = useState(null);
  const [selectionState, setSelectionState] = useState(buildInitialSelectionState(2));
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [success, setSuccess] = useState('');

  const betType = useMemo(() => getBetType(betTypeId), [betTypeId]);
  const availableModifiers = useMemo(() => getBetModifiersForType(betTypeId), [betTypeId]);

  const horses = (race?.horses ?? []).filter((horse) => !Number(horse.scratched));

  useEffect(() => {
    const load = async () => {
      if (!Number.isInteger(numericRaceId) || numericRaceId <= 0) {
        setError('Invalid race id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const { race } = await api.getRace(numericRaceId);
        setRace(race);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [numericRaceId]);

  useEffect(() => {
    const minBase = Number(getBetType(betTypeId).minBase);
    if (baseAmount < minBase) {
      setBaseAmount(minBase);
    }
    setSelectionState(buildInitialSelectionState(getBetType(betTypeId).positions));
    setQuote(null);
    setSuccess('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betTypeId]);

  useEffect(() => {
    if (availableModifiers.some((modifier) => modifier.id === betModifier)) {
      return;
    }
    setBetModifier(availableModifiers[0]?.id ?? 'straight');
  }, [availableModifiers, betModifier]);

  useEffect(() => {
    setQuote(null);
    setSuccess('');
  }, [betModifier]);

  const toggleIdInList = (list, horseId) => {
    if (!horseId) {
      return list;
    }
    return list.includes(horseId) ? list.filter((id) => id !== horseId) : [...list, horseId];
  };

  const buildSelections = () => {
    switch (betModifier) {
      case 'straight': {
        const horses = selectionState.straightPositions.map((entry) => parseId(entry)).filter(Boolean);
        return { horses };
      }
      case 'box': {
        return { horses: selectionState.boxHorseIds.map((entry) => parseId(entry)).filter(Boolean) };
      }
      case 'wheel': {
        return {
          anchor_horse_id: parseId(selectionState.wheelAnchorHorseId),
          anchor_position: Number(selectionState.wheelAnchorPosition || 1),
          other_horse_ids: selectionState.wheelOtherHorseIds.map((entry) => parseId(entry)).filter(Boolean)
        };
      }
      case 'key': {
        return {
          key_horse_ids: selectionState.keyHorseIds.map((entry) => parseId(entry)).filter(Boolean),
          other_horse_ids: selectionState.keyOtherHorseIds.map((entry) => parseId(entry)).filter(Boolean)
        };
      }
      case 'part_wheel': {
        return {
          positions: selectionState.partWheelPositions.map((position) =>
            position.map((entry) => parseId(entry)).filter(Boolean)
          )
        };
      }
      default:
        return { horses: [] };
    }
  };

  const buildBetPayload = () => ({
    race_id: numericRaceId,
    bet_type: betType.id,
    bet_modifier: betModifier,
    base_amount: Number(baseAmount),
    selections: buildSelections()
  });

  const requestQuote = async () => {
    setError('');
    setSuccess('');
    setQuoting(true);

    try {
      const payload = buildBetPayload();
      const { quote } = await api.quoteBet(payload);
      setQuote(quote);
    } catch (err) {
      setError(err.message);
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  };

  const placeBet = async () => {
    if (!currentUser?.id) {
      setError('Join the room in Lobby before placing bets.');
      return;
    }

    setError('');
    setSuccess('');
    setPlacing(true);

    try {
      const payload = {
        ...buildBetPayload(),
        user_id: currentUser.id
      };

      const result = await api.placeBet(payload);
      setQuote(null);
      setSuccess(`Bet placed. New balance: ${formatMoney(result.user_balance)}.`);
      setUser({ ...currentUser, balance: result.user_balance });
    } catch (err) {
      setError(err.message);
    } finally {
      setPlacing(false);
    }
  };

  const renderHorseCheckboxes = (selectedIds, onToggle) => (
    <div className="grid gap-1 sm:grid-cols-2">
      {horses.map((horse) => (
        <label key={horse.id} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-2 py-2 text-sm">
          <input
            type="checkbox"
            checked={selectedIds.includes(horse.id)}
            onChange={() => onToggle(horse.id)}
          />
          <span>
            {horse.post_position || '-'} - {horse.name}
          </span>
        </label>
      ))}
    </div>
  );

  const renderSelectionEditor = () => {
    if (!horses.length) {
      return <p className="text-sm text-stone-500">No horses available for this race.</p>;
    }

    if (betModifier === 'straight') {
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: betType.positions }).map((_, index) => (
            <label key={index} className="text-xs text-stone-600">
              {betType.positions === 1 ? 'Selection' : `Position ${index + 1}`}
              <select
                className="input mt-1"
                value={selectionState.straightPositions[index] ?? ''}
                onChange={(event) => {
                  const next = [...selectionState.straightPositions];
                  next[index] = event.target.value ? Number(event.target.value) : null;
                  setSelectionState((prev) => ({ ...prev, straightPositions: next }));
                }}
              >
                <option value="">Select horse</option>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.post_position || '-'} - {horse.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }

    if (betModifier === 'box') {
      return renderHorseCheckboxes(selectionState.boxHorseIds, (horseId) => {
        setSelectionState((prev) => ({
          ...prev,
          boxHorseIds: toggleIdInList(prev.boxHorseIds, horseId)
        }));
      });
    }

    if (betModifier === 'wheel') {
      return (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-stone-600">
              Anchor horse
              <select
                className="input mt-1"
                value={selectionState.wheelAnchorHorseId ?? ''}
                onChange={(event) =>
                  setSelectionState((prev) => ({
                    ...prev,
                    wheelAnchorHorseId: event.target.value ? Number(event.target.value) : null
                  }))
                }
              >
                <option value="">Select horse</option>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.post_position || '-'} - {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-600">
              Anchor position
              <select
                className="input mt-1"
                value={selectionState.wheelAnchorPosition}
                onChange={(event) =>
                  setSelectionState((prev) => ({
                    ...prev,
                    wheelAnchorPosition: Number(event.target.value)
                  }))
                }
              >
                {Array.from({ length: betType.positions }).map((_, index) => (
                  <option key={index + 1} value={index + 1}>
                    Position {index + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-600">Other horses</p>
            {renderHorseCheckboxes(selectionState.wheelOtherHorseIds, (horseId) => {
              setSelectionState((prev) => ({
                ...prev,
                wheelOtherHorseIds: toggleIdInList(prev.wheelOtherHorseIds, horseId)
              }));
            })}
          </div>
        </div>
      );
    }

    if (betModifier === 'key') {
      return (
        <div className="grid gap-3">
          <div>
            <p className="mb-2 text-xs text-stone-600">Key horse(s)</p>
            {renderHorseCheckboxes(selectionState.keyHorseIds, (horseId) => {
              setSelectionState((prev) => ({
                ...prev,
                keyHorseIds: toggleIdInList(prev.keyHorseIds, horseId)
              }));
            })}
          </div>
          <div>
            <p className="mb-2 text-xs text-stone-600">Other horses</p>
            {renderHorseCheckboxes(selectionState.keyOtherHorseIds, (horseId) => {
              setSelectionState((prev) => ({
                ...prev,
                keyOtherHorseIds: toggleIdInList(prev.keyOtherHorseIds, horseId)
              }));
            })}
          </div>
        </div>
      );
    }

    if (betModifier === 'part_wheel') {
      return (
        <div className="grid gap-3">
          {Array.from({ length: betType.positions }).map((_, index) => (
            <div key={index}>
              <p className="mb-2 text-xs text-stone-600">Position {index + 1} candidates</p>
              {renderHorseCheckboxes(selectionState.partWheelPositions[index] || [], (horseId) => {
                setSelectionState((prev) => {
                  const next = [...prev.partWheelPositions];
                  next[index] = toggleIdInList(next[index] || [], horseId);
                  return { ...prev, partWheelPositions: next };
                });
              })}
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  if (loading) {
    return <section className="panel">Loading bet slip...</section>;
  }

  if (error && !race) {
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
        <p className="kicker">Ticket Builder</p>
        <h2 className="page-title mt-1">Place Bet</h2>
        <p className="mt-1 text-sm text-stone-600">
          {race.name} • {race.track} • Race {race.race_number || '-'}
        </p>
        {Array.isArray(race.horses) && race.horses.some((horse) => Number(horse.scratched)) ? (
          <p className="mt-1 text-xs text-rose-700">
            Scratched: {race.horses.filter((horse) => Number(horse.scratched)).map((horse) => horse.name).join(', ')}
          </p>
        ) : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="tile">
            <p className="tile-title">Active User</p>
            <p className="tile-value text-base">{currentUser?.name || 'Not joined'}</p>
          </div>
          <div className="tile">
            <p className="tile-title">Available Bankroll</p>
            <p className="tile-value text-base">{currentUser ? formatMoney(currentUser.balance) : '$0.00'}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Link className="btn-secondary" to={`/races/${race.id}`}>
            Back To Race
          </Link>
          <Link className="btn-secondary" to="/lobby">
            Go To Lobby
          </Link>
        </div>
      </article>

      <article className="panel grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-stone-600">
            Bet type
            <select className="input mt-1" value={betType.id} onChange={(event) => setBetTypeId(event.target.value)}>
              {BET_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-stone-600">
            Modifier
            <select className="input mt-1" value={betModifier} onChange={(event) => setBetModifier(event.target.value)}>
              {availableModifiers.map((modifier) => (
                <option key={modifier.id} value={modifier.id}>
                  {modifier.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-stone-600">
            Base amount ($)
            <input
              className="input mt-1"
              type="number"
              min={betType.minBase}
              step={betType.minBase < 1 ? 0.1 : 1}
              value={baseAmount}
              onChange={(event) => setBaseAmount(Number(event.target.value) || betType.minBase)}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-[#dfcfbb] bg-[#fffaf3] p-3">
          <h3 className="mb-2 text-sm font-semibold text-stone-800">Selections</h3>
          {renderSelectionEditor()}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" onClick={requestQuote} disabled={quoting}>
            {quoting ? 'Quoting...' : 'Get Quote'}
          </button>
          <button className="btn-primary" type="button" onClick={placeBet} disabled={placing || !currentUser?.id}>
            {placing ? 'Placing...' : 'Place Bet'}
          </button>
        </div>

        {quote ? (
          <div className="rounded-2xl border border-[#ddcdb9] bg-[#fffaf3] p-3 text-sm">
            <p>
              Combinations: <strong>{quote.num_combinations}</strong> • Total Cost:{' '}
              <strong>{formatMoney(quote.total_cost)}</strong>
            </p>
            <p className="mt-1 text-xs text-stone-600">
              Estimated payout range: {formatMoney(quote.estimate?.estimatedMin)} -{' '}
              {formatMoney(quote.estimate?.estimatedMax)} (mean {formatMoney(quote.estimate?.estimatedMean)})
            </p>
            {Array.isArray(quote.estimate?.scenarios) && quote.estimate.scenarios.length ? (
              <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                {quote.estimate.scenarios.slice(0, 6).map((scenario) => (
                  <li key={scenario.combination} className="flex items-center justify-between">
                    <span>{scenario.combination}</span>
                    <span>{formatMoney(scenario.ticketPayout)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      </article>
    </section>
  );
}
