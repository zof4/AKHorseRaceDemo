import { getCombinationKey } from '../utils/betValidator.js';

const roundCurrency = (value) => Number((value + Number.EPSILON).toFixed(2));

export const applyBreakage = (value, breakageUnit = 0.1) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value / breakageUnit) * breakageUnit;
};

export const payoutPerDollar = ({ grossPool, takeoutPct, winningAmount, breakageUnit = 0.1 }) => {
  if (!Number.isFinite(grossPool) || grossPool <= 0) {
    return 0;
  }

  const normalizedTakeout = Number.isFinite(takeoutPct) ? Math.max(0, Math.min(1, takeoutPct)) : 0.22;
  const effectiveWinningAmount = Number.isFinite(winningAmount) && winningAmount > 0 ? winningAmount : 0;
  if (effectiveWinningAmount <= 0) {
    return 0;
  }

  const netPool = grossPool * (1 - normalizedTakeout);
  const raw = netPool / effectiveWinningAmount;
  return applyBreakage(raw, breakageUnit);
};

export const buildCombinationAmountMap = (bets, betType) => {
  const map = new Map();

  for (const bet of bets) {
    const baseAmount = Number(bet.base_amount);
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
      continue;
    }

    const combos = Array.isArray(bet.expanded_combinations) ? bet.expanded_combinations : [];
    for (const combo of combos) {
      const key = getCombinationKey(betType, combo);
      map.set(key, roundCurrency((map.get(key) ?? 0) + baseAmount));
    }
  }

  return map;
};

export const estimateTicketPayout = ({
  takeoutPct,
  currentPoolTotal,
  baseAmount,
  totalCost,
  combinationKeys,
  currentCombinationAmounts
}) => {
  if (!combinationKeys.length) {
    return {
      estimatedMin: 0,
      estimatedMax: 0,
      estimatedMean: 0,
      scenarios: []
    };
  }

  const grossAfterBet = roundCurrency(currentPoolTotal + totalCost);
  const scenarios = [];

  for (const key of combinationKeys) {
    const existingAmount = currentCombinationAmounts.get(key) ?? 0;
    const winningAmount = roundCurrency(existingAmount + baseAmount);
    const perDollar = payoutPerDollar({
      grossPool: grossAfterBet,
      takeoutPct,
      winningAmount
    });

    scenarios.push({
      combination: key,
      payoutPerDollar: perDollar,
      ticketPayout: roundCurrency(perDollar * baseAmount)
    });
  }

  const payouts = scenarios.map((entry) => entry.ticketPayout);
  const min = Math.min(...payouts);
  const max = Math.max(...payouts);
  const mean = payouts.reduce((acc, value) => acc + value, 0) / payouts.length;

  return {
    estimatedMin: roundCurrency(min),
    estimatedMax: roundCurrency(max),
    estimatedMean: roundCurrency(mean),
    scenarios: scenarios.sort((left, right) => right.ticketPayout - left.ticketPayout)
  };
};

export const buildPoolLadder = ({ poolTotal, takeoutPct, combinationAmounts, limit = 12 }) => {
  const entries = [...combinationAmounts.entries()].map(([combination, amount]) => ({
    combination,
    amount,
    probablePayoutPerDollar: payoutPerDollar({
      grossPool: poolTotal,
      takeoutPct,
      winningAmount: amount
    })
  }));

  entries.sort((left, right) => right.amount - left.amount);
  return entries.slice(0, limit).map((entry) => ({
    ...entry,
    amount: roundCurrency(entry.amount),
    probablePayoutPerDollar: roundCurrency(entry.probablePayoutPerDollar)
  }));
};
