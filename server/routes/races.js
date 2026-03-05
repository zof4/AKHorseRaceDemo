import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { validateCreateRaceInput } from '../utils/validators.js';

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
      created_at
   FROM races
   WHERE id = ?`
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
      takeout_pct
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      scratched
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

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

  return { ...race, horses };
};

const createRaceTx = db.transaction((payload) => {
  const takeout =
    typeof payload.takeout_pct === 'number' && payload.takeout_pct >= 0 && payload.takeout_pct <= 1
      ? payload.takeout_pct
      : Number(process.env.DEFAULT_TAKEOUT_PCT ?? 0.22);

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
    takeout
  );

  const raceId = Number(raceResult.lastInsertRowid);

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
      horse.scratched
    );
  }

  for (const betType of BET_TYPES) {
    insertPoolStmt.run(raceId, betType);
  }

  return raceId;
});

export const createRacesRouter = (io) => {
  const router = Router();

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

    const raceId = createRaceTx(parsed.value);
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
