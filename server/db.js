// SQLite storage using Node's built-in driver (no native modules to compile).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'gym-desk.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  date TEXT,
  day TEXT,
  status TEXT,
  started_at INTEGER,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_started ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Nutrition values are per 100 g (or 100 ml).
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  barcode TEXT,
  source TEXT NOT NULL,            -- custom | off | usda
  source_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  kcal REAL, protein REAL, carbs REAL, fat REAL,
  serving_g REAL,
  serving_label TEXT,
  favourite INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER,
  last_grams REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS foods_barcode ON foods(barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS foods_source ON foods(source, source_id) WHERE source_id IS NOT NULL;

-- Each entry keeps its own copy of the numbers, so editing a food later never rewrites history.
CREATE TABLE IF NOT EXISTS food_log (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  food_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  grams REAL,
  kcal100 REAL, protein100 REAL, carbs100 REAL, fat100 REAL,
  kcal REAL, protein REAL, carbs REAL, fat REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS food_log_date ON food_log(date);

CREATE TABLE IF NOT EXISTS saved_meals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS body (
  date TEXT PRIMARY KEY,
  weight REAL, waist REAL, arm REAL,
  note TEXT,
  updated_at INTEGER NOT NULL
);
`);

// Columns added after the first release.
try { db.exec('ALTER TABLE foods ADD COLUMN recipe TEXT'); } catch {}

module.exports = { db, DATA_DIR };
