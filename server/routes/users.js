import { Router } from 'express';
import db from '../db/connection.js';
import { validateCreateUserInput } from '../utils/validators.js';

const listUsersStmt = db.prepare(
  `SELECT id, name, balance, is_algo_bot, created_at
   FROM users
   ORDER BY created_at ASC, id ASC`
);

const findByNameStmt = db.prepare('SELECT id FROM users WHERE lower(name) = lower(?)');
const insertUserStmt = db.prepare(
  `INSERT INTO users (name, balance, is_algo_bot)
   VALUES (?, ?, ?)`
);
const getUserByIdStmt = db.prepare(
  `SELECT id, name, balance, is_algo_bot, created_at
   FROM users
   WHERE id = ?`
);

export const createUsersRouter = (io) => {
  const router = Router();

  router.get('/', (_req, res) => {
    const users = listUsersStmt.all();
    res.json({ users });
  });

  router.post('/', (req, res) => {
    const parsed = validateCreateUserInput(req.body);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const { name } = parsed.value;
    if (findByNameStmt.get(name)) {
      return res.status(409).json({ error: 'That player name is already in use.' });
    }

    const startingBalance = Number(process.env.STARTING_BALANCE ?? 1000);
    const balance = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 1000;

    const result = insertUserStmt.run(name, balance, 0);
    const user = getUserByIdStmt.get(result.lastInsertRowid);

    io.emit('user_joined', { user });
    return res.status(201).json({ user });
  });

  return router;
};
