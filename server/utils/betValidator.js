const BET_SPECS = {
  exacta: { positions: 2, minBase: 1, ordered: true },
  quinella: { positions: 2, minBase: 1, ordered: false },
  trifecta: { positions: 3, minBase: 1, ordered: true },
  superfecta: { positions: 4, minBase: 0.1, ordered: true },
  super_hi_5: { positions: 5, minBase: 0.1, ordered: true }
};

const MAX_COMBINATIONS = 20000;

const toInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeHorseIds = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  for (const raw of values) {
    const parsed = toInt(raw);
    if (parsed && parsed > 0) {
      normalized.push(parsed);
    }
  }
  return normalized;
};

const unique = (values) => [...new Set(values)];

const ensureAllowedHorseIds = (horseIds, allowedHorseIds) => {
  for (const horseId of horseIds) {
    if (!allowedHorseIds.has(horseId)) {
      return false;
    }
  }
  return true;
};

const permutations = (pool, length) => {
  if (length === 0) {
    return [[]];
  }

  const result = [];
  for (let index = 0; index < pool.length; index += 1) {
    const head = pool[index];
    const rest = pool.slice(0, index).concat(pool.slice(index + 1));
    const tails = permutations(rest, length - 1);
    for (const tail of tails) {
      result.push([head, ...tail]);
    }
  }
  return result;
};

const combinationsWithoutOrder = (pool, length, start = 0, trail = []) => {
  if (trail.length === length) {
    return [trail];
  }

  const result = [];
  for (let index = start; index < pool.length; index += 1) {
    result.push(...combinationsWithoutOrder(pool, length, index + 1, [...trail, pool[index]]));
  }
  return result;
};

const canonicalCombo = (betType, combo) => {
  if (betType === 'quinella') {
    return [...combo].sort((left, right) => left - right);
  }
  return combo;
};

const comboKey = (betType, combo) => canonicalCombo(betType, combo).join('-');

const dedupeCombinations = (betType, combinationsInput) => {
  const seen = new Set();
  const combinationsOut = [];

  for (const combo of combinationsInput) {
    const key = comboKey(betType, combo);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    combinationsOut.push(canonicalCombo(betType, combo));
    if (combinationsOut.length > MAX_COMBINATIONS) {
      throw new Error(`Bet expands to more than ${MAX_COMBINATIONS} combinations.`);
    }
  }

  return combinationsOut;
};

const validateDistinctByTicket = (betType, combo) => {
  if (betType === 'quinella') {
    return new Set(combo).size === 2;
  }
  return new Set(combo).size === combo.length;
};

const buildStraight = (betType, positions, selections) => {
  const horses = normalizeHorseIds(selections?.horses);
  if (horses.length !== positions) {
    throw new Error(`Straight ${betType} requires exactly ${positions} horses.`);
  }
  if (!validateDistinctByTicket(betType, horses)) {
    throw new Error('Straight ticket cannot repeat a horse in multiple positions.');
  }
  return [horses];
};

const buildBox = (betType, positions, selections) => {
  const horses = unique(normalizeHorseIds(selections?.horses));
  if (horses.length < positions) {
    throw new Error(`${betType} box requires at least ${positions} unique horses.`);
  }

  if (betType === 'quinella') {
    return combinationsWithoutOrder(horses, 2);
  }

  return permutations(horses, positions);
};

const buildWheel = (betType, positions, selections) => {
  const anchorHorseId = toInt(selections?.anchor_horse_id);
  const anchorPosition = toInt(selections?.anchor_position) ?? 1;
  const otherHorseIds = unique(normalizeHorseIds(selections?.other_horse_ids));

  if (!anchorHorseId) {
    throw new Error('Wheel bet requires anchor_horse_id.');
  }

  if (anchorPosition < 1 || anchorPosition > positions) {
    throw new Error(`anchor_position must be between 1 and ${positions}.`);
  }

  const filteredOthers = otherHorseIds.filter((horseId) => horseId !== anchorHorseId);
  if (filteredOthers.length < positions - 1) {
    throw new Error(`Wheel bet needs at least ${positions - 1} other horses.`);
  }

  const remainderOrders = permutations(filteredOthers, positions - 1);
  return remainderOrders.map((order) => {
    const combo = [];
    let remainderIndex = 0;
    for (let position = 1; position <= positions; position += 1) {
      if (position === anchorPosition) {
        combo.push(anchorHorseId);
      } else {
        combo.push(order[remainderIndex]);
        remainderIndex += 1;
      }
    }
    return combo;
  });
};

const buildKey = (betType, positions, selections) => {
  const keyHorseIds = unique(normalizeHorseIds(selections?.key_horse_ids));
  const otherHorseIds = unique(normalizeHorseIds(selections?.other_horse_ids));

  if (!keyHorseIds.length) {
    throw new Error('Key bet requires key_horse_ids.');
  }

  if (keyHorseIds.length >= positions) {
    throw new Error(`Key bet must reserve fewer than ${positions} positions for key horses.`);
  }

  const used = new Set(keyHorseIds);
  const filteredOthers = otherHorseIds.filter((horseId) => !used.has(horseId));
  const needed = positions - keyHorseIds.length;

  if (filteredOthers.length < needed) {
    throw new Error(`Key bet needs at least ${needed} non-key horses.`);
  }

  const tails = permutations(filteredOthers, needed);
  return tails.map((tail) => [...keyHorseIds, ...tail]);
};

const buildPartWheel = (betType, positions, selections) => {
  const perPosition = Array.isArray(selections?.positions) ? selections.positions : [];
  if (perPosition.length !== positions) {
    throw new Error(`Part-wheel for ${betType} requires ${positions} position arrays.`);
  }

  const normalized = perPosition.map((entry, index) => {
    const horseIds = unique(normalizeHorseIds(entry));
    if (!horseIds.length) {
      throw new Error(`Part-wheel position ${index + 1} has no horses.`);
    }
    return horseIds;
  });

  const generated = [];

  const walk = (positionIndex, trail) => {
    if (positionIndex === normalized.length) {
      if (validateDistinctByTicket(betType, trail)) {
        generated.push(trail);
      }
      return;
    }

    for (const horseId of normalized[positionIndex]) {
      if (trail.includes(horseId)) {
        continue;
      }
      walk(positionIndex + 1, [...trail, horseId]);
    }
  };

  walk(0, []);
  if (!generated.length) {
    throw new Error('Part-wheel produced zero valid combinations.');
  }

  return generated;
};

const expandCombinations = (betType, betModifier, positions, selections) => {
  switch (betModifier) {
    case 'straight':
      return buildStraight(betType, positions, selections);
    case 'box':
      return buildBox(betType, positions, selections);
    case 'wheel':
      return buildWheel(betType, positions, selections);
    case 'key':
      return buildKey(betType, positions, selections);
    case 'part_wheel':
      return buildPartWheel(betType, positions, selections);
    default:
      throw new Error(`Unsupported bet modifier: ${betModifier}`);
  }
};

export const validateAndExpandBet = ({ bet_type, bet_modifier, base_amount, selections }, allowedHorseIds) => {
  const spec = BET_SPECS[bet_type];
  if (!spec) {
    throw new Error(`Unsupported bet type: ${bet_type}`);
  }

  const betModifier = typeof bet_modifier === 'string' ? bet_modifier : 'straight';
  const baseAmount = Number(base_amount);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    throw new Error('base_amount must be a positive number.');
  }

  if (baseAmount < spec.minBase) {
    throw new Error(`${bet_type} minimum base amount is $${spec.minBase.toFixed(2)}.`);
  }

  const rawCombinations = expandCombinations(bet_type, betModifier, spec.positions, selections);
  const combinations = dedupeCombinations(bet_type, rawCombinations);

  for (const combo of combinations) {
    if (combo.length !== spec.positions) {
      throw new Error('Internal expansion error: combination length mismatch.');
    }

    if (!validateDistinctByTicket(bet_type, combo)) {
      throw new Error('Ticket cannot include the same horse twice in one combination.');
    }

    if (!ensureAllowedHorseIds(combo, allowedHorseIds)) {
      throw new Error('Ticket contains horse(s) not available in this race.');
    }
  }

  const numCombinations = combinations.length;
  if (numCombinations < 1) {
    throw new Error('Bet produced zero combinations.');
  }

  const totalCost = Number((baseAmount * numCombinations).toFixed(2));

  return {
    betType: bet_type,
    betModifier,
    selections,
    combinations,
    combinationKeys: combinations.map((combo) => comboKey(bet_type, combo)),
    numCombinations,
    baseAmount,
    totalCost
  };
};

export const getBetSpec = (betType) => BET_SPECS[betType] ?? null;

export const getCombinationKey = comboKey;
