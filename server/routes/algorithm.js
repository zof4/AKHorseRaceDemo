import { Router } from 'express';
import { getLiveOdds } from '../services/liveOddsProviders.js';
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
  'improvingTrend'
];

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

  return router;
};
