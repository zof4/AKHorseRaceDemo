import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { validateCreateRaceInput } from '../utils/validators.js';
import {
  getDefaultPresetId,
  getPresetById,
  listRacePresets,
  listTodayTomorrowPresets
} from '../services/racePresets.js';
import { importEquibaseRaces } from '../services/equibaseImporter.js';
import {
  setOfficialResultsAndSettle,
  tryAutoFetchAndSettleRace
} from '../services/raceResultsService.js';
import { buildRaceOutcomeComparison } from '../services/raceOutcomeComparisonService.js';

const BET_TYPES = ['win', 'place', 'show', 'exacta', 'quinella', 'trifecta', 'superfecta', 'super_hi_5'];

const listRacesStmt = db.prepare(
  `SELECT
      r.id,
      r.name,
      r.track,
      r.race_number,
      r.distance,
      r.surface,
      r.class,
      r.post_time,
      r.status,
      r.source,
      r.takeout_pct,
      r.external_id,
      r.created_at,
      COUNT(h.id) AS horse_count
    FROM races r
    LEFT JOIN horses h ON h.race_id = r.id
    GROUP BY r.id
    ORDER BY
      CASE r.status
        WHEN 'open' THEN 0
        WHEN 'upcoming' THEN 1
        WHEN 'closed' THEN 2
        WHEN 'official' THEN 3
        ELSE 4
      END,
      COALESCE(r.post_time, r.created_at) ASC,
      r.id ASC`
);

const getRaceStmt = db.prepare(
  `SELECT
      id,
      name,
      track,
      race_number,
      distance,
      surface,
      class,
      post_time,
      status,
      source,
      takeout_pct,
      external_id,
      race_config_json,
      brisnet_config_json,
      sources_json,
      results_metadata_json,
      created_at
   FROM races
   WHERE id = ?`
);

const getRaceByExternalIdStmt = db.prepare(
  `SELECT id
   FROM races
   WHERE external_id = ?`
);

const getRaceByIdentityStmt = db.prepare(
  `SELECT id
   FROM races
   WHERE lower(track) = lower(?)
     AND race_number = ?
     AND substr(post_time, 1, 10) = substr(?, 1, 10)
   LIMIT 1`
);

const listHorsesStmt = db.prepare(
  `SELECT
      id,
      race_id,
      name,
      post_position,
      jockey,
      trainer,
      morning_line_odds,
      weight,
      age,
      sex,
      recent_form,
      speed_figures,
      jockey_win_pct,
      trainer_win_pct,
      class_rating,
      speed_rating,
      form_rating,
      pace_fit_rating,
      distance_fit_rating,
      connections_rating,
      consistency_rating,
      volatility_rating,
      late_kick_rating,
      improving_trend_rating,
      brisnet_signal,
      scratched,
      created_at
   FROM horses
   WHERE race_id = ?
   ORDER BY COALESCE(post_position, 999), id ASC`
);

const listExistingHorsesForRaceStmt = db.prepare(
  `SELECT
      name,
      jockey,
      trainer,
      morning_line_odds,
      brisnet_signal,
      scratched
   FROM horses
   WHERE race_id = ?`
);

const listResultsStmt = db.prepare(
  `SELECT
      res.race_id,
      res.horse_id,
      res.finish_position,
      h.name AS horse_name,
      h.post_position
   FROM results res
   JOIN horses h ON h.id = res.horse_id
   WHERE res.race_id = ?
   ORDER BY res.finish_position ASC`
);

const insertRaceStmt = db.prepare(
  `INSERT INTO races (
      name,
      track,
      race_number,
      distance,
      surface,
      class,
      post_time,
      status,
      source,
      takeout_pct,
      external_id,
      race_config_json,
      brisnet_config_json,
      sources_json
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const updateRaceByIdStmt = db.prepare(
  `UPDATE races
   SET
      name = ?,
      track = ?,
      race_number = ?,
      distance = ?,
      surface = ?,
      class = ?,
      post_time = ?,
      status = ?,
      source = ?,
      takeout_pct = ?,
      race_config_json = ?,
      brisnet_config_json = ?,
      sources_json = ?
   WHERE id = ?`
);

const insertHorseStmt = db.prepare(
  `INSERT INTO horses (
      race_id,
      name,
      post_position,
      jockey,
      trainer,
      morning_line_odds,
      weight,
      age,
      sex,
      recent_form,
      speed_figures,
      jockey_win_pct,
      trainer_win_pct,
      class_rating,
      speed_rating,
      form_rating,
      pace_fit_rating,
      distance_fit_rating,
      connections_rating,
      consistency_rating,
      volatility_rating,
      late_kick_rating,
      improving_trend_rating,
      brisnet_signal,
      scratched
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const deleteHorsesForRaceStmt = db.prepare('DELETE FROM horses WHERE race_id = ?');

const insertPoolStmt = db.prepare(
  `INSERT OR IGNORE INTO pools (race_id, bet_type, total_amount)
   VALUES (?, ?, 0)`
);

const updateRaceStatusStmt = db.prepare(
  `UPDATE races
   SET status = ?
   WHERE id = ?`
);

const FINAL_RACE_STATUS = 'official';
const AUTO_FINALIZE_LOOKBACK_DAYS = Math.max(0, Number(process.env.AUTO_FINALIZE_LOOKBACK_DAYS ?? 1));

const padDatePart = (value) => String(value).padStart(2, '0');

const getTodayDateKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`;
};

const readRaceDateKey = (race) => {
  const raceConfig = jsonParseSafe(race?.race_config_json, null);
  if (
    raceConfig &&
    Number.isInteger(Number(raceConfig.year)) &&
    Number.isInteger(Number(raceConfig.month)) &&
    Number.isInteger(Number(raceConfig.day))
  ) {
    return `${Number(raceConfig.year)}-${padDatePart(Number(raceConfig.month))}-${padDatePart(Number(raceConfig.day))}`;
  }

  const externalMatch = String(race?.external_id ?? '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (externalMatch) {
    return `${externalMatch[1]}-${externalMatch[2]}-${externalMatch[3]}`;
  }

  const postTime = String(race?.post_time ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(postTime)) {
    return postTime.slice(0, 10);
  }

  return null;
};

const isRaceWithinAutoFinalizeWindow = (race) => {
  const raceDateKey = readRaceDateKey(race);
  if (!raceDateKey) {
    return false;
  }

  const today = new Date(`${getTodayDateKey()}T00:00:00`);
  const raceDay = new Date(`${raceDateKey}T00:00:00`);
  if (Number.isNaN(today.getTime()) || Number.isNaN(raceDay.getTime())) {
    return false;
  }

  const ageDays = Math.floor((today.getTime() - raceDay.getTime()) / 86_400_000);
  return ageDays >= 0 && ageDays <= AUTO_FINALIZE_LOOKBACK_DAYS;
};

const shouldAutoFinalizeRace = (race, { eager = false } = {}) => {
  if (!race) {
    return false;
  }

  const status = String(race.status ?? '').trim().toLowerCase();
  if (status === FINAL_RACE_STATUS) {
    return false;
  }

  if (Array.isArray(race.results) && race.results.length) {
    return true;
  }

  if (status === 'closed') {
    return true;
  }

  if (eager || isRaceWithinAutoFinalizeWindow(race)) {
    return isRaceWithinAutoFinalizeWindow(race);
  }

  return false;
};

const reconcileRaceState = async ({ io, raceId, eager = false }) => {
  const before = hydrateRace(raceId);
  if (!before) {
    return { race: null, settlement: null, autoResultImport: null, warnings: [] };
  }

  let settlement = null;
  let autoResultImport = null;
  const warnings = [];

  if (Array.isArray(before.results) && before.results.length && String(before.status ?? '').toLowerCase() !== FINAL_RACE_STATUS) {
    updateRaceStatusStmt.run(FINAL_RACE_STATUS, raceId);
  } else if (shouldAutoFinalizeRace(before, { eager })) {
    try {
      autoResultImport = await tryAutoFetchAndSettleRace({ raceId });
      if (autoResultImport?.settled) {
        settlement = autoResultImport.settlement;
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Automatic result check failed.');
    }
  }

  const race = hydrateRace(raceId);
  if (!race) {
    return { race: null, settlement, autoResultImport, warnings };
  }

  if (String(before.status ?? '').toLowerCase() !== String(race.status ?? '').toLowerCase()) {
    io.emit('race_status', { raceId, status: String(race.status) });
  }

  if (settlement) {
    settleAndBroadcast({ io, raceId, settlement });
  }

  return { race, settlement, autoResultImport, warnings };
};

const normalizeHorseKey = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const mergeHorseOnApiReimport = (incomingHorse, existingHorse) => {
  if (!existingHorse) {
    return incomingHorse;
  }

  const incomingOdds = String(incomingHorse.morning_line_odds ?? '').trim();
  const existingOdds = String(existingHorse.morning_line_odds ?? '').trim();
  const existingSignal = Number(existingHorse.brisnet_signal);

  return {
    ...incomingHorse,
    jockey: incomingHorse.jockey || existingHorse.jockey || null,
    trainer: incomingHorse.trainer || existingHorse.trainer || null,
    morning_line_odds: existingOdds || incomingOdds || null,
    brisnet_signal:
      Number.isFinite(existingSignal) && existingSignal > 0
        ? existingSignal
        : incomingHorse.brisnet_signal,
    scratched: Number(existingHorse.scratched) ? 1 : Number(incomingHorse.scratched) ? 1 : 0
  };
};

const hydrateRace = (raceId) => {
  const race = getRaceStmt.get(raceId);
  if (!race) {
    return null;
  }

  const horses = listHorsesStmt.all(raceId).map((horse) => ({
    ...horse,
    recent_form: jsonParseSafe(horse.recent_form, []),
    speed_figures: jsonParseSafe(horse.speed_figures, [])
  }));

  const results = listResultsStmt.all(raceId).map((row) => ({
    race_id: row.race_id,
    horse_id: row.horse_id,
    horse_name: row.horse_name,
    post_position: row.post_position,
    finish_position: row.finish_position
  }));

  return {
    ...race,
    race_config: jsonParseSafe(race.race_config_json, null),
    brisnet_config: jsonParseSafe(race.brisnet_config_json, null),
    sources: jsonParseSafe(race.sources_json, []),
    results_metadata: jsonParseSafe(race.results_metadata_json, null),
    horses,
    results
  };
};

const settleAndBroadcast = ({ io, raceId, settlement }) => {
  if (!settlement) {
    return;
  }

  io.emit('race_results', {
    raceId,
    settledCount: settlement.settledCount,
    results: settlement.results
  });
  io.emit('bets_settled', {
    raceId,
    settledCount: settlement.settledCount
  });
};

const createOrUpdateRaceTx = db.transaction((payload) => {
  const takeout =
    typeof payload.takeout_pct === 'number' && payload.takeout_pct >= 0 && payload.takeout_pct <= 1
      ? payload.takeout_pct
      : Number(process.env.DEFAULT_TAKEOUT_PCT ?? 0.22);

  let raceId;
  let existingHorseByKey = new Map();
  if (payload.external_id) {
    const existing = getRaceByExternalIdStmt.get(payload.external_id);
    if (existing) {
      raceId = Number(existing.id);
      existingHorseByKey = new Map(
        listExistingHorsesForRaceStmt
          .all(raceId)
          .map((horse) => [normalizeHorseKey(horse.name), horse])
      );
      updateRaceByIdStmt.run(
        payload.name,
        payload.track,
        payload.race_number,
        payload.distance,
        payload.surface,
        payload.class,
        payload.post_time,
        payload.status,
        payload.source,
        takeout,
        payload.race_config_json ?? null,
        payload.brisnet_config_json ?? null,
        payload.sources_json ?? null,
        raceId
      );
      deleteHorsesForRaceStmt.run(raceId);
    }
  }

  if (!raceId && payload.track && payload.race_number && payload.post_time) {
    const existingByIdentity = getRaceByIdentityStmt.get(payload.track, payload.race_number, payload.post_time);
    if (existingByIdentity) {
      raceId = Number(existingByIdentity.id);
      existingHorseByKey = new Map(
        listExistingHorsesForRaceStmt
          .all(raceId)
          .map((horse) => [normalizeHorseKey(horse.name), horse])
      );
      updateRaceByIdStmt.run(
        payload.name,
        payload.track,
        payload.race_number,
        payload.distance,
        payload.surface,
        payload.class,
        payload.post_time,
        payload.status,
        payload.source,
        takeout,
        payload.race_config_json ?? null,
        payload.brisnet_config_json ?? null,
        payload.sources_json ?? null,
        raceId
      );
      deleteHorsesForRaceStmt.run(raceId);
    }
  }

  if (!raceId) {
    const raceResult = insertRaceStmt.run(
      payload.name,
      payload.track,
      payload.race_number,
      payload.distance,
      payload.surface,
      payload.class,
      payload.post_time,
      payload.status,
      payload.source,
      takeout,
      payload.external_id ?? null,
      payload.race_config_json ?? null,
      payload.brisnet_config_json ?? null,
      payload.sources_json ?? null
    );
    raceId = Number(raceResult.lastInsertRowid);
  }

  for (const horse of payload.horses) {
    const key = normalizeHorseKey(horse.name);
    const existingHorse = existingHorseByKey.get(key);
    const mergedHorse =
      payload.source === 'api' ? mergeHorseOnApiReimport(horse, existingHorse) : horse;

    insertHorseStmt.run(
      raceId,
      mergedHorse.name,
      mergedHorse.post_position,
      mergedHorse.jockey,
      mergedHorse.trainer,
      mergedHorse.morning_line_odds,
      mergedHorse.weight,
      mergedHorse.age,
      mergedHorse.sex,
      mergedHorse.recent_form,
      mergedHorse.speed_figures,
      mergedHorse.jockey_win_pct,
      mergedHorse.trainer_win_pct,
      mergedHorse.class_rating,
      mergedHorse.speed_rating,
      mergedHorse.form_rating,
      mergedHorse.pace_fit_rating,
      mergedHorse.distance_fit_rating,
      mergedHorse.connections_rating,
      mergedHorse.consistency_rating,
      mergedHorse.volatility_rating,
      mergedHorse.late_kick_rating,
      mergedHorse.improving_trend_rating,
      mergedHorse.brisnet_signal,
      mergedHorse.scratched
    );
  }

  for (const betType of BET_TYPES) {
    insertPoolStmt.run(raceId, betType);
  }

  return raceId;
});

const mapPresetToRacePayload = (preset) => ({
  name: preset.meta.name,
  track: 'Oaklawn Park',
  race_number: Number(preset.raceConfig.raceNumber),
  distance: preset.meta.distance,
  surface: 'Dirt',
  class: preset.meta.class,
  post_time: `${preset.raceConfig.year}-${String(preset.raceConfig.month).padStart(2, '0')}-${String(
    preset.raceConfig.day
  ).padStart(2, '0')}T00:00:00`,
  status: 'upcoming',
  source: 'api',
  takeout_pct: Number(process.env.DEFAULT_TAKEOUT_PCT ?? 0.22),
  external_id: preset.id,
  race_config_json: JSON.stringify(preset.raceConfig ?? {}),
  brisnet_config_json: JSON.stringify(preset.brisnetConfig ?? {}),
  sources_json: JSON.stringify(preset.sources ?? []),
  horses: preset.horses.map((horse, index) => ({
    name: horse.name,
    post_position: index + 1,
    jockey: null,
    trainer: null,
    morning_line_odds: horse.odds,
    weight: null,
    age: null,
    sex: null,
    recent_form: JSON.stringify([]),
    speed_figures: JSON.stringify([horse.speed]),
    jockey_win_pct: null,
    trainer_win_pct: null,
    class_rating: horse.class,
    speed_rating: horse.speed,
    form_rating: horse.form,
    pace_fit_rating: horse.paceFit,
    distance_fit_rating: horse.distanceFit,
    connections_rating: horse.connections,
    consistency_rating: horse.consistency,
    volatility_rating: horse.volatility,
    late_kick_rating: horse.lateKick,
    improving_trend_rating: horse.improvingTrend,
    brisnet_signal: horse.brisnetSignal ?? 50,
    scratched: 0
  }))
});

export const createRacesRouter = (io) => {
  const router = Router();

  router.get('/presets', (_req, res) => {
    const presets = listRacePresets().map((preset) => ({
      id: preset.id,
      label: preset.label,
      meta: preset.meta,
      raceConfig: preset.raceConfig,
      brisnetConfig: preset.brisnetConfig,
      horses: Array.isArray(preset.horses)
        ? preset.horses.map((horse) => ({
            name: horse.name,
            odds: horse.odds,
            history: horse.history,
            speed: horse.speed,
            form: horse.form,
            class: horse.class,
            paceFit: horse.paceFit,
            distanceFit: horse.distanceFit,
            connections: horse.connections,
            consistency: horse.consistency,
            volatility: horse.volatility,
            lateKick: horse.lateKick,
            improvingTrend: horse.improvingTrend,
            brisnetSignal: horse.brisnetSignal
          }))
        : [],
      sourceCount: Array.isArray(preset.sources) ? preset.sources.length : 0,
      horseCount: Array.isArray(preset.horses) ? preset.horses.length : 0,
      isDefault: preset.id === getDefaultPresetId()
    }));

    res.json({ presets });
  });

  router.post('/import/presets', (req, res) => {
    const presetIds = Array.isArray(req.body?.presetIds)
      ? req.body.presetIds.map((entry) => String(entry)).filter(Boolean)
      : null;

    const selected = presetIds?.length
      ? presetIds.map((presetId) => getPresetById(presetId)).filter(Boolean)
      : listTodayTomorrowPresets();

    if (!selected.length) {
      return res.status(400).json({ error: 'No matching presets to import.' });
    }

    const imported = [];
    for (const preset of selected) {
      const payload = mapPresetToRacePayload(preset);
      const raceId = createOrUpdateRaceTx(payload);
      const race = hydrateRace(raceId);
      io.emit('race_created', { race });
      imported.push({ presetId: preset.id, raceId, raceName: race?.name ?? payload.name });
    }

    return res.json({ imported });
  });

  router.post('/import/equibase', async (req, res) => {
    const trackCode =
      typeof req.body?.trackCode === 'string' && req.body.trackCode.trim().length
        ? req.body.trackCode.trim().toUpperCase()
        : 'OP';

    const dates = Array.isArray(req.body?.dates)
      ? req.body.dates.map((entry) => String(entry)).filter(Boolean)
      : [];

    if (!dates.length) {
      return res.status(400).json({ error: 'dates array is required (YYYY-MM-DD).' });
    }

    try {
      const liveImport = await importEquibaseRaces({
        trackCode,
        dates,
        raceNumbers: Array.isArray(req.body?.raceNumbers) ? req.body.raceNumbers : undefined
      });

      const imported = [];
      for (const payload of liveImport.importedPayloads) {
        const raceId = createOrUpdateRaceTx(payload);
        const race = hydrateRace(raceId);
        io.emit('race_created', { race });
        imported.push({ raceId, raceName: race?.name ?? payload.name, externalId: payload.external_id });
      }

      return res.json({
        trackCode,
        imported,
        diagnostics: liveImport.diagnostics
      });
    } catch (error) {
      return res.status(502).json({
        error: 'Equibase import failed.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/', async (_req, res) => {
    try {
      const listedRaces = listRacesStmt.all();
      const candidateRaceIds = listedRaces
        .filter((race) => shouldAutoFinalizeRace(race))
        .map((race) => Number(race.id))
        .filter((raceId) => Number.isInteger(raceId) && raceId > 0);

      for (const raceId of candidateRaceIds) {
        await reconcileRaceState({ io, raceId });
      }

      const races = listRacesStmt.all();
      return res.json({ races });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to load races.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/:raceId(\\d+)', async (req, res) => {
    const raceId = Number(req.params.raceId);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    try {
      const { race } = await reconcileRaceState({ io, raceId, eager: true });
      if (!race) {
        return res.status(404).json({ error: 'Race not found.' });
      }

      return res.json({ race });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to load race.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  router.get('/:raceId(\\d+)/outcome-comparison', (req, res) => {
    const raceId = Number(req.params.raceId);
    const bankroll = Number(req.query.bankroll);

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    try {
      const comparison = buildRaceOutcomeComparison(raceId, bankroll);
      return res.json({ comparison });
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to build outcome comparison.'
      });
    }
  });

  router.post('/', (req, res) => {
    const parsed = validateCreateRaceInput(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const raceId = createOrUpdateRaceTx(parsed.value);
    const race = hydrateRace(raceId);
    io.emit('race_created', { race });

    return res.status(201).json({ race });
  });

  router.patch('/:raceId(\\d+)/status', async (req, res) => {
    const raceId = Number(req.params.raceId);
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const finishOrderInput = Array.isArray(req.body?.finishOrder)
      ? req.body.finishOrder
      : Array.isArray(req.body?.results)
        ? req.body.results
        : [];
    const allowed = new Set(['upcoming', 'open', 'closed', 'official']);

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    if (!allowed.has(status)) {
      return res.status(400).json({ error: 'Invalid race status.' });
    }

    const result = updateRaceStatusStmt.run(status, raceId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Race not found.' });
    }

    const warnings = [];
    let settlement = null;
    let autoResultImport = null;

    if (status === 'closed' || status === 'official') {
      try {
        if (finishOrderInput.length) {
          settlement = setOfficialResultsAndSettle({
            raceId,
            finishOrder: finishOrderInput,
            markOfficial: true
          });
        } else {
          autoResultImport = await tryAutoFetchAndSettleRace({ raceId });
          if (autoResultImport?.settled) {
            settlement = autoResultImport.settlement;
          } else if (autoResultImport?.message) {
            warnings.push(autoResultImport.message);
          }
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : 'Failed to settle results.');
      }
    }

    const race = hydrateRace(raceId);
    io.emit('race_status', { raceId, status: String(race?.status ?? status) });
    settleAndBroadcast({ io, raceId, settlement });
    return res.json({ race, settlement, autoResultImport, warnings });
  });

  router.put('/:raceId(\\d+)/results', (req, res) => {
    const raceId = Number(req.params.raceId);
    const finishOrder = Array.isArray(req.body?.finishOrder)
      ? req.body.finishOrder
      : Array.isArray(req.body?.results)
        ? req.body.results
        : [];
    const markOfficial = req.body?.markOfficial !== false;

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    if (!finishOrder.length) {
      return res.status(400).json({ error: 'finishOrder (array) is required.' });
    }

    try {
      const settlement = setOfficialResultsAndSettle({
        raceId,
        finishOrder,
        markOfficial
      });
      const race = hydrateRace(raceId);
      if (!race) {
        return res.status(404).json({ error: 'Race not found.' });
      }
      io.emit('race_status', { raceId, status: String(race.status) });
      settleAndBroadcast({ io, raceId, settlement });
      return res.json({ race, settlement });
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to set results.' });
    }
  });

  router.post('/:raceId(\\d+)/results/refresh', async (req, res) => {
    const raceId = Number(req.params.raceId);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    try {
      const autoResultImport = await tryAutoFetchAndSettleRace({ raceId });
      const settlement = autoResultImport?.settled ? autoResultImport.settlement : null;
      const race = hydrateRace(raceId);
      if (!race) {
        return res.status(404).json({ error: 'Race not found.' });
      }
      io.emit('race_status', { raceId, status: String(race.status) });
      settleAndBroadcast({ io, raceId, settlement });
      return res.json({
        race,
        settlement,
        autoResultImport
      });
    } catch (error) {
      return res.status(502).json({
        error: 'Failed to refresh official results.',
        detail: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
};
