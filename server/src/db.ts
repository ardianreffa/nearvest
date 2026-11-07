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
  provider TEXT NOT NULL,          -- 'google', 'near' (wallet), 'dev' or 'judge' (Try as Judge)
  subject TEXT NOT NULL,           -- Google 'sub', NEAR account id, dev username or the judge's device id
  email TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, subject)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce TEXT PRIMARY KEY,          -- base64, 32 random bytes (NEP-413 login)
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),  -- 1 login = 1 garden
  name TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,        -- '' for wallet players
  secret_key_enc TEXT NOT NULL,    -- AES-256-GCM encrypted with MASTER_KEY; '' for wallet players
  custody TEXT NOT NULL DEFAULT 'server', -- 'server' (Google: game holds the key) | 'wallet' (player's own account)
  key_nonce INTEGER NOT NULL DEFAULT 0,   -- wallet players: last game-key nonce accepted for a burn
  wallet_account_id TEXT,          -- NEAR wallet that can sign in to this garden (own account or linked); unique
  google_sub TEXT,                 -- Google account linked to a wallet garden (Google 'sub'); unique
  avatar TEXT NOT NULL DEFAULT 'farmer_hat', -- profile avatar id (rules.ts AVATARS)
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

-- TaniBot: one per garden. Its NEAR account holds the PANEN budget; the PANEN
-- contract enforces the daily limit. Its only key is a function call key.
CREATE TABLE IF NOT EXISTS bots (
  player_id INTEGER PRIMARY KEY REFERENCES players(id),
  account_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  secret_key_enc TEXT NOT NULL,    -- the bot's function call key, AES-256-GCM with MASTER_KEY
  mode TEXT NOT NULL,              -- 'sub' (bot.<player>, Google) | 'factory' (<name>-bot, wallet)
  status TEXT NOT NULL,            -- 'creating' | 'linking' | 'ready' | 'failed'
  enabled INTEGER NOT NULL DEFAULT 1,
  style TEXT NOT NULL DEFAULT 'balanced',  -- 'thrifty' | 'balanced' | 'turbo'
  daily_limit_micro INTEGER NOT NULL,
  budget_micro INTEGER NOT NULL DEFAULT 0, -- mirror of the bot's PANEN balance
  spent_day INTEGER,               -- UTC day of spent_micro (same day as the contract)
  spent_micro INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER NOT NULL DEFAULT 0,
  empty_notice_day INTEGER,        -- last day the "budget is empty" notice was logged
  last_ai_at INTEGER NOT NULL DEFAULT 0, -- last AI brain call (demo gardens: at most every 10 minutes)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bot_log (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  action TEXT NOT NULL,            -- 'water' | 'harvest' | 'sell' | 'buy' | 'fertilize' | 'setup' | 'budget' | 'notice' ...
  reason TEXT NOT NULL,
  job_id INTEGER,                  -- chain job that proves it (tx link), if any
  brain TEXT NOT NULL DEFAULT 'rules',  -- 'rules' | 'ai'
  short TEXT,                      -- a few words for the speech bubble above TaniBot
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_log_player ON bot_log(player_id, id);

-- Every call to TaniBot's AI brain (NEAR AI Cloud), for the call limit and the dollar brake.
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  day INTEGER NOT NULL,            -- UTC day
  player_id INTEGER,
  model TEXT NOT NULL,
  ok INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL,          -- estimate from the model's price list
  error TEXT
);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);

-- Try as Judge: the judge tour steps a judge garden has done (and the chain job that proves it).
CREATE TABLE IF NOT EXISTS judge_steps (
  player_id INTEGER NOT NULL REFERENCES players(id),
  step TEXT NOT NULL,              -- 'harvest' | 'sell' | 'shop' | 'tanibot' | 'village'
  job_id INTEGER,                  -- chain job of that action (NULL for the viewing steps)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, step)
);
`;

/** tutorial_step value of a finished (or skipped) tutorial. */
export const TUTORIAL_DONE = 100;

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
  if (!has('players', 'custody')) db.exec("ALTER TABLE players ADD COLUMN custody TEXT NOT NULL DEFAULT 'server'");
  if (!has('players', 'key_nonce')) db.exec('ALTER TABLE players ADD COLUMN key_nonce INTEGER NOT NULL DEFAULT 0');
  if (!has('players', 'wallet_account_id')) db.exec('ALTER TABLE players ADD COLUMN wallet_account_id TEXT');
  if (!has('bot_log', 'short')) db.exec('ALTER TABLE bot_log ADD COLUMN short TEXT');
  if (!has('bots', 'last_ai_at')) db.exec('ALTER TABLE bots ADD COLUMN last_ai_at INTEGER NOT NULL DEFAULT 0');
  if (!has('players', 'google_sub')) db.exec('ALTER TABLE players ADD COLUMN google_sub TEXT');
  if (!has('players', 'avatar')) db.exec("ALTER TABLE players ADD COLUMN avatar TEXT NOT NULL DEFAULT 'farmer_hat'");
  // Tutorial step (game.ts TUTORIAL_STEPS); gardens made before the tutorial existed count as done.
  if (!has('players', 'tutorial_step')) db.exec(`ALTER TABLE players ADD COLUMN tutorial_step INTEGER NOT NULL DEFAULT ${TUTORIAL_DONE}`);
  // Judge gardens: TaniBot waits for the judge's first harvest (at most until this time).
  if (!has('bots', 'hold_until')) db.exec('ALTER TABLE bots ADD COLUMN hold_until INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_google_sub ON players (google_sub)');
  // One wallet = one garden.
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_wallet_account ON players (wallet_account_id)');
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
