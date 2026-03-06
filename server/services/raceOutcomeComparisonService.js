import db from '../db/connection.js';
import { runBaselineAnalysis } from './baselineAlgorithm.js';

const DEFAULT_BANKROLL = 100;

const listRaceHorsesStmt = db.prepare(
  `SELECT
      id,
      race_id,
      name,
      post_position,
      morning_line_odds,
      speed_rating,
      form_rating,
      class_rating,
      pace_fit_rating,
      distance_fit_rating,
      connections_rating,
      consistency_rating,
      volatility_rating,
      late_kick_rating,
      improving_trend_rating,
      brisnet_signal,
      scratched
   FROM horses
   WHERE race_id = ?
   ORDER BY COALESCE(post_position, 999), id ASC`
);

const listOfficialResultsStmt = db.prepare(
  `SELECT
      res.horse_id,
      res.finish_position,
      h.name AS horse_name,
      h.post_position,
      h.morning_line_odds
   FROM results res
   JOIN horses h ON h.id = res.horse_id
   WHERE res.race_id = ?
   ORDER BY res.finish_position ASC`
);

const normalizeHorseName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseOddsProbability = (oddsText) => {
  const value = String(oddsText ?? '').trim();
  if (!value) {
    return null;
  }

  const split = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (split) {
    const numerator = Number(split[1]);
    const denominator = Number(split[2]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0) {
      return denominator / (numerator + denominator);
    }
  }

  const decimalLike = Number(value);
  if (Number.isFinite(decimalLike) && decimalLike > 0) {
    return 1 / (decimalLike + 1);
  }

  return null;
};

const mapHorseToModelInput = (horse) => ({
  name: horse.name,
  odds: horse.morning_line_odds ?? '',
  speed: Number(horse.speed_rating ?? 50),
  form: Number(horse.form_rating ?? 50),
  class: Number(horse.class_rating ?? 50),
  paceFit: Number(horse.pace_fit_rating ?? 50),
  distanceFit: Number(horse.distance_fit_rating ?? 50),
  connections: Number(horse.connections_rating ?? 50),
  consistency: Number(horse.consistency_rating ?? 50),
  volatility: Number(horse.volatility_rating ?? 50),
  lateKick: Number(horse.late_kick_rating ?? 50),
  improvingTrend: Number(horse.improving_trend_rating ?? 50),
  brisnetSignal: Number(horse.brisnet_signal ?? 50),
  history: ''
});

export const analyzeRaceById = (raceId, bankroll = DEFAULT_BANKROLL) => {
  const horses = listRaceHorsesStmt
    .all(raceId)
    .filter((horse) => !Number(horse.scratched))
    .map(mapHorseToModelInput);

  if (horses.length < 3) {
    throw new Error('Race needs at least three active horses for algorithm analysis.');
  }

  return runBaselineAnalysis({
    horses,
    bankroll: Number.isFinite(Number(bankroll)) && Number(bankroll) > 0 ? Number(bankroll) : DEFAULT_BANKROLL
  });
};

export const buildRaceOutcomeComparison = (raceId, bankroll = DEFAULT_BANKROLL) => {
  const officialResults = listOfficialResultsStmt.all(raceId);
  if (!officialResults.length) {
    throw new Error('Race has no official results yet.');
  }

  const analysis = analyzeRaceById(raceId, bankroll);
  const ranked = Array.isArray(analysis?.ranked) ? analysis.ranked : [];
  if (!ranked.length) {
    throw new Error('No model ranking available for this race.');
  }

  const predictedByName = new Map(
    ranked.map((runner) => [normalizeHorseName(runner.name), runner])
  );

  const rows = officialResults.map((resultRow) => {
    const model = predictedByName.get(normalizeHorseName(resultRow.horse_name));
    const finishPosition = Number(resultRow.finish_position);
    const modelRank = Number(model?.rank ?? 0) || null;
    const rankDelta = modelRank && finishPosition ? modelRank - finishPosition : null;

    return {
      horseId: Number(resultRow.horse_id),
      horseName: resultRow.horse_name,
      postPosition: resultRow.post_position,
      finishPosition,
      modelRank,
      rankDelta,
      endingOdds: resultRow.morning_line_odds ?? null,
      endingImpliedProbability: parseOddsProbability(resultRow.morning_line_odds),
      modelWinProbability: model ? Number(model.modelProbability ?? 0) : null,
      modelFairOdds: model?.fairOdds?.text ?? null,
      marketFairOdds: model?.marketFairOdds?.text ?? null,
      valueEdge: model ? Number(model.valueEdge ?? 0) : null
    };
  });

  const modelTop = ranked[0] ?? null;
  const actualWinner = rows.find((row) => row.finishPosition === 1) ?? null;
  const topTwoPredicted = ranked.slice(0, 2).map((entry) => normalizeHorseName(entry.name));
  const topThreePredicted = ranked.slice(0, 3).map((entry) => normalizeHorseName(entry.name));
  const topTwoActual = rows
    .filter((row) => row.finishPosition >= 1 && row.finishPosition <= 2)
    .sort((a, b) => a.finishPosition - b.finishPosition)
    .map((row) => normalizeHorseName(row.horseName));
  const topThreeActual = rows
    .filter((row) => row.finishPosition >= 1 && row.finishPosition <= 3)
    .sort((a, b) => a.finishPosition - b.finishPosition)
    .map((row) => normalizeHorseName(row.horseName));

  const absoluteErrors = rows
    .map((row) => (row.rankDelta === null ? null : Math.abs(row.rankDelta)))
    .filter((value) => Number.isFinite(value));

  const meanAbsoluteRankError = absoluteErrors.length
    ? Number((absoluteErrors.reduce((acc, value) => acc + value, 0) / absoluteErrors.length).toFixed(3))
    : null;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      winnerHorse: actualWinner?.horseName ?? null,
      winnerModelRank: actualWinner?.modelRank ?? null,
      winnerEndingOdds: actualWinner?.endingOdds ?? null,
      modelTopPick: modelTop?.name ?? null,
      modelTopPickFinish: rows.find((row) => normalizeHorseName(row.horseName) === normalizeHorseName(modelTop?.name))
        ?.finishPosition ?? null,
      exactaOrderHit:
        topTwoPredicted.length === 2 && topTwoActual.length === 2 && topTwoPredicted.every((name, idx) => name === topTwoActual[idx]),
      trifectaOrderHit:
        topThreePredicted.length === 3 &&
        topThreeActual.length === 3 &&
        topThreePredicted.every((name, idx) => name === topThreeActual[idx]),
      meanAbsoluteRankError
    },
    rows
  };
};
