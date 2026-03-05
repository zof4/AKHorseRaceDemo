import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../context/UserContext.jsx';
import { api } from '../lib/api.js';
import { BET_MODIFIERS, BET_TYPES, getBetType } from '../lib/betTypes.js';

const parseId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const normalizeHorseName = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const cleanHorseFragment = (value) =>
  String(value ?? '')
    .replace(/\(.*?\)/g, '')
    .replace(/\bover field\b.*$/i, '')
    .replace(/\bagainst\b.*$/i, '')
    .replace(/\bexclude\b.*$/i, '')
    .replace(/\bno\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

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

const inRange = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }
  return fallback;
};

const sanitizeHorseId = (value, allowedHorseIds) => {
  const parsed = parseId(value);
  return parsed && allowedHorseIds.has(parsed) ? parsed : null;
};

const sanitizeHorseIdList = (values, allowedHorseIds, blockedHorseIds = new Set()) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const sanitized = [];

  for (const raw of values) {
    const horseId = sanitizeHorseId(raw, allowedHorseIds);
    if (!horseId || blockedHorseIds.has(horseId) || seen.has(horseId)) {
      continue;
    }
    seen.add(horseId);
    sanitized.push(horseId);
  }

  return sanitized;
};

const sanitizeSelectionState = (value, positions, allowedHorseIds) => {
  const source = value && typeof value === 'object' ? value : buildInitialSelectionState(positions);
  const keyHorseIds = sanitizeHorseIdList(source.keyHorseIds, allowedHorseIds);
  const keyHorseIdSet = new Set(keyHorseIds);
  const wheelAnchorHorseId = sanitizeHorseId(source.wheelAnchorHorseId, allowedHorseIds);
  const wheelAnchorSet = wheelAnchorHorseId ? new Set([wheelAnchorHorseId]) : new Set();

  return {
    straightPositions: Array.from({ length: positions }, (_, index) =>
      sanitizeHorseId(source.straightPositions?.[index], allowedHorseIds)
    ),
    boxHorseIds: sanitizeHorseIdList(source.boxHorseIds, allowedHorseIds),
    wheelAnchorHorseId,
    wheelAnchorPosition: inRange(source.wheelAnchorPosition, 1, positions, 1),
    wheelOtherHorseIds: sanitizeHorseIdList(source.wheelOtherHorseIds, allowedHorseIds, wheelAnchorSet),
    keyHorseIds,
    keyOtherHorseIds: sanitizeHorseIdList(source.keyOtherHorseIds, allowedHorseIds, keyHorseIdSet),
    partWheelPositions: Array.from({ length: positions }, (_, index) =>
      sanitizeHorseIdList(source.partWheelPositions?.[index], allowedHorseIds)
    )
  };
};

const findHorseIdByName = (horses, horseName) => {
  const key = normalizeHorseName(horseName);
  if (!key) {
    return null;
  }
  return horses.find((horse) => normalizeHorseName(horse.name) === key)?.id ?? null;
};

const derivePrefillFromDraft = (draft, horses) => {
  const ticket = String(draft?.suggestedTicket ?? '');
  const suggestedType = String(draft?.suggestedType ?? '').toLowerCase();
  const focusHorseId = findHorseIdByName(horses, draft?.focusHorseName);

  const exactaSplit = ticket.split('/').map((entry) => cleanHorseFragment(entry)).filter(Boolean);
  const trifectaMatch = ticket.match(/^(.+?)\s+with\s+(.+)$/i);
  const trifectaFieldMatch = ticket.match(/^(.+?)\s+over\s+field/i);
  const winPlaceMatch = ticket.match(/^(.+?)\s+to\s+(?:win|place)\b/i);

  if (suggestedType.includes('exacta') || exactaSplit.length >= 2) {
    const ids = exactaSplit
      .slice(0, 4)
      .map((name) => findHorseIdByName(horses, name))
      .filter(Boolean);

    if (ids.length >= 2) {
      return {
        betTypeId: 'exacta',
        betModifier: 'box',
        selections: {
          ...buildInitialSelectionState(2),
          boxHorseIds: ids
        }
      };
    }
  }

  if (suggestedType.includes('trifecta') || trifectaMatch) {
    const fallbackNames = String(trifectaFieldMatch?.[1] ?? '')
      .split(',')
      .map((entry) => cleanHorseFragment(entry))
      .filter(Boolean);
    const anchorName = cleanHorseFragment(trifectaMatch?.[1] ?? fallbackNames[0] ?? '');
    const others = trifectaMatch
      ? String(trifectaMatch[2])
          .split(',')
          .map((entry) => cleanHorseFragment(entry))
          .filter(Boolean)
      : fallbackNames.slice(1);

    const anchorId = findHorseIdByName(horses, anchorName);
    const otherIds = others
      .map((name) => findHorseIdByName(horses, name))
      .filter(Boolean);

    return {
      betTypeId: 'trifecta',
      betModifier: 'key',
      selections: {
        ...buildInitialSelectionState(3),
        keyHorseIds: anchorId ? [anchorId] : focusHorseId ? [focusHorseId] : [],
        keyOtherHorseIds: otherIds
      }
    };
  }

  if (winPlaceMatch || focusHorseId) {
    const nameFromTicket = cleanHorseFragment(winPlaceMatch?.[1] ?? '');
    const ticketHorseId = findHorseIdByName(horses, nameFromTicket);
    const keyHorseId = ticketHorseId ?? focusHorseId ?? null;

    return {
      betTypeId: 'exacta',
      betModifier: 'key',
      selections: {
        ...buildInitialSelectionState(2),
        keyHorseIds: keyHorseId ? [keyHorseId] : []
      }
    };
  }

  return {
    betTypeId: 'exacta',
    betModifier: 'straight',
    selections: buildInitialSelectionState(2)
  };
};

export default function BetPlacementModal({ isOpen, race, draft, onClose, onBetPlaced }) {
  const { currentUser, setUser } = useUser();
  const [betTypeId, setBetTypeId] = useState('exacta');
  const [betModifier, setBetModifier] = useState('straight');
  const [baseAmount, setBaseAmount] = useState(1);
  const [selectionState, setSelectionState] = useState(buildInitialSelectionState(2));
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [quoting, setQuoting] = useState(false);
  const [placing, setPlacing] = useState(false);

  const horses = useMemo(() => (race?.horses ?? []).filter((horse) => !Number(horse.scratched)), [race]);
  const scratchedHorses = useMemo(() => (race?.horses ?? []).filter((horse) => Number(horse.scratched)), [race]);
  const allowedHorseIds = useMemo(() => new Set(horses.map((horse) => Number(horse.id))), [horses]);
  const betType = useMemo(() => getBetType(betTypeId), [betTypeId]);

  useEffect(() => {
    if (!isOpen || !race) {
      return;
    }

    const prefill = derivePrefillFromDraft(draft, horses);
    const initialType = getBetType(prefill.betTypeId);
    const sanitizedSelections = sanitizeSelectionState(prefill.selections, initialType.positions, allowedHorseIds);

    setBetTypeId(initialType.id);
    setBetModifier(prefill.betModifier);
    setBaseAmount(initialType.minBase);
    setSelectionState(sanitizedSelections);
    setQuote(null);
    setError('');
    setSuccess('');
  }, [isOpen, race, draft, horses, allowedHorseIds]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectionState((previous) => sanitizeSelectionState(previous, betType.positions, allowedHorseIds));
    setQuote(null);
  }, [isOpen, betType.positions, allowedHorseIds]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const minBase = Number(getBetType(betTypeId).minBase);
    if (baseAmount < minBase) {
      setBaseAmount(minBase);
    }
  }, [baseAmount, betTypeId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setQuote(null);
    setSuccess('');
  }, [betModifier, isOpen]);

  const toggleIdInList = (list, horseId) => {
    if (!horseId) {
      return list;
    }
    return list.includes(horseId) ? list.filter((id) => id !== horseId) : [...list, horseId];
  };

  const buildSelections = () => {
    switch (betModifier) {
      case 'straight':
        return {
          horses: selectionState.straightPositions.map((entry) => parseId(entry)).filter(Boolean)
        };
      case 'box':
        return {
          horses: selectionState.boxHorseIds.map((entry) => parseId(entry)).filter(Boolean)
        };
      case 'wheel':
        return {
          anchor_horse_id: parseId(selectionState.wheelAnchorHorseId),
          anchor_position: Number(selectionState.wheelAnchorPosition || 1),
          other_horse_ids: selectionState.wheelOtherHorseIds.map((entry) => parseId(entry)).filter(Boolean)
        };
      case 'key':
        return {
          key_horse_ids: selectionState.keyHorseIds.map((entry) => parseId(entry)).filter(Boolean),
          other_horse_ids: selectionState.keyOtherHorseIds.map((entry) => parseId(entry)).filter(Boolean)
        };
      case 'part_wheel':
        return {
          positions: selectionState.partWheelPositions.map((position) =>
            position.map((entry) => parseId(entry)).filter(Boolean)
          )
        };
      default:
        return { horses: [] };
    }
  };

  const buildBetPayload = () => ({
    race_id: Number(race?.id),
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
      const { quote: quoteResult } = await api.quoteBet(payload);
      setQuote(quoteResult);
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
      onBetPlaced?.(result);
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
          <input type="checkbox" checked={selectedIds.includes(horse.id)} onChange={() => onToggle(horse.id)} />
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
              Position {index + 1}
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

  if (!isOpen || !race) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[2100] px-3 py-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:py-6">
      <button type="button" className="absolute inset-0 bg-stone-950/55" aria-label="Close bet builder" onClick={onClose} />
      <section
        className="relative mx-auto flex h-[min(92dvh,920px)] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-[#d9c8b1] bg-[var(--bg-surface)] shadow-[0_20px_65px_rgba(0,0,0,0.45)]"
        role="dialog"
        aria-modal="true"
        aria-label="Algorithm bet builder"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#e4d7c6] bg-[var(--bg-surface)] px-4 py-3 md:px-5">
          <div>
            <p className="kicker">Bet Builder</p>
            <h3 className="text-base font-semibold">Place Algorithm Bet</h3>
            <p className="text-xs text-stone-600">{draft?.label || 'Build and place this ticket directly from algorithm output.'}</p>
          </div>
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 pb-6 md:px-5 [touch-action:pan-y]" style={{ WebkitOverflowScrolling: 'touch' }}>
          {draft?.suggestedTicket ? (
            <div className="mb-3 rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-3 text-sm">
              <p className="font-semibold text-stone-800">Suggested Ticket</p>
              <p className="mt-1 text-stone-700">{draft.suggestedTicket}</p>
              {draft?.suggestedStake ? <p className="mt-1 text-xs text-stone-600">Suggested stake: {draft.suggestedStake}</p> : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-stone-600">
              Bet type
              <select
                className="input mt-1"
                value={betType.id}
                onChange={(event) => {
                  const nextType = getBetType(event.target.value);
                  setBetTypeId(nextType.id);
                  setSelectionState(buildInitialSelectionState(nextType.positions));
                }}
              >
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
                {BET_MODIFIERS.map((modifier) => (
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

          <div className="mt-3 rounded-xl border border-[#dfcfbb] bg-[#fffaf3] p-3">
            <h4 className="mb-2 text-sm font-semibold text-stone-800">Selections</h4>
            {scratchedHorses.length ? (
              <p className="mb-2 text-xs text-stone-600">
                Scratched (not bettable): {scratchedHorses.map((horse) => horse.name).join(', ')}
              </p>
            ) : null}
            {renderSelectionEditor()}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="tile">
              <p className="tile-title">Active User</p>
              <p className="tile-value text-base">{currentUser?.name || 'Not joined'}</p>
              {!currentUser?.id ? (
                <p className="mt-1 text-xs text-rose-700">Join the lobby first to place bets.</p>
              ) : null}
            </div>
            <div className="tile">
              <p className="tile-title">Available Bankroll</p>
              <p className="tile-value text-base">{currentUser ? formatMoney(currentUser.balance) : '$0.00'}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" onClick={requestQuote} disabled={quoting}>
              {quoting ? 'Quoting...' : 'Get Quote'}
            </button>
            <button className="btn-primary" type="button" onClick={placeBet} disabled={placing || !currentUser?.id}>
              {placing ? 'Placing...' : 'Place Bet'}
            </button>
            <Link className="btn-secondary" to={`/races/${race.id}/bet`}>
              Open Full Bet Page
            </Link>
          </div>

          {quote ? (
            <div className="mt-3 rounded-2xl border border-[#ddcdb9] bg-[#fffaf3] p-3 text-sm">
              <p>
                Combinations: <strong>{quote.num_combinations}</strong> • Total Cost: <strong>{formatMoney(quote.total_cost)}</strong>
              </p>
              <p className="mt-1 text-xs text-stone-600">
                Estimated payout range: {formatMoney(quote.estimate?.estimatedMin)} - {formatMoney(quote.estimate?.estimatedMax)} (mean{' '}
                {formatMoney(quote.estimate?.estimatedMean)})
              </p>
            </div>
          ) : null}

          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
          {success ? <p className="mt-2 text-sm text-emerald-700">{success}</p> : null}
        </div>
      </section>
    </div>,
    document.body
  );
}
