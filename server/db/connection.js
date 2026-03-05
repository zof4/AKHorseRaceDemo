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
