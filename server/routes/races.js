import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { validateCreateRaceInput } from '../utils/validators.js';
import {
  getDefaultPresetId,
  getPresetById,
  listRacePresets,
  listTodayTomorrowPresets
} from '../services/racePresets.js';

const BET_TYPES = ['exacta', 'quinella', 'trifecta', 'superfecta', 'super_hi_5'];

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
      created_at
   FROM races
   WHERE id = ?`
);

const getRaceByExternalIdStmt = db.prepare(
  `SELECT id
   FROM races
   WHERE external_id = ?`
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

  return {
    ...race,
    race_config: jsonParseSafe(race.race_config_json, null),
    brisnet_config: jsonParseSafe(race.brisnet_config_json, null),
    sources: jsonParseSafe(race.sources_json, []),
    horses
  };
};

const createOrUpdateRaceTx = db.transaction((payload) => {
  const takeout =
    typeof payload.takeout_pct === 'number' && payload.takeout_pct >= 0 && payload.takeout_pct <= 1
      ? payload.takeout_pct
      : Number(process.env.DEFAULT_TAKEOUT_PCT ?? 0.22);

  let raceId;
  if (payload.external_id) {
    const existing = getRaceByExternalIdStmt.get(payload.external_id);
    if (existing) {
      raceId = Number(existing.id);
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
    insertHorseStmt.run(
      raceId,
      horse.name,
      horse.post_position,
      horse.jockey,
      horse.trainer,
      horse.morning_line_odds,
      horse.weight,
      horse.age,
      horse.sex,
      horse.recent_form,
      horse.speed_figures,
      horse.jockey_win_pct,
      horse.trainer_win_pct,
      horse.class_rating,
      horse.speed_rating,
      horse.form_rating,
      horse.pace_fit_rating,
      horse.distance_fit_rating,
      horse.connections_rating,
      horse.consistency_rating,
      horse.volatility_rating,
      horse.late_kick_rating,
      horse.improving_trend_rating,
      horse.brisnet_signal,
      horse.scratched
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

  router.get('/', (_req, res) => {
    const races = listRacesStmt.all();
    res.json({ races });
  });

  router.get('/:raceId', (req, res) => {
    const raceId = Number(req.params.raceId);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    const race = hydrateRace(raceId);
    if (!race) {
      return res.status(404).json({ error: 'Race not found.' });
    }

    return res.json({ race });
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

  router.patch('/:raceId/status', (req, res) => {
    const raceId = Number(req.params.raceId);
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
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

    const race = hydrateRace(raceId);
    io.emit('race_status', { raceId, status });
    return res.json({ race });
  });

  return router;
};
