const SCORE_WEIGHTS = {
  speed: 0.2,
  form: 0.17,
  class: 0.13,
  paceFit: 0.12,
  distanceFit: 0.1,
  connections: 0.09,
  consistency: 0.08,
  lateKick: 0.04,
  improvingTrend: 0.03,
  brisnetSignal: 0.04
};

const DEFAULT_ODDS_PROBABILITY = 0.1;
const VOLATILITY_PENALTY_WEIGHT = 0.12;
const VALUE_EDGE_LIFT_WEIGHT = 0.22;
const STABILITY_BONUS_WEIGHT = 6;

const MODEL_META = {
  scoreWeights: SCORE_WEIGHTS,
  volatilityPenaltyWeight: VOLATILITY_PENALTY_WEIGHT,
  valueEdgeLiftWeight: VALUE_EDGE_LIFT_WEIGHT,
  stabilityBonusWeight: STABILITY_BONUS_WEIGHT
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOdds = (oddsText) => {
  const value = String(oddsText ?? '').trim();
  if (!value) {
    return { numerator: 0, denominator: 0, display: 'N/A' };
  }

  if (value.includes('/')) {
    const [num, den] = value.split('/').map((part) => Number(part.trim()));
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return { numerator: num, denominator: den, display: `${num}/${den}` };
    }
  }

  const decimalLike = Number(value);
  if (Number.isFinite(decimalLike) && decimalLike > 0) {
    return { numerator: decimalLike, denominator: 1, display: `${decimalLike}/1` };
  }

  return { numerator: 0, denominator: 0, display: 'N/A' };
};

const impliedProbability = (oddsText) => {
  const { numerator, denominator } = parseOdds(oddsText);
  if (numerator <= 0 || denominator <= 0) {
    return DEFAULT_ODDS_PROBABILITY;
  }
  return denominator / (numerator + denominator);
};

const normalizedSoftmax = (values) => {
  if (!values.length) {
    return [];
  }

  const anchor = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - anchor) / 12));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => (sum > 0 ? value / sum : 0));
};

const probabilityToFairOdds = (probability) => {
  const safeProbability = Number(probability);
  if (!Number.isFinite(safeProbability) || safeProbability <= 0) {
    return {
      decimal: null,
      fractional: null,
      text: 'N/A'
    };
  }

  const decimal = 1 / safeProbability;
  const fractional = (1 - safeProbability) / safeProbability;

  return {
    decimal: Number(decimal.toFixed(2)),
    fractional: Number(fractional.toFixed(2)),
    text: `${fractional.toFixed(2)}/1`
  };
};

const buildBaseBreakdown = (horse) => {
  const components = Object.entries(SCORE_WEIGHTS).map(([key, weight]) => {
    const rating = numberOr(horse[key]);
    const contribution = rating * weight;
    return {
      key,
      rating,
      weight,
      contribution: Number(contribution.toFixed(3))
    };
  });

  const weightedSum = components.reduce((acc, component) => acc + component.contribution, 0);
  const volatilityRating = numberOr(horse.volatility);
  const volatilityPenalty = volatilityRating * VOLATILITY_PENALTY_WEIGHT;
  const unclampedBase = weightedSum - volatilityPenalty;
  const baseScore = clamp(unclampedBase, 0, 100);

  return {
    components,
    weightedSum: Number(weightedSum.toFixed(3)),
    volatilityRating,
    volatilityPenalty: Number(volatilityPenalty.toFixed(3)),
    unclampedBase: Number(unclampedBase.toFixed(3)),
    baseScore: Number(baseScore.toFixed(3))
  };
};

const buildStabilityBreakdown = (horse) => {
  const consistency = numberOr(horse.consistency);
  const inverseVolatility = 100 - numberOr(horse.volatility);
  const stabilityIndex = clamp((consistency * 0.55 + inverseVolatility * 0.45) / 100, 0, 1);

  return {
    consistency,
    inverseVolatility: Number(inverseVolatility.toFixed(3)),
    stabilityIndex: Number(stabilityIndex.toFixed(6))
  };
};

const buildScoreBreakdown = (horse, modelProbability, marketProbability) => {
  const base = buildBaseBreakdown(horse);
  const stability = buildStabilityBreakdown(horse);
  const valueEdge = modelProbability - marketProbability;
  const valueLift = valueEdge * 100 * VALUE_EDGE_LIFT_WEIGHT;
  const stabilityBonus = stability.stabilityIndex * STABILITY_BONUS_WEIGHT;
  const unclampedFinal = base.baseScore + valueLift + stabilityBonus;
  const finalScore = clamp(unclampedFinal, 0, 100);

  return {
    base,
    stability,
    valueEdge: Number(valueEdge.toFixed(6)),
    valueLift: Number(valueLift.toFixed(3)),
    stabilityBonus: Number(stabilityBonus.toFixed(3)),
    unclampedFinal: Number(unclampedFinal.toFixed(3)),
    finalScore: Number(finalScore.toFixed(3))
  };
};

const dollars = (value) => `$${Math.max(0, Math.round(value))}`;

export const rankRace = (horses) => {
  const modeled = horses.map((horse) => {
    const base = buildBaseBreakdown(horse);
    return {
      ...horse,
      base: base.baseScore,
      base_breakdown: base
    };
  });

  const probabilities = normalizedSoftmax(modeled.map((horse) => horse.base));
  const rawMarketProbabilities = modeled.map((horse) => impliedProbability(horse.odds));
  const marketDenominator = rawMarketProbabilities.reduce((acc, value) => acc + value, 0);
  const marketProbabilities = rawMarketProbabilities.map((value) =>
    marketDenominator > 0 ? value / marketDenominator : DEFAULT_ODDS_PROBABILITY
  );

  const ranked = modeled
    .map((horse, index) => {
      const modelProbability = probabilities[index];
      const marketProbability = marketProbabilities[index];
      const edge = modelProbability - marketProbability;
      const scoreBreakdown = buildScoreBreakdown(horse, modelProbability, marketProbability);
      const fairOdds = probabilityToFairOdds(modelProbability);
      const marketFairOdds = probabilityToFairOdds(marketProbability);

      return {
        ...horse,
        modelProbability,
        marketProbability,
        valueEdge: edge,
        stability: scoreBreakdown.stability.stabilityIndex,
        score: scoreBreakdown.finalScore,
        fairOdds,
        marketFairOdds,
        scoreBreakdown
      };
    })
    .sort((left, right) => right.score - left.score);

  return ranked.map((horse, index) => ({ ...horse, rank: index + 1 }));
};

export const identifyUndercoverWinner = (ranked) => {
  const excluded = new Set(ranked.slice(0, 5).map((horse) => horse.name));
  const candidates = ranked.filter((horse) => !excluded.has(horse.name));
  if (!candidates.length) {
    return null;
  }

  const scored = candidates.map((horse) => {
    const darkHorseScore =
      horse.valueEdge * 100 * 0.45 + numberOr(horse.lateKick) * 0.3 + numberOr(horse.improvingTrend) * 0.25;
    return { ...horse, darkHorseScore };
  });

  scored.sort((left, right) => right.darkHorseScore - left.darkHorseScore);
  return scored[0];
};

export const buildTopBets = (ranked, bankroll) => {
  const safeBankroll = Math.max(10, numberOr(bankroll, 100));
  const top = ranked[0];
  const second = ranked[1] ?? ranked[0];
  const third = ranked[2] ?? ranked[1] ?? ranked[0];
  const fourth = ranked[3] ?? ranked[2] ?? ranked[1] ?? ranked[0];
  const valueHorse =
    ranked
      .slice(0, 6)
      .sort((left, right) => right.valueEdge - left.valueEdge)
      .find((horse) => horse.name !== top.name) ?? second;

  const templates = [
    { type: 'Win', risk: 'Low', stakeRatio: 0.3, ticket: `${top.name} to Win` },
    { type: 'Place', risk: 'Low', stakeRatio: 0.2, ticket: `${second.name} to Place` },
    { type: 'Exacta Box', risk: 'Mid', stakeRatio: 0.18, ticket: `${top.name} / ${second.name}` },
    {
      type: 'Trifecta Key',
      risk: 'Mid-High',
      stakeRatio: 0.17,
      ticket: `${top.name} with ${second.name}, ${third.name}, ${fourth.name}`
    },
    { type: 'Value Win', risk: 'Mid', stakeRatio: 0.15, ticket: `${valueHorse.name} to Win` }
  ];

  return templates.map((template, index) => ({
    rank: index + 1,
    ...template,
    stake: dollars(safeBankroll * template.stakeRatio)
  }));
};

export const buildCounterBets = (ranked, bankroll, undercoverWinner) => {
  const safeBankroll = Math.max(10, numberOr(bankroll, 100));
  const favorite = ranked[0];
  const alternatives = ranked.filter((horse) => horse.name !== favorite.name);
  const valueAlternative = [...alternatives].sort((left, right) => right.valueEdge - left.valueEdge)[0] ?? ranked[1] ?? ranked[0];
  const second = alternatives[0] ?? ranked[0];
  const third = alternatives[1] ?? alternatives[0] ?? ranked[0];

  const templates = [
    { type: 'Fade Win', risk: 'Mid', stakeRatio: 0.4, ticket: `${valueAlternative.name} to Win (against ${favorite.name})` },
    { type: 'Exacta Fade', risk: 'Mid', stakeRatio: 0.25, ticket: `${second.name} / ${third.name} (exclude ${favorite.name})` },
    { type: 'Trifecta Fade', risk: 'High', stakeRatio: 0.2, ticket: `${second.name}, ${third.name} over field (no ${favorite.name})` },
    {
      type: 'Dark-Horse Saver',
      risk: 'High',
      stakeRatio: 0.15,
      ticket: undercoverWinner ? `${undercoverWinner.name} to Place` : `${third.name} to Place`
    }
  ];

  return templates.map((template) => ({
    ...template,
    stake: dollars(safeBankroll * template.stakeRatio)
  }));
};

export const buildThreeTierSuggestions = (ranked, undercoverWinner) => {
  const sureCandidate = [...ranked].slice(0, 3).sort((left, right) => right.stability - left.stability)[0] ?? ranked[0];

  const midCandidate = [...ranked].slice(0, 5).sort((left, right) => right.valueEdge - left.valueEdge)[0] ?? ranked[1] ?? ranked[0];

  const longShotPool = ranked.filter((horse) => horse.marketProbability <= 0.12);
  const longShotCandidate = [...longShotPool].sort((left, right) => right.valueEdge - left.valueEdge)[0] ?? undercoverWinner ?? ranked[ranked.length - 1];

  return [
    { tier: 'Sure Bet', horse: sureCandidate, strategy: 'Win or key in exacta/trifecta with top two model horses.' },
    { tier: 'Mid Bet', horse: midCandidate, strategy: 'Win/place split with a smaller exacta box.' },
    { tier: 'Long-Shot Bet', horse: longShotCandidate, strategy: 'Small win ticket plus saver place ticket.' }
  ];
};

export const runBaselineAnalysis = ({ horses, bankroll }) => {
  const ranked = rankRace(horses);
  const undercoverWinner = identifyUndercoverWinner(ranked);

  return {
    modelMeta: MODEL_META,
    ranked,
    undercoverWinner,
    topBets: buildTopBets(ranked, bankroll),
    counterBets: buildCounterBets(ranked, bankroll, undercoverWinner),
    tierSuggestions: buildThreeTierSuggestions(ranked, undercoverWinner)
  };
};
