import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { getBrisnetSignals, getLiveOdds } from '../services/liveOddsProviders.js';
import { runBaselineAnalysis } from '../services/baselineAlgorithm.js';

const NUMERIC_FIELDS = [
  'speed',
  'form',
  'class',
  'paceFit',
  'distanceFit',
  'connections',
  'consistency',
  'volatility',
  'lateKick',
  'improvingTrend',
  'brisnetSignal'
];

const getRaceStmt = db.prepare(
  `SELECT id, name, race_config_json, brisnet_config_json
   FROM races
   WHERE id = ?`
);

const listRaceHorsesStmt = db.prepare(
  `SELECT
      id,
      name,
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
      brisnet_signal
   FROM horses
   WHERE race_id = ? AND scratched = 0
   ORDER BY COALESCE(post_position, 999), id ASC`
);

const updateHorseOddsStmt = db.prepare(
  `UPDATE horses
   SET morning_line_odds = ?
   WHERE race_id = ? AND lower(name) = lower(?)`
);

const updateHorseSignalStmt = db.prepare(
  `UPDATE horses
   SET brisnet_signal = ?
   WHERE race_id = ? AND lower(name) = lower(?)`
);

const raceConfigIsValid = (raceConfig) => {
  if (!raceConfig || typeof raceConfig !== 'object') {
    return false;
  }
  const { trackSlug, year, month, day, raceNumber } = raceConfig;
  return (
    typeof trackSlug === 'string' &&
    trackSlug.trim().length > 0 &&
    Number.isFinite(Number(year)) &&
    Number.isFinite(Number(month)) &&
    Number.isFinite(Number(day)) &&
    Number.isFinite(Number(raceNumber))
  );
};

const sanitizeHorse = (horse) => {
  const name = typeof horse?.name === 'string' ? horse.name.trim() : '';
  if (!name) {
    return null;
  }

  const sanitized = {
    name,
    odds: typeof horse?.odds === 'string' ? horse.odds.trim() : '',
    history: typeof horse?.history === 'string' ? horse.history.trim() : ''
  };

  for (const field of NUMERIC_FIELDS) {
    const value = Number(horse?.[field]);
    sanitized[field] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }

  return sanitized;
};

const mapRaceHorseToAnalysisHorse = (horse) => ({
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

const analyzeRaceById = (raceId, bankroll) => {
  const horses = listRaceHorsesStmt.all(raceId).map(mapRaceHorseToAnalysisHorse);
  if (horses.length < 3) {
    throw new Error('Race needs at least three active horses for algorithm analysis.');
  }

  return runBaselineAnalysis({
    horses,
    bankroll: Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 100
  });
};

export const createAlgorithmRouter = () => {
  const router = Router();

  router.post('/analyze', (req, res) => {
    const horsesRaw = Array.isArray(req.body?.horses) ? req.body.horses : [];
    const horses = horsesRaw.map(sanitizeHorse).filter(Boolean);
    const bankroll = Number(req.body?.bankroll);

    if (horses.length < 3) {
      return res.status(400).json({ error: 'At least three horses are required to analyze a race.' });
    }

    const result = runBaselineAnalysis({
      horses,
      bankroll: Number.isFinite(bankroll) && bankroll > 0 ? bankroll : 100
    });

    return res.json(result);
  });

  router.get('/race/:raceId/analyze', (req, res) => {
    const raceId = Number(req.params.raceId);
    const bankroll = Number(req.query.bankroll);

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    try {
      const result = analyzeRaceById(raceId, bankroll);
      return res.json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Unable to analyze race.' });
    }
  });

  router.post('/live-odds', async (req, res) => {
    const raceConfig = req.body?.raceConfig;
    const horseNames = Array.isArray(req.body?.horseNames) ? req.body.horseNames : [];

    if (!raceConfigIsValid(raceConfig)) {
      return res.status(400).json({ error: 'Invalid raceConfig payload.' });
    }

    try {
      const result = await getLiveOdds(raceConfig, horseNames);
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        error: 'Live odds fetch failed.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/brisnet-signals', async (req, res) => {
    const brisnetConfig = req.body?.brisnetConfig;
    const horseNames = Array.isArray(req.body?.horseNames) ? req.body.horseNames : [];

    if (!brisnetConfig || typeof brisnetConfig !== 'object') {
      return res.status(400).json({ error: 'Invalid brisnetConfig payload.' });
    }

    try {
      const result = await getBrisnetSignals(brisnetConfig, horseNames);
      return res.json(result);
    } catch (error) {
      return res.status(502).json({
        error: 'BRISNET signal fetch failed.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.post('/race/:raceId/refresh-market', async (req, res) => {
    const raceId = Number(req.params.raceId);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    const race = getRaceStmt.get(raceId);
    if (!race) {
      return res.status(404).json({ error: 'Race not found.' });
    }

    const raceConfig = jsonParseSafe(race.race_config_json, null);
    const brisnetConfig = jsonParseSafe(race.brisnet_config_json, null);
    const horses = listRaceHorsesStmt.all(raceId);
    const horseNames = horses.map((horse) => horse.name);

    if (!raceConfigIsValid(raceConfig)) {
      return res.status(400).json({ error: 'Race does not have a valid live race config.' });
    }

    const updated = {
      odds: 0,
      signals: 0
    };

    try {
      const oddsPayload = await getLiveOdds(raceConfig, horseNames);
      for (const [name, odds] of Object.entries(oddsPayload.oddsByHorse ?? {})) {
        const result = updateHorseOddsStmt.run(String(odds), raceId, name);
        updated.odds += result.changes;
      }

      let brisnetPayload = null;
      if (brisnetConfig && typeof brisnetConfig === 'object') {
        brisnetPayload = await getBrisnetSignals(brisnetConfig, horseNames);
        for (const [name, signal] of Object.entries(brisnetPayload.signals ?? {})) {
          const result = updateHorseSignalStmt.run(Number(signal), raceId, name);
          updated.signals += result.changes;
        }
      }

      const analysis = analyzeRaceById(raceId, Number(req.body?.bankroll));
      return res.json({
        raceId,
        updated,
        analysis,
        fetchedAt: new Date().toISOString(),
        market: {
          odds: {
            provider: oddsPayload.provider,
            url: oddsPayload.url,
            fetchedAt: oddsPayload.fetchedAt
          },
          brisnet: brisnetPayload
            ? {
                provider: brisnetPayload.provider,
                fetchedAt: brisnetPayload.fetchedAt,
                spotPlay: brisnetPayload.spotPlay,
                optixSelections: brisnetPayload.optixSelections,
                sources: brisnetPayload.sources
              }
            : null
        },
        providers: {
          odds: 'BettingNews',
          brisnet: brisnetConfig ? 'BRISNET' : null
        }
      });
    } catch (error) {
      return res.status(502).json({
        error: 'Failed to refresh market data for race.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
};
