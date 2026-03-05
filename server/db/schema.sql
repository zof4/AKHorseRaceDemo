PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  balance REAL NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  is_algo_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_algo_bot IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  track TEXT NOT NULL,
  race_number INTEGER,
  distance TEXT,
  surface TEXT,
  class TEXT,
  post_time TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'closed', 'official')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'api')),
  takeout_pct REAL NOT NULL DEFAULT 0.22 CHECK (takeout_pct >= 0 AND takeout_pct <= 1),
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS horses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  post_position INTEGER,
  jockey TEXT,
  trainer TEXT,
  morning_line_odds TEXT,
  weight REAL,
  age INTEGER,
  sex TEXT,
  recent_form TEXT NOT NULL DEFAULT '[]',
  speed_figures TEXT NOT NULL DEFAULT '[]',
  jockey_win_pct REAL,
  trainer_win_pct REAL,
  class_rating REAL,
  scratched INTEGER NOT NULL DEFAULT 0 CHECK (scratched IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE,
  UNIQUE (race_id, name)
);

CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  horse_id INTEGER NOT NULL,
  finish_position INTEGER NOT NULL CHECK (finish_position > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE,
  FOREIGN KEY (horse_id) REFERENCES horses(id) ON DELETE CASCADE,
  UNIQUE (race_id, horse_id),
  UNIQUE (race_id, finish_position)
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  race_id INTEGER NOT NULL,
  bet_type TEXT NOT NULL CHECK (bet_type IN ('exacta', 'quinella', 'trifecta', 'superfecta', 'super_hi_5', 'win', 'place', 'show')),
  bet_modifier TEXT NOT NULL DEFAULT 'straight' CHECK (bet_modifier IN ('straight', 'box', 'wheel', 'key', 'part_wheel')),
  selections TEXT NOT NULL,
  expanded_combinations TEXT NOT NULL DEFAULT '[]',
  base_amount REAL NOT NULL CHECK (base_amount > 0),
  total_cost REAL NOT NULL CHECK (total_cost > 0),
  num_combinations INTEGER NOT NULL CHECK (num_combinations > 0),
  payout REAL,
  is_winner INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pools (
  race_id INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (race_id, bet_type),
  FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS algo_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id INTEGER NOT NULL,
  horse_id INTEGER NOT NULL,
  recent_form_score REAL,
  speed_score REAL,
  jockey_score REAL,
  trainer_score REAL,
  post_score REAL,
  class_score REAL,
  total_score REAL,
  is_sleeper INTEGER NOT NULL DEFAULT 0 CHECK (is_sleeper IN (0, 1)),
  explanation TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (race_id) REFERENCES races(id) ON DELETE CASCADE,
  FOREIGN KEY (horse_id) REFERENCES horses(id) ON DELETE CASCADE,
  UNIQUE (race_id, horse_id)
);

CREATE INDEX IF NOT EXISTS idx_races_status_post_time ON races(status, post_time);
CREATE INDEX IF NOT EXISTS idx_horses_race_id ON horses(race_id);
CREATE INDEX IF NOT EXISTS idx_bets_race_id ON bets(race_id);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_results_race_id ON results(race_id);
