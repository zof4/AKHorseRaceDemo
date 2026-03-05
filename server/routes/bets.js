import { Router } from 'express';
import db, { jsonParseSafe } from '../db/connection.js';
import { validateAndExpandBet } from '../utils/betValidator.js';
import {
  buildCombinationAmountMap,
  buildPoolLadder,
  estimateTicketPayout
} from '../services/parimutuel.js';

const ALLOWED_RACE_STATUSES_FOR_BETS = new Set(['upcoming', 'open']);

const getRaceForBetStmt = db.prepare(
  `SELECT id, status, takeout_pct
   FROM races
   WHERE id = ?`
);

const getRaceHorseIdsStmt = db.prepare(
  `SELECT id
   FROM horses
   WHERE race_id = ? AND scratched = 0`
);

const getUserForBetStmt = db.prepare(
  `SELECT id, balance, name
   FROM users
   WHERE id = ?`
);

const insertBetStmt = db.prepare(
  `INSERT INTO bets (
      user_id,
      race_id,
      bet_type,
      bet_modifier,
      selections,
      expanded_combinations,
      base_amount,
      total_cost,
      num_combinations
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const getBetByIdStmt = db.prepare(
  `SELECT
      b.id,
      b.user_id,
      b.race_id,
      b.bet_type,
      b.bet_modifier,
      b.selections,
      b.expanded_combinations,
      b.base_amount,
      b.total_cost,
      b.num_combinations,
      b.payout,
      b.is_winner,
      b.created_at,
      u.name AS user_name
   FROM bets b
   JOIN users u ON u.id = b.user_id
   WHERE b.id = ?`
);

const listBetsStmt = db.prepare(
  `SELECT
      b.id,
      b.user_id,
      b.race_id,
      b.bet_type,
      b.bet_modifier,
      b.selections,
      b.expanded_combinations,
      b.base_amount,
      b.total_cost,
      b.num_combinations,
      b.payout,
      b.is_winner,
      b.created_at,
      u.name AS user_name
   FROM bets b
   JOIN users u ON u.id = b.user_id
   WHERE (? IS NULL OR b.race_id = ?)
     AND (? IS NULL OR b.user_id = ?)
   ORDER BY b.created_at DESC, b.id DESC`
);

const listBetsForPoolStmt = db.prepare(
  `SELECT
      expanded_combinations,
      base_amount
   FROM bets
   WHERE race_id = ? AND bet_type = ?`
);

const listPoolsStmt = db.prepare(
  `SELECT race_id, bet_type, total_amount, updated_at
   FROM pools
   WHERE race_id = ?
   ORDER BY bet_type ASC`
);

const getPoolStmt = db.prepare(
  `SELECT race_id, bet_type, total_amount, updated_at
   FROM pools
   WHERE race_id = ? AND bet_type = ?`
);

const upsertPoolStmt = db.prepare(
  `INSERT INTO pools (race_id, bet_type, total_amount, updated_at)
   VALUES (?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(race_id, bet_type)
   DO UPDATE SET
     total_amount = pools.total_amount + excluded.total_amount,
     updated_at = CURRENT_TIMESTAMP`
);

const debitBalanceStmt = db.prepare(
  `UPDATE users
   SET balance = balance - ?
   WHERE id = ? AND balance >= ?`
);

const getUserBalanceStmt = db.prepare('SELECT balance FROM users WHERE id = ?');

const hydrateBet = (row) => ({
  ...row,
  selections: jsonParseSafe(row.selections, {}),
  expanded_combinations: jsonParseSafe(row.expanded_combinations, [])
});

const readCurrentPoolState = (raceId, betType) => {
  const poolRow = getPoolStmt.get(raceId, betType);
  const poolTotal = Number(poolRow?.total_amount ?? 0);

  const rows = listBetsForPoolStmt
    .all(raceId, betType)
    .map((row) => ({
      base_amount: row.base_amount,
      expanded_combinations: jsonParseSafe(row.expanded_combinations, [])
    }));

  const combinationAmounts = buildCombinationAmountMap(rows, betType);
  return { poolTotal, combinationAmounts };
};

const buildPoolsOverview = (raceId, takeoutPct) => {
  const pools = listPoolsStmt.all(raceId);

  return pools.map((pool) => {
    const betType = pool.bet_type;
    const rows = listBetsForPoolStmt
      .all(raceId, betType)
      .map((row) => ({
        base_amount: row.base_amount,
        expanded_combinations: jsonParseSafe(row.expanded_combinations, [])
      }));

    const combinationAmounts = buildCombinationAmountMap(rows, betType);

    return {
      ...pool,
      total_amount: Number(pool.total_amount),
      ladder: buildPoolLadder({
        poolTotal: Number(pool.total_amount),
        takeoutPct,
        combinationAmounts
      })
    };
  });
};

const placeBetTx = db.transaction((payload) => {
  const race = getRaceForBetStmt.get(payload.race_id);
  if (!race) {
    throw new Error('Race not found.');
  }

  if (!ALLOWED_RACE_STATUSES_FOR_BETS.has(race.status)) {
    throw new Error(`Race is ${race.status}; betting is not allowed.`);
  }

  const user = getUserForBetStmt.get(payload.user_id);
  if (!user) {
    throw new Error('User not found.');
  }

  const horseRows = getRaceHorseIdsStmt.all(payload.race_id);
  const allowedHorseIds = new Set(horseRows.map((horse) => Number(horse.id)));
  if (!allowedHorseIds.size) {
    throw new Error('Race has no available horses for betting.');
  }

  const expanded = validateAndExpandBet(payload, allowedHorseIds);
  if (Number(user.balance) < expanded.totalCost) {
    throw new Error('Insufficient balance for this bet.');
  }

  const debitResult = debitBalanceStmt.run(expanded.totalCost, payload.user_id, expanded.totalCost);
  if (debitResult.changes === 0) {
    throw new Error('Insufficient balance for this bet.');
  }

  const insertResult = insertBetStmt.run(
    payload.user_id,
    payload.race_id,
    expanded.betType,
    expanded.betModifier,
    JSON.stringify(payload.selections ?? {}),
    JSON.stringify(expanded.combinations),
    expanded.baseAmount,
    expanded.totalCost,
    expanded.numCombinations
  );

  upsertPoolStmt.run(payload.race_id, expanded.betType, expanded.totalCost);

  const userBalance = Number(getUserBalanceStmt.get(payload.user_id)?.balance ?? user.balance);

  return {
    betId: Number(insertResult.lastInsertRowid),
    expanded,
    raceTakeoutPct: Number(race.takeout_pct),
    userBalance
  };
});

export const createBetsRouter = (io) => {
  const router = Router();

  router.post('/bets/quote', (req, res) => {
    const raceId = Number(req.body?.race_id);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'race_id is required.' });
    }

    const race = getRaceForBetStmt.get(raceId);
    if (!race) {
      return res.status(404).json({ error: 'Race not found.' });
    }

    const horseRows = getRaceHorseIdsStmt.all(raceId);
    const allowedHorseIds = new Set(horseRows.map((horse) => Number(horse.id)));

    try {
      const expanded = validateAndExpandBet(req.body, allowedHorseIds);
      const { poolTotal, combinationAmounts } = readCurrentPoolState(raceId, expanded.betType);

      const estimate = estimateTicketPayout({
        takeoutPct: Number(race.takeout_pct),
        currentPoolTotal: poolTotal,
        baseAmount: expanded.baseAmount,
        totalCost: expanded.totalCost,
        combinationKeys: expanded.combinationKeys,
        currentCombinationAmounts: combinationAmounts
      });

      return res.json({
        quote: {
          bet_type: expanded.betType,
          bet_modifier: expanded.betModifier,
          num_combinations: expanded.numCombinations,
          total_cost: expanded.totalCost,
          estimate
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid bet payload.' });
    }
  });

  router.post('/bets', (req, res) => {
    const raceId = Number(req.body?.race_id);
    const userId = Number(req.body?.user_id);

    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'race_id is required.' });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'user_id is required.' });
    }

    try {
      const result = placeBetTx({
        ...req.body,
        race_id: raceId,
        user_id: userId
      });

      const bet = hydrateBet(getBetByIdStmt.get(result.betId));
      const pools = buildPoolsOverview(raceId, result.raceTakeoutPct);

      io.emit('bet_placed', { bet });
      io.to(`race:${raceId}`).emit('pool_updated', { raceId, pools });

      return res.status(201).json({
        bet,
        user_balance: result.userBalance,
        pools
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to place bet.' });
    }
  });

  router.get('/bets', (req, res) => {
    const raceId = req.query.raceId ? Number(req.query.raceId) : null;
    const userId = req.query.userId ? Number(req.query.userId) : null;

    if (req.query.raceId && (!Number.isInteger(raceId) || raceId <= 0)) {
      return res.status(400).json({ error: 'raceId must be a positive integer.' });
    }

    if (req.query.userId && (!Number.isInteger(userId) || userId <= 0)) {
      return res.status(400).json({ error: 'userId must be a positive integer.' });
    }

    const bets = listBetsStmt
      .all(raceId, raceId, userId, userId)
      .map((row) => hydrateBet(row));

    return res.json({ bets });
  });

  router.get('/bets/user/:userId', (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }

    const bets = listBetsStmt.all(null, null, userId, userId).map((row) => hydrateBet(row));
    return res.json({ bets });
  });

  router.get('/pools/:raceId', (req, res) => {
    const raceId = Number(req.params.raceId);
    if (!Number.isInteger(raceId) || raceId <= 0) {
      return res.status(400).json({ error: 'Invalid race id.' });
    }

    const race = getRaceForBetStmt.get(raceId);
    if (!race) {
      return res.status(404).json({ error: 'Race not found.' });
    }

    const pools = buildPoolsOverview(raceId, Number(race.takeout_pct));
    return res.json({ pools });
  });

  return router;
};
