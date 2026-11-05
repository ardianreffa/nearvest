// SQLite database (built into Node.js, no native modules).
// $PANEN amounts are stored in micro-PANEN (1 PANEN = 1,000,000) as integers.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export const MICRO = 1_000_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,          -- 'google' or 'dev'
  subject TEXT NOT NULL,           -- Google 'sub' or dev username
  email TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),  -- 1 login = 1 garden
  name TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  secret_key_enc TEXT NOT NULL,    -- AES-256-GCM encrypted with MASTER_KEY
  account_status TEXT NOT NULL,    -- 'pending' | 'ready' | 'failed'
  demo INTEGER NOT NULL DEFAULT 0,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  checkin_day INTEGER,             -- last check-in game day
  streak INTEGER NOT NULL DEFAULT 0,
  first_tree_planted INTEGER NOT NULL DEFAULT 0,
  created_ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  species TEXT NOT NULL,
  quality TEXT,                    -- NULL = rolled when planted
  parent_tree_id INTEGER,          -- lineage: tree this seed came from
  source TEXT NOT NULL,            -- 'welcome' | 'checkin' | 'shop' | 'tree'
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fruits (
  player_id INTEGER NOT NULL REFERENCES players(id),
  species TEXT NOT NULL,
  quality TEXT NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (player_id, species, quality)
);

CREATE TABLE IF NOT EXISTS items (
  player_id INTEGER NOT NULL REFERENCES players(id),
  item TEXT NOT NULL,
  qty INTEGER NOT NULL,
  PRIMARY KEY (player_id, item)
);

CREATE TABLE IF NOT EXISTS trees (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  plot INTEGER,                    -- NULL once the tree is gone
  species TEXT NOT NULL,
  quality TEXT NOT NULL,
  parent_tree_id INTEGER,
  token_id TEXT,                   -- NFT token id, set when the mint lands
  planted_at INTEGER NOT NULL,
  growth REAL NOT NULL DEFAULT 0,
  target REAL NOT NULL,
  last_tick INTEGER NOT NULL,
  water_until INTEGER NOT NULL DEFAULT 0,
  water_day INTEGER,               -- game day of the last watering
  fert_until INTEGER NOT NULL DEFAULT 0,
  fert_boost INTEGER NOT NULL DEFAULT 0, -- fertilized since the last harvest (better fruit odds)
  harvest_count INTEGER NOT NULL DEFAULT 0,
  max_harvests INTEGER NOT NULL,
  regrow_days REAL NOT NULL,
  synced_stage TEXT,               -- last stage sent to the chain
  status TEXT NOT NULL DEFAULT 'alive',  -- 'alive' | 'dead'
  died_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS trees_plot ON trees(player_id, plot) WHERE status = 'alive';

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL,              -- 'welcome' | 'checkin' | 'sell' | 'shop'
  amount_micro INTEGER NOT NULL,   -- positive = earned, negative = burned
  note TEXT,
  job_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  species TEXT NOT NULL,
  qty INTEGER NOT NULL,
  day INTEGER NOT NULL,            -- game day index (real clock)
  demo INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chain_jobs (
  id INTEGER PRIMARY KEY,
  player_id INTEGER,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,           -- JSON
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chain_jobs_pending ON chain_jobs(status, id);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Adds columns that were introduced after a database was created. */
function migrate(db: DB): void {
  const has = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!has('trees', 'fert_boost')) db.exec('ALTER TABLE trees ADD COLUMN fert_boost INTEGER NOT NULL DEFAULT 0');
}

/** Runs `fn` inside a transaction; rolls back if it throws. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function toMicro(panen: number): number {
  return Math.round(panen * MICRO);
}

export function fromMicro(micro: number): number {
  return micro / MICRO;
}
