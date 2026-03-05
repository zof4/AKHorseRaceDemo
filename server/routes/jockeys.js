import { Router } from 'express';
import db from '../db/connection.js';

const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map();

const listJockeyRideRowsStmt = db.prepare(
  `SELECT
      h.id AS horse_id,
      h.name AS horse_name,
      h.post_position,
      h.jockey,
      h.trainer,
      h.morning_line_odds,
      h.scratched,
      h.speed_rating,
      h.form_rating,
      h.class_rating,
      h.connections_rating,
      h.consistency_rating,
      r.id AS race_id,
      r.name AS race_name,
      r.track AS track_name,
      r.race_number,
      r.post_time,
      r.status AS race_status,
      res.finish_position
   FROM horses h
   JOIN races r ON r.id = h.race_id
   LEFT JOIN results res
     ON res.race_id = h.race_id
    AND res.horse_id = h.id
   WHERE lower(trim(h.jockey)) = lower(trim(?))
   ORDER BY COALESCE(r.post_time, r.created_at) DESC,
            COALESCE(r.race_number, 999) ASC,
            COALESCE(h.post_position, 999) ASC`
);

const toOddsProbability = (oddsText) => {
  const value = String(oddsText ?? '').trim();
  const match = value.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return null;
  }
  return denominator / (numerator + denominator);
};

const avg = (values) => {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  const numbers = values.map((entry) => Number(entry)).filter(Number.isFinite);
  if (!numbers.length) {
    return null;
  }
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(3));
};

const normalizeJockeyKey = (value) => String(value ?? '').trim().toLowerCase();

const summarizeJockeyProfile = (jockeyName, rows) => {
  const raceIds = new Set(rows.map((row) => Number(row.race_id)));
  const tracks = [...new Set(rows.map((row) => row.track_name).filter(Boolean))];
  const wins = rows.filter((row) => Number(row.finish_position) === 1).length;
  const inTheMoney = rows.filter((row) => {
    const finish = Number(row.finish_position);
    return Number.isInteger(finish) && finish >= 1 && finish <= 3;
  }).length;
  const scratched = rows.filter((row) => Number(row.scratched)).length;

  const impliedProbabilities = rows
    .map((row) => toOddsProbability(row.morning_line_odds))
    .filter((value) => Number.isFinite(value));

  const trainerCounts = new Map();
  for (const row of rows) {
    const trainerName = String(row.trainer ?? '').trim();
    if (!trainerName) {
      continue;
    }
    trainerCounts.set(trainerName, (trainerCounts.get(trainerName) ?? 0) + 1);
  }

  const topTrainerPartnerships = [...trainerCounts.entries()]
    .map(([trainer, starts]) => ({ trainer, starts }))
    .sort((left, right) => right.starts - left.starts)
    .slice(0, 5);

  const recentMounts = rows.slice(0, 12).map((row) => ({
    race_id: Number(row.race_id),
    race_name: row.race_name,
    track: row.track_name,
    race_number: row.race_number,
    race_status: row.race_status,
    post_time: row.post_time,
    horse_id: Number(row.horse_id),
    horse_name: row.horse_name,
    post_position: row.post_position,
    trainer: row.trainer,
    odds: row.morning_line_odds,
    scratched: Number(row.scratched),
    finish_position: Number.isInteger(Number(row.finish_position)) ? Number(row.finish_position) : null
  }));

  return {
    jockey: jockeyName,
    generatedAt: new Date().toISOString(),
    source: 'local_db_cached',
    summary: {
      starts: rows.length,
      races: raceIds.size,
      tracks: tracks.length,
      wins,
      inTheMoney,
      scratchedRides: scratched,
      winRate: rows.length ? Number((wins / rows.length).toFixed(4)) : 0,
      itmRate: rows.length ? Number((inTheMoney / rows.length).toFixed(4)) : 0,
      averageImpliedWinProbability: avg(impliedProbabilities),
      averageRatings: {
        speed: avg(rows.map((row) => row.speed_rating)),
        form: avg(rows.map((row) => row.form_rating)),
        class: avg(rows.map((row) => row.class_rating)),
        connections: avg(rows.map((row) => row.connections_rating)),
        consistency: avg(rows.map((row) => row.consistency_rating))
      }
    },
    topTrainerPartnerships,
    tracks,
    recentMounts
  };
};

export const createJockeysRouter = () => {
  const router = Router();

  router.get('/profile', (req, res) => {
    const jockeyName = String(req.query?.name ?? '').trim();
    const forceRefresh = String(req.query?.force ?? '0') === '1';
    if (!jockeyName) {
      return res.status(400).json({ error: 'name query parameter is required.' });
    }

    const key = normalizeJockeyKey(jockeyName);
    const cached = profileCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return res.json({
        profile: cached.profile,
        cache: {
          hit: true,
          ttlMs: Math.max(0, cached.expiresAt - Date.now())
        }
      });
    }

    const rows = listJockeyRideRowsStmt.all(jockeyName);
    if (!rows.length) {
      return res.status(404).json({ error: 'No rides found for this jockey in local race data.' });
    }

    const profile = summarizeJockeyProfile(jockeyName, rows);
    profileCache.set(key, {
      profile,
      expiresAt: Date.now() + PROFILE_CACHE_TTL_MS
    });

    return res.json({
      profile,
      cache: {
        hit: false,
        ttlMs: PROFILE_CACHE_TTL_MS
      }
    });
  });

  return router;
};
