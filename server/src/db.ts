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
  died_at INTEGER,
  -- Weather (weather.ts): last moment the tree had water, cleaned of volcanic ash at, went back
  -- a stage from thirst at, waterings on the current game day (a drought needs two).
  dry_from INTEGER NOT NULL DEFAULT 0,
  ash_clean_at INTEGER NOT NULL DEFAULT 0,
  wilt_at INTEGER NOT NULL DEFAULT 0,
  water_count INTEGER NOT NULL DEFAULT 0
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

-- Garden visits: a player helped water another player's tree (1 per helper per village day).
CREATE TABLE IF NOT EXISTS garden_help (
  id INTEGER PRIMARY KEY,
  helper_id INTEGER NOT NULL REFERENCES players(id),
  owner_id INTEGER NOT NULL REFERENCES players(id),
  tree_id INTEGER NOT NULL REFERENCES trees(id),
  plot INTEGER NOT NULL,
  help_day INTEGER NOT NULL,       -- village day (normal 07:00 WIB day, also for demo gardens)
  helper_xp INTEGER NOT NULL,
  owner_xp INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (helper_id, help_day)
);
CREATE INDEX IF NOT EXISTS garden_help_owner ON garden_help (owner_id, created_at);

-- Stickers: a visitor left a template sticker in a garden (at most 3 per visitor per garden per
-- village day, 5 s apart: social.ts). Until 2026-11-10 the table had UNIQUE (from_id, to_id,
-- sticker_day); migrate() rebuilds old tables without it.
CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES players(id),
  to_id INTEGER NOT NULL REFERENCES players(id),
  sticker TEXT NOT NULL,           -- rules.ts STICKERS id
  sticker_day INTEGER NOT NULL,    -- village day (normal 07:00 WIB day, also for demo gardens)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stickers_to ON stickers (to_id, id);
CREATE INDEX IF NOT EXISTS stickers_pair ON stickers (from_id, to_id, sticker_day);

-- Browsers (random device id in localStorage) a player has used: refuses inviting yourself.
CREATE TABLE IF NOT EXISTS devices (
  player_id INTEGER NOT NULL REFERENCES players(id),
  device_id TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, device_id)
);
CREATE INDEX IF NOT EXISTS devices_device ON devices (device_id);

-- Referral: a new garden made from an invite link (?ref=<name>). Paid after the friend's first harvest.
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY,
  referrer_id INTEGER NOT NULL REFERENCES players(id),
  friend_id INTEGER NOT NULL UNIQUE REFERENCES players(id),  -- one inviter per garden
  device_id TEXT,
  ip TEXT,
  status TEXT NOT NULL,            -- 'pending' | 'paid' | 'refused'
  reason TEXT,                     -- refused: 'self' | 'limit'
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  referrer_job_id INTEGER,
  friend_job_id INTEGER
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id, id);

-- Arena 1 VS 1 (arena.ts, docs/PLAN-arena.md, 2026-11-11): one row per duel, decided and stored
-- by the server (scores and dice in data). New table only: older releases ignore it.
CREATE TABLE IF NOT EXISTS arena_duels (
  id INTEGER PRIMARY KEY,
  challenger_id INTEGER NOT NULL REFERENCES players(id),
  defender_id INTEGER NOT NULL REFERENCES players(id),
  duel_day INTEGER NOT NULL,       -- village day (normal 07:00 WIB day, also for demo gardens)
  winner TEXT NOT NULL,            -- 'challenger' | 'defender'
  practice TEXT,                   -- NULL = real duel; 'self' (same browser / identity) | 'limit'
  prize_micro INTEGER NOT NULL DEFAULT 0,
  job_id INTEGER,                  -- the prize's mint_reward chain job
  xp_c INTEGER NOT NULL DEFAULT 0,
  xp_d INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,              -- JSON: both sides (name, avatar, title, scores, trees) + rounds
  ip TEXT,
  device_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS arena_challenger ON arena_duels (challenger_id, duel_day);
CREATE INDEX IF NOT EXISTS arena_defender ON arena_duels (defender_id, created_at);

-- Arena v2 (arena-match.ts, docs/PLAN-arena.md section 7, 2026-11-11): Rock / Paper / Scissors
-- turns against the other garden's TaniBot. New table only: older releases ignore it (they keep
-- reading arena_duels, whose rows and JSON never change).
CREATE TABLE IF NOT EXISTS arena_matches (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'bot', -- 'bot' (v2: against the computer); 'live' later (v3)
  status TEXT NOT NULL,            -- 'playing' | 'done'
  challenger_id INTEGER NOT NULL REFERENCES players(id),
  defender_id INTEGER NOT NULL REFERENCES players(id),
  duel_day INTEGER NOT NULL,       -- village day (normal 07:00 WIB day), like arena_duels
  turn INTEGER NOT NULL DEFAULT 0, -- turns decided so far
  hp_c INTEGER NOT NULL,
  hp_d INTEGER NOT NULL,
  skill_c INTEGER NOT NULL DEFAULT 0,
  skill_d INTEGER NOT NULL DEFAULT 0,
  bonus_c INTEGER NOT NULL DEFAULT 0, -- garden bonus in percent (0-20)
  bonus_d INTEGER NOT NULL DEFAULT 0,
  bot_pick TEXT,                   -- the computer's pick for the open turn: locked, NEVER sent before the player picks
  winner TEXT,                     -- 'challenger' | 'defender' once done
  end_reason TEXT,                 -- 'ko' | 'turns' | 'left'
  practice TEXT,                   -- NULL | 'self' | 'limit' (as arena_duels)
  prize_micro INTEGER NOT NULL DEFAULT 0,
  job_id INTEGER,
  xp_c INTEGER NOT NULL DEFAULT 0,
  xp_d INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,              -- JSON: both sides (public data) + the decided turns
  ip TEXT,
  device_id TEXT,
  seen_at INTEGER NOT NULL,        -- the player's last request for this match
  turn_started_at INTEGER,         -- when the open turn's 10 s started (server clock; arena-match.ts)
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  -- Online duel (kind 'live', 2026-11-11; status may also be 'invite' | 'paused' | 'cancelled').
  -- Added by migrate() on older databases; older releases name their columns, so they ignore these.
  pick_c TEXT,                     -- this turn's picks of the two players: NEVER sent to the other side
  pick_d TEXT,
  seen_d INTEGER NOT NULL DEFAULT 0, -- the challenged player's last request (seen_at = the challenger's)
  invite_ends_at INTEGER,
  invite_result TEXT,              -- 'accepted' | 'declined' | 'timeout' | 'busy' | 'skipped'
  paused_side TEXT,                -- 'challenger' | 'defender' while paused
  pause_ends_at INTEGER,
  ip_d TEXT,                       -- the challenged player's IP and browser (paid-win limits when they win)
  device_d TEXT
);
CREATE INDEX IF NOT EXISTS arena_match_challenger ON arena_matches (challenger_id, duel_day);
CREATE INDEX IF NOT EXISTS arena_match_defender ON arena_matches (defender_id, ended_at);
CREATE INDEX IF NOT EXISTS arena_match_status ON arena_matches (status);

-- Fishing (fishing.ts, docs/PLAN-fishing.md, 2026-11-11): one row per cast. The catch is rolled and
-- stored at the cast and NEVER sent before the reel. New table only: older releases ignore it.
CREATE TABLE IF NOT EXISTS fishing_casts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  cast_day INTEGER NOT NULL,       -- village day (normal 07:00 WIB day, also for demo gardens)
  catch TEXT NOT NULL,             -- rules.ts FishingCatchId
  base_panen INTEGER NOT NULL DEFAULT 0, -- chest amount (rolled at the cast); else from the table
  line INTEGER,                    -- message in a bottle: index into FISHING_BOTTLE_LINES
  paid INTEGER NOT NULL DEFAULT 0, -- 1 = a paid catch (counts toward the browser / IP limits)
  released INTEGER NOT NULL DEFAULT 0, -- 1 = over the paid limit: let go, 1 XP only
  status TEXT NOT NULL,            -- 'open' (line in the water) | 'done'
  result TEXT,                     -- JSON once reeled: what was given
  panen_micro INTEGER NOT NULL DEFAULT 0, -- PANEN paid (after the Season rule)
  xp INTEGER NOT NULL DEFAULT 0,
  job_id INTEGER,                  -- the mint_reward chain job, if any
  auto INTEGER NOT NULL DEFAULT 0, -- 1 = pulled in by the server (nobody reeled)
  device_id TEXT,
  ip TEXT,
  bite_at INTEGER NOT NULL,
  reeled_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fishing_player ON fishing_casts (player_id, cast_day);
CREATE INDEX IF NOT EXISTS fishing_open ON fishing_casts (status, bite_at);
CREATE INDEX IF NOT EXISTS fishing_device ON fishing_casts (device_id, cast_day);
CREATE INDEX IF NOT EXISTS fishing_ip ON fishing_casts (ip, cast_day);

-- Add friend (social.ts, docs/PLAN-arena.md 7.11, 2026-11-11): one way, no accept needed. New
-- tables only: older releases ignore them.
CREATE TABLE IF NOT EXISTS friends (
  player_id INTEGER NOT NULL REFERENCES players(id),  -- who added
  friend_id INTEGER NOT NULL REFERENCES players(id),  -- who was added
  created_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, friend_id)
);
CREATE INDEX IF NOT EXISTS friends_friend ON friends (friend_id, created_at);
-- Every add (also after a remove): the daily add limit, and the notice to the added garden (only
-- the first add of a pair ever notifies: notify = 1).
CREATE TABLE IF NOT EXISTS friend_adds (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  friend_id INTEGER NOT NULL REFERENCES players(id),
  add_day INTEGER NOT NULL,        -- village day (normal 07:00 WIB day, also for demo gardens)
  notify INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS friend_adds_player ON friend_adds (player_id, add_day);
CREATE INDEX IF NOT EXISTS friend_adds_notice ON friend_adds (friend_id, notify, created_at);
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
  if (!has('players', 'last_seen_at')) db.exec('ALTER TABLE players ADD COLUMN last_seen_at INTEGER');
  // Arena v2 turn timer (2026-11-11): only local test databases had arena_matches before it.
  if (!has('arena_matches', 'turn_started_at')) db.exec('ALTER TABLE arena_matches ADD COLUMN turn_started_at INTEGER');
  // Online duel (2026-11-11): new nullable / DEFAULT columns only (older releases ignore them).
  for (const [col, type] of [
    ['pick_c', 'TEXT'],
    ['pick_d', 'TEXT'],
    ['seen_d', 'INTEGER NOT NULL DEFAULT 0'],
    ['invite_ends_at', 'INTEGER'],
    ['invite_result', 'TEXT'],
    ['paused_side', 'TEXT'],
    ['pause_ends_at', 'INTEGER'],
    ['ip_d', 'TEXT'],
    ['device_d', 'TEXT'],
  ])
    if (!has('arena_matches', col)) db.exec(`ALTER TABLE arena_matches ADD COLUMN ${col} ${type}`);
  // Red dot on the Village tab (2026-11-10): the newest social event the owner has seen (0 = none).
  if (!has('players', 'village_seen_at')) db.exec('ALTER TABLE players ADD COLUMN village_seen_at INTEGER NOT NULL DEFAULT 0');
  // Red dot on the Market tab (2026-11-10): when fruit was last added (a harvest) and when the owner
  // last opened the Market. Gardens that already hold fruit get fruit_at = 1, so their dot shows once.
  if (!has('players', 'fruit_at')) {
    db.exec('ALTER TABLE players ADD COLUMN fruit_at INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE players SET fruit_at = 1 WHERE id IN (SELECT player_id FROM fruits WHERE qty > 0)');
  }
  if (!has('players', 'market_seen_at')) db.exec('ALTER TABLE players ADD COLUMN market_seen_at INTEGER NOT NULL DEFAULT 0');
  // Online dot (2026-11-11): the last sign of life from a visible game tab (POST /api/ping; 0 = never).
  if (!has('players', 'active_at')) db.exec('ALTER TABLE players ADD COLUMN active_at INTEGER NOT NULL DEFAULT 0');
  if (!has('players', 'tutorial_step')) db.exec(`ALTER TABLE players ADD COLUMN tutorial_step INTEGER NOT NULL DEFAULT ${TUTORIAL_DONE}`);
  // Judge gardens: TaniBot waits for the judge's first harvest (at most until this time).
  // TaniBot auto-plant: 'off' | 'common' (only Common or unknown seeds, never Rare or Gold).
  if (!has('bots', 'auto_plant')) db.exec("ALTER TABLE bots ADD COLUMN auto_plant TEXT NOT NULL DEFAULT 'off'");
  if (!has('bots', 'hold_until')) db.exec('ALTER TABLE bots ADD COLUMN hold_until INTEGER NOT NULL DEFAULT 0');
  // Weather (2026-11-09). Thirst counts from the moment this release starts, not from the past:
  // gardens left dry before the weather existed do not wilt at once.
  if (!has('trees', 'dry_from')) {
    db.exec('ALTER TABLE trees ADD COLUMN dry_from INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE trees SET dry_from = ?').run(Date.now());
  }
  if (!has('trees', 'ash_clean_at')) db.exec('ALTER TABLE trees ADD COLUMN ash_clean_at INTEGER NOT NULL DEFAULT 0');
  if (!has('trees', 'wilt_at')) db.exec('ALTER TABLE trees ADD COLUMN wilt_at INTEGER NOT NULL DEFAULT 0');
  if (!has('trees', 'water_count')) db.exec('ALTER TABLE trees ADD COLUMN water_count INTEGER NOT NULL DEFAULT 0');
  // Stickers: up to 3 per visitor per garden per day (2026-11-10): drop the old one-a-day UNIQUE.
  const stickerUnique = (db.prepare('PRAGMA index_list(stickers)').all() as { origin: string }[]).some((i) => i.origin === 'u');
  if (stickerUnique) {
    tx(db, () => {
      db.exec(`CREATE TABLE stickers_new (
        id INTEGER PRIMARY KEY,
        from_id INTEGER NOT NULL REFERENCES players(id),
        to_id INTEGER NOT NULL REFERENCES players(id),
        sticker TEXT NOT NULL,
        sticker_day INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`);
      db.exec('INSERT INTO stickers_new (id, from_id, to_id, sticker, sticker_day, created_at) SELECT id, from_id, to_id, sticker, sticker_day, created_at FROM stickers');
      db.exec('DROP TABLE stickers');
      db.exec('ALTER TABLE stickers_new RENAME TO stickers');
      db.exec('CREATE INDEX IF NOT EXISTS stickers_to ON stickers (to_id, id)');
      db.exec('CREATE INDEX IF NOT EXISTS stickers_pair ON stickers (from_id, to_id, sticker_day)');
    });
  }
  // Garden visits, recorded on every visit (2026-11-10): one row per visitor per garden per village
  // day, also without a sticker. The owner can wave back once per visitor per day (a template
  // sticker sent to the visitor). New table: filled once from the stickers and helps before it.
  const hasVisits = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'visits'").get();
  if (!hasVisits) {
    tx(db, () => {
      db.exec(`CREATE TABLE visits (
        id INTEGER PRIMARY KEY,
        visitor_id INTEGER NOT NULL REFERENCES players(id),
        owner_id INTEGER NOT NULL REFERENCES players(id),
        visit_day INTEGER NOT NULL,      -- village day (normal 07:00 WIB day, also for demo gardens)
        created_at INTEGER NOT NULL,     -- first visit that day
        last_at INTEGER NOT NULL,        -- last visit / sticker / help that day (list order)
        wave_sticker TEXT,               -- the owner waved back with this sticker (rules.ts STICKERS id)
        wave_day INTEGER,                -- village day of the wave back (1 per visitor per day)
        wave_at INTEGER,
        UNIQUE (visitor_id, owner_id, visit_day)
      )`);
      db.exec('CREATE INDEX visits_owner ON visits (owner_id, last_at)');
      db.exec('CREATE INDEX visits_visitor_wave ON visits (visitor_id, wave_at)');
      db.exec(`INSERT OR IGNORE INTO visits (visitor_id, owner_id, visit_day, created_at, last_at)
        SELECT visitor_id, owner_id, day, min(at), max(at) FROM (
          SELECT from_id AS visitor_id, to_id AS owner_id, sticker_day AS day, created_at AS at FROM stickers
          UNION ALL SELECT helper_id, owner_id, help_day, created_at FROM garden_help
        ) GROUP BY visitor_id, owner_id, day`);
    });
  }
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
