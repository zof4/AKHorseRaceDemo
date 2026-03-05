const SCORE_WEIGHTS = {
  speed: 0.22,
  form: 0.18,
  class: 0.14,
  paceFit: 0.12,
  distanceFit: 0.1,
  connections: 0.09,
  consistency: 0.08,
  lateKick: 0.04,
  improvingTrend: 0.03
};

const DEFAULT_ODDS_PROBABILITY = 0.1;

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

const baseScore = (horse) => {
  const weighted = Object.entries(SCORE_WEIGHTS).reduce((acc, [key, weight]) => {
    return acc + numberOr(horse[key]) * weight;
  }, 0);

  const volatilityPenalty = numberOr(horse.volatility) * 0.12;
  return clamp(weighted - volatilityPenalty, 0, 100);
};

const stabilityIndex = (horse) => {
  const consistency = numberOr(horse.consistency);
  const inverseVolatility = 100 - numberOr(horse.volatility);
  return clamp((consistency * 0.55 + inverseVolatility * 0.45) / 100, 0, 1);
};

const finalScore = (horse, modelProbability, edge) => {
  const base = baseScore(horse);
  const stability = stabilityIndex(horse);
  const valueLift = edge * 100 * 0.22;
  return clamp(base + valueLift + stability * 6, 0, 100);
};

const dollars = (value) => `$${Math.max(0, Math.round(value))}`;

export const rankRace = (horses) => {
  const modeled = horses.map((horse) => ({ ...horse, base: baseScore(horse) }));
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
      const stability = stabilityIndex(horse);
      const score = finalScore(horse, modelProbability, edge);

      return {
        ...horse,
        modelProbability,
        marketProbability,
        valueEdge: edge,
        stability,
        score
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
    ranked,
    undercoverWinner,
    topBets: buildTopBets(ranked, bankroll),
    counterBets: buildCounterBets(ranked, bankroll, undercoverWinner),
    tierSuggestions: buildThreeTierSuggestions(ranked, undercoverWinner)
  };
};
