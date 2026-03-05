import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const defaultPath = path.join(rootDir, 'data', 'app.sqlite');
const configuredPath = process.env.DB_PATH
  ? path.resolve(rootDir, process.env.DB_PATH)
  : defaultPath;

fs.mkdirSync(path.dirname(configuredPath), { recursive: true });

const db = new Database(configuredPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.join(currentDir, 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

const hasColumn = (tableName, columnName) => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
};

const ensureColumn = (tableName, columnName, definition) => {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

ensureColumn('races', 'race_config_json', 'TEXT');
ensureColumn('races', 'brisnet_config_json', 'TEXT');
ensureColumn('races', 'sources_json', 'TEXT');

ensureColumn('horses', 'speed_rating', 'REAL');
ensureColumn('horses', 'form_rating', 'REAL');
ensureColumn('horses', 'pace_fit_rating', 'REAL');
ensureColumn('horses', 'distance_fit_rating', 'REAL');
ensureColumn('horses', 'connections_rating', 'REAL');
ensureColumn('horses', 'consistency_rating', 'REAL');
ensureColumn('horses', 'volatility_rating', 'REAL');
ensureColumn('horses', 'late_kick_rating', 'REAL');
ensureColumn('horses', 'improving_trend_rating', 'REAL');
ensureColumn('horses', 'brisnet_signal', 'REAL');

export const jsonParseSafe = (value, fallback = null) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export default db;
