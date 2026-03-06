export const BET_TYPES = [
  { id: 'win', label: 'Win', positions: 1, minBase: 1, modifiers: ['straight'] },
  { id: 'place', label: 'Place', positions: 1, minBase: 1, modifiers: ['straight'] },
  { id: 'show', label: 'Show', positions: 1, minBase: 1, modifiers: ['straight'] },
  { id: 'exacta', label: 'Exacta', positions: 2, minBase: 1, modifiers: ['straight', 'box', 'wheel', 'key', 'part_wheel'] },
  { id: 'quinella', label: 'Quinella', positions: 2, minBase: 1, modifiers: ['straight', 'box', 'wheel', 'key', 'part_wheel'] },
  { id: 'trifecta', label: 'Trifecta', positions: 3, minBase: 1, modifiers: ['straight', 'box', 'wheel', 'key', 'part_wheel'] },
  { id: 'superfecta', label: 'Superfecta', positions: 4, minBase: 0.1, modifiers: ['straight', 'box', 'wheel', 'key', 'part_wheel'] },
  { id: 'super_hi_5', label: 'Super Hi-5', positions: 5, minBase: 0.1, modifiers: ['straight', 'box', 'wheel', 'key', 'part_wheel'] }
];

export const BET_MODIFIERS = [
  { id: 'straight', label: 'Straight' },
  { id: 'box', label: 'Box' },
  { id: 'wheel', label: 'Wheel' },
  { id: 'key', label: 'Key' },
  { id: 'part_wheel', label: 'Part-Wheel' }
];

export const getBetType = (betTypeId) => BET_TYPES.find((item) => item.id === betTypeId) ?? BET_TYPES[0];
export const getBetModifiersForType = (betTypeId) => {
  const betType = getBetType(betTypeId);
  const allowed = new Set(Array.isArray(betType.modifiers) && betType.modifiers.length ? betType.modifiers : ['straight']);
  return BET_MODIFIERS.filter((modifier) => allowed.has(modifier.id));
};
