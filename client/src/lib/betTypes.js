export const BET_TYPES = [
  { id: 'exacta', label: 'Exacta', positions: 2, minBase: 1 },
  { id: 'quinella', label: 'Quinella', positions: 2, minBase: 1 },
  { id: 'trifecta', label: 'Trifecta', positions: 3, minBase: 1 },
  { id: 'superfecta', label: 'Superfecta', positions: 4, minBase: 0.1 },
  { id: 'super_hi_5', label: 'Super Hi-5', positions: 5, minBase: 0.1 }
];

export const BET_MODIFIERS = [
  { id: 'straight', label: 'Straight' },
  { id: 'box', label: 'Box' },
  { id: 'wheel', label: 'Wheel' },
  { id: 'key', label: 'Key' },
  { id: 'part_wheel', label: 'Part-Wheel' }
];

export const getBetType = (betTypeId) => BET_TYPES.find((item) => item.id === betTypeId) ?? BET_TYPES[0];
