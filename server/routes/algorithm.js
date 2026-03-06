import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { getBrisnetSignals, getEquibaseScratches, getLiveOdds } from '../services/liveOddsProviders.js';
import { runBaselineAnalysis } from '../services/baselineAlgorithm.js';
import { tryAutoFetchAndSettleRace } from '../services/raceResultsService.js';
import { analyzeRaceById } from '../services/raceOutcomeComparisonService.js';

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
  `SELECT id, name, track, race_number, status, race_config_json, brisnet_config_json
   FROM races
   WHERE id = ?`
);

const listRaceHorsesStmt = db.prepare(
  `SELECT
      id,
      name,
      morning_line_odds
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

const updateHorseScratchedByNameStmt = db.prepare(
  `UPDATE horses
   SET scratched = 1
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

export const createAlgorithmRouter = (io) => {
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
    const hasLiveOddsConfig = raceConfigIsValid(raceConfig);
    const hasBrisnetConfig = brisnetConfig && typeof brisnetConfig === 'object';

    if (!hasLiveOddsConfig && !hasBrisnetConfig) {
      return res.status(400).json({ error: 'Race does not have valid market provider config.' });
    }

    const updated = {
      odds: 0,
      signals: 0,
      scratches: 0
    };
    const warnings = [];

    try {
      let oddsPayload = null;
      let brisnetPayload = null;
      let scratchesPayload = null;

      if (hasLiveOddsConfig) {
        try {
          oddsPayload = await getLiveOdds(raceConfig, horseNames);
          for (const [name, odds] of Object.entries(oddsPayload.oddsByHorse ?? {})) {
            const result = updateHorseOddsStmt.run(String(odds), raceId, name);
            updated.odds += result.changes;
          }
        } catch (error) {
          warnings.push({
            provider: 'BettingNews',
            message: error instanceof Error ? error.message : 'Unknown live-odds error'
          });
        }
      } else {
        warnings.push({
          provider: 'BettingNews',
          message: 'Skipped: race is missing a valid live-odds config.'
        });
      }

      if (hasBrisnetConfig) {
        try {
          brisnetPayload = await getBrisnetSignals(brisnetConfig, horseNames);
          for (const [name, signal] of Object.entries(brisnetPayload.signals ?? {})) {
            const result = updateHorseSignalStmt.run(Number(signal), raceId, name);
            updated.signals += result.changes;
          }
        } catch (error) {
          warnings.push({
            provider: 'BRISNET',
            message: error instanceof Error ? error.message : 'Unknown BRISNET error'
          });
        }
      } else {
        warnings.push({
          provider: 'BRISNET',
          message: 'Skipped: race has no BRISNET config.'
        });
      }

      try {
        const raceTrack = String(race.track ?? '').toLowerCase();
        const raceNumber = Number(race.race_number ?? raceConfig?.raceNumber ?? 0);
        const trackCode = raceTrack.includes('oaklawn') ? 'OP' : String(raceConfig?.trackCode ?? 'OP');

        if (Number.isInteger(raceNumber) && raceNumber > 0) {
          scratchesPayload = await getEquibaseScratches(trackCode);
          const scratchesForRace = Array.isArray(scratchesPayload.scratchesByRace?.[raceNumber])
            ? scratchesPayload.scratchesByRace[raceNumber]
            : [];

          for (const horseName of scratchesForRace) {
            const result = updateHorseScratchedByNameStmt.run(raceId, horseName);
            updated.scratches += result.changes;
          }
        } else {
          warnings.push({
            provider: 'Equibase',
            message: 'Skipped scratches sync: race number unavailable.'
          });
        }
      } catch (error) {
        warnings.push({
          provider: 'Equibase',
          message: error instanceof Error ? error.message : 'Unknown scratches sync error'
        });
      }

      let analysis = null;
      try {
        analysis = analyzeRaceById(raceId, Number(req.body?.bankroll));
      } catch (error) {
        warnings.push({
          provider: 'Algorithm',
          message: error instanceof Error ? error.message : 'Unable to analyze current field'
        });
      }

      let settlement = null;
      let officialResults = null;
      if (String(race.status ?? '').toLowerCase() !== 'official') {
        try {
          officialResults = await tryAutoFetchAndSettleRace({ raceId });
          if (officialResults?.settled) {
            settlement = officialResults.settlement;
            io?.emit('race_status', { raceId, status: 'official' });
            io?.emit('race_results', {
              raceId,
              settledCount: settlement.settledCount,
              results: settlement.results
            });
            io?.emit('bets_settled', {
              raceId,
              settledCount: settlement.settledCount
            });
          } else if (officialResults?.message) {
            warnings.push({
              provider: 'Results',
              message: officialResults.message
            });
          }
        } catch (error) {
          warnings.push({
            provider: 'Results',
            message: error instanceof Error ? error.message : 'Official results check failed'
          });
        }
      }

      return res.json({
        raceId,
        updated,
        warnings,
        analysis,
        settlement,
        officialResults,
        fetchedAt: new Date().toISOString(),
        market: {
          odds: oddsPayload
            ? {
                provider: oddsPayload.provider,
                url: oddsPayload.url,
                fetchedAt: oddsPayload.fetchedAt,
                oddsByHorse: oddsPayload.oddsByHorse
              }
            : null,
          brisnet: brisnetPayload
            ? {
                provider: brisnetPayload.provider,
                fetchedAt: brisnetPayload.fetchedAt,
                spotPlay: brisnetPayload.spotPlay,
                optixSelections: brisnetPayload.optixSelections,
                sources: brisnetPayload.sources,
                signals: brisnetPayload.signals,
                diagnostics: brisnetPayload.diagnostics
              }
            : null,
          scratches: scratchesPayload
            ? {
                provider: scratchesPayload.provider,
                fetchedAt: scratchesPayload.fetchedAt,
                url: scratchesPayload.url,
                diagnostics: scratchesPayload.diagnostics,
                raceNumber: Number(race.race_number ?? raceConfig?.raceNumber ?? 0),
                scratchesForRace:
                  scratchesPayload.scratchesByRace?.[Number(race.race_number ?? raceConfig?.raceNumber ?? 0)] ?? []
              }
            : null
        },
        providers: {
          odds: hasLiveOddsConfig ? 'BettingNews' : null,
          brisnet: hasBrisnetConfig ? 'BRISNET' : null,
          scratches: 'Equibase'
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
